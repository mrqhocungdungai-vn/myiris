// Run activity/tool-step stream projection and the PO live-question relay:
// reacting to a running Claude process's NDJSON stream and, separately,
// pausing a PO turn to ask the user a question by voice. Split out of
// electron/main.mjs (split-main-process-modules): Electron-free — every
// cross-module effect (the run queue, session store, renderer emission,
// voice announcements) is injected.
//
// Carved out of run-dispatch.mjs (task 3.5) once that module's verbatim
// move measured 670 lines against the reorganization's 450-line ceiling —
// see run-dispatch.mjs's header comment. run-dispatch.mjs takes this
// module's resolvePendingPoQuestion as an injected dependency for its
// answer_po_question tool case.
import { parseClaudeStreamMessage } from "./claude-stream.mjs";
import { poQuestionTimeoutMs } from "./po-session.mjs";
import { RUN_STATUS, toUpdateEvent } from "./run-queue.mjs";
import { createTrailingThrottle } from "./coalesce.mjs";
import { activityEmitIntervalMs } from "./user-config.mjs";

/**
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   notifyIris: (lines: string | string[], opts?: { bufferIfOffline?: boolean }) => void,
 *   findWorkstream: (id: string | null) => any,
 *   agentKey: (agent: string | null) => string,
 *   persistSessionStore: () => void,
 *   emitSessions: () => void,
 * }} deps
 */
