// Drives the two Claude worker shapes, both now on the Agent SDK: DEV (a
// one-shot `query()` per run) and PO (a resident `query()` session). Neither
// touches a host-installed CLI — the binary ships with the app, see
// bundled-binaries.mjs. Split out of electron/main.mjs
// (split-main-process-modules): Electron-free — every cross-module effect (the
// run queue, session store, run-stream projection, notes-vault/canvas
// capability hooks, pipeline probes/install) is injected.
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  poBillingStatus,
  getOrCreatePoSession,
  deliverPoTurn,
  cancelPoTurn,
  setPoSessionModel,
  setPoSessionMcpServers,
} from "./po-session.mjs";
import { buildSystemPrompt } from "./role-prompt.mjs";
import { budgetWarnFraction, describeCeiling, isCeilingSubtype, resolveRunBudget } from "./run-budget.mjs";
import { buildRunHooks, readInFlightCostUsd } from "./run-hooks.mjs";
import { DECISION_OUTPUT_FORMAT, readRunOutput } from "./run-output-format.mjs";
import { isSessionAlive } from "./run-sessions.mjs";
import { skillsForRole } from "./run-skills.mjs";
import { computeClaudeWorkerEnv } from "./worker-env.mjs";
import { RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";

// A run that terminated because it could not produce valid structured output
// after the SDK's own retries. Named as its own cause: the work it did may be
// complete on disk, and telling the user "the run failed" would send them
// looking for a problem that is not there.
const STRUCTURED_OUTPUT_FAILURE =
  "The run finished its work but could not format a valid summary after several attempts, so its report was " +
  "lost. Check the project for what it actually changed before re-running — the work itself may be done.";

// How many trailing stderr lines a failed run carries. Enough to show a stack or
// a spawn error, small enough that a chatty subprocess cannot turn a failure
// message into a wall of text.
const STDERR_TAIL_LINES = 20;

// The SDK hands stderr over in arbitrary chunks, not lines, so this keeps a
// rolling line buffer rather than concatenating everything a run ever wrote.
// Attached to a run only when it FAILS — on the success path these lines are
// debug noise the user has no reason to read.
function createStderrBuffer(limit = STDERR_TAIL_LINES) {
  const lines = [];
  let partial = "";
  return {
    collect(chunk) {
      partial += String(chunk ?? "");
      const parts = partial.split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) lines.push(line);
      }
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    },
    tail() {
      const all = partial.trim() ? [...lines, partial] : lines;
      return all.slice(-limit).join("\n").trim();
    },
  };
}

