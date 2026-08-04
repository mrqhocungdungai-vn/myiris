// Verb dispatch: the pre-dispatch review gate and the Gemini tool
// implementations that submit, query, and control Claude runs. Split out of
// electron/main.mjs (split-main-process-modules): Electron-free — every
// cross-module effect is injected.
//
// Originally one module with run-stream.mjs's content — split in two once the
// verbatim move measured at 670 lines, over the 450-line ceiling. run-stream.mjs
// owns the run activity/tool-step stream and the live-question relay; this
// module owns the review gate and tool-execution surface, taking run-stream's
// resolvePendingPoQuestion as an injected dependency for answer_claude_question
// below.
import fs from "node:fs";
import crypto from "node:crypto";
import { resolveApprovedTask } from "./task-review.mjs";
import { RUN_STATUS, TERMINAL_STATUSES } from "./run-queue.mjs";
import { promptReviewTimeoutMs, sleepDelayMs } from "./user-config.mjs";
import { PARK, VERB_NAMES, isVerb, resolveVerb } from "./verbs.mjs";
import { composeBrief, missingRequired } from "./run-context.mjs";

// The deprecated alias, retained for one release. A Gemini session resumed
// mid-conversation would otherwise call a tool that no longer exists — which is
// the whole reason two dispatch surfaces are tolerable for one release.
const DEPRECATED_TASK_TOOL = "submit_claude_task";

/**
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   notifyIris: (lines: string | string[], opts?: { bufferIfOffline?: boolean }) => void,
 *   findWorkstream: (id: string | null) => any,
 *   activeWorkstream: () => any,
 *   createWorkstream: (label?: string) => any,
 *   setVerbModel: (workstreamId: string, verb: string, model: string) => any,
 *   modelChoices: Array<{ id: string, label: string }>,
 *   getPromptReviewMode: () => string,
 *   getPipelineAvailable: () => boolean,
 *   checkClaudeStatus: () => Promise<any>,
 *   workspaceInfo: () => any,
 *   projectStateFor: (workstream: any) => { hasOpenChange: boolean, changes: string[] },
 *   hasLiveStatefulSession: (workstreamId: string) => boolean,
 *   getUiContextSnapshot: () => any,
 *   resolvePendingPoQuestion: (answers: any) => any,
 *   captureNote: (args: any) => Promise<any>,
 * }} deps
 */
