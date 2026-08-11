// The stateless run shape: one `query()` per run, torn down when it finalizes.
// Distinct from the resident session (stateful-session.mjs) in LIFETIME, not in
// transport — both run on the Agent SDK's `query()`, and which shape a verb
// takes is declared in verbs.mjs, never decided here.
//
// Extracted from run-exec.mjs (the-sessions-are-named-for-their-shape D4) as a
// verbatim move: run-exec.mjs was 1040 lines and held the stateless half inline
// while the stateful half had a module of its own, so the pair the whole design
// rests on was invisible on the file tree. run-exec.mjs constructs this and
// re-exposes its `startStatelessRun`, so nothing outside it changed.
//
// Electron-free, like everything it was extracted from: every cross-module
// effect (the run queue, session store, stream projection, canvas/vault
// capability hooks) arrives injected.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPrompt } from "./role-prompt.mjs";
import { budgetWarnFraction, describeCeiling, isCeilingSubtype, resolveRunBudget } from "./run-budget.mjs";
import { buildRunHooks, readInFlightCostUsd } from "./run-hooks.mjs";
import {
  DECISION_OUTPUT_FORMAT,
  STRUCTURED_OUTPUT_FAILURE,
  createStderrBuffer,
  readRunOutput,
  withStderr,
} from "./run-output-format.mjs";
import { isSessionAlive } from "./run-sessions.mjs";
import { computeClaudeWorkerEnv } from "./worker-env.mjs";
import { RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";
import { buildRunPrompt } from "./run-context.mjs";
import { QUESTION_EXPIRY } from "./run-stream.mjs";

/**
 * The tools this run may not use — the verb's own state-resolved bound, narrowed
 * by whether an answer could actually be delivered (ask-when-unspecified D2).
 *
 * Two independent things must hold for a question to be answerable: the work
 * must be unspecified, so asking is warranted (project state, decided by the
 * registry), and a voice layer must be connected, so the answer can arrive. If
 * either fails the tool is absent — the guarantee is structural, and the model
 * is never offered a tool whose use would abort its run.
 *
 * Exported so this composition is assertable on its own, without driving a run.
 *
 * @param {{ disallowedTools: string[] }} verb
 * @param {boolean} canRelay whether anything can currently relay a question
 * @returns {string[]}
 */
export function effectiveDisallowedTools(verb, canRelay) {
  const list = [...verb.disallowedTools];
  if (!canRelay && !list.includes("AskUserQuestion")) list.push("AskUserQuestion");
  return list;
}

// The user-facing account of a run that stopped because its question was never
// answered (ask-when-unspecified D3). Names what it needed to know, and says
// outright that nothing was chosen — this text is what reaches the spoken
// announcement and the record appended to the notes inbox, and neither may read
// as though the user had been consulted.
function describeUnansweredQuestion(questions) {
  const asked = (questions ?? [])
    .map((q) => String(q?.question ?? "").trim())
    .filter(Boolean);
  return [
    "This run needed something decided before it could go on, no answer arrived in time, so it stopped " +
      "without writing anything further.",
    asked.length
      ? `What it needed to know: ${asked.map((q) => `"${q}"`).join(" ")}`
      : "It did not record what it needed to know.",
    "Nothing was chosen on your behalf and no default was applied. Say what you want and it can pick up from there.",
  ].join(" ");
}

/**
 * The stateless subset of createRunExec's dependencies — the same objects, so a
 * run behaves identically whichever module holds the code.
 *
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   findWorkstream: (id: string | null) => any,
 *   persistSessionStore: () => void,
 *   sessionKeyFor: (verb: string, state?: any) => string,
 *   resolveVerbModel: (workstream: any, verb: string) => string | null,
 *   agentPrefix: string,
 *   claudeBinary: () => string,
 *   resolveAgentDefinition: (base: string, cwd: string | null) => { description: string, prompt: string, model?: string },
 *   irisPluginConfig: () => Array<{ type: "local", path: string, skipMcpDiscovery?: boolean }> | null,
 *   ensureCanvasMcpForRun: () => Promise<any>,
 *   ensureNotesVaultReady: () => void,
 *   checkNotesSkillsStatus: () => { ok: boolean },
 *   notesVaultDir: string,
 *   notesInboxDir: string,
 *   recentUtterances: () => Array<{ text: string, at: number }>,
 *   listenWindowEndedAt?: () => number,
 *   resolveFocusForPrompt?: () => Array<{ id: string, title: string, tags: string[] }> | null,
 *   resolveOpenNoteForRun?: () => { id: string, title: string, tags: string[], relativePath: string } | null,
 *   handleClaudeStreamMessage: (run: any, message: any) => void,
 *   pushActivity: (run: any, line: string) => void,
 *   pushToolEnd: (run: any, toolId: string, isError: boolean) => void,
 *   askUserQuestionViaVoice: (workstreamId: string, questions: any[], options?: { onExpiry?: string }) => Promise<any>,
 *   canRelayQuestion?: () => boolean,
 *   isSessionAliveImpl?: (sessionId: string, options?: { dir?: string }) => Promise<boolean>,
 *   queryImpl?: typeof query,
 * }} deps
 */
export function createStatelessSession({
  runQueue,
  emitEvent,
  findWorkstream,
  persistSessionStore,
  sessionKeyFor,
  resolveVerbModel,
  agentPrefix,
  claudeBinary,
  resolveAgentDefinition,
  irisPluginConfig,
  ensureCanvasMcpForRun,
  ensureNotesVaultReady,
  checkNotesSkillsStatus,
  notesVaultDir,
  notesInboxDir,
  recentUtterances,
  listenWindowEndedAt = () => 0,
  resolveFocusForPrompt = () => null,
  resolveOpenNoteForRun = () => null,
  handleClaudeStreamMessage,
  pushActivity,
  pushToolEnd,
  askUserQuestionViaVoice,
  // Defaults to FALSE and fails closed on purpose: a wiring that forgot to
  // supply it withholds the question tool rather than granting a tool whose
  // answer nothing could deliver.
  canRelayQuestion = () => false,
  isSessionAliveImpl = isSessionAlive,
  queryImpl = query,
}) {
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

  // The stateless shape: one `query()` per run, torn down when it finalizes.
  // Distinct from the resident session in lifetime, not in transport.
  async function startStatelessRun(run, resolvedVerb) {
    // The registry decided whether asking is WARRANTED (from project state);
    // this decides whether it is DELIVERABLE, and the run is configured from
    // both (design D2). Narrowed once, here, and everything downstream —
    // the system prompt included — reads the narrowed value, so the prose can
    // never promise a tool the run was not given.
    const verb = {
      ...resolvedVerb,
      disallowedTools: effectiveDisallowedTools(resolvedVerb, canRelayQuestion()),
    };
    const mayAsk = !verb.disallowedTools.includes("AskUserQuestion");

    // Model is resolved at run START (not at submit time), so a model change
    // made while this task was queued still applies. No --fallback-model is ever
    // set: an unavailable model must fail loudly, not silently downgrade.
    const workstream = findWorkstream(run.workstream_id);
    run.model = resolveVerbModel(workstream, verb.verb);

    // No prompt text is built here. Every verb gets its instruction from one
    // policy (role-prompt.mjs), which owns both the wording and the choice of
    // SDK field — that is what stopped two call sites from drifting apart. The
    // only thing decided here is whether the notes vault applies, which is
    // itself a declared property of the verb.
    let notesVault = null;
    if (verb.vault) {
      ensureNotesVaultReady();
      notesVault = { dir: notesVaultDir, skillsInstalled: checkNotesSkillsStatus().ok, inbox: notesInboxDir };
    }
    const systemPrompt = buildSystemPrompt(verb, { notesVault });

    // canvas-claude-mcp: Iris-scoped per-run wiring, never written to ~/.claude.
    // The SDK takes the server record directly, so the bearer token travels
    // in-process — it never reaches a temp file or an argv visible to `ps`.
    // Wired only for a verb whose registry entry declares it, rather than for
    // every run on the off-chance.
    const mcpRecord = verb.mcpServers.includes("iris-canvas") ? await ensureCanvasMcpForRun() : null;

    // CONTEXT IS USER-CONTROLLED. Every verb keeps its OWN continuous
    // conversation within this workstream: a run always resumes the verb's
    // stored session, no matter what ran in between. Continuity is not
    // statefulness — a stateless verb resumes too, which is what makes a
    // follow-up request intelligible. Nothing here ever drops a session on its
    // own: context resets only when the USER asks for it (the "New" session
    // button, an explicit voice new-session request, or picking a different
    // project folder, since Claude stores conversations per directory).
    const key = sessionKeyFor(verb.verb, verb.projectState);
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
        message: `The stored Claude conversation for ${verb.verb} no longer exists — starting a fresh one.`,
      });
    }

    const permissionMode = /** @type {import("@anthropic-ai/claude-agent-sdk").PermissionMode} */ (
      process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions"
    );
    // Declared before the options object because three of its fields close over
    // them: the ceilings, the stderr sink, and a canUseTool that has to be able
    // to abort the run it is guarding.
    const budget = resolveRunBudget(verb.budget);
    const sessionTitle = [workstream?.label, verb.label].filter(Boolean).join(" · ");
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

    // Reached when the question tool was withheld and the model tried anyway,
    // and — the case that matters now — when it was GRANTED and the voice layer
    // has since gone away. This is no longer a belt-and-braces backstop: it is
    // the only thing standing between a mid-run sleep and a run waiting forever
    // on the single execution slot (design D2/2.3). Fail loudly: record the
    // violation, then abort so the run settles now rather than continuing on an
    // answer it invented.
    const refuseUndeliverableQuestion = () => {
      run.askViolation = mayAsk
        ? `The ${verb.verb} run asked a question, but the voice layer that could have relayed it is no longer ` +
          "connected, so no answer can arrive. The run was stopped rather than left waiting. Ask again with Iris awake."
        : `The ${verb.verb} run tried to ask a question, but this run was not permitted to ask and nothing is ` +
          "listening for it. It must work autonomously; shape the requirements first if a decision is genuinely needed.";
      abortController.abort();
      return { behavior: /** @type {const} */ ("deny"), message: run.askViolation };
    };

    /** @type {import("@anthropic-ai/claude-agent-sdk").Options} */
    const options = {
      cwd: run.cwd,
      permissionMode,
      // The SDK rejects `bypassPermissions` unless this accompanies it. Only
      // attached for that mode, so IRIS_CLAUDE_PERMISSION_MODE=acceptEdits|plan
      // genuinely restricts the worker rather than being quietly overridden.
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      // Built by role-prompt.mjs, the single policy every verb shares. Measured
      // caveat: on a run with `agent` set — which is every verb run — the
      // definition's prompt replaces the base, so the `claude_code` preset half
      // is discarded and only the `append` half (preamble + statefulness clause
      // + the verb's own clause) reaches the model.
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
      // Not "all": a run sees only the skills its own work needs, declared by
      // its verb. Without this, seven verbs would be seven names for one agent —
      // the scoping is the substance and the verb table is the vehicle. The
      // lists and the evidence behind each entry live in run-skills.mjs.
      skills: verb.skills,
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
      // mechanism. Only the verb that declares `vault`, matching who gets the
      // vault clause in its prompt.
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
    // The persona is handed over by value rather than looked up by name in
    // ~/.claude/agents — nothing is installed outside the app.
    const agentName = `${agentPrefix}${verb.basePersona}`;
    options.agents = { [agentName]: resolveAgentDefinition(verb.basePersona, run.cwd) };
    options.agent = agentName;
    if (verb.structuredOutput) {
      // Declared per verb. A verb that answers a spoken question rather than
      // reporting on work has no use for a summary/decisions schema, and forcing
      // one on it would reshape an answer that has nothing to do with a build.
      options.outputFormat = DECISION_OUTPUT_FORMAT;
    }
    // Whether a run may ask is enforced by configuration, not by instruction —
    // in both directions. Measured: `AskUserQuestion` is only exposed to the
    // model when a `canUseTool` callback is present, and `disallowedTools`
    // removes it even when one is. So the list is the guarantee: a run that may
    // not ask is not offered the tool, and a run that may ask is.
    // `investigate` carries Write/Edit in the same list: investigating does not
    // modify, and that has to be structural too.
    options.disallowedTools = [...verb.disallowedTools];
    options.canUseTool = async (toolName, input) => {
      if (toolName === "AskUserQuestion" && mayAsk) {
        // The permitted branch (ask-when-unspecified 3.1). Routed into the SAME
        // relay a resident session's question goes through — no second channel,
        // no second pending-question object. The run is suspended off the idle
        // bound while it waits and continues, in place, on the answer: pausing
        // is not residency.
        //
        // Re-checked here, not assumed from run start: permission was granted
        // when the run was configured and the listener can go away while it is
        // still running (D2).
        if (!canRelayQuestion()) return refuseUndeliverableQuestion();
        const questions = Array.isArray(input?.questions) ? input.questions : [];
        const settled = await askUserQuestionViaVoice(run.workstream_id, questions, {
          // D3: this run WRITES, so an unanswered question must not resolve to a
          // fabricated recommendation. It supplies no answer and the run stops.
          onExpiry: QUESTION_EXPIRY.DENY,
        });
        if (settled?.behavior === "deny") {
          // Nothing further is written. The run is aborted rather than merely
          // told "no": a denial alone leaves the model free to carry on and
          // guess, which is the outcome this whole path exists to remove.
          if (settled.reason === "abandoned") {
            run.questionAbandoned = "The session was reset before the run's question could be answered.";
          } else {
            run.unansweredQuestion = describeUnansweredQuestion(questions);
          }
          abortController.abort();
          return { behavior: "deny", message: settled.message ?? "No answer was supplied." };
        }
        return { behavior: "allow", updatedInput: { ...input, answers: settled?.answers ?? {} } };
      }
      if (!verb.disallowedTools.includes(toolName)) return { behavior: "allow", updatedInput: input };
      if (toolName !== "AskUserQuestion") {
        // A withheld edit tool is refused without ending the run: the model can
        // still answer, which is what it was asked for.
        return { behavior: "deny", message: `${verb.verb} runs cannot use ${toolName}.` };
      }
      return refuseUndeliverableQuestion();
    };
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
      // The brief plus the fenced transcript of what the user actually said,
      // plus the fenced focus (second-brain-focus D5) — so the voice layer's
      // summary is no longer the only thing this run sees.
      handle = queryImpl({
        prompt: buildRunPrompt(verb, {
          brief: run.task,
          utterances: recentUtterances(),
          listenWindowEndedAt: listenWindowEndedAt(),
          focus: resolveFocusForPrompt(),
          openNote: resolveOpenNoteForRun(),
        }),
        options,
      });
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
      // This run asked, and no answer came. Its own terminal status
      // (ask-when-unspecified D3/4.4): it did not FAIL — it did the work it
      // could and then stopped at a fork it was right not to guess at — and the
      // user did not CANCEL it, so both of those would be false accounts. The
      // message names the question rather than claiming a decision.
      if (run.unansweredQuestion) {
        runQueue.finalize(run.run_id, RUN_STATUS.UNANSWERED, run.unansweredQuestion);
        return;
      }
      // The question was pending when the user reset the session. That IS a
      // cancellation by the user, on the same terms as the resident path's
      // teardown, so it says so rather than blaming an absent answer.
      if (run.questionAbandoned) {
        runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, run.questionAbandoned);
        return;
      }
      // The other reason this path aborts: the run reached for a question it
      // could not have answered. The guard aborted deliberately, so report the
      // violation rather than the generic transport error the abort produced.
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

  return { startStatelessRun };
}
