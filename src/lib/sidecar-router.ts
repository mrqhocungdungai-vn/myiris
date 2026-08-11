import { eventTime, readStatusObject, readString } from "./tasks";
import { isVerb } from "./verbs";
import { transcriptVoice } from "./transcript-speaker";

// Routes one sidecar event to whichever domain owns it.
//
// This was a 19-branch `if` chain inside `App.tsx`, and it was **correctly**
// left there while every branch called a bare `setState`: extracting it then
// would have meant threading twenty setters through, relocating the coupling
// rather than reducing it.
//
// Once the domains became hooks, the branches became calls on domain objects,
// and the calculation changed. The router now takes ten named collaborators
// instead of twenty setters, says what it does, and — the part that was never
// possible before — can be driven with fakes and asserted.
//
// It stays a flat `if`/`return` chain rather than a lookup table on purpose:
// several branches do real work beyond a single call, and a table would push
// that work into closures defined somewhere else, which is how a router stops
// being readable as "what happens when X arrives".

export type SidecarRouterDeps = {
  session: {
    setRunning: (running: boolean) => void;
    setPid: (pid: number | null) => void;
    setGemini: (status: string) => void;
    setClaude: (status: string) => void;
    setAudio: (state: string) => void;
  };
  work: { apply: (event: SidecarEvent) => void; finishRun: (runId: string) => void };
  review: {
    applyMode: (mode: ReviewMode) => void;
    setPending: (review: PendingTaskReview | null) => void;
  };
  claudeQuestion: {
    raise: (pending: { workstreamId: string; questions: ClaudeQuestion[] }) => void;
    clear: () => void;
  };
  listenOnly: { refuse: (tool: string) => void; setHeardLive: (text: string) => void };
  orb: { ripple: () => void };
  workstreams: { apply: (snapshot: SessionsSnapshot) => void; refreshVerbs: () => void };
  hud: { closeGalaxy: () => void };
  pushLog: (level: string, message: string, timestamp?: number) => void;
  pushTranscript: (speaker: string, text: string) => void;
  setPipelineAvailable: (available: boolean) => void;
  setSecondBrainAvailable: (available: boolean) => void;
};

