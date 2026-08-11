// The shared preamble and policy layer in front of the two Claude run shapes,
// both on the Agent SDK: **stateless** (a one-shot `query()` per run,
// stateless-session.mjs) and **stateful** (a resident `query()` session that can
// pause mid-turn to ask by voice, stateful-session.mjs). They differ in
// lifetime, not in transport. Neither touches a host-installed CLI — the binary
// ships with the app, see bundled-binaries.mjs.
//
// This module owns what both shapes share — the project directory, verb
// resolution, the persona check, the OpenSpec scaffold, the note write guard,
// the budget/credential policy — and then delegates to the two session modules
// symmetrically. Which shape a run takes is not decided here: it is a declared
// property of the verb, read from electron/verbs.mjs.
//
// Split out of electron/main.mjs (split-main-process-modules): Electron-free —
// every cross-module effect (the run queue, session store, run-stream
// projection, notes-vault/canvas capability hooks, pipeline probes/install) is
// injected. The residual length here is the stateful driver, which stays with
// the shared layer deliberately (the-sessions-are-named-for-their-shape D4):
// moving it would bloat stateful-session.mjs or mint a third module.
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  getOrCreateStatefulSession,
  deliverStatefulTurn,
  cancelStatefulTurn,
  setStatefulSessionModel,
  setStatefulSessionMcpServers,
  getStatefulSessionState,
} from "./stateful-session.mjs";
import { buildSystemPrompt } from "./role-prompt.mjs";
import { budgetWarnFraction, describeCeiling, isCeilingSubtype, resolveRunBudget } from "./run-budget.mjs";
import { buildRunHooks } from "./run-hooks.mjs";
import {
  DECISION_OUTPUT_FORMAT,
  STRUCTURED_OUTPUT_FAILURE,
  createStderrBuffer,
  withStderr,
} from "./run-output-format.mjs";
import { isSessionAlive } from "./run-sessions.mjs";
import { claudeBillingStatus } from "./worker-env.mjs";
import { RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";
import { resolveVerb } from "./verbs.mjs";
import { buildRunPrompt } from "./run-context.mjs";
import { writeRemovesNothing } from "./note-write-guard.mjs";
import { createStatelessSession } from "./stateless-session.mjs";

// open-note-session D6/8.2-8.6: the destructive-edit confirmation, wired only
// for the verb that declares `guardOpenNoteWrites`. Reuses the SAME voice
// relay a session's own AskUserQuestion already goes through (task 8.4) — no
// second question channel — and fires independently of whether the session
// remembered to ask on its own, deciding for itself (via writeRemovesNothing)
// whether anything is actually at risk. This is a guard against the
// confirmation being skipped, never containment: the session has the vault
// granted under bypassPermissions and could reach the file through Bash,
// which this does not inspect (design.md Risks).
export function buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId, notePath }) {
  if (!notePath) return undefined;
  const KEEP = "Keep it, don't remove";
  const REMOVE = "Yes, remove it";
  return async function confirmWrite(toolName, input) {
    const filePath = String(input?.file_path ?? "");
    // A write aimed elsewhere is not this guard's business (task 8.3).
    if (filePath !== notePath) return { behavior: "allow" };

    let currentContent = "";
    try {
      currentContent = fs.readFileSync(notePath, "utf8");
    } catch {
      // Nothing on disk yet to remove from (a fresh page).
      return { behavior: "allow" };
    }

    if (writeRemovesNothing({ toolName, input, currentContent })) {
      return { behavior: "allow" };
    }

    const removedText = toolName === "Edit" ? String(input?.old_string ?? "").trim() : currentContent.trim();
    const named = removedText.length > 300 ? `${removedText.slice(0, 300)}…` : removedText;
    const question = {
      question: `This would remove: "${named}". Go ahead?`,
      header: "Confirm removal",
      // The first option MUST write nothing (task 8.5): the relay's own
      // unanswered-question default resolves to options[0], so an unanswered
      // confirmation must never be the one that deletes something.
      options: [
        { label: KEEP, description: "Leave the note exactly as it is" },
        { label: REMOVE, description: "Go ahead and remove it" },
      ],
    };

    const result = await askUserQuestionViaVoice(workstreamId, [question]);
    if (result?.behavior === "deny") {
      return { behavior: "deny", message: result.message ?? "This write is held pending confirmation." };
    }
    if (result?.answers?.[question.question] === REMOVE) {
      return { behavior: "allow" };
    }
    // A decline (or the safe timeout default) denies with a message the
    // session can act on — which part it named wrongly — so the next turn
    // corrects rather than retries (task 8.6).
    return {
      behavior: "deny",
      message: `The user did not confirm removing: "${named}". Ask what they actually want changed, or leave this text as is.`,
    };
  };
}

