import { useEffect, useMemo, useRef, useState } from "react";
import type { LogLine, TaskCard, TaskStep, TranscriptLine } from "./types";
import {
  TERMINAL,
  eventTime,
  findTaskMatches,
  readString,
  readStatusObject,
  resolveMergedString,
  taskKeyFor,
} from "./lib/tasks";
import { AGENT_LABELS, PIPELINE, isAgentRole, modelLabel } from "./lib/agents";
import { uiSounds } from "./lib/sounds";
import { useAudioPipeline } from "./hooks/useAudioPipeline";
import { useHandoffFx } from "./hooks/useHandoffFx";
import { useHandControl, SYSTEM_DEFAULT_CAMERA, type HandPoint } from "./hooks/useHandControl";
import { useWakeWord } from "./hooks/useWakeWord";
import TopBar from "./components/TopBar";
import HudShell from "./components/HudShell";
import CommsPanel from "./components/CommsPanel";
import CameraDock from "./components/CameraDock";
import CenterStage from "./components/CenterStage";
import WorkStream from "./components/WorkStream";
import PipelineBar from "./components/PipelineBar";
import PoQuestionBanner from "./components/PoQuestionBanner";
import ReviewBanner from "./components/ReviewBanner";
import ProjectBar from "./components/ProjectBar";
import ReaderOverlay from "./components/ReaderOverlay";
import HistoryDrawer from "./components/HistoryDrawer";
import ConfirmModal from "./components/ConfirmModal";
import TaskChooser from "./components/TaskChooser";
import SetupPanel from "./components/SetupPanel";
import HandReticles from "./components/HandReticles";
import HandoffLayer from "./components/HandoffLayer";
import BootSequence from "./components/BootSequence";
import HoloBackdrop from "./components/HoloBackdrop";

const MAX_LOGS = 80;
const SOUNDS_STORAGE_KEY = "iris.soundsEnabled";
const CAMERA_STORAGE_KEY = "iris.cameraDeviceId";
const HAND_STORAGE_KEY = "iris.handControlEnabled";

function loadSoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUNDS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function loadHandEnabled(): boolean {
  try {
    return window.localStorage.getItem(HAND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function loadCameraDeviceId(): string {
  try {
    return window.localStorage.getItem(CAMERA_STORAGE_KEY) || SYSTEM_DEFAULT_CAMERA;
  } catch {
    return SYSTEM_DEFAULT_CAMERA;
  }
}

export default function App() {
  const [sidecarRunning, setSidecarRunning] = useState(false);
  // Drives the WebGL backdrop/orb render loops: paused (0 GPU) whenever the
  // window is unfocused, independent of awake/asleep.
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  const [sidecarPid, setSidecarPid] = useState<number | null>(null);
  const [geminiStatus, setGeminiStatus] = useState("offline");
  const [claudeStatus, setClaudeStatus] = useState("offline");
  const [audioState, setAudioState] = useState("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [, setLogs] = useState<LogLine[]>([]);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [stepsOpenIds, setStepsOpenIds] = useState<Record<string, boolean>>({});
  const [taskChooser, setTaskChooser] = useState<{ query: string; matches: TaskCard[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [handControl, setHandControl] = useState(loadHandEnabled);
  // Non-blocking replacement for window.confirm (BUG item 3): resolving/rejecting
  // this promise never suspends the event loop, so the orb/audio/gestures keep
  // running while the user decides.
  const [confirm, setConfirm] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);
  function askConfirm(message: string) {
    return new Promise<boolean>((resolve) => setConfirm({ message, resolve }));
  }
  // Master switch for the PO → DEV pipeline surface (Work Stream, PipelineBar,
  // workstream switcher, task chooser, HUD tasks column, PO question banner) —
  // determined by main from whether the `claude` binary resolves. Defaults to
  // false (chat-only) until the boot-time fetch or a pipeline_availability
  // sidecar event says otherwise, so first paint never flashes pipeline UI
  // that immediately disappears.
  const [pipelineAvailable, setPipelineAvailable] = useState(false);
  const [fullConfig, setFullConfig] = useState<IrisConfig | null>(null);
  const [setup, setSetup] = useState<{ mode: "onboarding" | "settings" } | null>(null);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentsSnapshot | null>(null);
  const [installingAgents, setInstallingAgents] = useState(false);
  // Bumped whenever a run completes or sessions change so the gate ✓s re-scan.
  const [agentsTick, setAgentsTick] = useState(0);
  // The PO's live session is mid-question — set while status is "pending",
  // cleared once main reports "answered" or "timed_out".
  const [pendingPoQuestion, setPendingPoQuestion] = useState<{
    workstreamId: string;
    questions: PoQuestion[];
  } | null>(null);
  // Local picks for the CURRENT pendingPoQuestion — submitted as one batch
  // once every question has a pick, matching the voice path's batching.
  const [poAnswers, setPoAnswers] = useState<Record<string, string>>({});
  // A brief submit_claude_task just parked for Approve/Edit/Cancel
  // (prompt-review-gate spec) — cleared by the "task_review" sidecar event
  // once main resolves it (approved/cancelled/timed_out/abandoned), never
  // optimistically here, so a rejected empty edit leaves the banner up.
  const [pendingReview, setPendingReview] = useState<PendingTaskReview | null>(null);
  // Review-gate mode mirror (prompt-review-gate spec) — read at mount via
  // getPromptStatus, kept live via the prompt_review_mode sidecar event.
  // Defaults true to match main's own IRIS_PROMPT_REVIEW default.
  const [reviewMode, setReviewModeState] = useState(true);
  // Which role's model popover is open (clicking the chip's model segment,
  // not its role-select label) — at most one at a time.
  const [modelPopoverRole, setModelPopoverRole] = useState<AgentRole | null>(null);

  // Glass HUD mode: main process drives the window shape; we mirror it in a
  // root class and re-layout. App always boots into deck mode (design.md D5).
  // Choreography: entering HUD, the deck plays a 170ms collapse while the
  // window is still deck-sized, THEN the layout swaps as main goes fullscreen
  // (HUD elements enter with a matching delay). Exiting, the deck mounts
  // invisible and fades in right as main restores the window bounds.
  const [uiMode, setUiMode] = useState<UiMode>("deck");
  const [modeTransition, setModeTransition] = useState<"to-hud" | "to-deck" | null>(null);
  const modeTimerRef = useRef<number | null>(null);

  // Orb micro-expressions + sound cues.
  const [orbThinking, setOrbThinking] = useState(false);
  const [wakeKey, setWakeKey] = useState(0);
  const [rippleKey, setRippleKey] = useState(0);
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const soundsRef = useRef(soundsEnabled);
  soundsRef.current = soundsEnabled;
  const [cameraDeviceId, setCameraDeviceIdState] = useState(loadCameraDeviceId);
  const audioStateRef = useRef(audioState);
  audioStateRef.current = audioState;

  const hasBridge = typeof window.iris !== "undefined";
  const orbStageRef = useRef<HTMLDivElement | null>(null);
  const workScrollRef = useRef<HTMLDivElement | null>(null);
  const commsScrollRef = useRef<HTMLDivElement | null>(null);

  function pushLog(level: string, message: string, timestamp = Date.now()) {
    setLogs((current) => [{ id: crypto.randomUUID(), level, message, timestamp }, ...current].slice(0, MAX_LOGS));
  }

  const audio = useAudioPipeline({ onLog: pushLog });
  const { pulses, removePulse, orbFlash, clearOrbFlash, acceptedIds } = useHandoffFx(
    tasks,
    orbStageRef,
    workScrollRef,
    {
      onDelegate: () => {
        if (soundsRef.current) uiSounds.taskSent();
      },
      onComplete: (tone) => {
        if (soundsRef.current) (tone === "error" ? uiSounds.taskFailed : uiSounds.taskDone)();
      },
    },
  );

  function toggleSounds() {
    setSoundsEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SOUNDS_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // Best-effort persistence; the toggle still works for this session.
      }
      return next;
    });
  }

  function toggleHand() {
    setHandControl((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(HAND_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // Best-effort persistence; the toggle still works for this session.
      }
      return next;
    });
  }

  function setCameraDeviceId(next: string) {
    setCameraDeviceIdState(next);
    try {
      window.localStorage.setItem(CAMERA_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence; the selection still applies for this session.
    }
  }

  // Wake/sleep edges: fire the orb's double-pulse and the audio cues.
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = sidecarRunning;
    if (!wasRunning && sidecarRunning) {
      setWakeKey((key) => key + 1);
      if (soundsRef.current) uiSounds.wake();
    } else if (wasRunning && !sidecarRunning) {
      setOrbThinking(false);
      if (soundsRef.current) uiSounds.sleep();
    }
  }, [sidecarRunning]);

  // Deck WebGL backdrop/orb: pause their render loops when the window loses
  // OS focus, independent of the awake/asleep gate above.
  useEffect(() => {
    function onFocus() {
      setWindowFocused(true);
    }
    function onBlur() {
      setWindowFocused(false);
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // "Thinking" detector: you stopped talking but Iris hasn't started speaking
  // yet — that gap gets the orbiting swirl. Driven by the real mic level, so
  // it needs no extra events from the model.
  useEffect(() => {
    if (!sidecarRunning) return;
    let talking = false;
    let lastLoudAt = 0;
    let thinkingSince = 0;
    let thinking = false;

    const id = window.setInterval(() => {
      const now = performance.now();
      const level = audio.inputLevelRef.current;
      const speaking = audioStateRef.current === "speaking";
      let next = thinking;

      if (speaking) {
        next = false;
        talking = false;
      } else if (level > 0.13) {
        talking = true;
        lastLoudAt = now;
        next = false;
      } else if (talking && now - lastLoudAt > 420) {
        talking = false;
        thinkingSince = now;
        next = true;
      }
      if (next && now - thinkingSince > 6000) next = false;

      if (next !== thinking) {
        thinking = next;
        setOrbThinking(next);
      }
    }, 120);

    return () => {
      window.clearInterval(id);
      setOrbThinking(false);
    };
  }, [sidecarRunning]);

  const sidecarHandlerRef = useRef(handleSidecarEvent);
  useEffect(() => {
    sidecarHandlerRef.current = handleSidecarEvent;
  });

  useEffect(() => {
    if (!hasBridge) return;
    window.iris.getSidecarStatus().then((status) => {
      setSidecarRunning(status.running);
      setSidecarPid(status.pid);
    });
    window.iris.getSessions().then(applySessions).catch(() => {});
    window.iris
      .getPipelineStatus()
      .then((status) => setPipelineAvailable(Boolean(status.available)))
      .catch(() => {});
    window.iris
      .getPromptStatus()
      .then((status) => setReviewModeState(Boolean(status.reviewMode)))
      .catch(() => {});
    // Dispatch through the ref so this always calls the newest closure —
    // handleSidecarEvent may safely read live state (pendingPoQuestion,
    // sortedTasks, …) without a stale-render-0 read.
    return window.iris.onSidecarEvent((event) => sidecarHandlerRef.current(event));
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) return;
    const offAudio = window.iris.onAudioChunk((chunk) => audio.playGeminiAudio(chunk));
    const offInterrupt = window.iris.onAudioInterrupt(() => audio.flushPlayback());
    return () => {
      offAudio();
      offInterrupt();
    };
  }, [hasBridge]);

  // Voice-commanded sleep (design.md D6): Gemini's go_to_sleep tool tells main
  // to emit iris:sleep after a short goodbye delay; sleeping here is identical
  // to the keyboard "S" path.
  useEffect(() => {
    if (!hasBridge) return;
    return window.iris.onSleepRequest(() => {
      if (sidecarRunning) stop();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge, sidecarRunning]);

  // Main process owns the current window shape; mirror its `hud:mode`
  // broadcasts here. Tray/hotkey wake requests run the same renderer flow as
  // the W key so mic capture stays renderer-owned.
  useEffect(() => {
    if (!hasBridge) return;
    const offMode = window.iris.onHudMode(({ mode }) => {
      if (modeTimerRef.current) window.clearTimeout(modeTimerRef.current);
      if (mode === "hud") {
        setModeTransition("to-hud");
        modeTimerRef.current = window.setTimeout(() => {
          setUiMode("hud");
          setModeTransition(null);
        }, 170);
      } else {
        setUiMode("deck");
        setModeTransition("to-deck");
        modeTimerRef.current = window.setTimeout(() => setModeTransition(null), 600);
      }
    });
    const offWake = window.iris.onWakeRequest(() => {
      if (!sidecarRunning) start();
    });
    return () => {
      offMode();
      offWake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge, sidecarRunning]);

  useEffect(() => {
    document.documentElement.classList.toggle("hud-mode", uiMode === "hud");
  }, [uiMode]);

  // Click-through management: in HUD mode the window ignores the mouse except
  // when the pointer is over a `.hud-hit` element. elementFromPoint respects
  // pointer-events, so it only returns elements that opted in.
  useEffect(() => {
    if (!hasBridge || uiMode !== "hud") return;
    let interactive = false;
    let raf = 0;
    window.iris.setHudInteractive(false);

    const onMove = (event: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = document.elementFromPoint(event.clientX, event.clientY);
        const next = Boolean(
          el?.closest?.(
            ".hud-hit, .reader-backdrop, .history-backdrop, .match-backdrop, .setup-backdrop, .boot",
          ),
        );
        if (next !== interactive) {
          interactive = next;
          window.iris.setHudInteractive(next);
        }
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
      window.iris.setHudInteractive(false);
    };
  }, [hasBridge, uiMode]);

  // First-run onboarding + settings affordance (design.md D3/D4): load the
  // effective config once, auto-open the wizard if no Gemini key is set yet.
  useEffect(() => {
    if (!hasBridge) return;
    window.iris.getConfig().then((config) => {
      setFullConfig(config);
      if (!config.configured) setSetup({ mode: "onboarding" });
    });
  }, [hasBridge]);

  // Keep the wake-word toggle in sync with the effective config, including
  // after a SetupPanel save (onSaved -> setFullConfig).
  useEffect(() => {
    if (fullConfig) setWakeWordEnabled(fullConfig.wakeWord);
  }, [fullConfig]);

  async function openSettings() {
    if (!hasBridge) return;
    const config = await window.iris.getConfig();
    setFullConfig(config);
    setSetup({ mode: "settings" });
  }

  // Local "Hey Iris" wake word: only listens while asleep and enabled; a
  // detection wakes Iris exactly like pressing W (design.md D5).
  useWakeWord(
    hasBridge && wakeWordEnabled && !sidecarRunning,
    () => {
      if (!sidecarRunning) start();
    },
    (message) => pushLog("error", `Wake word: ${message}`),
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const key = event.key.toLowerCase();
      if (key === "w" && !sidecarRunning) {
        event.preventDefault();
        start();
      } else if (key === "s" && sidecarRunning) {
        event.preventDefault();
        stop();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidecarRunning, hasBridge]);

  // Scoped autoscroll: scrollIntoView would also scroll every scrollable
  // ancestor (the rounded deck clips with overflow:hidden), shifting the whole
  // layout up. Scroll the comms panel directly instead.
  useEffect(() => {
    const el = commsScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  const working = useMemo(
    () => tasks.some((task) => !TERMINAL.has(task.status.toLowerCase())) && tasks.length > 0,
    [tasks],
  );

  const booting = sidecarRunning && geminiStatus !== "connected";
  const prevBootingRef = useRef(false);
  useEffect(() => {
    // Tell main the boot screen is gone so Iris can speak its welcome now
    // (design.md D6) — only on the falling edge, once per wake.
    if (prevBootingRef.current && !booting && hasBridge) window.iris.notifyBootDone();
    prevBootingRef.current = booting;
  }, [booting, hasBridge]);

  const reactorState = useMemo(() => {
    if (!sidecarRunning) return "idle" as const;
    if (audioState === "speaking") return "speaking" as const;
    if (audioState === "listening") return "listening" as const;
    if (working) return "working" as const;
    if (geminiStatus === "connected") return "online" as const;
    return "idle" as const;
  }, [audioState, geminiStatus, sidecarRunning, working]);

  function applySessions(snapshot: SessionsSnapshot) {
    setSessions(Array.isArray(snapshot.sessions) ? snapshot.sessions : []);
    setActiveSessionId(typeof snapshot.active === "string" ? snapshot.active : null);
  }

  async function chooseSession(id: string) {
    if (!hasBridge || !id || id === activeSessionId) return;
    const snapshot = await window.iris.selectSession(id);
    applySessions(snapshot);
    const label = snapshot.sessions?.find((entry) => entry.id === id)?.label ?? id;
    pushLog("info", `Claude session switched to ${label}`);
  }

  async function createSession() {
    if (!hasBridge) return;
    const snapshot = await window.iris.newSession();
    applySessions(snapshot);
  }

  async function chooseProjectFolder() {
    if (!hasBridge) return;
    const snapshot = await window.iris.chooseProjectFolder(activeSessionId ?? undefined);
    if (snapshot.status === "error") {
      pushLog("error", snapshot.error ?? "Could not set the project folder.");
      return;
    }
    applySessions(snapshot);
  }

  async function sendContextSupplement(text: string) {
    if (!hasBridge) return;
    setTranscript((current) => [...current, { id: crypto.randomUUID(), speaker: "you", text }].slice(-40));
    const result = await window.iris.sendContextSupplement(text);
    if (result.status === "error") {
      pushLog("error", result.error ?? "Could not send that to Iris.");
    }
  }

  const activeSession = useMemo(
    () => sessions.find((entry) => entry.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const activeAgent = activeSession?.active_agent ?? null;

  useEffect(() => {
    if (!hasBridge) return;
    window.iris
      .listAgents(activeSessionId ?? undefined)
      .then(setAgents)
      .catch(() => setAgents(null));
  }, [hasBridge, activeSessionId, sessions, agentsTick]);

  useEffect(() => {
    if (!modelPopoverRole) return;
    function onDocPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".agent-chip-model") || target?.closest(".model-popover")) return;
      setModelPopoverRole(null);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [modelPopoverRole]);

  // Switching roles is a GATE: each role keeps its OWN continuous Claude
  // conversation (resumed on every task; only the user resets it via "New"),
  // and picks up the other role's context from the handoff files. The gate is
  // soft — a missing handoff warns but the user can push through on purpose.
  async function chooseAgent(role: AgentRole | null) {
    if (!hasBridge || !activeSessionId || role === activeAgent) return;
    if (role) {
      const index = PIPELINE.indexOf(role);
      const prevRole = index > 0 ? PIPELINE[index - 1] : null;
      const prevHandoff = prevRole ? Boolean(agents?.gates.byRole?.[prevRole]) : true;
      if (prevRole && !prevHandoff) {
        const slug = agents?.gates.slug;
        const where = slug ? `.scratch/${slug}/handoff/${prevRole}.md` : `the ${AGENT_LABELS[prevRole]} handoff file`;
        const ok = await askConfirm(
          `Gate check: ${where} does not exist yet, so ${AGENT_LABELS[role]} has no handoff from ${AGENT_LABELS[prevRole]} to work from.\n\nSwitch to ${AGENT_LABELS[role]} anyway?`,
        );
        if (!ok) return;
      }
    }
    const snapshot = await window.iris.selectAgent(activeSessionId, role);
    if (snapshot.status === "error") {
      pushLog("error", snapshot.error ?? "Could not switch the agent.");
      return;
    }
    applySessions(snapshot);
    if (role) {
      const index = PIPELINE.indexOf(role);
      const prevRole = index > 0 ? PIPELINE[index - 1] : null;
      const gatePassed = prevRole ? Boolean(agents?.gates.byRole?.[prevRole]) : true;
      pushLog(
        "info",
        `${prevRole && gatePassed ? `Gate passed: ${AGENT_LABELS[prevRole]} → ${AGENT_LABELS[role]}. ` : ""}Agent switched to ${AGENT_LABELS[role]} — next task resumes ${AGENT_LABELS[role]}'s own conversation; context from other roles flows via the handoff files.`,
      );
    } else {
      pushLog("info", "Agent switched to plain Iris/Claude (no role).");
    }
  }

  // Deliberately does NOT touch activeAgent — the model segment is a separate
  // click zone from the role-select label, so picking a model for the OTHER
  // role never switches the pipeline picker.
  async function setRoleModel(role: AgentRole, model: string) {
    if (!hasBridge || !activeSessionId) return;
    setModelPopoverRole(null);
    const result = await window.iris.setAgentModel(activeSessionId, role, model);
    if (result.status === "error") {
      pushLog("error", result.error ?? "Could not change the model.");
      return;
    }
    setAgentsTick((tick) => tick + 1);
    pushLog("info", `${AGENT_LABELS[role]}'s model is now ${modelLabel(model)}.`);
  }

  async function installAgents() {
    if (!hasBridge || installingAgents) return;
    setInstallingAgents(true);
    try {
      const result = await window.iris.installAgents();
      if (result.status === "error") {
        pushLog("error", result.error ?? "Could not install the Iris agents.");
      } else {
        pushLog(
          "info",
          `Iris agents ready: ${result.installed.length} installed/updated, ${result.skipped.length} already current${
            result.removed?.length ? `, ${result.removed.length} retired removed` : ""
          }.`,
        );
      }
      setAgentsTick((tick) => tick + 1);
    } finally {
      setInstallingAgents(false);
    }
  }

  // Secondary answer path: lets a sighted user click an option directly
  // instead of answering by voice. Picks accumulate locally; the batch is
  // submitted only once every question in this AskUserQuestion call has a
  // pick, matching the voice path's "collect all answers, then resolve"
  // batching. If the voice path answers first, the submit call is a no-op —
  // main resolves whichever side (voice or UI) completes first.
  function pickPoAnswer(question: string, choice: string) {
    if (!hasBridge || !pendingPoQuestion) return;
    const next = { ...poAnswers, [question]: choice };
    setPoAnswers(next);
    const complete = pendingPoQuestion.questions.every((q) => next[q.question]);
    if (!complete) return;
    setPendingPoQuestion(null);
    setPoAnswers({});
    window.iris.answerPoQuestion(
      pendingPoQuestion.questions.map((q) => ({ question: q.question, choice: next[q.question] })),
    );
  }

  // Approve/Cancel for a parked review (prompt-review-gate spec). Deliberately
  // does NOT optimistically clear pendingReview: an edit that main rejects
  // (empty/whitespace-only) must leave the banner up so the user can fix it —
  // the "task_review" sidecar event is the single source of truth for when
  // the review actually resolves.
  async function approveReview(editedTask?: string) {
    if (!hasBridge || !pendingReview) return;
    const result = await window.iris.resolvePromptReview({ action: "approve", editedTask });
    if (result.status === "error") pushLog("error", result.error ?? "Could not approve the brief.");
  }

  async function cancelReview() {
    if (!hasBridge || !pendingReview) return;
    const result = await window.iris.resolvePromptReview({ action: "cancel" });
    if (result.status === "error") pushLog("error", result.error ?? "Could not cancel the brief.");
  }

  async function toggleReviewMode(next: boolean) {
    if (!hasBridge) return;
    const result = await window.iris.setPromptReviewMode(next);
    setReviewModeState(Boolean(result.reviewMode));
  }

  function handleSidecarEvent(event: SidecarEvent) {
    if (event.type === "pipeline_availability") {
      setPipelineAvailable(Boolean(event.available));
      return;
    }

    if (event.type === "claude_session") {
      applySessions({
        active: typeof event.active === "string" ? event.active : null,
        sessions: Array.isArray(event.sessions) ? (event.sessions as ClaudeSession[]) : [],
      });
      return;
    }

    if (event.type === "sidecar_status") {
      const status = readStatusObject(event.status);
      setSidecarRunning(Boolean(status.running));
      setSidecarPid(typeof status.pid === "number" ? status.pid : null);
      return;
    }

    if (event.type === "gemini_status") {
      setGeminiStatus(readString(event.status, "unknown"));
      return;
    }

    if (event.type === "claude_status") {
      const status = readString(event.status, "unknown");
      setClaudeStatus(status);
      pushLog(
        status === "error" ? "error" : "info",
        `Claude ${status}${event.error ? `: ${readString(event.error)}` : ""}`,
        eventTime(event),
      );
      return;
    }

    if (event.type === "audio_state") {
      setAudioState(readString(event.state, "idle"));
      return;
    }

    if (event.type === "transcript") {
      const speaker = readString(event.speaker, "unknown");
      const text = readString(event.text);
      if (text.trim()) {
        // Your words just got locked in — the orb answers with a soft ripple.
        if (/you|user/i.test(speaker)) setRippleKey((key) => key + 1);
        setTranscript((current) => [...current, { id: crypto.randomUUID(), speaker, text }].slice(-40));
      }
      return;
    }

    if (event.type === "claude_task_update") {
      const task = readString(event.task, "Claude task");
      const rawRunId = readString(event.run_id);
      const runId = rawRunId || taskKeyFor(task);
      const status = readString(event.status, "unknown");
      const agent = isAgentRole(event.agent) ? event.agent : null;
      const model = typeof event.model === "string" ? event.model : null;
      // Additive step-timeline fields (see electron/claude-stream.mjs) — a tool
      // call opens a step keyed by Claude's own tool_use id, the matching
      // tool_end closes it. Absent for plain activity/terminal updates, which
      // leave the existing steps untouched.
      const phase = readString(event.phase);
      const toolId = readString(event.tool_id);

      setTasks((current) => {
        const existing = current.find((item) => item.id === runId);
        const placeholderId = taskKeyFor(task);
        let steps = existing?.steps;
        if (phase === "tool_start" && toolId) {
          const step: TaskStep = {
            id: toolId,
            tool: readString(event.tool, "tool"),
            preview: readString(event.detail) || undefined,
            status: "running",
            ts: eventTime(event),
          };
          steps = [...(steps ?? []), step].slice(-40);
        } else if (phase === "tool_end" && toolId && steps) {
          const isError = event.error === true;
          const duration = typeof event.duration === "number" ? event.duration : undefined;
          steps = steps.map((step) =>
            step.id === toolId ? { ...step, status: isError ? "error" : "done", duration } : step,
          );
        }
        const next: TaskCard = {
          id: runId,
          task,
          status,
          output: resolveMergedString(event.output, existing?.output),
          error: resolveMergedString(event.error, existing?.error),
          agent: agent ?? existing?.agent ?? null,
          model: model ?? existing?.model ?? null,
          claudeSessionId: readString(event.claude_session_id) || existing?.claudeSessionId || null,
          updatedAt: eventTime(event),
          steps,
        };
        return [next, ...current.filter((item) => item.id !== runId && item.id !== placeholderId)].slice(0, 20);
      });
      return;
    }

    if (event.type === "agent_model_update") {
      // A role's model changed — via this window's own popover, another
      // window, or the voice tool. Re-fetch the agents snapshot so the chip
      // badge reflects it immediately either way.
      setAgentsTick((tick) => tick + 1);
      return;
    }

    if (event.type === "po_question") {
      const status = readString(event.status, "pending");
      const workstreamId = readString(event.workstream_id);
      const questions = Array.isArray(event.questions) ? (event.questions as PoQuestion[]) : [];
      if (status === "pending") {
        setPendingPoQuestion({ workstreamId, questions });
        setPoAnswers({});
      } else {
        setPendingPoQuestion(null);
        setPoAnswers({});
        if (status === "timed_out") {
          pushLog("warn", "The PO's question went unanswered — applied its recommended option.", eventTime(event));
        }
      }
      return;
    }

    if (event.type === "prompt_review_mode") {
      setReviewModeState(Boolean(event.reviewMode));
      return;
    }

    if (event.type === "task_review") {
      const status = readString(event.status, "pending");
      if (status === "pending") {
        setPendingReview({
          workstreamId: readString(event.workstream_id),
          task: readString(event.task),
          urgency: readString(event.urgency, "normal"),
          agent: isAgentRole(event.agent) ? event.agent : null,
        });
      } else {
        setPendingReview(null);
        if (status === "timed_out") {
          pushLog("warn", "A parked brief went unanswered and was not sent to Claude.", eventTime(event));
        }
      }
      return;
    }

    if (event.type === "claude_completion") {
      pushLog("info", `Claude returned: ${readString(event.task, "task complete")}`, eventTime(event));
      // The finished run may have written its handoff file — re-scan the gates.
      setAgentsTick((tick) => tick + 1);
      const runId = readString(event.run_id);
      if (runId) {
        setTasks((current) =>
          current.map((item) =>
            item.id === runId && item.steps
              ? {
                  ...item,
                  steps: item.steps.map((step) => (step.status === "running" ? { ...step, status: "done" } : step)),
                }
              : item,
          ),
        );
      }
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

  async function start() {
    if (!hasBridge) {
      pushLog("error", "Electron bridge unavailable. Launch with `npm run dev`.");
      return;
    }
    const status = await window.iris.startSidecar({ mode: "none" });
    setSidecarRunning(status.running);
    setSidecarPid(status.pid);
    await audio.start();
  }

  async function stop() {
    if (!hasBridge) return;
    await audio.stop();
    await window.iris.stopSidecar();
    setGeminiStatus("offline");
    setClaudeStatus("offline");
    setAudioState("idle");
    setHandControl(false);
  }

  function dotState(value: string, goodValues: string[]) {
    if (!sidecarRunning) return "off";
    if (value === "error") return "err";
    return goodValues.includes(value) ? "on" : "warn";
  }

  const expandedTask = useMemo(() => tasks.find((task) => task.id === expandedTaskId) ?? null, [tasks, expandedTaskId]);
  // Bookkeeping (which element, when it started, whether it already fired)
  // stays in a ref — only the render-visible facts below become state.
  const dwellRef = useRef<{ el: HTMLElement; startedAt: number; fired: boolean } | null>(null);
  const [dwellActive, setDwellActive] = useState(false);
  const [dwellFired, setDwellFired] = useState(false);

  const { state: hand, stateRef: liveHandRef, error: handError, stream: handStream } = useHandControl(
    handControl,
    cameraDeviceId,
  );

  useEffect(() => {
    if (handError) pushLog("error", `Hand control: ${handError}`);
  }, [handError]);

  // Universal point-and-hold: the finger pointer can activate ANY clickable
  // element — task cards, close buttons, PO answer options, chips. Holding
  // over a target for 300ms fires a real click; the target must be left and
  // re-entered before it can fire again. Reads live per-frame hand data from
  // a ref (not React state) so charging the dwell timer never forces a
  // re-render — only entering/leaving a target or firing does (BUG F).
  useEffect(() => {
    let raf = 0;
    const syncDwell = (active: boolean, fired: boolean) => {
      setDwellActive((prev) => (prev === active ? prev : active));
      setDwellFired((prev) => (prev === fired ? prev : fired));
    };
    const loop = () => {
      const h = liveHandRef.current;
      if (!handControl || !h.present || !h.point || !h.pointing || expandedTaskId) {
        dwellRef.current = null;
        syncDwell(false, false);
        raf = requestAnimationFrame(loop);
        return;
      }

      const el = document.elementFromPoint(h.point.x, h.point.y);
      const actionable = el?.closest<HTMLElement>('button, a, [data-task-id], [role="button"]') ?? null;
      if (!actionable || actionable.closest("[data-no-dwell]")) {
        dwellRef.current = null;
        syncDwell(false, false);
        raf = requestAnimationFrame(loop);
        return;
      }

      // Track which card the hand is hovering so voice references like "this
      // one" / "show its steps" can resolve to it (design.md D1 focusedTaskId).
      const taskId = actionable.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
      if (taskId) setFocusedTaskId((current) => (current === taskId ? current : taskId));

      const now = performance.now();
      if (dwellRef.current?.el !== actionable) {
        dwellRef.current = { el: actionable, startedAt: now, fired: false };
        syncDwell(true, false);
      } else if (!dwellRef.current.fired && now - dwellRef.current.startedAt > 300) {
        dwellRef.current.fired = true;
        syncDwell(true, true);
        actionable.click();
      } else {
        syncDwell(true, dwellRef.current.fired);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, expandedTaskId]);

  // Open-palm hold-to-scroll: scrolls whichever scrollable region (Comms or
  // Work Stream column) is under the hand.
  useEffect(() => {
    let raf = 0;
    const SCROLLABLES = ".activity-timeline, .comms-scroll, .work-scroll, .history-grid";
    const loop = () => {
      const h = liveHandRef.current;
      if (handControl && h?.openPalm && h.point && !expandedTaskId && !showHistory) {
        const el = document.elementFromPoint(h.point.x, h.point.y);
        const target = el?.closest<HTMLElement>(SCROLLABLES) ?? null;
        if (target) {
          const rect = target.getBoundingClientRect();
          const center = rect.top + rect.height / 2;
          const deadZone = Math.max(24, rect.height * 0.12);
          const delta = h.point.y - center;
          if (Math.abs(delta) > deadZone) {
            const reach = rect.height / 2 - deadZone;
            const norm = Math.max(-1, Math.min(1, (delta - Math.sign(delta) * deadZone) / reach));
            target.scrollTop += norm * 26;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, expandedTaskId, showHistory]);

  // Closed-fist rotates the Arc Reactor orb, pinch scales it — only while the
  // reader is closed, so this never collides with the reader-open fist-close
  // or two-palm-resize bindings. Written straight into refs (not React state)
  // every frame, same as the audio-level refs ReactorCore already reads.
  const orbRotationRef = useRef({ x: 0, y: 0 });
  const orbScaleRef = useRef(1);
  useEffect(() => {
    let raf = 0;
    let prevFistPoint: HandPoint | null = null;
    const loop = () => {
      const h = liveHandRef.current;
      const engaged = handControl && h?.present && !expandedTaskId;

      if (engaged && h.fist && h.point) {
        if (prevFistPoint) {
          const dx = h.point.x - prevFistPoint.x;
          const dy = h.point.y - prevFistPoint.y;
          orbRotationRef.current = {
            x: Math.max(-0.8, Math.min(0.8, orbRotationRef.current.x + dy * 0.006)),
            y: orbRotationRef.current.y + dx * 0.006,
          };
        }
        prevFistPoint = h.point;
      } else {
        prevFistPoint = null;
      }

      if (engaged) {
        // Clamped tighter than a "natural" zoom range: the outer wireframe
        // sphere already fills ~85% of the camera frustum at scale 1, so
        // anything much past ~1.15 gets clipped by the (square) canvas
        // viewport, showing as an ugly hard-edged square cutting into the
        // circular silhouette instead of a smooth zoom.
        const norm = Math.max(0, Math.min(1, (h.pinchDistance - 0.03) / (0.3 - 0.03)));
        orbScaleRef.current = 0.7 + norm * 0.45;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, expandedTaskId]);

  const handAction = useMemo(() => {
    if (!hand.present) return { label: "Show your hand", tone: "idle" };
    if (hand.hands.filter((item) => item.openPalm).length >= 2) return { label: "Two palms · resize", tone: "open" };
    if (hand.fist) {
      return expandedTaskId
        ? { label: "Closed_Fist · close", tone: "fist" }
        : { label: "Closed_Fist · rotate orb", tone: "fist" };
    }
    if (hand.openPalm) return { label: "Open_Palm · scroll", tone: "open" };
    if (!hand.pointing) return { label: `${hand.gesture} · idle`, tone: "idle" };
    if (dwellActive) return { label: "Hold · opening", tone: "move" };
    return { label: "Pointing_Up · hover", tone: "move" };
  }, [
    hand.present,
    hand.hands,
    hand.fist,
    hand.openPalm,
    hand.pointing,
    hand.gesture,
    dwellActive,
    expandedTaskId,
  ]);

  const activeProject = activeSession?.cwd ?? null;

  const sortedTasks = useMemo(() => {
    const isActive = (task: TaskCard) => !TERMINAL.has(task.status.toLowerCase());
    return [...tasks].sort((a, b) => {
      const activeDelta = Number(isActive(b)) - Number(isActive(a));
      if (activeDelta !== 0) return activeDelta;
      return b.updatedAt - a.updatedAt;
    });
  }, [tasks]);

  const latestResultTask = useMemo(
    () => sortedTasks.find((task) => Boolean(task.output || task.error)) ?? null,
    [sortedTasks],
  );

  function setTaskStepsOpen(id: string, open: boolean) {
    setStepsOpenIds((current) => ({ ...current, [id]: open }));
  }

  function toggleTaskSteps(id: string) {
    setStepsOpenIds((current) => ({ ...current, [id]: !current[id] }));
  }

  function openTaskByQuery(query?: string) {
    const matches = findTaskMatches(sortedTasks, query);
    if (matches.length === 0) return;

    const [best, second] = matches;
    const clearWinner = !second || best.score - second.score >= 3;
    if (clearWinner) {
      openTask(best.task);
      return;
    }

    // A pending PO question or parked review outranks disambiguation
    // (design.md D2, prompt-review-gate D3): the chooser must never stack
    // over those banners — drop the ambiguous request rather than showing it.
    if (pendingPoQuestion || pendingReview) return;
    setTaskChooser({ query: query || "task", matches: matches.map((match) => match.task) });
  }

  // Voice-driven UI context (design.md D1, spec voice-ui-control): throttled by
  // React batching a snapshot after every relevant state change, mirroring
  // upstream's sendUiContext effect.
  useEffect(() => {
    if (!hasBridge) return;
    window.iris.sendUiContext({
      expandedTaskId,
      focusedTaskId,
      latestResultTaskId: latestResultTask?.id ?? null,
      pendingTaskMatches:
        taskChooser?.matches.map((task, index) => ({
          index: index + 1,
          id: task.id,
          task: task.task,
          status: task.status,
        })) ?? [],
      showHistory,
      tasks: sortedTasks.map((task) => ({
        id: task.id,
        task: task.task,
        status: task.status,
        hasResult: Boolean(task.output || task.error),
        stepCount: task.steps?.length ?? 0,
        stepsOpen: Boolean(stepsOpenIds[task.id]),
        updatedAt: task.updatedAt,
      })),
      uiMode,
    });
  }, [
    hasBridge,
    expandedTaskId,
    focusedTaskId,
    latestResultTask?.id,
    showHistory,
    sortedTasks,
    stepsOpenIds,
    taskChooser,
    uiMode,
  ]);

  // Gemini's control_ui tool forwards here over iris:ui-action. Suppressed
  // implicitly for disambiguation purposes while a PO question is pending: the
  // PO banner already occupies the "answer by voice" surface, and Iris's own
  // system prompt is told not to issue open_task_by_query in that state — see
  // design.md D2 and specs/voice-ui-control's PO precedence requirement.
  useEffect(() => {
    if (!hasBridge) return;
    return window.iris.onUiAction(({ action, target_id, query }) => {
      const taskById = target_id ? tasks.find((task) => task.id === target_id) : null;
      const currentTask = expandedTaskId ? tasks.find((task) => task.id === expandedTaskId) : null;
      const focusedTask = focusedTaskId ? tasks.find((task) => task.id === focusedTaskId) : null;
      const fallbackTask = currentTask || focusedTask || latestResultTask;

      if (action === "open_task") {
        if (taskById) openTask(taskById);
        return;
      }
      if (action === "open_task_by_query") {
        openTaskByQuery(query);
        return;
      }
      if (action === "open_current_claude_result") {
        if (fallbackTask) openTask(fallbackTask);
        return;
      }
      if (action === "open_latest_claude_result") {
        if (latestResultTask) openTask(latestResultTask);
        return;
      }
      if (action === "open_claude_history") {
        setShowHistory(true);
        return;
      }
      if (action === "close_reader") {
        closeReader();
        return;
      }
      if (action === "close_history") {
        setShowHistory(false);
        return;
      }
      if (action === "close_all_overlays") {
        closeReader();
        setShowHistory(false);
        setTaskChooser(null);
        return;
      }
      if (action === "show_task_steps" || action === "hide_task_steps") {
        const byQuery = !taskById && query ? findTaskMatches(sortedTasks, query)[0]?.task ?? null : null;
        const activeTask = tasks.find((task) => !TERMINAL.has(task.status.toLowerCase()));
        const target = taskById || byQuery || currentTask || focusedTask || activeTask || latestResultTask;
        if (!target) return;
        setTaskStepsOpen(target.id, action === "show_task_steps");
        return;
      }
    });
  }, [hasBridge, tasks, sortedTasks, expandedTaskId, focusedTaskId, latestResultTask, pendingPoQuestion, pendingReview]);

  const caption = useMemo(() => {
    if (!sidecarRunning)
      return {
        text: wakeWordEnabled ? "Say “Hey Iris” or press W to wake" : "Press W to wake Iris",
        dim: true,
      };
    if (audioState === "speaking") return { text: "Speaking…", dim: false };
    if (audioState === "listening") return { text: "Listening…", dim: false };
    if (working) return { text: "Working on it…", dim: false };
    const last = transcript[transcript.length - 1];
    if (last) return { text: last.text, dim: false };
    if (geminiStatus === "connected") return { text: "How can I help?", dim: true };
    return { text: "Connecting…", dim: true };
  }, [sidecarRunning, audioState, working, transcript, geminiStatus, wakeWordEnabled]);

  function openTask(task: TaskCard) {
    if (!(task.output || task.error)) return;
    setTaskChooser(null);
    setExpandedTaskId(task.id);
    setShowHistory(false);
  }

  function closeReader() {
    setExpandedTaskId(null);
  }

  const audioDot = !sidecarRunning
    ? "off"
    : audio.muted
      ? "warn"
      : audioState === "speaking"
        ? "speaking"
        : audioState === "idle"
          ? "warn"
          : "on";

  return (
    <>
      {uiMode === "hud" ? (
        <HudShell
          reactorState={reactorState}
          inputLevelRef={audio.inputLevelRef}
          outputLevelRef={audio.outputLevelRef}
          thinking={orbThinking}
          wakeKey={wakeKey}
          rippleKey={rippleKey}
          running={sidecarRunning}
          orbRotationRef={orbRotationRef}
          orbScaleRef={orbScaleRef}
          orbStageRef={orbStageRef}
          orbFlash={orbFlash}
          onOrbFlashEnd={clearOrbFlash}
          awake={sidecarRunning}
          caption={caption.text}
          captionDim={caption.dim}
          wakeWordEnabled={wakeWordEnabled}
          muted={audio.muted}
          onToggleMute={audio.toggleMute}
          onWake={start}
          onSleep={stop}
          onExitHud={() => window.iris.toggleHud()}
          tasks={sortedTasks}
          acceptedIds={acceptedIds}
          stepsOpenIds={stepsOpenIds}
          workScrollRef={workScrollRef}
          onToggleSteps={toggleTaskSteps}
          onOpenTask={openTask}
          transcript={transcript}
          commsScrollRef={commsScrollRef}
          onSendSupplement={sendContextSupplement}
          handControl={handControl}
          onToggleHand={toggleHand}
          hand={hand}
          handRef={liveHandRef}
          handStream={handStream}
          handActionLabel={handAction.label}
          handActionTone={handAction.tone}
          pipelineAvailable={pipelineAvailable}
          poQuestion={
            pendingPoQuestion
              ? { questions: pendingPoQuestion.questions, answers: poAnswers, onPick: pickPoAnswer }
              : null
          }
          taskReview={
            pendingReview ? { review: pendingReview, onApprove: approveReview, onCancel: cancelReview } : null
          }
        />
      ) : (
      <div
        className={`deck ${sidecarRunning ? "awake" : "asleep"} ${
          modeTransition === "to-hud" ? "deck-leaving" : ""
        } ${modeTransition === "to-deck" ? "deck-entering" : ""}`}
      >
        <div className="hud-nebula" />
        <div className="hud-glow" />
        <div className="hud-vignette" />
        <HoloBackdrop running={sidecarRunning && windowFocused} />

        <TopBar
          geminiDot={dotState(geminiStatus, ["connected"])}
          claudeDot={dotState(claudeStatus, ["ready"])}
          audioDot={audioDot}
          linked={sidecarRunning}
          pid={sidecarPid}
          handControl={handControl}
          onToggleHand={toggleHand}
          onOpenSettings={openSettings}
        />

        <div className={`deck-body ${pipelineAvailable ? "" : "chat-only"}`}>
          {/* LEFT — You */}
          <div className="deck-left">
            <CommsPanel
              transcript={transcript}
              scrollRef={commsScrollRef}
              awake={sidecarRunning}
              onSendSupplement={sendContextSupplement}
            />
            <CameraDock
              handControl={handControl}
              hand={hand}
              handRef={liveHandRef}
              stream={handStream}
              actionLabel={handAction.label}
              actionTone={handAction.tone}
            />
          </div>

          {/* CENTER — Iris */}
          <CenterStage
            reactorState={reactorState}
            inputLevelRef={audio.inputLevelRef}
            outputLevelRef={audio.outputLevelRef}
            thinking={orbThinking}
            wakeKey={wakeKey}
            rippleKey={rippleKey}
            orbRunning={sidecarRunning && windowFocused}
            orbRotationRef={orbRotationRef}
            orbScaleRef={orbScaleRef}
            orbStageRef={orbStageRef}
            orbFlash={orbFlash}
            onOrbFlashEnd={clearOrbFlash}
            awake={sidecarRunning}
            geminiStatus={geminiStatus}
            claudeStatus={claudeStatus}
            runs={tasks.length}
            sessionStartRef={audio.sessionStartRef}
            caption={caption.text}
            captionDim={caption.dim}
            muted={audio.muted}
            onToggleMute={audio.toggleMute}
            onSleep={stop}
          />

          {/* RIGHT — Work (pipeline-only, see pipeline-availability spec) */}
          {pipelineAvailable ? (
            <WorkStream
              tasks={tasks}
              sortedTasks={sortedTasks}
              scrollRef={workScrollRef}
              acceptedIds={acceptedIds}
              session={activeSession}
              sessions={sessions}
              onSwitchSession={chooseSession}
              onNewSession={createSession}
              onShowHistory={() => setShowHistory(true)}
              onOpenTask={openTask}
              stepsOpenIds={stepsOpenIds}
              onToggleTaskSteps={toggleTaskSteps}
            >
              <PipelineBar
                agents={agents}
                activeAgent={activeAgent}
                installingAgents={installingAgents}
                modelPopoverRole={modelPopoverRole}
                reviewMode={reviewMode}
                onChooseAgent={chooseAgent}
                onInstallAgents={installAgents}
                onToggleModelPopover={(role) => setModelPopoverRole((current) => (current === role ? null : role))}
                onSetRoleModel={setRoleModel}
                onToggleReviewMode={toggleReviewMode}
              />
              <ProjectBar project={activeProject} onChoose={chooseProjectFolder} />
              {pendingPoQuestion ? (
                <PoQuestionBanner questions={pendingPoQuestion.questions} answers={poAnswers} onPick={pickPoAnswer} />
              ) : null}
              {pendingReview ? (
                <ReviewBanner review={pendingReview} onApprove={approveReview} onCancel={cancelReview} />
              ) : null}
            </WorkStream>
          ) : null}
        </div>

        <footer className="deck-foot">
          <span className="build-meta">
            IRIS · build 0.2.0 · by Ashutosh Shrivastava ·{" "}
            <a href="https://x.com/ai_for_success" target="_blank" rel="noreferrer">
              X
            </a>{" "}
            ·{" "}
            <a href="https://github.com/ASHR12/iris" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </span>
        </footer>

        {booting ? <BootSequence visible={booting} /> : null}
      </div>
      )}

      {expandedTask ? (
        <ReaderOverlay task={expandedTask} hand={handControl ? hand : null} handRef={liveHandRef} onClose={closeReader} />
      ) : null}

      {showHistory ? (
        <HistoryDrawer
          tasks={sortedTasks}
          onOpen={openTask}
          onClose={() => setShowHistory(false)}
          stepsOpenIds={stepsOpenIds}
          onToggleTaskSteps={toggleTaskSteps}
        />
      ) : null}

      {taskChooser && pipelineAvailable ? (
        <TaskChooser
          query={taskChooser.query}
          matches={taskChooser.matches}
          onOpen={openTask}
          onClose={() => setTaskChooser(null)}
        />
      ) : null}

      {setup && fullConfig ? (
        <SetupPanel
          mode={setup.mode}
          config={fullConfig}
          soundsEnabled={soundsEnabled}
          onToggleSounds={toggleSounds}
          cameraDeviceId={cameraDeviceId}
          onChangeCameraDevice={setCameraDeviceId}
          onClose={() => setSetup(null)}
          onSaved={setFullConfig}
          onStart={() => {
            if (!sidecarRunning) start();
          }}
          onRunWizard={() => setSetup({ mode: "onboarding" })}
        />
      ) : null}

      {confirm ? (
        <ConfirmModal
          message={confirm.message}
          onResolve={(ok) => {
            confirm.resolve(ok);
            setConfirm(null);
          }}
        />
      ) : null}

      <HandoffLayer pulses={pulses} onPulseEnd={removePulse} />

      {handControl && hand.present ? (
        <HandReticles hand={hand} handRef={liveHandRef} dwelling={dwellActive && !dwellFired} />
      ) : null}
    </>
  );
}
