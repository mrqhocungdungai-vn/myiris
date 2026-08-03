// Drives the two Claude worker shapes, both now on the Agent SDK: DEV (a
// one-shot `query()` per run) and PO (a resident `query()` session). Neither
// touches a host-installed CLI — the binary ships with the app, see
// bundled-binaries.mjs. Split out of electron/main.mjs
// (split-main-process-modules): Electron-free — every cross-module effect (the
// run queue, session store, run-stream projection, notes-vault/canvas
// capability hooks, pipeline probes/install) is injected.
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { poBillingStatus, getOrCreatePoSession, deliverPoTurn, setPoSessionModel, setPoSessionMcpServers } from "./po-session.mjs";
import { computeClaudeWorkerEnv } from "./worker-env.mjs";
import { RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";

/**
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   findWorkstream: (id: string | null) => any,
 *   persistSessionStore: () => void,
 *   agentKey: (agent: string | null) => string,
 *   resolveAgentModel: (workstream: any, role: string) => string | null,
 *   agentLabels: Record<string, string>,
 *   agentPrefix: string,
 *   claudeWorkdir: () => string,
 *   claudeBinary: () => string,
 *   resolveAgentDefinition: (agent: string, cwd: string | null) => { description: string, prompt: string, model?: string },
 *   irisPluginConfig: () => Array<{ type: "local", path: string, skipMcpDiscovery?: boolean }> | null,
 *   ensureProjectScaffold: (cwd: string) => { created: string[], error?: string },
 *   openChangesWithTasks: (cwd: string) => string[],
 *   ensureCanvasMcpForRun: () => Promise<any>,
 *   ensureNotesVaultReady: () => void,
 *   checkNotesSkillsStatus: () => { ok: boolean },
 *   notesVaultDir: string,
 *   noteCaptureHintRe: RegExp,
 *   vaultChangedSince: (sinceMs: number) => boolean,
 *   handleClaudeStreamMessage: (run: any, message: any) => void,
 *   pushActivity: (run: any, line: string) => void,
 *   rememberClaudeSessionId: (run: any, claudeSessionId: string | null) => void,
 *   pushToolStart: (run: any, toolId: string, toolName: string, detail: any) => void,
 *   pushToolEnd: (run: any, toolId: string, isError: boolean) => void,
 *   askUserQuestionViaVoice: (workstreamId: string, questions: any[]) => Promise<any>,
 *   queryImpl?: typeof query,
 * }} deps
 */
export function createRunExec({
  runQueue,
  emitEvent,
  findWorkstream,
  persistSessionStore,
  agentKey,
  resolveAgentModel,
  agentLabels,
  agentPrefix,
  claudeWorkdir,
  claudeBinary,
  resolveAgentDefinition,
  irisPluginConfig,
  ensureProjectScaffold,
  openChangesWithTasks,
  ensureCanvasMcpForRun,
  ensureNotesVaultReady,
  checkNotesSkillsStatus,
  notesVaultDir,
  noteCaptureHintRe,
  vaultChangedSince,
  handleClaudeStreamMessage,
  pushActivity,
  rememberClaudeSessionId,
  pushToolStart,
  pushToolEnd,
  askUserQuestionViaVoice,
  queryImpl = query,
}) {
  function runProjectDir(run) {
    const projectDir = findWorkstream(run.workstream_id)?.cwd;
    if (projectDir && fs.existsSync(projectDir)) return projectDir;
    return claudeWorkdir();
  }

  // A resume id can outlive the transcript it names — history deleted, project
  // moved, or the state directory relocated. Dropping the dead id lets the next
  // task in the workstream start a fresh session instead of failing the same
  // way forever. Called from both failure paths because the SDK reports this
  // one inconsistently: a result message carrying the reason on some runs, and
  // an empty `error_during_execution` followed by a throw on others.
  function forgetStaleSession(run, key, previousSession, detail) {
    if (!previousSession) return;
    if (!/no conversation|session.*not.*found|unknown session/i.test(String(detail))) return;
    const ws = findWorkstream(run.workstream_id);
    if (ws?.agent_sessions?.[key] !== previousSession) return;
    delete ws.agent_sessions[key];
    persistSessionStore();
  }

  // Shared preamble (cwd, install check, scaffold) then dispatches to the
  // stateful PO module or the stateless DEV module — see design.md D1. This is
  // the `startRun` injected into electron/run-queue.mjs's createRunQueue(), which
  // owns slot acquisition and finalization; both modules finalize through the
  // same runQueue.finalize() path, so they share the single "Claude does one
  // thing at a time" execution slot without either one needing to know the
  // other exists.
  function startClaudeRun(run) {
    run.cwd = runProjectDir(run);

    // A run submitted for a role must run AS that role — falling back to plain
    // Claude would silently skip the gate the user thinks they are in. The
    // personas ship inside the app now, so the only way this fails is a broken
    // bundle, not a missing install step the user could have skipped.
    if (run.agent) {
      try {
        resolveAgentDefinition(run.agent, run.cwd);
      } catch (error) {
        runQueue.finalize(
          run.run_id,
          RUN_STATUS.FAILED,
          `The ${agentLabels[run.agent] ?? run.agent} persona could not be loaded: ${error.message}`,
        );
        return;
      }
    }

    // First role run in a fresh project: make it OpenSpec-ready (`openspec init`)
    // so the PO can propose changes and the DEV can implement their tasks.
    if (run.agent) {
      const scaffold = ensureProjectScaffold(run.cwd);
      if (scaffold.created.length) {
        emitEvent({
          type: "log",
          level: "info",
          message: `Set up ${run.cwd} for the agent pipeline: ${scaffold.created.join(", ")}.`,
        });
      }
      if (scaffold.error) {
        emitEvent({ type: "log", level: "warn", message: `Project setup incomplete (${scaffold.error}) — the run continues anyway.` });
      }
    }

    // DEV runs only against an open OpenSpec change with unchecked tasks (see the
    // po-voice-controller change / openspec-native-pipeline spec). No open change
    // with work means the PO has not proposed yet — fail loudly rather than let
    // DEV free-code without a spec, and tell the user to have the PO propose first.
    if (run.agent === "dev" && !openChangesWithTasks(run.cwd).length) {
      runQueue.finalize(
        run.run_id,
        RUN_STATUS.FAILED,
        "No open OpenSpec change with remaining tasks to implement. Ask the PO to grill and propose a change first (it creates openspec/changes/<name>/tasks.md), then run the DEV.",
      );
      return;
    }

    // PO is the stateful module: a resident session that can pause mid-turn to
    // ask. The IRIS_PO_LIVE_SESSION rollback switch is gone — it fell back to a
    // one-shot `claude -p --resume` subprocess path that no longer exists now
    // that both roles run on the Agent SDK.
    if (run.agent === "po") {
      startPoRun(run);
      return;
    }
    startDevRun(run);
  }

  // The stateless module: one `query()` per run, torn down when it finalizes.
  // Distinct from PO's resident session in lifetime, not in transport.
  async function startDevRun(run) {
    // Model is resolved at run START (not at submit time), so a model change
    // made while this task was queued still applies — see design.md D4. Only
    // role runs are model-selectable; plain Claude gets no --model flag and no
    // --fallback-model is ever set (an unavailable model must fail loudly, not
    // silently downgrade — see design.md D6).
    const workstream = findWorkstream(run.workstream_id);
    run.model = run.agent ? resolveAgentModel(workstream, run.agent) : null;

    // DEV (stateless module): never asks mid-run, always defaults. The PO
    // (stateful module, see startPoRun) gets the opposite instruction — it is
    // allowed to pause via AskUserQuestion — so the two must not share this string.
    let systemPrompt =
      "You are invoked from Iris voice. Work autonomously. Do not ask for clarification unless absolutely impossible. Use sensible defaults and report concise final results.";

    // Personal-knowledge-notes capability: plain-Claude runs only (`!run.agent`)
    // — PO and DEV must see this exact string unchanged (design.md D3/D5 of the
    // llm-wiki change). Verified manually per task 2.3: when `run.agent` is set,
    // this whole branch is skipped, so `systemPrompt` stays byte-identical to
    // the base string above — there is no other place that mutates it.
    if (!run.agent) {
      ensureNotesVaultReady();
      if (checkNotesSkillsStatus().ok) {
        systemPrompt +=
          ` The personal-notes / LLM-Wiki vault root is fixed at ${notesVaultDir}, regardless of the current working directory — use the wiki skills there for any note-taking or second-brain request. wiki-config.md and wiki-schema.md already exist in that vault; never ask the user for the wiki root path or wait for a reply — proceed directly using this path.`;
      } else {
        // Vault creation and skill installation are independent actions on
        // independent schedules — the vault can exist before "Install missing"
        // is ever clicked. Without this branch the directive above would send
        // Claude looking for wiki skills that aren't installed, and it would
        // either invent an ungoverned note format or hallucinate the skill's
        // behavior instead of refusing honestly.
        systemPrompt +=
          " The personal-notes / LLM-Wiki skills are not installed on this machine yet. If the user asks to capture, save, or retrieve a personal note or second-brain entry, tell them the notes capability needs to be installed first (Iris's setup panel, \"Install missing\") — do not attempt an ad-hoc note file in its place.";
      }
    }

    // canvas-claude-mcp (design.md D6/5.2): Iris-scoped per-run wiring, never
    // written to ~/.claude. The SDK takes the server record directly, so the
    // bearer token now travels in-process — it never reaches a temp file or an
    // argv visible to `ps`, and there is nothing left to clean up afterwards.
    const mcpRecord = await ensureCanvasMcpForRun();

    // CONTEXT IS USER-CONTROLLED. Every role (and plain Claude) keeps its OWN
    // continuous conversation within this workstream: a task always resumes the
    // role's stored session, no matter what ran in between. Nothing here ever
    // drops a session on its own — context resets only when the USER asks for it:
    // the "New" session button, an explicit voice new-session request, or picking
    // a different project folder (Claude stores conversations per directory).
    // Cross-role context still crosses the PO → DEV gate via the handoff files in
    // the project, never via a shared conversation.
    const key = agentKey(run.agent);
    const previousSession = workstream?.agent_sessions?.[key] ?? null;

    const permissionMode = /** @type {import("@anthropic-ai/claude-agent-sdk").PermissionMode} */ (
      process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions"
    );
    /** @type {import("@anthropic-ai/claude-agent-sdk").Options} */
    const options = {
      cwd: run.cwd,
      permissionMode,
      // The SDK rejects `bypassPermissions` unless this accompanies it. Only
      // attached for that mode, so IRIS_CLAUDE_PERMISSION_MODE=acceptEdits|plan
      // genuinely restricts the worker rather than being quietly overridden.
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      // The typed equivalent of the old `--append-system-prompt` flag: Claude
      // Code's own system prompt, plus Iris's instructions. Stated explicitly
      // rather than relying on `appendSystemPrompt` (which the SDK still honours
      // at runtime but does not declare on Options) so the base prompt is not
      // left to a default that could change.
      systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt },
      env: computeClaudeWorkerEnv(process.env),
      pathToClaudeCodeExecutable: claudeBinary(),
      // The skills and /opsx commands the personas invoke, from the app bundle.
      // Namespaced by the plugin: `iris:grilling`, `/iris:opsx:apply`.
      ...(irisPluginConfig() ? { plugins: irisPluginConfig() } : {}),
      // The user's ~/.claude is deliberately NOT a source: Iris brings its own
      // skills and must not depend on, or be perturbed by, whatever the user has
      // installed in their own Claude Code. "project" is kept so a run still
      // picks up the settings of the repository it is working in.
      settingSources: /** @type {Array<"project">} */ (["project"]),
      skills: /** @type {"all"} */ ("all"),
    };
    if (run.agent) {
      // The persona is handed over by value rather than looked up by name in
      // ~/.claude/agents — nothing is installed outside the app.
      const name = `${agentPrefix}${run.agent}`;
      options.agents = { [name]: resolveAgentDefinition(run.agent, run.cwd) };
      options.agent = name;
    }
    if (run.model) options.model = run.model;
    if (mcpRecord) options.mcpServers = { "iris-canvas": mcpRecord };
    if (previousSession) options.resume = previousSession;

    // Replaces the detached process-group kill: aborting the controller tears
    // down the SDK's own subprocess and everything it spawned, so run-queue no
    // longer needs to know a subprocess exists at all.
    const abortController = new AbortController();
    options.abortController = abortController;
    run.cancel = () => abortController.abort();

    run.status = RUN_STATUS.RUNNING;
    run.started_at = Date.now() / 1000;
    // The id the run will resume (if any) — replaced by the live id once
    // Claude's init event confirms it.
    run.claude_session_id = previousSession ?? null;
    emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

    try {
      for await (const message of queryImpl({ prompt: run.task, options })) {
        handleClaudeStreamMessage(run, message);
      }
    } catch (error) {
      // An abort surfaces here as a thrown error; the run was already marked
      // CANCELLED by runQueue.stop() before the abort fired.
      if (run.status === RUN_STATUS.CANCELLED) {
        runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
        return;
      }
      // A dead resume id arrives here, not on the result path: the SDK yields
      // `error_during_execution` with an empty `result` and *then* throws with
      // the reason. Without this the id is never dropped and every later task
      // in the workstream fails the same way — which is what relocating
      // CLAUDE_CONFIG_DIR would otherwise cause once, for every workstream
      // holding an id recorded against the old location.
      forgetStaleSession(run, key, previousSession, error.message);
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to run claude: ${error.message}`);
      return;
    }

    if (run.status === RUN_STATUS.CANCELLED) {
      runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
      return;
    }

    const result = run.result;
    if (result && !result.is_error && result.subtype === "success") {
      let output = String(result.result ?? "");
      // Backstop for the soft append-system-prompt vault directive (design.md
      // Risks): the directive is a prompt, not a sandboxed writable root, so
      // Claude could ignore it. Only checked for plain-Claude tasks that look
      // like a note-capture request, so unrelated tasks (e.g. "translate
      // this") never get a spurious caveat — and only when nothing under the
      // vault changed, so a real save is never second-guessed.
      if (!run.agent && noteCaptureHintRe.test(run.task) && !vaultChangedSince(run.started_at * 1000)) {
        output +=
          `\n\n[vault-check: no file changes detected under ${notesVaultDir} during this run — verify the note actually saved before confirming that to the user]`;
      }
      runQueue.finalize(run.run_id, RUN_STATUS.COMPLETED, output);
      return;
    }

    // The iterator ending with no result message at all means the transport died
    // without reporting — name that rather than emitting an empty failure.
    const detail = result?.result || (result ? `claude reported ${result.subtype}` : "claude ended without a result");
    forgetStaleSession(run, key, previousSession, detail);
    runQueue.finalize(run.run_id, RUN_STATUS.FAILED, String(detail));
  }

  // The stateful module: delivers the turn into the workstream's resident Agent
  // SDK session (creating it on the first PO turn), instead of spawning a new
  // process. See electron/po-session.mjs and design.md D1/D2/D3.
  async function startPoRun(run) {
    const workstream = findWorkstream(run.workstream_id);
    if (!workstream) {
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, "Unknown workstream for PO run.");
      return;
    }
    const billing = poBillingStatus();
    if (!billing.ok) {
      runQueue.finalize(
        run.run_id,
        RUN_STATUS.FAILED,
        "PO needs a subscription token: run `claude setup-token`, set CLAUDE_CODE_OAUTH_TOKEN (see .env.example), then retry. DEV is unaffected.",
      );
      return;
    }

    // Resolved at run start (not submit time) so a model change made while this
    // task was queued still applies — see design.md D5.
    run.model = resolveAgentModel(workstream, "po");
    // canvas-claude-mcp (design.md D6/5.1): awaits server-ready before wiring,
    // so a PO turn that fires the instant the canvas is engaged never wires an
    // undefined URL, and never wires anything at all when the canvas MCP does
    // not apply to this session.
    const mcpRecord = await ensureCanvasMcpForRun();
    const mcpServers = mcpRecord ? { "iris-canvas": mcpRecord } : undefined;

    run.status = RUN_STATUS.RUNNING;
    run.started_at = Date.now() / 1000;
    run.claude_session_id = workstream.agent_sessions?.po ?? null;
    emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

    let state;
    try {
      state = getOrCreatePoSession(workstream, {
        agent: `${agentPrefix}po`,
        agentDefinition: resolveAgentDefinition("po", run.cwd),
        plugins: irisPluginConfig(),
        cwd: run.cwd,
        resumeSessionId: workstream.agent_sessions?.po ?? null,
        claudeExecutable: claudeBinary(),
        onAskUserQuestion: (workstreamId, questions) => askUserQuestionViaVoice(workstreamId, questions),
        model: run.model,
        mcpServers,
      });
    } catch (error) {
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start PO session: ${error.message}`);
      return;
    }

    // The session may already be live on an older model (created before a
    // queued model change) — switch it via setModel() so the turn about to run
    // uses the current choice with the session's context fully preserved,
    // instead of closing/resuming just to change models.
    const modelReady = (
      state.currentModel === run.model ? Promise.resolve() : setPoSessionModel(state, run.model)
    ).catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not switch PO's live session model: ${error.message}` });
    });
    // Applied lazily, at most once per session (design.md D6/D8) — a session
    // created before the canvas was engaged gets wired here on its first turn
    // after; a session created with it already set (mcpServers above) has
    // state.currentMcp === true and this is a no-op.
    const mcpReady = (
      state.currentMcp || !mcpServers ? Promise.resolve() : setPoSessionMcpServers(state, mcpServers)
    ).catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not wire the canvas MCP into PO's live session: ${error.message}` });
    });

    Promise.all([modelReady, mcpReady])
      .then(() =>
        deliverPoTurn(state, run.task, {
          onActivity: (line) => pushActivity(run, line),
          onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
          onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
          onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
        }),
      )
      .then((result) => runQueue.finalize(run.run_id, result.status, result.output))
      .catch((error) => {
        // The reason travels on the rejected error (see po-session.mjs pump's
        // finally), not on session state — the session may already be deleted
        // from the map by the time this settles.
        if (error?.poEndReason?.kind === "teardown") {
          runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "PO session was reset before the turn completed.");
          return;
        }
        if (error?.poEndReason?.kind === "cancelled") {
          runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
          return;
        }
        runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `PO session error: ${error.message}`);
      });
  }

  return {
    runProjectDir,
    startClaudeRun,
    startDevRun,
    startPoRun,
  };
}