/**
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   findWorkstream: (id: string | null) => any,
 *   activeWorkstream: () => any,
 *   persistSessionStore: () => void,
 *   sessionKeyFor: (verb: string, state?: any) => string,
 *   resolveVerbModel: (workstream: any, verb: string) => string | null,
 *   agentPrefix: string,
 *   claudeWorkdir: () => string,
 *   claudeBinary: () => string,
 *   resolveAgentDefinition: (base: string, cwd: string | null) => { description: string, prompt: string, model?: string },
 *   irisPluginConfig: () => Array<{ type: "local", path: string, skipMcpDiscovery?: boolean }> | null,
 *   ensureProjectScaffold: (cwd: string) => { created: string[], error?: string },
 *   openChangesWithTasks: (cwd: string) => string[],
 *   ensureCanvasMcpForRun: () => Promise<any>,
 *   ensureNotesVaultReady: () => void,
 *   checkNotesSkillsStatus: () => { ok: boolean },
 *   notesVaultDir: string,
 *   notesInboxDir: string,
 *   recentUtterances: () => Array<{ text: string, at: number }>,
 *   listenWindowEndedAt?: () => number,
 *   resolveFocusForPrompt?: () => Array<{ id: string, title: string, tags: string[] }> | null,
 *   resolveOpenNoteForRun?: () => { id: string, title: string, tags: string[], relativePath: string } | null,
 *   openNoteWritePath?: () => string | null,
 *   handleClaudeStreamMessage: (run: any, message: any) => void,
 *   pushActivity: (run: any, line: string) => void,
 *   speakWorkingText: (run: any, text: string) => void,
 *   rememberClaudeSessionId: (run: any, claudeSessionId: string | null) => void,
 *   pushToolStart: (run: any, toolId: string, toolName: string, detail: any) => void,
 *   pushToolEnd: (run: any, toolId: string, isError: boolean) => void,
 *   askUserQuestionViaVoice: (workstreamId: string, questions: any[], options?: { onExpiry?: string }) => Promise<any>,
 *   canRelayQuestion?: () => boolean,
 *   isSessionAliveImpl?: (sessionId: string, options?: { dir?: string }) => Promise<boolean>,
 *   queryImpl?: typeof query,
 * }} deps
 */
