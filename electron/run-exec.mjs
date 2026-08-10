// Drives the two Claude worker shapes, both on the Agent SDK: **stateless** (a
// one-shot `query()` per run) and **stateful** (a resident `query()` session
// that can pause mid-turn to ask by voice). They differ in lifetime, not in
// transport. Neither touches a host-installed CLI — the binary ships with the
// app, see bundled-binaries.mjs. Split out of electron/main.mjs
// (split-main-process-modules): Electron-free — every cross-module effect (the
// run queue, session store, run-stream projection, notes-vault/canvas
// capability hooks, pipeline probes/install) is injected.
//
// Which shape a run takes is not decided here: it is a declared property of the
// verb, read from electron/verbs.mjs. This module's whole job is to turn one
// resolved verb into one `query()`.
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  poBillingStatus,
  getOrCreatePoSession,
  deliverPoTurn,
  cancelPoTurn,
  setPoSessionModel,
  setPoSessionMcpServers,
  getPoSessionState,
} from "./po-session.mjs";
import { buildSystemPrompt } from "./role-prompt.mjs";
import { budgetWarnFraction, describeCeiling, isCeilingSubtype, resolveRunBudget } from "./run-budget.mjs";
import { buildRunHooks, readInFlightCostUsd } from "./run-hooks.mjs";
import { DECISION_OUTPUT_FORMAT, readRunOutput } from "./run-output-format.mjs";
import { isSessionAlive } from "./run-sessions.mjs";
import { computeClaudeWorkerEnv } from "./worker-env.mjs";
import { RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";
import { resolveVerb } from "./verbs.mjs";
import { buildRunPrompt } from "./run-context.mjs";
import { writeRemovesNothing } from "./note-write-guard.mjs";
import { QUESTION_EXPIRY } from "./run-stream.mjs";

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

// A failure message with the subprocess's own diagnostics behind it. Before
// this, a transport failure reached the user as `Failed to run claude: <message>`
// and nothing else.
function withStderr(message, tail) {
  const diagnostics = tail();
  return diagnostics ? `${message}\n\n--- claude stderr (last ${STDERR_TAIL_LINES} lines) ---\n${diagnostics}` : message;
}

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
    // Every dispatch records why it happened: offering eight verbs creates more
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
      // its verb. Without this, eight verbs would be eight names for one agent —
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

  // The stateful shape: delivers the turn into the workstream's resident Agent
  // SDK session (creating it on the first turn), instead of spawning a new
  // process. See electron/po-session.mjs.
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
   * The return type is taken from `getOrCreatePoSession` itself so the two
   * cannot disagree: without it the literal `false` in `outputFormat` widens
   * to `boolean` once it is built here instead of inline at the call.
   *
   * @returns {Parameters<typeof getOrCreatePoSession>[1]}
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
      // condensed). `false`, never `undefined`, so po-session.mjs's default
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
    const billing = poBillingStatus();
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
    // turn already opened — see setPoSessionMcpServers below.
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
      state = getOrCreatePoSession(
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
      void cancelPoTurn(state);
    };

    // The session may already be live on an older model (created before a
    // queued model change) — switch it via setModel() so the turn about to run
    // uses the current choice with the session's context fully preserved,
    // instead of closing/resuming just to change models.
    const modelReady = (
      state.currentModel === run.model ? Promise.resolve() : setPoSessionModel(state, run.model)
    ).catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not switch the live session's model: ${error.message}` });
    });
    // Applied lazily, at most once per session — a session opened by a voice
    // turn gets the canvas wired here on the first canvas turn into it, which is
    // exactly the shared-session case D3 exists for. A session created with it
    // already set (mcpServers above) has state.currentMcp === true and this is a
    // no-op.
    const mcpReady = (
      state.currentMcp || !mcpServers ? Promise.resolve() : setPoSessionMcpServers(state, mcpServers)
    ).catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not wire the canvas server into the live session: ${error.message}` });
    });

    Promise.all([modelReady, mcpReady])
      .then(() =>
        deliverPoTurn(
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
            // po-session parses its own stream — so this has to be wired here
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
        // po-session.mjs reports the raw subtype and usage without interpreting
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
        // The reason travels on the rejected error (see po-session.mjs pump's
        // finally), not on session state — the session may already be deleted
        // from the map by the time this settles.
        if (error?.poEndReason?.kind === "teardown") {
          runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "The live session was reset before the turn completed.");
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
      if (!poBillingStatus().ok) return { warmed: false, reason: "no-credential" };

      const cwd = runProjectDir({ workstream_id: workstream.id });
      const verb = resolveVerb(verbName, {
        changes: openChangesWithTasks(cwd),
        openNoteId: resolveOpenNoteForRun()?.id ?? null,
      });
      if (!verb.stateful) return { warmed: false, reason: "not-a-conversation" };

      const sessionKey = sessionKeyFor(verb.verb, verb.projectState);
      // Already open — warming again would be a handoff, closing the very
      // conversation it means to have ready.
      if (getPoSessionState(workstream.id)) return { warmed: false, reason: "already-open" };

      const mcpRecord = verb.mcpServers.includes("iris-canvas") ? await ensureCanvasMcpForRun() : null;
      const { collect: collectStderr } = createStderrBuffer();

      getOrCreatePoSession(
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