export function routeSidecarEvent(event: SidecarEvent, deps: SidecarRouterDeps): void {
  const {
    session,
    work,
    review,
    claudeQuestion,
    listenOnly,
    orb,
    workstreams,
    hud,
    pushLog,
    pushTranscript,
    setPipelineAvailable,
    setSecondBrainAvailable,
  } = deps;

  if (event.type === "pipeline_availability") {
    setPipelineAvailable(Boolean(event.available));
    return;
  }

  if (event.type === "secondbrain_availability") {
    const available = Boolean(event.available);
    setSecondBrainAvailable(available);
    // On disappearance, force-close the galaxy and hide the toggle
    // (design.md D7/M4/M-5/L2).
    if (!available) hud.closeGalaxy();
    return;
  }

  if (event.type === "claude_session") {
    workstreams.apply({
      active: typeof event.active === "string" ? event.active : null,
      sessions: Array.isArray(event.sessions) ? (event.sessions as ClaudeSession[]) : [],
    } as SessionsSnapshot);
    return;
  }

  if (event.type === "sidecar_status") {
    const status = readStatusObject(event.status);
    session.setRunning(Boolean(status.running));
    session.setPid(typeof status.pid === "number" ? status.pid : null);
    return;
  }

  if (event.type === "gemini_status") {
    session.setGemini(readString(event.status, "unknown"));
    return;
  }

  if (event.type === "claude_status") {
    const status = readString(event.status, "unknown");
    session.setClaude(status);
    pushLog(
      status === "error" ? "error" : "info",
      `Claude ${status}${event.error ? `: ${readString(event.error)}` : ""}`,
      eventTime(event),
    );
    return;
  }

  if (event.type === "audio_state") {
    session.setAudio(readString(event.state, "idle"));
    return;
  }

  // listen-mode-hears-system-audio: something Iris overheard tried to make her
  // act, and main refused it before dispatch. Surfaced as its own notice rather
  // than left to the activity strip — the strip is ambient and scrolls away, and
  // an unnoticed refusal is indistinguishable from Iris quietly doing the work.
  if (event.type === "listen_only_refused") {
    listenOnly.refuse(readString(event.tool, "a task"));
    return;
  }

  if (event.type === "heard_live") {
    listenOnly.setHeardLive(readString(event.text));
    return;
  }

  if (event.type === "transcript") {
    const speaker = readString(event.speaker, "unknown");
    const text = readString(event.text);
    if (text.trim()) {
      // The ripple means "your speech just locked in", so it must not fire for a
      // line Iris merely overheard — transcriptVoice keeps that decision in one
      // place for the two surfaces and this.
      if (transcriptVoice(speaker) === "self") orb.ripple();
      pushTranscript(speaker, text);
    }
    return;
  }

  if (event.type === "claude_task_update") {
    // The whole fold — id resolution, field merging, the step timeline and the
    // list cap — is `applyTaskUpdate` in lib/tasks.ts, where it is tested.
    work.apply(event);
    return;
  }

  if (event.type === "agent_model_update") {
    // A verb's model changed — via this window's own popover, another window, or
    // the voice tool. Re-read the roster so the chip badge reflects it either way.
    workstreams.refreshVerbs();
    return;
  }

  if (event.type === "claude_question") {
    const status = readString(event.status, "pending");
    const workstreamId = readString(event.workstream_id);
    const questions = Array.isArray(event.questions) ? (event.questions as ClaudeQuestion[]) : [];
    if (status === "pending") {
      claudeQuestion.raise({ workstreamId, questions });
      return;
    }
    claudeQuestion.clear();
    if (status === "timed_out") {
      // Which branch actually ran — main tells us (run-stream.mjs's settle
      // `outcome`), we do not infer it. "timed_out" covers both expiry policies,
      // and announcing the ALLOW wording for a DENY settlement reports a decision
      // the user never made (voice-decision-relay: "The unanswered outcome is
      // never presented as a decision"). An older main that sends no `outcome`
      // falls back to the neutral wording rather than to the wrong one.
      const outcome = readString(event.outcome, "timed_out");
      pushLog(
        "warn",
        outcome === "defaulted"
          ? "Claude's question went unanswered — applied its recommended option."
          : outcome === "unanswered"
            ? "Claude's question went unanswered — no answer was supplied and the run stopped."
            : "Claude's question went unanswered.",
        eventTime(event),
      );
    }
    return;
  }

  if (event.type === "prompt_review_mode") {
    review.applyMode((event.reviewMode as ReviewMode) ?? "verb");
    return;
  }

  if (event.type === "task_review") {
    const status = readString(event.status, "pending");
    if (status === "pending") {
      review.setPending({
        workstreamId: readString(event.workstream_id),
        task: readString(event.task),
        urgency: readString(event.urgency, "normal"),
        verb: isVerb(event.verb) ? event.verb : null,
      } as PendingTaskReview);
      return;
    }
    review.setPending(null);
    if (status === "timed_out") {
      pushLog("warn", "A parked brief went unanswered and was not sent to Claude.", eventTime(event));
    }
    return;
  }

  if (event.type === "claude_completion") {
    pushLog("info", `Claude returned: ${readString(event.task, "task complete")}`, eventTime(event));
    // The finished run may have written its handoff file — re-scan the gates.
    workstreams.refreshVerbs();
    const runId = readString(event.run_id);
    // Close any step the runtime never closed — see closeRunningSteps.
    if (runId) work.finishRun(runId);
    return;
  }

  if (event.type === "tool_call") {
    pushLog("info", `Gemini invoked ${readString(event.name, "tool")}`, eventTime(event));
    return;
  }

  if (event.type === "fatal") {
    pushLog("error", readString(event.message, "Fatal sidecar error"), eventTime(event));
    return;
  }

  if (event.type === "log") {
    pushLog(readString(event.level, "info"), readString(event.message), eventTime(event));
  }
}