export function createRunExec({
  runQueue,
  emitEvent,
  findWorkstream,
  activeWorkstream,
  persistSessionStore,
  sessionKeyFor,
  resolveVerbModel,
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
  notesInboxDir,
  recentUtterances,
  listenWindowEndedAt = () => 0,
  // second-brain-focus D5: no focus means no block at all — a capability that
  // hasn't wired this in (or a test that doesn't care) just sees no notes.
  resolveFocusForPrompt = () => null,
  // open-note-session D4/8.3: same default-to-nothing shape as the focus
  // above. openNoteWritePath is for this module's own write guard only —
  // never sent to a run's prompt.
  resolveOpenNoteForRun = () => null,
  openNoteWritePath = () => null,
  handleClaudeStreamMessage,
  pushActivity,
  speakWorkingText,
  rememberClaudeSessionId,
  pushToolStart,
  pushToolEnd,
  askUserQuestionViaVoice,
  // Whether the voice layer can currently relay a question and carry an answer
  // back (ask-when-unspecified D2/2.1). Injected — this module never reads a
  // live session, Electron, or a global to find out. Defaults to FALSE, and
  // fails closed on purpose: a wiring that forgot to supply it withholds the
  // question tool, which is today's behavior, rather than granting a tool whose
  // answer nothing could deliver.
  canRelayQuestion = () => false,
  isSessionAliveImpl = isSessionAlive,
  queryImpl = query,
}) {
  function runProjectDir(run) {
    const projectDir = findWorkstream(run.workstream_id)?.cwd;
    if (projectDir && fs.existsSync(projectDir)) return projectDir;
    return claudeWorkdir();
  }

  // The stateless half of the pair, constructed here rather than by the caller:
  // run-exec.mjs stays the single seam the wiring builds, and its returned
  // interface is unchanged by the extraction (D4). It gets the stateless subset
  // of these same deps — the same objects, not copies.
  const { startStatelessRun } = createStatelessSession({
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
    listenWindowEndedAt,
    resolveFocusForPrompt,
    resolveOpenNoteForRun,
    handleClaudeStreamMessage,
    pushActivity,
    pushToolEnd,
    askUserQuestionViaVoice,
    canRelayQuestion,
    isSessionAliveImpl,
    queryImpl,
  });

  // Shared preamble (cwd, verb resolution, persona check, scaffold) then
  // dispatches to the stateful or the stateless shape — which one is a declared
  // property of the verb, not a decision made here. This is the `startRun`
  // injected into electron/run-queue.mjs's createRunQueue(), which owns slot
  // acquisition and finalization; both shapes finalize through the same
  // runQueue.finalize() path, so they share the single "Claude does one thing at
  // a time" execution slot without either one needing to know the other exists.
  function startClaudeRun(run) {
    run.cwd = runProjectDir(run);

    // The project is read HERE, at run start, not at submit time: a change
    // proposed while this run sat queued should be seen by it. This is the state
    // `execute` forks on (design.md D4). openNoteId rides the same resolved
    // state (open-note-session D2) so work_on_note's sessionKey/vault/etc.
    // resolve against whichever note is open at THIS moment, not at submit time.
    let verb;
    try {
      verb = resolveVerb(run.verb, {
        changes: openChangesWithTasks(run.cwd),
        openNoteId: resolveOpenNoteForRun()?.id ?? null,
        depth: run.depth ?? null,
      });
    } catch (error) {
      runQueue.finalize(run.run_id, RUN_STATUS.FAILED, error.message);
      return;
    }
    run.verbConfig = verb;
    // Every dispatch records why it happened: offering seven verbs creates more
    // ways to select wrongly than one general tool did, and that trade is only
    // acceptable while every selection is inspectable afterwards. The brief
    // itself is deliberately absent — it is the user's content, not diagnostics.
    emitEvent({
      type: "log",
      level: "info",
      message:
        `Dispatching ${verb.verb} · model ${verb.model} · ${verb.stateful ? "stateful" : "stateless"} ` +
        `· session ${verb.sessionKey} · park ${verb.park} · skills [${verb.skills.join(", ") || "none"}] ` +
        `· project ${run.cwd} (${verb.projectState.hasOpenChange ? `open changes: ${verb.projectState.changes.join(", ")}` : "no open change"}).`,
    });

    // A run must run as its verb's persona — the personas ship inside the app
    // now, so the only way this fails is a broken bundle, not a missing install
    // step the user could have skipped.
    try {
      resolveAgentDefinition(verb.basePersona, run.cwd);
    } catch (error) {
      runQueue.finalize(run.run_id, RUN_STATUS.FAILED, `The ${verb.label} persona could not be loaded: ${error.message}`);
      return;
    }

    // First shaping run in a fresh project: make it OpenSpec-ready
    // (`openspec init`) so a change can be proposed into it. Deliberately NOT
    // done for the other verbs — the openspec-native-pipeline spec requires
    // ordinary work to create no process artifacts, and scaffolding a project
    // the user only asked a question about would be exactly that.
    if (verb.stateful) {
      const scaffold = ensureProjectScaffold(run.cwd);
      if (scaffold.created.length) {
        emitEvent({ type: "log", level: "info", message: `Set up ${run.cwd} for OpenSpec: ${scaffold.created.join(", ")}.` });
      }
      if (scaffold.error) {
        emitEvent({ type: "log", level: "warn", message: `Project setup incomplete (${scaffold.error}) — the run continues anyway.` });
      }
    }

    // The gate that used to sit here — a DEV run refused outright when no open
    // change had unchecked tasks — is gone (design.md D4, and recorded as a
    // decision in the openspec-native-pipeline spec). `execute` reads the
    // project and forks instead: a user asking for a small piece of work is not
    // asking for a software-development process, and refusing them was never a
    // safety measure. The protection that gate provided now comes from `execute`
    // being parked for review on EVERY dispatch (run-dispatch.mjs). If that park
    // is ever weakened, this decision must be revisited with it.

    if (verb.stateful) {
      startStatefulRun(run, verb);
      return;
    }
    startStatelessRun(run, verb);
  }

  // The stateful shape: delivers the turn into the workstream's resident Agent
  // SDK session (creating it on the first turn), instead of spawning a new
  // process. See electron/stateful-session.mjs.
  //
  // Both stateful verbs land here and share ONE session, keyed by the registry's
  // sessionKey (design.md D3): shaping by voice and shaping on the canvas are the
  // same conversation in two media, and switching to the canvas happens precisely
  // when talking has stopped working — the moment the accumulated context matters
  // most. Whichever verb is called first is what opens it.
  /**
   * Everything a resident shaping session is opened WITH, in one place, so the
   * two callers cannot drift: the turn that opens a conversation by being
   * spoken, and the warm that opens one because the canvas appeared. It used
   * to live only inside `startStatefulRun`, which meant a session could only
   * come into existence as a side effect of somebody talking.
   *
   * `cwd` and `model` are passed in rather than read from a run, because a
   * warm has no run.
   *
   * The return type is taken from `getOrCreateStatefulSession` itself so the two
   * cannot disagree: without it the literal `false` in `outputFormat` widens
   * to `boolean` once it is built here instead of inline at the call.
   *
   * @returns {Parameters<typeof getOrCreateStatefulSession>[1]}
   */
  function statefulSessionOptions({ verb, sessionKey, cwd, model, mcpServers, budget, collectStderr, confirmWrite, resumeSessionId, workstreamLabel, warm = false }) {
    return {
      agent: `${agentPrefix}${verb.basePersona}`,
      agentDefinition: resolveAgentDefinition(verb.basePersona, cwd),
      plugins: irisPluginConfig(),
      cwd,
      sessionKey,
      resumeSessionId,
      claudeExecutable: claudeBinary(),
      onAskUserQuestion: (workstreamId, questions) => askUserQuestionViaVoice(workstreamId, questions),
      confirmWrite,
      model,
      mcpServers,
      budget,
      stderr: collectStderr,
      skills: verb.skills,
      // A spoken reading, not a build report, for the verb that declares so
      // (open-note-session: the decisions schema's own "keep it to a few
      // sentences" instruction would condense exactly what must not be
      // condensed). `false`, never `undefined`, so stateful-session.mjs's default
      // does not silently reapply it.
      outputFormat: verb.structuredOutput ? DECISION_OUTPUT_FORMAT : false,
      // Set once, when the session opens. Because the session is SHARED, the
      // clause baked in here is whichever verb opened it — which is why each
      // turn also carries its own verb's clause in its prompt below. A session
      // opened by voice must still be told, on the turn that moves to the
      // canvas, that this turn is canvas work.
      systemPrompt: buildSystemPrompt(verb),
      title: [workstreamLabel, verb.label].filter(Boolean).join(" · "),
      // The session supplies the per-turn seams; the policy (thresholds,
      // denylist, what a hook does) stays here so both shapes share one. The
      // seams route through `state.currentTurn`, which is null between turns,
      // so a hook that fires while nothing is running lands on nothing rather
      // than on a stale run.
      buildHooks: (seams) =>
        buildRunHooks({
          budget,
          warnFraction: budgetWarnFraction(),
          emitEvent,
          ...seams,
        }),
      warm,
    };
  }

  async function startStatefulRun(run, verb) {
    const workstream = findWorkstream(run.workstream_id);
    if (!workstream) {
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Unknown workstream for the ${verb.verb} run.`);
      return;
    }
    const billing = claudeBillingStatus();
    if (!billing.ok) {
      runQueue.finalize(
        run.run_id,
        RUN_STATUS.FAILED,
        "A live session needs a subscription token: run `claude setup-token`, set CLAUDE_CODE_OAUTH_TOKEN " +
          "(see .env.example), then retry. The one-shot verbs are unaffected.",
      );
      return;
    }

    const sessionKey = sessionKeyFor(verb.verb, verb.projectState);
    // Resolved at run start (not submit time) so a model change made while this
    // task was queued still applies.
    run.model = resolveVerbModel(workstream, verb.verb);
    // canvas-claude-mcp: awaits server-ready before wiring, so a turn that fires
    // the instant the canvas is engaged never wires an undefined URL, and never
    // wires anything at all when this verb does not declare the server. The
    // session is shared, so a canvas turn wires it lazily into a session a voice
    // turn already opened — see setStatefulSessionMcpServers below.
    const mcpRecord = verb.mcpServers.includes("iris-canvas") ? await ensureCanvasMcpForRun() : null;
    const mcpServers = mcpRecord ? { "iris-canvas": mcpRecord } : undefined;

    run.status = RUN_STATUS.RUNNING;
    run.started_at = Date.now() / 1000;
    run.claude_session_id = workstream.agent_sessions?.[sessionKey] ?? null;
    emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

    // Same policy the stateless shape routes through, so the two cannot drift.
    // A resident session applies them once per `query()` — across the session's
    // whole lifetime, not per turn — so a long-lived session is measured
    // cumulatively, which is the behaviour a runaway guard wants.
    const budget = resolveRunBudget(verb.budget);
    const { collect: collectStderr, tail: stderrTail } = createStderrBuffer();
    // open-note-session D6/8.3: wired only for the verb that declares it,
    // built from the capability's own resolved absolute path — never a path
    // supplied by the model.
    const confirmWrite = verb.guardOpenNoteWrites
      ? buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: workstream.id, notePath: openNoteWritePath() })
      : undefined;

    /** @type {any} */
    let state;
    try {
      state = getOrCreateStatefulSession(
        workstream,
        statefulSessionOptions({
          verb,
          sessionKey,
          cwd: run.cwd,
          model: run.model,
          mcpServers,
          budget,
          collectStderr,
          confirmWrite,
          resumeSessionId: workstream.agent_sessions?.[sessionKey] ?? null,
          workstreamLabel: workstream.label,
        }),
      );
    } catch (error) {
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start the live session: ${error.message}`);
      return;
    }

    // Both shapes cancel through the same caller-facing handle: the queue calls
    // run.cancel() and does not need to know whether it is stopping a one-shot
    // query or a turn inside a resident session. The stateless one aborts its
    // controller; this one interrupts its turn and leaves the session alive.
    run.cancel = () => {
      void cancelStatefulTurn(state);
    };

    // The session may already be live on an older model (created before a
    // queued model change) — switch it via setModel() so the turn about to run
    // uses the current choice with the session's context fully preserved,
    // instead of closing/resuming just to change models.
    const modelReady = (
      state.currentModel === run.model ? Promise.resolve() : setStatefulSessionModel(state, run.model)
    ).catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not switch the live session's model: ${error.message}` });
    });
    // Applied lazily, at most once per session — a session opened by a voice
    // turn gets the canvas wired here on the first canvas turn into it, which is
    // exactly the shared-session case D3 exists for. A session created with it
    // already set (mcpServers above) has state.currentMcp === true and this is a
    // no-op.
    const mcpReady = (
      state.currentMcp || !mcpServers ? Promise.resolve() : setStatefulSessionMcpServers(state, mcpServers)
    ).catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not wire the canvas server into the live session: ${error.message}` });
    });

    Promise.all([modelReady, mcpReady])
      .then(() =>
        deliverStatefulTurn(
          state,
          buildRunPrompt(verb, {
            brief: `${verb.clause}\n\n${run.task}`,
            utterances: recentUtterances(),
            listenWindowEndedAt: listenWindowEndedAt(),
            focus: resolveFocusForPrompt(),
            openNote: resolveOpenNoteForRun(),
          }),
          {
            onActivity: (line) => pushActivity(run, line),
            // The resident path does NOT go through handleClaudeStreamMessage —
            // stateful-session parses its own stream — so this has to be wired here
            // or the conversation the feature exists for is the one that never
            // speaks while it works.
            onAssistantText: (text) => speakWorkingText(run, text),
            onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
            onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
            onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
          },
        ),
      )
      .then((result) => {
        // stateful-session.mjs reports the raw subtype and usage without interpreting
        // either; the budget policy lives here, once, for both shapes.
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
        // The reason travels on the rejected error (see stateful-session.mjs pump's
        // finally), not on session state — the session may already be deleted
        // from the map by the time this settles.
        if (error?.statefulEndReason?.kind === "teardown") {
          runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "The live session was reset before the turn completed.");
          return;
        }
        if (error?.statefulEndReason?.kind === "cancelled") {
          // Work that survived the interrupt will still run, so saying it was
          // cancelled would be false. Report it rather than letting the user
          // discover it when it finishes.
          const survived = error.statefulEndReason.survived?.length ?? 0;
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
          withStderr(`Live session error: ${error.message}`, stderrTail),
        );
      });
  }

  /**
   * Open the shaping conversation ahead of the user's first sentence, because
   * the surface it serves just appeared (the-canvas-becomes-a-conversation
   * D1). Nothing is delivered into it: this is the process, the resumed
   * context and the canvas tools being ready, so the first thing the user says
   * is answered by a conversation instead of paying to create one.
   *
   * It is deliberately quiet about failure. A warm is an optimisation the user
   * did not ask for by name; if it cannot happen — no credential, no
   * workstream, a transport that will not start — the first spoken turn opens
   * the session exactly as it always did. Announcing a failed preparation
   * would be reporting the absence of something the user was never promised.
   *
   * @param {string} verbName - the verb whose conversation to warm
   */
  async function warmStatefulConversation(verbName) {
    try {
      // The ACTIVE workstream, not a lookup by id — a warm has no run to take
      // an id from. `findWorkstream(null)` matches nothing, which is how this
      // spent a release silently answering "no-workstream" and never warming
      // anything at all.
      const workstream = activeWorkstream();
      if (!workstream) return { warmed: false, reason: "no-workstream" };
      if (!claudeBillingStatus().ok) return { warmed: false, reason: "no-credential" };

      const cwd = runProjectDir({ workstream_id: workstream.id });
      const verb = resolveVerb(verbName, {
        changes: openChangesWithTasks(cwd),
        openNoteId: resolveOpenNoteForRun()?.id ?? null,
      });
      if (!verb.stateful) return { warmed: false, reason: "not-a-conversation" };

      const sessionKey = sessionKeyFor(verb.verb, verb.projectState);
      // Already open — warming again would be a handoff, closing the very
      // conversation it means to have ready.
      if (getStatefulSessionState(workstream.id)) return { warmed: false, reason: "already-open" };

      const mcpRecord = verb.mcpServers.includes("iris-canvas") ? await ensureCanvasMcpForRun() : null;
      const { collect: collectStderr } = createStderrBuffer();

      getOrCreateStatefulSession(
        workstream,
        statefulSessionOptions({
          verb,
          sessionKey,
          cwd,
          model: resolveVerbModel(workstream, verb.verb),
          mcpServers: mcpRecord ? { "iris-canvas": mcpRecord } : undefined,
          budget: resolveRunBudget(/** @type {any} */ (verb.budget)),
          collectStderr,
          confirmWrite: undefined,
          resumeSessionId: workstream.agent_sessions?.[sessionKey] ?? null,
          workstreamLabel: workstream.label,
          // The distinction the review gate depends on: a transport is up, a
          // conversation has not happened. Cleared by the first turn.
          warm: true,
        }),
      );
      // Two facts the user cannot see from the outside and will want when the
      // canvas feels slow: whether a conversation was standing ready before
      // they spoke, and whether it was reused. Without it, "the first sentence
      // was slow" has no explanation in the record — which is how a warm that
      // never warmed anything went unnoticed.
      emitEvent({
        type: "log",
        level: "info",
        message: `[canvas] shaping conversation warmed for ${verbName} — ready before the first turn`,
      });
      return { warmed: true, reason: null };
    } catch (error) {
      emitEvent({
        type: "log",
        level: "warn",
        message: `Could not warm the shaping conversation: ${error?.message || error}`,
      });
      return { warmed: false, reason: "error" };
    }
  }

  return {
    runProjectDir,
    startClaudeRun,
    startStatelessRun,
    startStatefulRun,
    warmStatefulConversation,
  };
}