export function createRunDispatch({
  runQueue,
  emitEvent,
  emitToRenderer,
  notifyIris,
  findWorkstream,
  activeWorkstream,
  createWorkstream,
  setVerbModel,
  modelChoices,
  getPromptReviewMode,
  getPipelineAvailable,
  checkClaudeStatus,
  workspaceInfo,
  projectStateFor,
  hasLiveStatefulSession,
  getUiContextSnapshot,
  resolvePendingPoQuestion,
  captureNote,
}) {
  // Parks a Gemini-authored brief for Approve/Edit/Cancel before any Claude
  // tokens are spent (prompt-review-gate spec). Mirrors run-stream.mjs's
  // PendingQuestion settle-once + timeout + abandon shape, but deliberately
  // does NOT call runQueue.suspend/resume: a parked review holds no execution
  // slot, and pausing the queue's idle bound would wrongly disable the
  // watchdog on whatever unrelated run currently holds it.
  const PendingReview = {
    current: null, // { workstream_id, task, urgency, verb, timer }

    raise(parked, { timeoutMs }) {
      this.clear(); // at most one pending review — a new submit supersedes silently
      const timer = setTimeout(() => this.expire(), timeoutMs);
      timer.unref?.();
      this.current = { ...parked, timer };
      emitTaskReviewEvent(this.current, "pending");
    },

    // Tears down the pending review and, if `status` is given, emits the UI
    // sidecar event for it. Returns the parked brief (sans timer) so the caller
    // can act on it, or null if nothing was pending.
    clear(status) {
      if (!this.current) return null;
      const { timer, ...parked } = this.current;
      clearTimeout(timer);
      this.current = null;
      if (status) emitTaskReviewEvent(parked, status);
      return parked;
    },

    expire() {
      const parked = this.clear("timed_out");
      if (parked) notifyTaskReviewResolved("timed_out", parked, "The review timed out and was not sent to Claude.");
    },

    // Deliberate reset denial, mirroring PendingQuestion.abandon — the parked
    // workstream is going away, so its brief must never become approvable
    // afterwards (this is what keeps approve's parked workstream always valid).
    abandon(workstreamId) {
      if (!this.current || this.current.workstream_id !== workstreamId) return;
      const parked = this.clear("abandoned");
      if (parked) {
        notifyTaskReviewResolved("abandoned", parked, "The session changed, so the parked brief was discarded and not sent.");
      }
    },
  };

  // The event type stays `task_review` for renderer/IPC — carries the brief
  // text so the deck banner can prefill its editable textarea (not a console
  // log, so this does not violate the "never log the brief" rule below).
  function emitTaskReviewEvent(parked, status) {
    emitEvent({
      type: "task_review",
      workstream_id: parked.workstream_id,
      status,
      task: parked.task,
      urgency: parked.urgency,
      verb: parked.verb,
    });
  }

  // Voice narration on park: a short summary, not the whole brief, plus "the
  // full brief is on screen" — and explicitly forbids querying run status, since
  // a parked review has no run_id yet.
  function notifyTaskReviewParked(parked) {
    notifyIris([
      "SYSTEM_EVENT_TASK_REVIEW_PARKED",
      `verb: ${parked.verb}`,
      "instructions_to_iris:",
      "- This request was parked for the user's review, not sent to Claude — zero tokens spent so far.",
      "- Speak a SHORT 1-2 sentence summary of what you just asked for (do not read it verbatim), say the full brief is on screen, then wait. Do not say it started or is queued.",
      "- Do NOT call get_claude_task_status for this — there is no run yet.",
      "- The user may approve (optionally after editing), or cancel — from the screen, or by telling you so you can call respond_to_task_review. If they resolve it from the screen, you will receive SYSTEM_EVENT_TASK_REVIEW_RESOLVED instead.",
    ]);
  }

  // Injected on any resolution the voice layer did NOT itself initiate — a
  // UI-driven approve/cancel, a timeout, or a reset-abandon.
  // respond_to_task_review's own synchronous tool return already tells Gemini
  // the outcome when IT resolves the review, so that path never also calls this
  // (see respondToTaskReview below) — this would be a redundant, confusing
  // double-narration otherwise.
  function notifyTaskReviewResolved(outcome, parked, detail) {
    notifyIris([
      "SYSTEM_EVENT_TASK_REVIEW_RESOLVED",
      `outcome: ${outcome}`,
      "instructions_to_iris:",
      detail ? `- ${detail}` : `- The parked brief was resolved (${outcome}).`,
      "- This did not come from your own respond_to_task_review call — the user acted from the screen, or it timed out/was abandoned. Announce it naturally; do not re-send the brief yourself.",
    ]);
  }

  // buildRun produces the run object; dispatch submits it and shapes the result.
  //
  // The `active_agent` fallback is gone with the chip that set it. A run carries
  // the verb it was dispatched as, chosen per call — there is no current role for
  // it to inherit, and inheriting one was how "Iris, build me X" did the wrong
  // thing whenever the chip happened to be set differently.
  function buildRun({ task, urgency = "normal", verb, workstream }) {
    return {
      run_id: crypto.randomUUID(),
      workstream_id: workstream.id,
      session_label: workstream.label,
      task: String(task).trim(),
      urgency,
      verb,
      status: RUN_STATUS.QUEUED,
      output: "",
      activity: [],
      queued_at: Date.now() / 1000,
      child: null,
    };
  }

  function dispatch(run) {
    const label = resolveVerb(run.verb).label;
    const workstream = findWorkstream(run.workstream_id);
    const projectFolder = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
    const whereNote = projectFolder
      ? `Working in project folder ${projectFolder}.`
      : "No project folder is selected — working in the default workspace.";

    const outcome = runQueue.submit(run);
    if (outcome.status === "queued") {
      return {
        status: "queued",
        run_id: run.run_id,
        verb: run.verb,
        position: outcome.position,
        project_folder: projectFolder,
        message: `Claude is still finishing the current task. This ${label} request is queued at position ${outcome.position} and will start automatically. ${whereNote}`,
      };
    }
    if (TERMINAL_STATUSES.includes(outcome.status)) {
      // The run was rejected synchronously during start (an unloadable persona,
      // an unknown verb) — never say "started" for a run that has already
      // failed. onFinalized is gated on started_at (see run-queue.mjs), so this
      // is the only channel this rejection reaches Gemini through.
      return {
        status: outcome.status,
        run_id: run.run_id,
        verb: run.verb,
        project_folder: projectFolder,
        message: `The ${label} request did not start: ${outcome.output} ${whereNote}`,
      };
    }
    return {
      status: "started",
      run_id: run.run_id,
      verb: run.verb,
      project_folder: projectFolder,
      message: `Claude has started the ${label} work. ${whereNote}`,
    };
  }

  /**
   * D6 — whether this dispatch is parked, decided in the main process from the
   * verb registry. It reads the verb's declared label, never the brief's text:
   * a heuristic over wording fails silently in both directions, and the verb is
   * the risk signal precisely because it is explicit and enumerable.
   *
   * The phase scope is what keeps a spoken interface usable. A stateful verb
   * parks only on the call that OPENS its resident session; once the user has
   * agreed to a conversation, every steering turn into it dispatches directly.
   * Requiring approval per turn of a live grilling conversation would send the
   * user to the screen mid-sentence and buy no safety — the session is already
   * alive and already spending. Once that conversation ends, opening a new one
   * is reviewed again, because `hasLiveStatefulSession` is false by then.
   */
  function shouldPark(verb, workstreamId) {
    const mode = getPromptReviewMode();
    if (mode === "never") return false;
    if (mode === "always") return true;
    const park = resolveVerb(verb).park;
    if (park === PARK.ALWAYS) return true;
    if (park === PARK.NEVER) return false;
    return !hasLiveStatefulSession(workstreamId);
  }

  /**
   * The one entry point every verb tool goes through. `args` are the verb's own
   * schema parameters; the brief is composed from them by run-context.mjs
   * against that schema, so no verb needs its own formatting code here.
   * @param {string} verb
   * @param {Record<string, unknown>} [args]
   * @param {{ urgency?: string }} [options]
   */
  function submitVerb(verb, args = {}, { urgency = "normal" } = {}) {
    if (!isVerb(verb)) {
      return { status: "error", error: `Unknown verb: ${verb}. Known verbs: ${VERB_NAMES.join(", ")}.` };
    }
    const workstream = activeWorkstream();
    const resolved = resolveVerb(verb, projectStateFor(workstream));
    const missing = missingRequired(resolved, args);
    if (missing.length) {
      return { status: "error", error: `${verb} needs ${missing.join(" and ")}.` };
    }
    const task = composeBrief(resolved, args);
    if (!task) return { status: "error", error: `${verb} was called with nothing in it.` };

    // Review gate (prompt-review-gate spec): park instead of dispatching. Zero
    // tokens spent — no run, no run_id — until the review is approved.
    if (shouldPark(verb, workstream.id)) {
      const parked = { workstream_id: workstream.id, task, urgency, verb };
      PendingReview.raise(parked, { timeoutMs: promptReviewTimeoutMs() });
      notifyTaskReviewParked(parked);
      return {
        status: "parked_for_review",
        verb,
        workstream_id: workstream.id,
        message: "The request is parked for the user's review — nothing has been sent to Claude yet.",
      };
    }

    return dispatch(buildRun({ task, urgency, verb, workstream }));
  }

  // The deprecated alias. A resumed Gemini session may still hold the old
  // declaration; mapping it to `execute` keeps that session working for one
  // release rather than failing on a tool that no longer exists.
  /** @param {{ task?: string, urgency?: string }} [params] */
  function submitClaudeTask({ task, urgency = "normal" } = {}) {
    if (!task || !String(task).trim()) return { status: "error", error: "Task is required." };
    emitEvent({
      type: "log",
      level: "warn",
      message: `${DEPRECATED_TASK_TOOL} is deprecated — dispatched as execute. It is removed in the next release.`,
    });
    return submitVerb("execute", { goal: String(task).trim(), details: "(carried over from a deprecated call)" }, { urgency });
  }

  function cancelTaskReview({ notify }) {
    const parked = PendingReview.clear("cancelled");
    if (!parked) return { status: "error", error: "No task review is pending." };
    if (notify) notifyTaskReviewResolved("cancelled", parked, "The brief was cancelled and was not sent to Claude.");
    return { status: "ok" };
  }

  // Approve dispatches against the PARKED workstream_id, never a fresh
  // activeWorkstream() read — the user may have switched workstreams while the
  // review sat parked. editedTaskRaw is validated by the pure helper below:
  // undefined/null falls back to the parked task; an explicitly empty edit is
  // refused WITHOUT clearing the pending review, so the banner stays up and the
  // user can fix it.
  function approveTaskReview(editedTaskRaw, { notify }) {
    const pending = PendingReview.current;
    if (!pending) return { status: "error", error: "No task review is pending." };
    let finalTask;
    try {
      finalTask = resolveApprovedTask(editedTaskRaw, pending.task);
    } catch (error) {
      return { status: "error", error: error.message };
    }
    const parked = PendingReview.clear("approved");
    const workstream = findWorkstream(parked.workstream_id);
    if (!workstream) {
      const message = "That session no longer exists — the brief was not sent.";
      if (notify) notifyTaskReviewResolved("error", parked, message);
      return { status: "error", error: message };
    }
    const result = dispatch(buildRun({ task: finalTask, urgency: parked.urgency, verb: parked.verb, workstream }));
    if (notify) notifyTaskReviewResolved(result.status, parked, result.message);
    return result;
  }

  // Voice tool `respond_to_task_review` — its own synchronous tool return IS
  // Gemini's notification of the outcome, so this path never also injects
  // SYSTEM_EVENT_TASK_REVIEW_RESOLVED (reserved for channels Gemini did not
  // initiate). Editing is deck-only: voice can only approve as-is or cancel,
  // never supply edited text.
  /** @param {{ decision?: string }} [params] */
  function respondToTaskReview({ decision } = {}) {
    const clean = String(decision || "").trim().toLowerCase();
    if (clean === "approve") return approveTaskReview(undefined, { notify: false });
    if (clean === "cancel") return cancelTaskReview({ notify: false });
    return { status: "error", error: `Unknown decision: ${decision}` };
  }

  // IPC path for the UI banner (deck Approve/Cancel + edit, HUD Approve/Cancel).
  // Gemini did not initiate this, so the resolution needs the SYSTEM_EVENT to
  // stay coherent.
  /** @param {{ action?: string, editedTask?: string }} [params] */
  function resolvePromptReview({ action, editedTask } = {}) {
    const clean = String(action || "").trim().toLowerCase();
    if (clean === "approve") return approveTaskReview(editedTask, { notify: true });
    if (clean === "cancel") return cancelTaskReview({ notify: true });
    return { status: "error", error: `Unknown action: ${action}` };
  }

  /** @param {{ label?: string }} [params] */
  async function startNewClaudeSession({ label } = {}) {
    const workstream = createWorkstream(label);
    emitEvent({ type: "log", level: "info", message: `Claude: started a fresh session (${workstream.label}).` });
    return {
      status: "ok",
      message: `Started a fresh Claude session named ${workstream.label}. New tasks begin with a clean slate; tasks already running are not affected.`,
      session: { id: workstream.id, label: workstream.label },
    };
  }

  async function getClaudeTaskStatus({ run_id }) {
    const serialized = runQueue.serialize(run_id);
    if (!serialized) return { status: "error", error: `Unknown run: ${run_id}` };
    return serialized;
  }

  async function stopClaudeTask({ run_id }) {
    const status = runQueue.stop(run_id);
    if (status == null) return { status: "error", error: `Unknown run: ${run_id}` };
    return { status, run_id };
  }

  // What the project looks like right now, so Iris can answer "what's the state
  // of this" and choose sensibly between shaping and executing without guessing.
  function getProjectState() {
    const workstream = activeWorkstream();
    const state = projectStateFor(workstream);
    return {
      status: "ok",
      project_folder: workstream?.cwd ?? null,
      open_changes: state.changes,
      has_open_change: state.hasOpenChange,
      shaping_conversation_open: hasLiveStatefulSession(workstream.id),
      last_verb_used: workstream?.last_verb_used ?? null,
    };
  }

  // Voice path for switching a verb's model — goes through the exact same
  // setVerbModel() choke point the UI uses, so the two can never diverge. Always
  // targets the active workstream (Gemini never invents ids).
  //
  // D3: the two shaping verbs share a live session and therefore cannot run on
  // different models while it is alive. The change applies to both and the reply
  // says so, rather than appearing to change one and silently changing the other.
  /** @param {{ verb?: string, model?: string }} [params] */
  function setVerbModelTool({ verb, model } = {}) {
    const workstream = activeWorkstream();
    const result = setVerbModel(workstream.id, verb, model);
    if (result.status === "error") return result;
    const label = modelChoices.find((choice) => choice.id === model)?.label ?? model;
    return {
      status: "ok",
      verbs: result.verbs,
      message: result.shared
        ? `${result.verbs.join(" and ")} now run on ${label} — they share one live conversation, so changing one changes both.`
        : `${verb} now runs on ${label}.`,
    };
  }

  // Voice-driven UI control (spec voice-ui-control). Single tool with an action
  // enum — mirrors the {action, target_id?, query?} shape forwarded verbatim to
  // the renderer over iris:ui-action.
  const UI_ACTIONS = new Set([
    "open_task",
    "open_task_by_query",
    "open_current_claude_result",
    "open_latest_claude_result",
    "open_claude_history",
    "close_reader",
    "close_history",
    "close_all_overlays",
    "show_task_steps",
    "hide_task_steps",
  ]);

  function getUiContext() {
    return getUiContextSnapshot();
  }

  /** @param {{ action?: string, target_id?: string, query?: string }} [params] */
  function controlUi({ action, target_id = undefined, query = undefined } = {}) {
    if (!UI_ACTIONS.has(action)) {
      return { status: "error", error: `Unknown UI action: ${action}` };
    }
    emitToRenderer("iris:ui-action", { action, target_id, query });
    return { status: "sent", action, target_id, query };
  }

  // Tools that only make sense when the pipeline is available — declared to
  // Gemini only when pipelineAvailable is true (see geminiTools.buildClaudeTools).
  // This guard is a defensive backstop, not the primary gate: Gemini should never
  // call one of these in chat-only mode since it was never given the
  // declaration, but a stray call (e.g. a race right after availability drops)
  // gets a clean error instead of throwing.
  const PIPELINE_ONLY_TOOLS = new Set([
    ...VERB_NAMES,
    DEPRECATED_TASK_TOOL,
    "check_claude_status",
    "get_claude_task_status",
    "stop_claude_task",
    "start_new_claude_session",
    "get_workspace_info",
    "get_project_state",
    "answer_claude_question",
    "set_verb_model",
    "respond_to_task_review",
  ]);

  /** @param {string} name @param {any} [args] */
  async function executeClaudeTool(name, args = {}) {
    if (PIPELINE_ONLY_TOOLS.has(name) && !getPipelineAvailable()) {
      return { status: "error", error: "The Claude pipeline is not available on this machine — add a Claude credential to enable it (see Settings)." };
    }
    // Every verb dispatches through one path, so a verb added to the registry
    // needs no case of its own here.
    if (isVerb(name)) return submitVerb(name, args, { urgency: args?.urgency });
    switch (name) {
      case DEPRECATED_TASK_TOOL:
        return submitClaudeTask(args);
      case "check_claude_status":
        return checkClaudeStatus();
      case "get_claude_task_status":
        return getClaudeTaskStatus(args);
      case "stop_claude_task":
        return stopClaudeTask(args);
      case "start_new_claude_session":
        return startNewClaudeSession(args);
      case "get_workspace_info":
        return workspaceInfo();
      case "get_project_state":
        return getProjectState();
      case "answer_claude_question":
        return resolvePendingPoQuestion(args.answers);
      case "set_verb_model":
        return setVerbModelTool(args);
      case "respond_to_task_review":
        return respondToTaskReview(args);
      case "get_ui_context":
        return getUiContext();
      case "control_ui":
        return controlUi(args);
      case "capture_note":
        // NOT in PIPELINE_ONLY_TOOLS, deliberately: a plain file write needs no
        // worker, so it must survive chat-only mode (design D4/D7,
        // pipeline-availability spec "A worker-free local tool still works").
        return captureNote(args);
      case "go_to_sleep":
        // Give the goodbye a moment to play before the renderer tears down
        // audio (its stop() flushes playback immediately).
        setTimeout(() => emitToRenderer("iris:sleep", {}), sleepDelayMs());
        return {
          status: "sleeping",
          instructions: `Say a one-line goodbye right now (nothing else, no new topics). Iris goes to sleep in about ${Math.round(sleepDelayMs() / 1000)} seconds.`,
        };
      default:
        return { status: "error", error: `Unknown tool: ${name}` };
    }
  }

  return {
    PendingReview,
    buildRun,
    dispatch,
    shouldPark,
    submitVerb,
    submitClaudeTask,
    cancelTaskReview,
    approveTaskReview,
    respondToTaskReview,
    resolvePromptReview,
    startNewClaudeSession,
    getClaudeTaskStatus,
    stopClaudeTask,
    getProjectState,
    setVerbModelTool,
    getUiContext,
    controlUi,
    executeClaudeTool,
  };
}
