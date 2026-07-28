// Task dispatch: the pre-dispatch review gate and the Gemini tool
// implementations that submit, query, and control Claude runs. Split out of
// electron/main.mjs (split-main-process-modules): Electron-free — every
// cross-module effect is injected.
//
// Originally one module with run-stream.mjs's content (task 3.5's ~380-line
// estimate) — split in two once the verbatim move measured at 670 lines,
// over the 450-line ceiling. run-stream.mjs owns the run activity/tool-step
// stream and the PO live-question relay; this module owns the review gate
// and tool-execution surface, taking run-stream's resolvePendingPoQuestion
// as an injected dependency for answer_po_question below.
import fs from "node:fs";
import crypto from "node:crypto";
import { resolveApprovedTask } from "./task-review.mjs";
import { RUN_STATUS, TERMINAL_STATUSES } from "./run-queue.mjs";
import { promptReviewTimeoutMs, sleepDelayMs } from "./user-config.mjs";

/**
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   notifyIris: (lines: string | string[], opts?: { bufferIfOffline?: boolean }) => void,
 *   findWorkstream: (id: string | null) => any,
 *   activeWorkstream: () => any,
 *   createWorkstream: (label?: string) => any,
 *   setAgentModel: (workstreamId: string, role: string, model: string) => any,
 *   agentRoster: string[],
 *   agentLabels: Record<string, string>,
 *   modelChoices: Array<{ id: string, label: string }>,
 *   getPromptReviewMode: () => boolean,
 *   getPipelineAvailable: () => boolean,
 *   checkClaudeStatus: () => Promise<any>,
 *   workspaceInfo: () => any,
 *   getUiContextSnapshot: () => any,
 *   resolvePendingPoQuestion: (answers: any) => any,
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
  setAgentModel,
  agentRoster,
  agentLabels,
  modelChoices,
  getPromptReviewMode,
  getPipelineAvailable,
  checkClaudeStatus,
  workspaceInfo,
  getUiContextSnapshot,
  resolvePendingPoQuestion,
}) {
  // Parks a Gemini-authored brief for Approve/Edit/Cancel before any Claude
  // tokens are spent (prompt-review-gate spec). Mirrors run-stream.mjs's
  // PendingQuestion settle-once + timeout + abandon shape, but deliberately
  // does NOT call runQueue.suspend/resume: a parked review holds no execution
  // slot, and pausing the queue's idle bound would wrongly disable the
  // watchdog on whatever unrelated run (typically DEV) currently holds it
  // (design.md D2).
  const PendingReview = {
    current: null, // { workstream_id, task, urgency, agent, timer }

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
    // afterwards (design.md D4: this is what keeps approve's parked workstream
    // always valid).
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
      agent: parked.agent,
    });
  }

  // Voice narration on park (D6): a short summary, not the whole brief, plus
  // "the full brief is on screen" — and explicitly forbids querying run status,
  // since a parked review has no run_id yet.
  function notifyTaskReviewParked(parked) {
    notifyIris([
      "SYSTEM_EVENT_TASK_REVIEW_PARKED",
      `agent: ${parked.agent ?? "none"}`,
      "instructions_to_iris:",
      "- Review mode is on: the brief you just submitted was parked, not sent to Claude — zero tokens spent so far.",
      "- Speak a SHORT 1-2 sentence summary of the brief you just wrote (do not read it verbatim), say the full brief is on screen, then wait. Do not say it started or is queued.",
      "- Do NOT call get_claude_task_status for this — there is no run yet.",
      "- The user may approve (optionally after editing), or cancel — from the screen, or by telling you so you can call respond_to_task_review. If they resolve it from the screen, you will receive SYSTEM_EVENT_TASK_REVIEW_RESOLVED instead.",
    ]);
  }

  // Injected on any resolution the voice layer did NOT itself initiate — a
  // UI-driven approve/cancel, a timeout, or a reset-abandon (D6, review #5).
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

  // D1: buildRun resolves the workstream/role and produces the run object;
  // dispatch submits it and shapes the result. Auto mode below calls
  // dispatch(buildRun(...)) inline — byte-identical to the pre-gate behavior.
  function buildRun({ task, urgency = "normal", agent, workstream }) {
    const cleanTask = String(task).trim();
    // The role is captured at enqueue time: a queued/parked task keeps the
    // agent it was submitted under even if the user flips the pipeline picker
    // afterwards. Gemini may name a role explicitly; anything not in the
    // roster is ignored.
    const requestedAgent = agent ? String(agent).trim().toLowerCase() : null;
    if (requestedAgent && !agentRoster.includes(requestedAgent)) {
      emitEvent({ type: "log", level: "warn", message: `Ignoring unknown agent "${agent}" — using the session's active agent.` });
    }
    const runAgent = agentRoster.includes(requestedAgent) ? requestedAgent : workstream.active_agent ?? null;
    return {
      run_id: crypto.randomUUID(),
      workstream_id: workstream.id,
      session_label: workstream.label,
      task: cleanTask,
      urgency,
      agent: runAgent,
      status: RUN_STATUS.QUEUED,
      output: "",
      activity: [],
      queued_at: Date.now() / 1000,
      child: null,
    };
  }

  function dispatch(run) {
    const runAgent = run.agent;
    const agentLabel = runAgent ? `${agentLabels[runAgent]} agent` : "Claude";
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
        position: outcome.position,
        project_folder: projectFolder,
        message: `Claude is still finishing the current task. This one is queued at position ${outcome.position} for the ${agentLabel} and will start automatically. ${whereNote}`,
      };
    }
    if (TERMINAL_STATUSES.includes(outcome.status)) {
      // The run was rejected synchronously during start (e.g. the DEV gate
      // finding no open change with tasks) — never say "started" for a run
      // that has already failed. onFinalized is gated on started_at (see
      // run-queue.mjs), so this is the only channel this rejection reaches
      // Gemini through.
      return {
        status: outcome.status,
        run_id: run.run_id,
        agent: runAgent,
        project_folder: projectFolder,
        message: `${runAgent ? `Claude's ${agentLabel}` : "Claude"} did not start the task: ${outcome.output} ${whereNote}`,
      };
    }
    return {
      status: "started",
      run_id: run.run_id,
      agent: runAgent,
      project_folder: projectFolder,
      message: `${runAgent ? `Claude's ${agentLabel} has started the task.` : "Claude has started the task."} ${whereNote}`,
    };
  }

  /** @param {{ task?: string, urgency?: string, agent?: string }} [params] */
  async function submitClaudeTask({ task, urgency = "normal", agent } = {}) {
    if (!task || !String(task).trim()) {
      return { status: "error", error: "Task is required." };
    }
    const workstream = activeWorkstream();

    // Review gate (prompt-review-gate spec): park instead of dispatching.
    // Zero tokens spent — no run, no run_id — until the review is approved.
    if (getPromptReviewMode()) {
      const parked = {
        workstream_id: workstream.id,
        task: String(task).trim(),
        urgency,
        agent: agent ? String(agent).trim().toLowerCase() : null,
      };
      PendingReview.raise(parked, { timeoutMs: promptReviewTimeoutMs() });
      notifyTaskReviewParked(parked);
      return {
        status: "parked_for_review",
        workstream_id: workstream.id,
        message: "The brief is parked for the user's review — nothing has been sent to Claude yet.",
      };
    }

    return dispatch(buildRun({ task, urgency, agent, workstream }));
  }

  function cancelTaskReview({ notify }) {
    const parked = PendingReview.clear("cancelled");
    if (!parked) return { status: "error", error: "No task review is pending." };
    if (notify) notifyTaskReviewResolved("cancelled", parked, "The brief was cancelled and was not sent to Claude.");
    return { status: "ok" };
  }

  // Approve dispatches against the PARKED workstream_id, never a fresh
  // activeWorkstream() read — the user may have switched workstreams while the
  // review sat parked (design.md D4). editedTaskRaw is validated by the pure
  // helper below: undefined/null falls back to the parked task; an explicitly
  // empty edit is refused WITHOUT clearing the pending review, so the banner
  // stays up and the user can fix it.
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
    const result = dispatch(buildRun({ task: finalTask, urgency: parked.urgency, agent: parked.agent, workstream }));
    if (notify) notifyTaskReviewResolved(result.status, parked, result.message);
    return result;
  }

  // Voice tool `respond_to_task_review` — its own synchronous tool return IS
  // Gemini's notification of the outcome, so this path never also injects
  // SYSTEM_EVENT_TASK_REVIEW_RESOLVED (reserved for channels Gemini did not
  // initiate). Editing is deck-only (D7): voice can only approve as-is or
  // cancel, never supply edited text.
  /** @param {{ decision?: string }} [params] */
  function respondToTaskReview({ decision } = {}) {
    const clean = String(decision || "").trim().toLowerCase();
    if (clean === "approve") return approveTaskReview(undefined, { notify: false });
    if (clean === "cancel") return cancelTaskReview({ notify: false });
    return { status: "error", error: `Unknown decision: ${decision}` };
  }

  // IPC path for the UI banner (deck Approve/Cancel + edit, HUD Approve/Cancel).
  // Gemini did not initiate this, so the resolution needs the SYSTEM_EVENT to
  // stay coherent (D6, review #5).
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

  // Voice path for switching a role's model — goes through the exact same
  // setAgentModel() choke point the UI popover uses, so the two can never
  // diverge. Always targets the active workstream (Gemini never invents ids).
  /** @param {{ role?: string, model?: string }} [params] */
  function setAgentModelTool({ role, model } = {}) {
    const workstream = activeWorkstream();
    const result = setAgentModel(workstream.id, role, model);
    if (result.status === "error") return result;
    const label = modelChoices.find((choice) => choice.id === model)?.label ?? model;
    return { status: "ok", message: `${agentLabels[role] ?? role}'s model is now ${label}.` };
  }

  // Voice-driven UI control (design.md D1/D2, spec voice-ui-control). Single
  // tool with an action enum — mirrors the {action, target_id?, query?} shape
  // forwarded verbatim to the renderer over iris:ui-action. Renamed from
  // upstream's Hermes vocabulary to Claude terms; no other change.
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
  // Gemini only when pipelineAvailable is true (see geminiTools.buildClaudeTools). This
  // guard is a defensive backstop, not the primary gate: Gemini should never
  // call one of these in chat-only mode since it was never given the
  // declaration, but a stray call (e.g. a race right after availability drops)
  // gets a clean error instead of throwing.
  const PIPELINE_ONLY_TOOLS = new Set([
    "check_claude_status",
    "submit_claude_task",
    "get_claude_task_status",
    "stop_claude_task",
    "start_new_claude_session",
    "get_workspace_info",
    "answer_po_question",
    "set_agent_model",
    "respond_to_task_review",
  ]);

  /** @param {string} name @param {any} [args] */
  async function executeClaudeTool(name, args = {}) {
    if (PIPELINE_ONLY_TOOLS.has(name) && !getPipelineAvailable()) {
      return { status: "error", error: "The Claude pipeline is not available on this machine — install the Claude CLI to enable it (see Settings)." };
    }
    switch (name) {
      case "check_claude_status":
        return checkClaudeStatus();
      case "submit_claude_task":
        return submitClaudeTask(args);
      case "get_claude_task_status":
        return getClaudeTaskStatus(args);
      case "stop_claude_task":
        return stopClaudeTask(args);
      case "start_new_claude_session":
        return startNewClaudeSession(args);
      case "get_workspace_info":
        return workspaceInfo();
      case "answer_po_question":
        return resolvePendingPoQuestion(args.answers);
      case "set_agent_model":
        return setAgentModelTool(args);
      case "respond_to_task_review":
        return respondToTaskReview(args);
      case "get_ui_context":
        return getUiContext();
      case "control_ui":
        return controlUi(args);
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
    submitClaudeTask,
    cancelTaskReview,
    approveTaskReview,
    respondToTaskReview,
    resolvePromptReview,
    startNewClaudeSession,
    getClaudeTaskStatus,
    stopClaudeTask,
    setAgentModelTool,
    getUiContext,
    controlUi,
    executeClaudeTool,
  };
}