export function createRunStream({
  runQueue,
  emitEvent,
  notifyIris,
  findWorkstream,
  agentKey,
  persistSessionStore,
  emitSessions,
}) {
  // At most one PO turn (or DEV run) is ever mid-execution system-wide — Claude
  // runs strictly one at a time (see runQueue) — so at most one
  // AskUserQuestion can be pending across the whole app. This object owns that
  // single slot and the "raised → answered/expired/abandoned, exactly once"
  // invariant: every settlement path (answer, expire, abandon) funnels through
  // one settle() so nothing can resolve the same question twice or hang it
  // forever — see openspec/changes/architecture-deepening-refactors/design.md
  // decision 2 (an earlier bare-global version already caused exactly that bug).
  const PendingQuestion = {
    current: null, // { workstreamId, questions, resolve, timer }

    raise(workstreamId, questions, { timeoutMs }) {
      // The active run is legitimately blocked on a human now, not idle — the
      // idle watchdog (run-queue.mjs) must not count this wait against its
      // bound, or it would kill precisely the turns behaving correctly. See
      // openspec/changes/add-run-idle-watchdog/design.md D3.
      runQueue.suspend();
      return new Promise((resolve) => {
        const timer = setTimeout(() => this.expire(), timeoutMs);
        this.current = { workstreamId, questions, resolve, timer };
        emitPoQuestionEvent(workstreamId, questions, "pending");
      });
    },

    settle(status, resolvedValue) {
      if (!this.current) return;
      const { workstreamId, questions, resolve, timer } = this.current;
      clearTimeout(timer);
      this.current = null;
      // Resume here, in the one funnel every settlement path (answer, expire,
      // abandon) goes through — not at the individual call sites — so no
      // future settlement path can miss it (design D3).
      runQueue.resume();
      emitPoQuestionEvent(workstreamId, questions, status);
      resolve(resolvedValue);
    },

    answer(answers) {
      this.settle("answered", { behavior: "allow", answers });
    },

    expire() {
      if (!this.current) return;
      emitEvent({
        type: "log",
        level: "warn",
        message: "The PO's question went unanswered — applying the recommended option for each.",
      });
      this.settle("timed_out", { behavior: "allow", answers: defaultPoAnswers(this.current.questions) });
    },

    // A deliberate reset denies the question rather than answering it with a
    // fabricated default — the asking role must not continue and act on a
    // decision the user never made (e.g. writing into the abandoned cwd). This
    // is the opposite of expire() above, which legitimately applies the
    // default for a question left unanswered past the configured wait.
    abandon(workstreamId) {
      if (!this.current || this.current.workstreamId !== workstreamId) return;
      this.settle("abandoned", {
        behavior: "deny",
        message: "The session was reset; this question was abandoned.",
      });
    },
  };

  function rememberClaudeSessionId(run, claudeSessionId) {
    if (!claudeSessionId) return;
    run.claude_session_id = claudeSessionId;
    const workstream = findWorkstream(run.workstream_id);
    if (!workstream) return;
    const key = agentKey(run.agent);
    const changed =
      workstream.agent_sessions[key] !== claudeSessionId ||
      workstream.last_agent_used !== (run.agent ?? null);
    workstream.agent_sessions[key] = claudeSessionId;
    workstream.last_agent_used = run.agent ?? null;
    workstream.last_used_at = Date.now() / 1000;
    workstream.last_task = run.task.slice(0, 100);
    persistSessionStore();
    if (changed) emitSessions();
  }

  // Single global slot (see runQueue) ⇒ at most one run's activity
  // throttle is ever live, so one module-level throttle handle suffices
  // (design.md D3 of coalesce-activity-updates). Only the renderer emit is
  // throttled; the buffer push, cap, and heartbeat below stay per-line (D2).
  const activityThrottle = createTrailingThrottle(
    (run) => emitEvent(toUpdateEvent(run, RUN_STATUS.RUNNING, { output: run.activity.join("\n") })),
    activityEmitIntervalMs(),
  );

  // Discard any pending trailing activity emit so it cannot fire after
  // finalize's terminal update (the real result) and overwrite it with the
  // activity log (design.md D3 of coalesce-activity-updates). Called from
  // main.mjs's runQueue.onFinalized.
  function cancelActivityThrottle() {
    activityThrottle.cancel();
  }

  function pushActivity(run, line) {
    const clean = String(line || "").trim();
    if (!clean) return;
    run.activity.push(clean.length > 220 ? `${clean.slice(0, 220)}…` : clean);
    if (run.activity.length > 80) run.activity.splice(0, run.activity.length - 80);
    activityThrottle.schedule(run);
    runQueue.heartbeat();
  }

  // Live per-task step timeline: additive fields on the SAME claude_task_update
  // projection (no new event type), keyed by Claude's own tool_use id so
  // start/end pairing survives duplicate tool names within one run. See
  // openspec/changes/two-hand-gestures-and-orb design.md D2.
  function pushToolStart(run, toolId, toolName, detail) {
    if (!toolId) return;
    if (!run.toolStartedAt) run.toolStartedAt = new Map();
    run.toolStartedAt.set(toolId, Date.now());
    emitEvent(
      toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_start", tool: toolName, tool_id: toolId, detail }),
    );
    runQueue.heartbeat();
  }

  function pushToolEnd(run, toolId, isError) {
    if (!toolId) return;
    const startedAt = run.toolStartedAt?.get(toolId);
    const duration = startedAt ? (Date.now() - startedAt) / 1000 : undefined;
    run.toolStartedAt?.delete(toolId);
    emitEvent(
      toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_end", tool_id: toolId, error: isError, duration }),
    );
    // A tool_result (per claude-stream.mjs) fires only this callback, never
    // onActivity — resetting on activity alone would stretch the measured idle
    // window to tool duration *plus* the model's next-message thinking time,
    // instead of the actual silence (design.md D6 / tasks.md 4.1).
    runQueue.heartbeat();
  }

  function handleClaudeStreamEvent(run, line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    parseClaudeStreamMessage(event, {
      onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
      onActivity: (text) => pushActivity(run, text),
      onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
      onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
      onResult: (result) => {
        run.result = result;
        rememberClaudeSessionId(run, result.session_id);
      },
    });
  }

  // The PO's recommended choice for each question, used both as the AskUserQuestion
  // convention (first option = recommended) and as the safe default on timeout/reset.
  function defaultPoAnswers(questions) {
    const answers = {};
    for (const q of questions) {
      answers[q.question] = q.options?.[0]?.label ?? "";
    }
    return answers;
  }

  // The event type stays `po_question` for renderer/IPC back-compat.
  function emitPoQuestionEvent(workstreamId, questions, status) {
    emitEvent({ type: "po_question", workstream_id: workstreamId, status, questions });
  }

  // canUseTool's onAskUserQuestion callback (electron/po-session.mjs): pauses
  // the PO's live turn, relays the question(s) to Gemini voice, and resolves
  // once an answer arrives — via the Gemini tool, the UI IPC channel, or
  // PendingQuestion's own timeout fallback. Only one run executes globally at a
  // time, so at most one question is ever pending. See the voice-decision-relay
  // spec.
  function askUserQuestionViaVoice(workstreamId, questions) {
    const promise = PendingQuestion.raise(workstreamId, questions, { timeoutMs: poQuestionTimeoutMs() });

    const lines = [
      "SYSTEM_EVENT_PO_QUESTION",
      "instructions_to_iris:",
      "- The PO has paused to ask you something. Read each question aloud with its options, in order, and collect the user's answer for each.",
      "- Once you have every answer, call answer_po_question with one entry per question (question text verbatim, and the option label the user chose).",
      "- If asked for your recommendation, suggest the first-listed option, but submit whatever the user actually picks.",
      "questions:",
      ...questions.map(
        (q, i) =>
          `${i + 1}. ${q.question}\n${(q.options || [])
            .map((opt, j) => `   ${j + 1}) ${opt.label} — ${opt.description}`)
            .join("\n")}`,
      ),
    ].join("\n");
    notifyIris(lines);

    return promise;
  }

  // Voice (Gemini tool) and the UI (IPC) both call this; whichever answers first
  // wins — the second call is a no-op since PendingQuestion is already settled.
  function resolvePendingPoQuestion(answers) {
    if (!PendingQuestion.current) return { status: "error", error: "No PO question is pending." };
    const map = {};
    for (const entry of Array.isArray(answers) ? answers : []) {
      if (entry?.question) map[entry.question] = entry.choice ?? "";
    }
    PendingQuestion.answer(map);
    return { status: "ok" };
  }

  return {
    PendingQuestion,
    rememberClaudeSessionId,
    cancelActivityThrottle,
    pushActivity,
    pushToolStart,
    pushToolEnd,
    handleClaudeStreamEvent,
    askUserQuestionViaVoice,
    resolvePendingPoQuestion,
  };
}
