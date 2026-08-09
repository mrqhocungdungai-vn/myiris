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
// answer_claude_question tool case.
import { parseClaudeStreamMessage, runUsageFrom } from "./claude-stream.mjs";
import { nameSession } from "./run-sessions.mjs";
import { poQuestionTimeoutMs } from "./po-session.mjs";
import { RUN_STATUS, toUpdateEvent } from "./run-queue.mjs";
import { createTrailingThrottle } from "./coalesce.mjs";
import { isVerb, resolveVerb } from "./verbs.mjs";
import { activityEmitIntervalMs } from "./user-config.mjs";

/**
 * What an unanswered question settles as. **Supplied by the caller that raises
 * it, never inferred here** (ask-when-unspecified D3): which behavior is right
 * is a property of the asking run, and inference from the verb or the run is
 * exactly how the two policies would drift apart.
 *
 * - `RECOMMENDED_OPTION` — resolve an *answer* built from the first-listed
 *   option, by the AskUserQuestion convention that the first option is the
 *   recommendation. Right where the asking run's output is something the user
 *   reads and decides on before anything happens to their files: a defaulted
 *   decision is visible and reversible at no cost.
 * - `DENY` — supply NO answer, so the asking run stops instead of proceeding.
 *   Right where the run WRITES. Applying a default there produces the one
 *   outcome worse than an honest guess: the run acts on a decision the user
 *   never made, and every downstream account of it — the result, the spoken
 *   announcement, the record in the notes — reads as though the user had been
 *   consulted.
 */
export const QUESTION_EXPIRY = Object.freeze({
  RECOMMENDED_OPTION: "recommended_option",
  DENY: "deny",
});

/**
 * @param {{
 *   runQueue: any,
 *   emitEvent: (event: any) => void,
 *   notifyIris: (lines: string | string[], opts?: { bufferIfOffline?: boolean }) => void,
 *   findWorkstream: (id: string | null) => any,
 *   sessionKeyFor: (verb: string, state?: any) => string,
 *   persistSessionStore: () => void,
 *   emitSessions: () => void,
 * }} deps
 */
