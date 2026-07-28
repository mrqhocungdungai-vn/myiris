// Spawns and drives the two Claude worker shapes: DEV (a one-shot detached
// `claude -p` subprocess) and PO (a resident Agent SDK session). Split out
// of electron/main.mjs (split-main-process-modules): Electron-free — every
// cross-module effect (the run queue, session store, run-stream projection,
// notes-vault/canvas capability hooks, pipeline probes/install) is injected.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn as nodeSpawn } from "node:child_process";
import { poBillingStatus, getOrCreatePoSession, deliverPoTurn, setPoSessionModel, setPoSessionMcpServers } from "./po-session.mjs";
import { computeWorkerEnv } from "./worker-env.mjs";
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
 *   installedAgentFile: (agent: string, cwd: string | null) => string | null,
 *   ensureProjectScaffold: (cwd: string) => { created: string[], error?: string },
 *   openChangesWithTasks: (cwd: string) => string[],
 *   ensureCanvasMcpForRun: () => Promise<any>,
 *   ensureNotesVaultReady: () => void,
 *   checkNotesSkillsStatus: () => { ok: boolean },
 *   notesVaultDir: string,
 *   noteCaptureHintRe: RegExp,
 *   vaultChangedSince: (sinceMs: number) => boolean,
 *   handleClaudeStreamEvent: (run: any, line: string) => void,
 *   pushActivity: (run: any, line: string) => void,
 *   rememberClaudeSessionId: (run: any, claudeSessionId: string | null) => void,
 *   pushToolStart: (run: any, toolId: string, toolName: string, detail: any) => void,
 *   pushToolEnd: (run: any, toolId: string, isError: boolean) => void,
 *   askUserQuestionViaVoice: (workstreamId: string, questions: any[]) => Promise<any>,
 *   spawnImpl?: typeof nodeSpawn,
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
  installedAgentFile,
  ensureProjectScaffold,
  openChangesWithTasks,
  ensureCanvasMcpForRun,
  ensureNotesVaultReady,
  checkNotesSkillsStatus,
  notesVaultDir,
  noteCaptureHintRe,
  vaultChangedSince,
  handleClaudeStreamEvent,
  pushActivity,
  rememberClaudeSessionId,
  pushToolStart,
  pushToolEnd,
  askUserQuestionViaVoice,
  spawnImpl = nodeSpawn,
}) {
  // Group-aware kill for a DEV subprocess (spawned `detached: true`, so it is
  // its own process-group leader on POSIX) — reaches descendant tool
  // subprocesses (bash, MCP servers under bypassPermissions) that a plain
  // child.kill() would orphan. Injected into createRunQueue in main.mjs so
  // run-queue.mjs stays free of process-group/platform knowledge (design.md D1
  // of bound-shutdown-teardown).
  function killChild(child, signal) {
    if (!child?.pid) {
      child?.kill?.(signal);
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Group already gone (or was never formed) — fall back to the direct
      // child, mirroring the escalation path's existing tolerance of a dead
      // process.
      child.kill(signal);
    }
  }

  function runProjectDir(run) {
    const projectDir = findWorkstream(run.workstream_id)?.cwd;
    if (projectDir && fs.existsSync(projectDir)) return projectDir;
    return claudeWorkdir();
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
    // Claude would silently skip the gate the user thinks they are in.
    if (run.agent && !installedAgentFile(run.agent, run.cwd)) {
      runQueue.finalize(
        run.run_id,
        RUN_STATUS.FAILED,
        `The ${agentLabels[run.agent] ?? run.agent} agent is not installed (missing ${agentPrefix}${run.agent}.md). Click "Install agents" in the Iris session bar, then retry.`,
      );
      return;
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

    // Rollback switch for the stateful PO module (design.md Migration Plan):
    // set IRIS_PO_LIVE_SESSION=0 to fall back to the pre-SDK behavior, where PO
    // runs exactly like DEV (one-shot `claude -p --resume`, no live session, no
    // mid-turn questions). No data migration needed — both paths read/write the
    // same workstream.agent_sessions.po id.
    if (run.agent === "po" && process.env.IRIS_PO_LIVE_SESSION !== "0") {
      startPoRun(run);
      return;
    }
    startDevRun(run);
  }

  // The stateless module: unchanged one-shot `claude -p` subprocess per run,
  // exactly as before this change — mechanism AND auth (process.env, `/login`).
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

    const args = [
      "-p", run.task,
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--append-system-prompt",
      systemPrompt,
    ];
    if (run.agent) args.push("--agent", `${agentPrefix}${run.agent}`);
    if (run.model) args.push("--model", run.model);

    // canvas-claude-mcp (design.md D6/5.2): Iris-scoped per-run wiring, never
    // written to ~/.claude. A 0600 temp file (not inline argv) so the bearer
    // token isn't visible via `ps`; deleted once the run's own process ends
    // (see the child "close"/"error" handlers and the spawn-failure catch
    // below) — cleanupMcpConfig() is idempotent and safe to call from all three.
    const mcpRecord = await ensureCanvasMcpForRun();
    let mcpConfigDir = null;
    if (mcpRecord) {
      mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-mcp-"));
      const mcpConfigPath = path.join(mcpConfigDir, "mcp-config.json");
      fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { "iris-canvas": mcpRecord } }), { mode: 0o600 });
      args.push("--mcp-config", mcpConfigPath);
    }
    function cleanupMcpConfig() {
      if (mcpConfigDir) fs.rmSync(mcpConfigDir, { recursive: true, force: true });
      mcpConfigDir = null;
    }

    // CONTEXT IS USER-CONTROLLED. Every role (and plain Claude) keeps its OWN
    // continuous conversation within this workstream: a task always --resumes the
    // role's stored session, no matter what ran in between. Nothing here ever
    // drops a session on its own — context resets only when the USER asks for it:
    // the "New" session button, an explicit voice new-session request, or picking
    // a different project folder (Claude stores conversations per directory).
    // Cross-role context still crosses the PO → DEV gate via the handoff files in
    // the project, never via a shared conversation.
    const key = agentKey(run.agent);
    const previousSession = workstream?.agent_sessions?.[key] ?? null;
    if (previousSession) args.push("--resume", previousSession);

    let child;
    try {
      child = spawnImpl(claudeBinary(), args, {
        cwd: run.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        // D12 (harden-security-boundaries): derived by subtraction, not
        // process.env passed through by reference — GEMINI_API_KEY has no use
        // to any role, and CLAUDE_CODE_OAUTH_TOKEN specifically has none to
        // DEV, confirmed empirically (an invalid token left the CLI's result
        // unaffected — `claude -p` authenticates via its own /login-based
        // credential store, never this env var; only the Agent SDK PO uses
        // reads it). Withholding an unused credential from a worker that runs
        // with bypassPermissions and reads untrusted content is pure risk
        // reduction, not a functional change.
        env: computeWorkerEnv(process.env, ["GEMINI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
        // Process-group leader (POSIX) so killChild's group kill also reaches
        // this run's own tool subprocesses (bash, MCP servers under
        // bypassPermissions) — not unref()'d, the parent keeps managing the
        // child. See design.md D2 of bound-shutdown-teardown.
        detached: true,
      });
    } catch (error) {
      cleanupMcpConfig();
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
      return;
    }

    run.status = RUN_STATUS.RUNNING;
    run.started_at = Date.now() / 1000;
    run.child = child;
    // The id the run will resume (if any) — replaced by the live id once
    // Claude's init event confirms it.
    run.claude_session_id = previousSession ?? null;
    emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

    let stdoutBuffer = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) handleClaudeStreamEvent(run, line);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      cleanupMcpConfig();
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
    });
    child.on("close", (code) => {
      cleanupMcpConfig();
      if (run.status === RUN_STATUS.CANCELLED) {
        runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
        return;
      }
      const result = run.result;
      if (code === 0 && result && !result.is_error) {
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
      } else {
        const detail = result?.result || stderr.trim() || `claude exited with code ${code}`;
        // A dead --resume id (deleted history, moved project) would otherwise fail
        // every subsequent task; dropping it lets the next run start fresh.
        if (previousSession && /no conversation|session.*not.*found|unknown session/i.test(String(detail))) {
          const ws = findWorkstream(run.workstream_id);
          if (ws?.agent_sessions?.[key] === previousSession) {
            delete ws.agent_sessions[key];
            persistSessionStore();
          }
        }
        runQueue.finalize(run.run_id, RUN_STATUS.FAILED, String(detail));
      }
    });
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
    killChild,
    runProjectDir,
    startClaudeRun,
    startDevRun,
    startPoRun,
  };
}