// A failure message with the subprocess's own diagnostics behind it. Before
// this, a transport failure reached the user as `Failed to run claude: <message>`
// and nothing else.
function withStderr(message, tail) {
  const diagnostics = tail();
  return diagnostics ? `${message}\n\n--- claude stderr (last ${STDERR_TAIL_LINES} lines) ---\n${diagnostics}` : message;
}

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
 *   handleClaudeStreamMessage: (run: any, message: any) => void,
 *   pushActivity: (run: any, line: string) => void,
 *   rememberClaudeSessionId: (run: any, claudeSessionId: string | null) => void,
 *   pushToolStart: (run: any, toolId: string, toolName: string, detail: any) => void,
 *   pushToolEnd: (run: any, toolId: string, isError: boolean) => void,
 *   askUserQuestionViaVoice: (workstreamId: string, questions: any[]) => Promise<any>,
 *   isSessionAliveImpl?: (sessionId: string, options?: { dir?: string }) => Promise<boolean>,
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
  handleClaudeStreamMessage,
  pushActivity,
  rememberClaudeSessionId,
  pushToolStart,
  pushToolEnd,
  askUserQuestionViaVoice,
  isSessionAliveImpl = isSessionAlive,
  queryImpl = query,
}) {
  function runProjectDir(run) {
    const projectDir = findWorkstream(run.workstream_id)?.cwd;
    if (projectDir && fs.existsSync(projectDir)) return projectDir;
    return claudeWorkdir();
  }

  // A resume id can outlive the transcript it names — history deleted, project
  // moved, or the state directory relocated. Dropping the dead id lets the next
  // task in the workstream start a fresh session instead of failing the same way
  // forever.
  //
  // This used to be reached only *after* a run had already failed, by regex-
  // matching the error string the SDK produced — and the SDK reported it
  // inconsistently (a result message on some runs, an empty
  // `error_during_execution` followed by a throw on others), so the guess had to
  // be made from both paths. `getSessionInfo()` answers the same question
  // directly and *before* the run starts, so a dead id now costs nothing rather
  // than costing a run (run-sessions.mjs).
  function forgetSession(run, key, previousSession) {
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

    // No prompt text is built here. DEV and plain Claude get their base prompt
    // from the same policy PO does (role-prompt.mjs) — that module owns both the
    // wording and the choice of SDK field, which is what stopped the two roles
    // from drifting apart. The only thing decided at this call site is which
    // role is being started and whether the notes vault applies.
    //
    // The vault clause is for plain-Claude runs only (`!run.agent`): PO and DEV
    // must never see it (design.md D3/D5 of the llm-wiki change), and
    // buildRoleInstructions ignores a notesVault passed for any other role.
    let notesVault = null;
    if (!run.agent) {
      ensureNotesVaultReady();
      notesVault = { dir: notesVaultDir, skillsInstalled: checkNotesSkillsStatus().ok };
    }
    const systemPrompt = buildSystemPrompt(run.agent ? "dev" : "plain", { notesVault });

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
    const storedSession = workstream?.agent_sessions?.[key] ?? null;
    // Checked before the run starts, not guessed from the error it would
    // otherwise fail with. Only a positive "this session does not exist" drops
    // the id — see run-sessions.mjs on why an inconclusive probe keeps it.
    let previousSession = storedSession;
    if (storedSession && !(await isSessionAliveImpl(storedSession, { dir: run.cwd }))) {
      previousSession = null;
      forgetSession(run, key, storedSession);
      emitEvent({
        type: "log",
        level: "info",
        message: "The stored Claude session for this role no longer exists — starting a fresh one.",
      });
    }

    const permissionMode = /** @type {import("@anthropic-ai/claude-agent-sdk").PermissionMode} */ (
      process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions"
    );
    // Declared before the options object because three of its fields close over
    // them: the ceilings, the stderr sink, and (for DEV) a canUseTool that has to
    // be able to abort the run it is guarding.
    const budget = resolveRunBudget(run.agent === "dev" ? "dev" : "plain");
    const sessionTitle = [workstream?.label, run.agent ? agentLabels[run.agent] ?? run.agent : "Claude"]
      .filter(Boolean)
      .join(" · ");
    const { collect: collectStderr, tail: stderrTail } = createStderrBuffer();
    // The SDK's Query handle, needed by the PreToolUse hook for the in-flight
    // spend figure. Assigned when the query is created, read only from inside a
    // hook — which cannot fire before iteration begins.
    /** @type {any} */
    let handle = null;
    // Replaces the detached process-group kill: aborting the controller tears
    // down the SDK's own subprocess and everything it spawned, so run-queue no
    // longer needs to know a subprocess exists at all.
    const abortController = new AbortController();
    /** @type {import("@anthropic-ai/claude-agent-sdk").Options} */
    const options = {
      cwd: run.cwd,
      permissionMode,
      // The SDK rejects `bypassPermissions` unless this accompanies it. Only
      // attached for that mode, so IRIS_CLAUDE_PERMISSION_MODE=acceptEdits|plan
      // genuinely restricts the worker rather than being quietly overridden.
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      // Built by role-prompt.mjs, the single policy both roles share. Measured
      // caveat (design.md D1): on a run with `agent` set, the definition's
      // prompt replaces the base, so the `claude_code` preset half is discarded
      // and only the `append` half reaches the model. Plain-Claude runs get both.
      systemPrompt,
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
      // Not "all": a run sees only the skills its own work needs. The lists and
      // the evidence behind each entry live in run-skills.mjs.
      skills: skillsForRole(run.agent === "dev" ? "dev" : "plain"),
      // The runaway guard. Without these a voice-dispatched run executes under
      // bypassPermissions with no turn limit and no spend limit, on a credential
      // the user may be paying per token for. Both produce their own result
      // subtype, which is what lets a ceiling be reported as the different thing
      // it is (see the finalization below).
      maxTurns: budget.maxTurns,
      maxBudgetUsd: budget.maxBudgetUsd,
      stderr: collectStderr,
      // The name the user chose, so a transcript is identifiable instead of
      // carrying an auto-generated summary. This is the declared mechanism for a
      // NEW session; a session that already exists is retitled through
      // renameSession (run-sessions.mjs), which is what run-stream does when it
      // first sees an id.
      ...(sessionTitle ? { title: sessionTitle } : {}),
      // The notes vault lives outside the project the run works in, so it has
      // to be GRANTED, not described. It used to be named in a prose directive
      // and then checked for afterwards — a prompt is not a writable root, and
      // diffing a directory to guess whether the model complied is not a
      // mechanism. Plain-Claude runs only, matching who gets the vault clause.
      ...(notesVault ? { additionalDirectories: [notesVault.dir] } : {}),
      // The guard (spend warning + destructive-command denylist) and the
      // authoritative tool-end boundary. `handle` is assigned just below, before
      // any hook can fire — a hook only runs once the query is iterating.
      hooks: buildRunHooks({
        budget,
        warnFraction: budgetWarnFraction(),
        costUsd: () => readInFlightCostUsd(handle),
        onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
        onActivity: (line) => pushActivity(run, line),
        emitEvent,
      }),
    };
    if (run.agent) {
      // The persona is handed over by value rather than looked up by name in
      // ~/.claude/agents — nothing is installed outside the app.
      const name = `${agentPrefix}${run.agent}`;
      options.agents = { [name]: resolveAgentDefinition(run.agent, run.cwd) };
      options.agent = name;
    }
    if (run.agent) {
      // Role runs only. Plain Claude answers arbitrary spoken requests, and
      // forcing every one of those through a summary/decisions schema would
      // reshape answers that have nothing to do with a build pipeline.
      options.outputFormat = DECISION_OUTPUT_FORMAT;
    }
    if (run.agent === "dev") {
      // "DEV never asks" was a prompt promise with nothing behind it. Measured
      // (design.md D1c): `AskUserQuestion` is only exposed to the model when a
      // `canUseTool` callback is present, and `disallowedTools` removes it even
      // when one is — so this is the guarantee and the callback below is the
      // backstop if a future change adds a callback for some other reason.
      options.disallowedTools = ["AskUserQuestion"];
      options.canUseTool = async (toolName, input) => {
        if (toolName !== "AskUserQuestion") return { behavior: "allow", updatedInput: input };
        // Nobody is listening on the headless path, so waiting here would hang
        // the run and the single execution slot with it. Fail loudly instead:
        // record the violation, then abort so the run settles now rather than
        // continuing on an answer it invented.
        run.askViolation =
          "The DEV run tried to ask a question, but nothing is listening on the headless path. " +
          "DEV must work autonomously; ask the PO to make the decision instead.";
        abortController.abort();
        return { behavior: "deny", message: run.askViolation };
      };
    }
    if (run.model) options.model = run.model;
    if (mcpRecord) options.mcpServers = { "iris-canvas": mcpRecord };
    if (previousSession) options.resume = previousSession;

    options.abortController = abortController;
    run.cancel = () => abortController.abort();

    run.status = RUN_STATUS.RUNNING;
    run.started_at = Date.now() / 1000;
    // The id the run will resume (if any) — replaced by the live id once
    // Claude's init event confirms it.
    run.claude_session_id = previousSession ?? null;
    emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

    try {
      handle = queryImpl({ prompt: run.task, options });
      for await (const message of handle) {
        handleClaudeStreamMessage(run, message);
      }
    } catch (error) {
      // An abort surfaces here as a thrown error; the run was already marked
      // CANCELLED by runQueue.stop() before the abort fired.
      if (run.status === RUN_STATUS.CANCELLED) {
        runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
        return;
      }
      // The other reason this path aborts: DEV reached for AskUserQuestion. The
      // guard aborted deliberately, so report the violation rather than the
      // generic transport error the abort produced.
      if (run.askViolation) {
        runQueue.finalize(run.run_id, RUN_STATUS.FAILED, run.askViolation);
        return;
      }
      // A dead resume id arrives here, not on the result path: the SDK yields
      // `error_during_execution` with an empty `result` and *then* throws with
      // the reason. Without this the id is never dropped and every later task
      // in the workstream fails the same way — which is what relocating
      // CLAUDE_CONFIG_DIR would otherwise cause once, for every workstream
      // holding an id recorded against the old location.
      runQueue.finalize(
        run.run_id,
        RUN_STATUS.ERROR,
        withStderr(`Failed to run claude: ${error.message}`, stderrTail),
      );
      return;
    }

    if (run.status === RUN_STATUS.CANCELLED) {
      runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
      return;
    }

    const result = run.result;
    if (result && !result.is_error && result.subtype === "success") {
      // Prefers structured output, falls back to prose. Also the guard against
      // the JSON string in `result.result` reaching the user's ears — see
      // run-output-format.mjs.
      const read = readRunOutput(result);
      run.decisions = read.decisions;
      // The `[vault-check: …]` caveat that used to be appended here is gone:
      // it existed only because the vault was granted by prose, so Iris had to
      // diff the directory afterwards and guess whether the model had complied.
      // `additionalDirectories` grants it for real, and a caveat derived from a
      // filesystem diff was never evidence of anything anyway — a run can
      // legitimately answer a note question without writing a file.
      runQueue.finalize(run.run_id, RUN_STATUS.COMPLETED, read.text);
      return;
    }

    // A ceiling is not a failure. The run did the work it had room for and then
    // ran out of the allowance Iris starts every run with, which needs a
    // different response from the user than something that broke — so it gets
    // its own terminal status and a message naming the ceiling, its value, and
    // how to raise it, instead of the generic `claude reported <subtype>` below.
    if (isCeilingSubtype(result?.subtype)) {
      runQueue.finalize(run.run_id, RUN_STATUS.LIMITED, describeCeiling(result.subtype, budget));
      return;
    }

    // The run may have done all its real work and then failed only to format a
    // summary. That is not "the run broke", so it does not get the generic
    // failure message.
    if (result?.subtype === "error_max_structured_output_retries") {
      runQueue.finalize(run.run_id, RUN_STATUS.FAILED, STRUCTURED_OUTPUT_FAILURE);
      return;
    }

    // The iterator ending with no result message at all means the transport died
    // without reporting — name that rather than emitting an empty failure.
    const detail = result?.result || (result ? `claude reported ${result.subtype}` : "claude ended without a result");
    runQueue.finalize(run.run_id, RUN_STATUS.FAILED, withStderr(String(detail), stderrTail));
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

    // Same policy DEV routes through, so the two roles' ceilings cannot drift.
    // A resident session applies them once per `query()` — across the session's
    // whole lifetime, not per turn — so a long-lived PO session is measured
    // cumulatively, which is the behaviour a runaway guard wants.
    const budget = resolveRunBudget("po");
    const { collect: collectStderr, tail: stderrTail } = createStderrBuffer();

    /** @type {any} */
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
        budget,
        stderr: collectStderr,
        skills: skillsForRole("po"),
        title: [workstream.label, agentLabels.po ?? "PO"].filter(Boolean).join(" · "),
        // The session supplies the per-turn seams; the policy (thresholds,
        // denylist, what a hook does) stays here so both roles share one.
        // `run` is captured deliberately: hooks that fire between turns route
        // through `state.currentTurn`, which is null then, so nothing lands on
        // a stale run.
        buildHooks: (seams) =>
          buildRunHooks({
            budget,
            warnFraction: budgetWarnFraction(),
            emitEvent,
            ...seams,
          }),
      });
    } catch (error) {
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start PO session: ${error.message}`);
      return;
    }

    // Both roles now cancel through the same caller-facing handle: the queue
    // calls run.cancel() and does not need to know whether it is stopping a
    // one-shot query or a turn inside a resident session. DEV's aborts its
    // controller; PO's interrupts its turn and leaves the session alive.
    run.cancel = () => {
      void cancelPoTurn(state);
    };

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
      .then((result) => {
        // po-session.mjs reports the raw subtype and usage without interpreting
        // either; the budget policy lives here, once, for both roles.
        if (result.usage) run.usage = result.usage;
        if (result.decisions) run.decisions = result.decisions;
        if (isCeilingSubtype(result.subtype)) {
          runQueue.finalize(run.run_id, RUN_STATUS.LIMITED, describeCeiling(result.subtype, budget));
          return;
        }
        if (result.subtype === "error_max_structured_output_retries") {
          runQueue.finalize(run.run_id, RUN_STATUS.FAILED, STRUCTURED_OUTPUT_FAILURE);
          return;
        }
        const output =
          result.status === RUN_STATUS.FAILED ? withStderr(result.output, stderrTail) : result.output;
        runQueue.finalize(run.run_id, result.status, output);
      })
      .catch((error) => {
        // The reason travels on the rejected error (see po-session.mjs pump's
        // finally), not on session state — the session may already be deleted
        // from the map by the time this settles.
        if (error?.poEndReason?.kind === "teardown") {
          runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "PO session was reset before the turn completed.");
          return;
        }
        if (error?.poEndReason?.kind === "cancelled") {
          // Work that survived the interrupt will still run, so saying it was
          // cancelled would be false. Report it rather than letting the user
          // discover it when it finishes.
          const survived = error.poEndReason.survived?.length ?? 0;
          runQueue.finalize(
            run.run_id,
            RUN_STATUS.CANCELLED,
            survived
              ? `Run was stopped before completion. ${survived} queued message${survived === 1 ? "" : "s"} survived the interrupt and will still run.`
              : "Run was stopped before completion.",
          );
          return;
        }
        runQueue.finalize(
          run.run_id,
          RUN_STATUS.ERROR,
          withStderr(`PO session error: ${error.message}`, stderrTail),
        );
      });
  }

  return {
    runProjectDir,
    startClaudeRun,
    startDevRun,
    startPoRun,
  };
}