export function createRunStream({
  runQueue,
  emitEvent,
  notifyIris,
  findWorkstream,
  sessionKeyFor,
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

    // `onExpiry` is the asking caller's declared policy (QUESTION_EXPIRY
    // above), not a default this object gets to choose for them. It defaults to
    // RECOMMENDED_OPTION only because that is what every resident-session
    // caller already relied on before there was a second policy.
    /**
     * @param {string} workstreamId
     * @param {any[]} questions
     * @param {{ timeoutMs: number, onExpiry?: string }} policy
     */
    raise(workstreamId, questions, { timeoutMs, onExpiry = QUESTION_EXPIRY.RECOMMENDED_OPTION }) {
      // The active run is legitimately blocked on a human now, not idle — the
      // idle watchdog (run-queue.mjs) must not count this wait against its
      // bound, or it would kill precisely the turns behaving correctly. See
      // openspec/changes/add-run-idle-watchdog/design.md D3. Run-shape-agnostic
      // by design: a one-shot headless run that pauses on a question is inside
      // exactly what run-execution-queue already specifies for "the active run".
      runQueue.suspend();
      return new Promise((resolve) => {
        const timer = setTimeout(() => this.expire(), timeoutMs);
        this.current = { workstreamId, questions, resolve, timer, onExpiry };
        emitPoQuestionEvent(workstreamId, questions, "pending");
      });
    },

    // `outcome` names WHICH settlement ran, because `status` alone cannot:
    // both expiry policies settle as "timed_out", and the renderer was
    // announcing the ALLOW branch's wording ("applied its recommended
    // option") for the DENY branch too — a run that deliberately supplied no
    // answer was reported as a decision the user never made, which
    // voice-decision-relay ("The unanswered outcome is never presented as a
    // decision") forbids. Emitted from the one funnel every path goes
    // through, so no future settlement path can omit it.
    settle(status, resolvedValue, outcome = status) {
      if (!this.current) return;
      const { workstreamId, questions, resolve, timer } = this.current;
      clearTimeout(timer);
      this.current = null;
      // Resume here, in the one funnel every settlement path (answer, expire,
      // abandon) goes through — not at the individual call sites — so no
      // future settlement path can miss it (design D3).
      runQueue.resume();
      emitPoQuestionEvent(workstreamId, questions, status, outcome);
      resolve(resolvedValue);
    },

    answer(answers) {
      this.settle("answered", { behavior: "allow", answers });
    },

    // Both policies land here and both go through the single settle() below, so
    // neither can miss runQueue.resume() (ask-when-unspecified 4.6).
    expire() {
      if (!this.current) return;
      const { questions, onExpiry } = this.current;
      if (onExpiry === QUESTION_EXPIRY.DENY) {
        // No answer is supplied and no option is chosen on the user's behalf.
        // The asking run stops here rather than proceeding on a decision that
        // was never made — see QUESTION_EXPIRY.
        emitEvent({
          type: "log",
          level: "warn",
          message:
            "A question from a run that writes went unanswered — supplying no answer, so the run stops " +
            "instead of proceeding on a default.",
        });
        this.settle(
          "timed_out",
          {
            behavior: "deny",
            reason: "unanswered",
            message: unansweredDenialMessage(questions),
          },
          "unanswered",
        );
        return;
      }
      emitEvent({
        type: "log",
        level: "warn",
        message: "The question went unanswered — applying the recommended option for each.",
      });
      this.settle("timed_out", { behavior: "allow", answers: defaultPoAnswers(questions) }, "defaulted");
    },

    // A deliberate reset denies the question rather than answering it with a
    // fabricated default — the asking session must not continue and act on a
    // decision the user never made (e.g. writing into the abandoned cwd). This
    // is the opposite of expire()'s RECOMMENDED_OPTION branch, which
    // legitimately applies the default for a question left unanswered past the
    // configured wait.
    abandon(workstreamId) {
      if (!this.current || this.current.workstreamId !== workstreamId) return;
      this.settle("abandoned", {
        behavior: "deny",
        reason: "abandoned",
        message: "The session was reset; this question was abandoned.",
      });
    },
  };

  function rememberClaudeSessionId(run, claudeSessionId) {
    if (!claudeSessionId) return;
    run.claude_session_id = claudeSessionId;
    const workstream = findWorkstream(run.workstream_id);
    if (!workstream) return;
    // open-note-session D2: work_on_note's key is per-note, resolved against
    // whichever note was open when the RUN started (run.verbConfig.projectState,
    // set once in run-exec.mjs's startClaudeRun) — not against whatever note
    // happens to be open now, which could have changed mid-turn.
    const key = sessionKeyFor(run.verb, run.verbConfig?.projectState);
    const changed =
      workstream.agent_sessions[key] !== claudeSessionId || workstream.last_verb_used !== run.verb;
    workstream.agent_sessions[key] = claudeSessionId;
    workstream.last_verb_used = run.verb;
    workstream.last_used_at = Date.now() / 1000;
    workstream.last_task = run.task.slice(0, 100);
    persistSessionStore();
    if (changed) {
      emitSessions();
      // Name the session after the workstream, once, when it is first seen.
      // Every session Iris created used to carry an auto-generated title, so a
      // user browsing their transcripts had no way to tell which project or
      // which kind of work a session belonged to. Fire-and-forget and never
      // throws — a title is cosmetic and must not be able to disturb a run.
      const label = [workstream.label, run.verbConfig?.label ?? run.verb].filter(Boolean).join(" · ");
      void nameSession(claudeSessionId, label, { dir: workstream.cwd });
    }
  }

  // One throttle PER RUN. It used to be a single module-level handle, on the
  // stated grounds that the single execution slot meant at most one run's
  // activity could ever be live — true when it was written, and no longer
  // true: a resident conversation turn now runs beside a slot job
  // (the-canvas-becomes-a-conversation D2).
  //
  // A shared trailing throttle keeps only the LATEST scheduled args, so two
  // interleaved runs would have silently swallowed each other's updates, and
  // `cancel()` on either one finalizing would have discarded a pending emit
  // belonging to the other. Only the renderer emit is throttled; the buffer
  // push, cap, and heartbeat below stay per-line (D2 of
  // coalesce-activity-updates).
  const activityThrottles = new Map(); // run_id -> throttle

  function activityThrottleFor(run) {
    let throttle = activityThrottles.get(run.run_id);
    if (!throttle) {
      throttle = createTrailingThrottle(
        (pending) => emitEvent(toUpdateEvent(pending, RUN_STATUS.RUNNING, { output: pending.activity.join("\n") })),
        activityEmitIntervalMs(),
      );
      activityThrottles.set(run.run_id, throttle);
    }
    return throttle;
  }

  // Discard any pending trailing activity emit so it cannot fire after
  // finalize's terminal update (the real result) and overwrite it with the
  // activity log (design.md D3 of coalesce-activity-updates). Called from
  // main.mjs's runQueue.onFinalized, with the run that finalized — cancelling
  // every run's would now take an unrelated conversation's pending update with
  // it.
  function cancelActivityThrottle(run = null) {
    if (!run) {
      for (const throttle of activityThrottles.values()) throttle.cancel();
      activityThrottles.clear();
      return;
    }
    activityThrottles.get(run.run_id)?.cancel();
    activityThrottles.delete(run.run_id);
    // A narration still pending when the turn ends would be spoken after the
    // result it was describing — an aside about work already reported.
    narrationThrottles.get(run.run_id)?.cancel();
    narrationThrottles.delete(run.run_id);
  }

  function pushActivity(run, line) {
    const clean = String(line || "").trim();
    if (!clean) return;
    run.activity.push(clean.length > 220 ? `${clean.slice(0, 220)}…` : clean);
    if (run.activity.length > 80) run.activity.splice(0, run.activity.length - 80);
    activityThrottleFor(run).schedule(run);
    runQueue.heartbeat(run.run_id);
  }

  // Live per-task step timeline: additive fields on the SAME claude_task_update
  // projection (no new event type), keyed by Claude's own tool_use id so
  // start/end pairing survives duplicate tool names within one run. See
  // openspec/changes/two-hand-gestures-and-orb design.md D2.
  // How often an act may be spoken during one turn. Slower than the deck's
  // activity updates on purpose: the deck is glanced at, speech is listened to,
  // and a voice reporting every tool call talks over the work it is narrating.
  const ACT_NARRATION_INTERVAL_MS = 3000;
  const narrationThrottles = new Map(); // run_id -> throttle

  function narrateAct(run, toolName, detail) {
    if (!isVerb(run.verb) || !resolveVerb(run.verb).narrateActs) return;
    let throttle = narrationThrottles.get(run.run_id);
    if (!throttle) {
      throttle = createTrailingThrottle((act) => {
        notifyIris([
          "SYSTEM_EVENT_WORK_IN_PROGRESS",
          `tool: ${act.tool}`,
          ...(act.detail ? [`detail: ${act.detail}`] : []),
          "instructions_to_iris:",
          "- Say in a few words what is happening right now, as an aside, then stop.",
          "- Report only this act. Do not guess what comes next, do not summarize the work so far, and do not describe the canvas — you cannot see it.",
          "- If you are mid-sentence, finish it first. This is an aside, not an interruption.",
        ]);
      }, ACT_NARRATION_INTERVAL_MS);
      narrationThrottles.set(run.run_id, throttle);
    }
    throttle.schedule({ tool: toolName, detail });
  }

  function pushToolStart(run, toolId, toolName, detail) {
    if (!toolId) return;
    if (!run.toolStartedAt) run.toolStartedAt = new Map();
    run.toolStartedAt.set(toolId, Date.now());
    emitEvent(
      toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_start", tool: toolName, tool_id: toolId, detail }),
    );
    // Only where the verb declares the user is watching this happen.
    narrateAct(run, toolName, detail);
    runQueue.heartbeat(run.run_id);
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
    runQueue.heartbeat(run.run_id);
  }

  // Takes an already-parsed SDK message. Both transports now deliver objects —
  // DEV iterates the Agent SDK's async iterator and PO's pump routes the same
  // union — so there is no newline-delimited JSON to decode on either side.
  function handleClaudeStreamMessage(run, event) {
    if (!event || typeof event !== "object") return;
    parseClaudeStreamMessage(event, {
      onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
      onActivity: (text) => pushActivity(run, text),
      onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
      onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
      onResult: (result) => {
        run.result = result;
        run.usage = runUsageFrom(result);
        rememberClaudeSessionId(run, result.session_id);
      },
    });
  }

  // AskUserQuestion's `answers` map is question text -> ONE string, and a
  // multi-select answer is that string with the chosen labels comma-separated
  // (see the SDK's AskUserQuestionInput). Every answer path — voice, the UI, and
  // the timeout default — encodes through here, so none of them can silently
  // reduce a multi-select question to a single choice.
  function encodeAnswer(choice) {
    const labels = Array.isArray(choice) ? choice : [choice];
    return labels
      .map((label) => String(label ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }

  // The PO's recommended choice for each question, used both as the AskUserQuestion
  // convention (first option = recommended) and as the safe default on timeout/reset.
  // Encoded in the shape the question asked for: a multi-select question's default
  // travels as a list, so it carries however many options the recommendation names
  // rather than being structurally capped at one.
  function defaultPoAnswers(questions) {
    const answers = {};
    for (const q of questions) {
      const recommended = q.options?.[0]?.label ?? "";
      answers[q.question] = q.multiSelect ? encodeAnswer([recommended]) : encodeAnswer(recommended);
    }
    return answers;
  }

  // What the asking run is told when its question expires under
  // QUESTION_EXPIRY.DENY. Names the question rather than gesturing at one, and
  // says outright that nothing was chosen — this text is the model's only
  // account of what happened, and "denied" on its own reads like a refusal of
  // the work rather than an absent answer.
  function unansweredDenialMessage(questions) {
    const asked = (questions ?? [])
      .map((q) => String(q?.question ?? "").trim())
      .filter(Boolean)
      .map((q) => `"${q}"`)
      .join(" ");
    return (
      "No answer arrived, and no option was chosen on the user's behalf. " +
      (asked ? `The question was: ${asked}. ` : "") +
      "Stop here without writing anything further."
    );
  }

  // The event type stays `po_question` for renderer/IPC back-compat.
  function emitPoQuestionEvent(workstreamId, questions, status, outcome = status) {
    emitEvent({ type: "po_question", workstream_id: workstreamId, status, outcome, questions });
  }

  // canUseTool's onAskUserQuestion callback: pauses the asking run, relays the
  // question(s) to Gemini voice, and resolves once an answer arrives — via the
  // Gemini tool, the UI IPC channel, or PendingQuestion's own timeout fallback.
  // Only one run executes globally at a time, so at most one question is ever
  // pending. See the voice-decision-relay spec.
  //
  // The ONE relay, for every asking run (ask-when-unspecified 3.1): a resident
  // session's own question, the open-note write guard's confirmation, and a
  // one-shot build run's question all arrive here. `onExpiry` is what differs
  // between them, and it is the caller's to declare.
  /**
   * @param {string} workstreamId
   * @param {any[]} questions
   * @param {{ onExpiry?: string }} [policy]
   */
  function askUserQuestionViaVoice(workstreamId, questions, { onExpiry = QUESTION_EXPIRY.RECOMMENDED_OPTION } = {}) {
    const promise = PendingQuestion.raise(workstreamId, questions, {
      timeoutMs: poQuestionTimeoutMs(),
      onExpiry,
    });

    const lines = [
      "SYSTEM_EVENT_PO_QUESTION",
      "instructions_to_iris:",
      "- Claude has paused mid-task to ask you something. Read each question aloud with its options, in order, and collect the user's answer for each.",
      "- Once you have every answer, call answer_claude_question with one entry per question (question text verbatim, and the option label the user chose).",
      "- If asked for your recommendation, suggest the first-listed option, but submit whatever the user actually picks.",
      // The expiry difference, stated rather than left for Iris to assume
      // (ask-when-unspecified 5.4). Telling the user a default was applied when
      // the run in fact stopped — or that it stopped when a default was in fact
      // applied — is a false account of what happened to their work.
      onExpiry === QUESTION_EXPIRY.DENY
        ? "- This question is BLOCKING work that writes: if it goes unanswered, the run STOPS and writes nothing further. No default is applied and nothing is chosen for the user. So get an answer if you can, and if the run does stop, say it stopped for want of an answer — never that a recommended option was used."
        : "- If this goes unanswered past the wait, the first-listed option is applied as the recommended default and the run continues. If that happens, say plainly that the default was applied.",
      // `header` is the question's own short label. Relayed so Iris can
      // introduce a question by its topic instead of launching into the full
      // text, which is what the label is for.
      "- Each question carries a short topic label — use it to introduce the question naturally, do not read it out as if it were part of the question.",
      "- A question marked multi_select accepts SEVERAL options. Say so when you read it, let the user pick as many as they want, and submit every one of them comma-separated. Never narrow it to one.",
      "questions:",
      ...questions.map(
        (q, i) =>
          `${i + 1}. [${q.header || "decision"}]${q.multiSelect ? " (multi_select: the user may choose more than one)" : ""} ${q.question}\n${(q.options || [])
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
      // `choice` may arrive as one label or as several (the UI sends an array
      // for a multi-select question; Gemini sends them comma-separated).
      if (entry?.question) map[entry.question] = encodeAnswer(entry.choices ?? entry.choice ?? "");
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
    handleClaudeStreamMessage,
    askUserQuestionViaVoice,
    resolvePendingPoQuestion,
  };
}
