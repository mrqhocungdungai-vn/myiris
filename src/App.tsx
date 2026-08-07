import { useEffect, useMemo, useRef, useState } from "react";
import type { LogLine, TaskCard, TaskStep, TranscriptLine } from "./types";
import {
  TERMINAL,
  eventTime,
  findTaskMatches,
  readString,
  readStatusObject,
  readTaskUsage,
  resolveMergedString,
  taskKeyFor,
} from "./lib/tasks";
import { isVerb, modelLabel, verbLabel } from "./lib/verbs";
import { resolveGestureContext, orbGestureEngaged } from "./lib/gestureContext";
import { isHudChrome } from "./lib/hudChrome";
import { readWebglHighFidelity, deriveWebglSettings, WEBGL_QUALITY_STORAGE_KEY } from "./lib/webgl-quality";
import { uiSounds } from "./lib/sounds";
import { useAudioPipeline } from "./hooks/useAudioPipeline";
import { useHandoffFx } from "./hooks/useHandoffFx";
import { useHandControl, SYSTEM_DEFAULT_CAMERA, type HandPoint } from "./hooks/useHandControl";
import { useEyeTracking } from "./hooks/useEyeTracking";
import { useWakeWord } from "./hooks/useWakeWord";
import { SYSTEM_DEFAULT_MIC } from "./lib/mic-device";
import { wakeCaption } from "./lib/wake-caption";
import { stepBootGate, type BootGateState } from "./lib/boot-gate";
import { surfaceAdvancesFrames } from "./lib/orb-frameloop";
import TopBar from "./components/TopBar";
import HudShell from "./components/HudShell";
import CommsPanel from "./components/CommsPanel";
import CameraDock from "./components/CameraDock";
import CenterStage from "./components/CenterStage";
import ListenOnlyNotice from "./components/ListenOnlyNotice";
import { transcriptVoice, liveHeardCaption } from "./lib/transcript-speaker";
import WorkStream from "./components/WorkStream";
import PipelineBar from "./components/PipelineBar";
import PoQuestionBanner from "./components/PoQuestionBanner";
import ReviewBanner from "./components/ReviewBanner";
import ProjectBar from "./components/ProjectBar";
import ReaderOverlay from "./components/ReaderOverlay";
import NoteReader from "./components/NoteReader";
import type { GalaxyNode } from "./components/VaultGalaxy";
import HistoryDrawer from "./components/HistoryDrawer";
import TaskChooser from "./components/TaskChooser";
import SetupPanel from "./components/SetupPanel";
import HandReticles from "./components/HandReticles";
import HandoffLayer from "./components/HandoffLayer";
import BootSequence from "./components/BootSequence";
import HoloBackdrop from "./components/HoloBackdrop";

const MAX_LOGS = 80;
const SOUNDS_STORAGE_KEY = "iris.soundsEnabled";
const CAMERA_STORAGE_KEY = "iris.cameraDeviceId";
const MIC_STORAGE_KEY = "iris.micDeviceId";
const HAND_STORAGE_KEY = "iris.handControlEnabled";
// ambient-memory: default OFF, unlike sounds above — this is the one
// preference whose safer default is off, not on (design D1).
const AMBIENT_CAPTURE_STORAGE_KEY = "iris.ambientCaptureEnabled";
// glass-hud-mode: the HUD camera's size. Enlarging is the deliberate act, so
// the standard size is the default and anything absent or unreadable resolves
// to it — the failure mode is "reverts to standard", never "stuck enlarged
// with no way back".
const HUD_CAMERA_SIZE_STORAGE_KEY = "iris.hudCameraEnlarged";
// listen-mode-hears-system-audio: engaging the mode IS the consent point for
// meeting retention, so the first engage states what is retained, that it may
// include other people, and where it is written. Remembered so it is a
// first-run notice rather than a nag.
const LISTEN_ONLY_CONSENT_STORAGE_KEY = "iris.listenOnlyConsentSeen";

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

function loadMicDeviceId(): string {
  try {
    return window.localStorage.getItem(MIC_STORAGE_KEY) || SYSTEM_DEFAULT_MIC;
  } catch {
    return SYSTEM_DEFAULT_MIC;
  }
}

function loadWebglHighFidelity(): boolean {
  try {
    return readWebglHighFidelity(window.localStorage.getItem(WEBGL_QUALITY_STORAGE_KEY));
  } catch {
    return false;
  }
}

function loadAmbientCaptureEnabled(): boolean {
  try {
    return window.localStorage.getItem(AMBIENT_CAPTURE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function loadHudCameraEnlarged(): boolean {
  try {
    return window.localStorage.getItem(HUD_CAMERA_SIZE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function loadListenOnlyConsentSeen(): boolean {
  try {
    return window.localStorage.getItem(LISTEN_ONLY_CONSENT_STORAGE_KEY) === "on";
  } catch {
    // Unreadable storage shows the notice again rather than swallowing it: a
    // repeated consent statement is a nuisance, a missing one is not.
    return false;
  }
}

/**
 * Whether audio output is going to speakers rather than headphones, so
 * engaging the mode can advise headphones — speaker output re-enters the
 * microphone and reaches Iris a second time, degraded and out of step with the
 * captured copy. Advisory only: never blocks, and nothing tries to cancel or
 * duck that second copy (a ducking bug eats the user's own voice, which is
 * invisible until it matters).
 *
 * Errs toward NOT advising: an ambiguous device label is not worth a warning.
 */
async function outputIsSpeakers(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === "audiooutput");
    if (!outputs.length) return false;
    const label = (outputs[0].label || "").toLowerCase();
    if (!label) return false;
    return !/headphone|headset|earphone|earbud|airpod|buds/.test(label);
  } catch {
    return false;
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
  const [hudCameraEnlarged, setHudCameraEnlarged] = useState(loadHudCameraEnlarged);
  // The non-blocking confirm dialog is gone with its only caller: the soft gate
  // that warned before switching pipeline roles. Nothing asks the user to
  // confirm anything now — Iris picks the verb, and the review gate is where a
  // consequential dispatch stops for a human decision.
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
  // Fatal wake-word init failure (not the recoverable mic-fallback case) — held
  // here rather than routed to pushLog, whose state is discarded at
  // declaration and rendered by no component (design D3, wake-sleep-voice).
  const [wakeFailed, setWakeFailed] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [verbs, setVerbs] = useState<VerbsSnapshot | null>(null);
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
  // Picks per question, as a LIST: a multi-select question may take several,
  // and collapsing it to one answers a different question than the PO asked.
  const [poAnswers, setPoAnswers] = useState<Record<string, string[]>>({});
  // A request a verb just parked for Approve/Edit/Cancel
  // (prompt-review-gate spec) — cleared by the "task_review" sidecar event
  // once main resolves it (approved/cancelled/timed_out/abandoned), never
  // optimistically here, so a rejected empty edit leaves the banner up.
  const [pendingReview, setPendingReview] = useState<PendingTaskReview | null>(null);
  // Review-gate mode mirror (prompt-review-gate spec) — read at mount via
  // getPromptStatus, kept live via the prompt_review_mode sidecar event.
  // Defaults true to match main's own IRIS_PROMPT_REVIEW default.
  const [reviewMode, setReviewModeState] = useState<ReviewMode>("verb");
  // Which role's model popover is open (clicking the chip's model segment,
  // not its role-select label) — at most one at a time.
  const [modelPopoverVerb, setModelPopoverVerb] = useState<Verb | null>(null);

  // Glass HUD mode: main process drives the window shape; we mirror it in a
  // root class and re-layout. App always boots into deck mode (design.md D5).
  // Choreography: entering HUD, the deck plays a 170ms collapse while the
  // window is still deck-sized, THEN the layout swaps as main goes fullscreen
  // (HUD elements enter with a matching delay). Exiting, the deck mounts
  // invisible and fades in right as main restores the window bounds.
  const [uiMode, setUiMode] = useState<UiMode>("deck");
  const [modeTransition, setModeTransition] = useState<"to-hud" | "to-deck" | null>(null);
  const modeTimerRef = useRef<number | null>(null);
  // Toggleable excalidraw drawing panel (hud-drawing-canvas), HUD-only and
  // hidden by default; unmounting DrawingCanvas when false keeps its lazy
  // chunk from ever loading unless the user opens it.
  const [drawingActive, setDrawingActive] = useState(false);
  // second-brain-galaxy-view: the "show second brain" toggle, HUD-only and
  // hidden by default; mutually exclusive with drawingActive (design.md D5).
  const [secondBrainActive, setSecondBrainActive] = useState(false);
  const [secondBrainAvailable, setSecondBrainAvailable] = useState(false);
  // Hoisted above VaultGalaxy's own mount (design.md M-3) so toggling the
  // galaxy off and back on rehydrates node positions instead of
  // re-scrambling the force-directed layout on every reopen.
  const galaxyPositionsRef = useRef<Map<string, GalaxyNode>>(new Map());
  // `revision` is the token for the content in `markdown` (add-manual-note-editing):
  // the editor hands it back on save so main can refuse a write when the file has
  // since changed under it.
  const [openNote, setOpenNote] = useState<{
    id: string;
    title: string;
    markdown: string;
    revision: string;
  } | null>(null);

  // Listen-only mode (replace-listening-mode-with-listen-only design.md D3):
  // main is the sole owner of this state — this is pure display, seeded from
  // a query on mount/reload and updated only by main's push. Never asserted
  // back. Feeds the audio pipeline's suppression flag from the same push.
  const [listenOnlyEngaged, setListenOnlyEngaged] = useState(false);
  // The first-run consent notice for meeting retention, and the (non-blocking)
  // headphone advisory. Both are shown on the engaging edge only.
  const [listenOnlyNotice, setListenOnlyNotice] = useState<"consent" | "headphones" | "refused" | null>(null);
  // A live readout of what Iris is hearing, for the caption under the orb.
  // Ephemeral by design: it replaces itself and is never added to the
  // conversation, which is where a meeting's verbatim does not belong.
  const [heardLive, setHeardLive] = useState("");
  const [refusedTool, setRefusedTool] = useState<string>("");
  // Records the HUD Comms panel's open/closed state from just before the
  // mode engaged, so disengaging restores it rather than forcing it shut
  // (design.md D7). Only the push handler below writes to it, on the
  // engaging edge.
  const priorCommsOpenRef = useRef(false);
  const [commsOpen, setCommsOpen] = useState(false);
  const commsOpenRef = useRef(commsOpen);
  commsOpenRef.current = commsOpen;

  // Orb micro-expressions + sound cues.
  const [orbThinking, setOrbThinking] = useState(false);
  const [wakeKey, setWakeKey] = useState(0);
  const [rippleKey, setRippleKey] = useState(0);
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const soundsRef = useRef(soundsEnabled);
  soundsRef.current = soundsEnabled;
  const [cameraDeviceId, setCameraDeviceIdState] = useState(loadCameraDeviceId);
  const [micDeviceId, setMicDeviceIdState] = useState(loadMicDeviceId);
  // webgl-quality-mode: defaults to the light path (false/off) — see design.md D6.
  const [webglHighFidelity, setWebglHighFidelity] = useState(loadWebglHighFidelity);
  // ambient-memory: this renderer-held value is only ever the PREFERENCE main
  // was last told about — main is the sole authority on whether retention is
  // actually happening (design D1), which is `ambientCaptureLive` below.
  const [ambientCaptureEnabled, setAmbientCaptureEnabled] = useState(loadAmbientCaptureEnabled);
  const [ambientCaptureLive, setAmbientCaptureLive] = useState(false);
  // IRIS_AMBIENT_CAPTURE=off (design D3): the toggle is not offered at all.
  const [ambientCaptureForcedOff, setAmbientCaptureForcedOff] = useState(false);
  const webglSettings = useMemo(
    () => deriveWebglSettings(webglHighFidelity, window.devicePixelRatio),
    [webglHighFidelity],
  );
  const audioStateRef = useRef(audioState);
  audioStateRef.current = audioState;

  const hasBridge = typeof window.iris !== "undefined";
  const orbStageRef = useRef<HTMLDivElement | null>(null);
  const workScrollRef = useRef<HTMLDivElement | null>(null);
  const commsScrollRef = useRef<HTMLDivElement | null>(null);

  function pushLog(level: string, message: string, timestamp = Date.now()) {
    setLogs((current) => [{ id: crypto.randomUUID(), level, message, timestamp }, ...current].slice(0, MAX_LOGS));
  }

  const audio = useAudioPipeline({
    onLog: pushLog,
    micDeviceId,
    // A capture that could not be acquired at all is reported to main, which
    // owns the mode and decides to disengage (listen-mode-hears-system-audio
    // D4). Reported, never decided here.
    onSystemAudioUnavailable: (reason) => {
      if (!hasBridge) return;
      window.iris.reportSystemAudioUnavailable(reason);
    },
  });
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

  function toggleHudCameraSize() {
    setHudCameraEnlarged((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(HUD_CAMERA_SIZE_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // Best-effort persistence; the toggle still works for this session.
      }
      return next;
    });
  }

  function toggleWebglQuality() {
    setWebglHighFidelity((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(WEBGL_QUALITY_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // Best-effort persistence; the toggle still works for this session.
      }
      return next;
    });
  }

  // ambient-memory: persists the preference AND tells main, on every change —
  // main is the one thing that decides whether retention is actually live,
  // so a toggle that only flipped local state would show "on" while nothing
  // was retained.
  function setAmbientCapturePreference(next: boolean) {
    setAmbientCaptureEnabled(next);
    try {
      window.localStorage.setItem(AMBIENT_CAPTURE_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Best-effort persistence; the toggle still works for this session.
    }
    if (hasBridge) window.iris.setAmbientCaptureEnabled(next);
  }

  function toggleAmbientCapture() {
    setAmbientCapturePreference(!ambientCaptureEnabled);
  }

  // The indicator's stop affordance (spec: "Stopping is reachable from the
  // indicator, without hunting through settings") — the same action as
  // switching the settings toggle off.
  function stopAmbientCapture() {
    setAmbientCapturePreference(false);
  }

  function toggleDrawing() {
    setDrawingActive((current) => {
      const next = !current;
      // Single active-layer invariant (design.md D5 of second-brain-galaxy-view):
      // opening the drawing panel closes the galaxy, and vice versa (below).
      if (next) setSecondBrainActive(false);
      return next;
    });
  }

  function toggleSecondBrain() {
    setSecondBrainActive((current) => {
      const next = !current;
      if (next) setDrawingActive(false);
      return next;
    });
  }

  function closeNoteReader() {
    setOpenNote(null);
    window.iris.reportNoteClosed();
  }

  // A saved edit updates the open note in place — no reopen, no re-fetch. The
  // new revision comes back from the write itself, so the next save in the same
  // sitting is checked against what was actually written rather than against the
  // content the reader was first opened on.
  function noteSaved(content: string, revision: string) {
    setOpenNote((current) => (current ? { ...current, markdown: content, revision } : current));
  }

  async function openNoteFromGalaxy(id: string, title: string) {
    // Reader single-instance invariant (design.md D5/spec "At most one
    // reader open at a time") — opening a note closes the task reader.
    setExpandedTaskId(null);
    const result = await window.iris.readSecondBrainNote(id);
    if (!result.ok) return;
    setOpenNote({ id, title, markdown: result.content, revision: result.revision });
    // open-note-session: main is the single authority on which note is open —
    // the renderer reports every step of this lifecycle to it.
    window.iris.reportNoteOpened(id);
  }

  function exitHud() {
    // Drawing/galaxy are HUD-only (glass-hud-mode design.md D7); hide them
    // before leaving so neither is left mounted the next time the HUD is entered.
    setDrawingActive(false);
    setSecondBrainActive(false);
    window.iris.toggleHud();
  }

  function setCameraDeviceId(next: string) {
    setCameraDeviceIdState(next);
    try {
      window.localStorage.setItem(CAMERA_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence; the selection still applies for this session.
    }
  }

  // Updates state + persistence only, with no hot-swap side effect — used both
  // for an explicit user pick (setMicDeviceId below) and to reconcile the
  // selector/persisted value after either mic consumer's auto-fallback to
  // System Default (design.md's "return value, not a callback" decision).
  function applyMicDeviceId(next: string) {
    setMicDeviceIdState(next);
    try {
      window.localStorage.setItem(MIC_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence; the selection still applies for this session.
    }
  }

  // The user picked a mic from Settings. useWakeWord picks up the new
  // micDeviceId through its own [enabled, deviceId] effect dependency (it only
  // holds a stream while idle, i.e. exactly when a session isn't capturing),
  // so only the useAudioPipeline path needs an explicit hot-swap here — the
  // two consumers are temporally exclusive and never both fire for one change.
  function setMicDeviceId(next: string) {
    applyMicDeviceId(next);
    if (sidecarRunning) {
      audio.restartCapture(next).then((active) => {
        if (active && active !== next) applyMicDeviceId(active);
      });
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
      // No manual reset needed here: main resets listen-only mode on every
      // transition to not-running and pushes the change, which this
      // component's listen-only:state subscription already applies.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecarRunning]);

  // Deck WebGL backdrop/orb: pause their render loops when the window loses
  // OS focus, independent of the awake/asleep gate above.
  //
  // The seed above is read during the first render, which commonly runs while
  // the window is still hidden (it is shown on "ready-to-show"), so the focus
  // event that follows can land before these listeners exist. Nothing else
  // writes the flag and a window that never loses focus never fires another
  // event, so a missed transition would latch `false` for the whole session and
  // leave the deck's surfaces paused. Resynchronise on attach, and take main's
  // report — it owns the window — as authoritative over these DOM events.
  useEffect(() => {
    function onFocus() {
      setWindowFocused(true);
    }
    function onBlur() {
      setWindowFocused(false);
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    setWindowFocused(document.hasFocus());
    const offWindowFocus = hasBridge
      ? window.iris.onWindowFocus(({ focused }) => setWindowFocused(Boolean(focused)))
      : null;
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      offWindowFocus?.();
    };
  }, [hasBridge]);

  // renderer-content-security (harden-security-boundaries D9): Chromium's
  // default for an unhandled drop is to navigate the window to the dropped
  // file/URL — the window carrying `preload.cjs`. Cancelling dragover/drop at
  // the document level means a drop never starts a navigation in the first
  // place, independent of main's own will-navigate guard.
  useEffect(() => {
    function preventDefaultDrop(event: DragEvent) {
      event.preventDefault();
    }
    document.addEventListener("dragover", preventDefaultDrop);
    document.addEventListener("drop", preventDefaultDrop);
    return () => {
      document.removeEventListener("dragover", preventDefaultDrop);
      document.removeEventListener("drop", preventDefaultDrop);
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
      .getSecondBrainAvailability()
      .then((status) => setSecondBrainAvailable(Boolean(status.available)))
      .catch(() => {});
    window.iris
      .getPromptStatus()
      .then((status) => setReviewModeState(status.reviewMode ?? "verb"))
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
  // broadcasts here. Tray and global-hotkey wake requests both arrive as
  // iris:wake and run this same renderer flow, so mic capture stays
  // renderer-owned wherever the wake came from.
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
        // Drawing/galaxy are HUD-only (glass-hud-mode design.md D7); any exit
        // path (button, hotkey, tray) hides both so neither is left mounted
        // (and interactivity-latching, or — for the galaxy — snapping back on
        // by design.md D7 of second-brain-gesture-nav) once back in deck mode.
        setDrawingActive(false);
        setSecondBrainActive(false);
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

  // Listen-only mode: query on mount/reload (so a window opened or reloaded
  // while the mode is engaged shows the true state — design.md D3) and
  // subscribe to main's one-way push for every subsequent change. There is
  // deliberately no report-back call anywhere in this effect — main owns the
  // state, the renderer only executes the audio drop and displays it.
  useEffect(() => {
    if (!hasBridge) return;
    window.iris.getListenOnlyState().then((state) => {
      setListenOnlyEngaged(state.engaged);
      audio.applyListenOnlyState(state);
    });
    return window.iris.onListenOnlyState((state) => {
      const { engaged } = state;
      setListenOnlyEngaged(engaged);
      setHeardLive("");
      audio.applyListenOnlyState(state);
      // The consent point and the headphone advice both belong to the engaging
      // edge, and only when there is actually a capture to consent to — under
      // the escape hatch the mode retains nothing and captures nothing, so
      // saying otherwise would be false.
      if (engaged && state.systemAudio) {
        if (!loadListenOnlyConsentSeen()) {
          setListenOnlyNotice("consent");
          try {
            window.localStorage.setItem(LISTEN_ONLY_CONSENT_STORAGE_KEY, "on");
          } catch {
            // A notice we cannot remember is shown again next time; harmless.
          }
        } else {
          outputIsSpeakers().then((speakers) => {
            if (speakers) setListenOnlyNotice("headphones");
          });
        }
      } else if (!engaged) {
        setListenOnlyNotice(null);
      }
      // The HUD reveal applies on the transition only (design.md D7): every
      // push here IS a transition (main only pushes on an actual change), so
      // the engaging edge records the panel's prior state and forces it
      // open, and the disengaging edge restores what was recorded — a
      // manual toggle in between is respected rather than re-forced.
      if (engaged) {
        priorCommsOpenRef.current = commsOpenRef.current;
        setCommsOpen(true);
      } else {
        setCommsOpen(priorCommsOpenRef.current);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  function toggleListenOnly() {
    if (!hasBridge) return;
    window.iris.requestListenOnlyToggle();
  }

  // ambient-memory: pushes the persisted preference to main at boot — main
  // defaults to off on every launch (design D1) and stays off until this
  // arrives — then queries the current live/forcedOff state and subscribes
  // to every later transition. Mirrors the listen-only effect above.
  useEffect(() => {
    if (!hasBridge) return;
    window.iris.setAmbientCaptureEnabled(loadAmbientCaptureEnabled());
    window.iris.getAmbientCaptureState().then(({ live, forcedOff }) => {
      setAmbientCaptureLive(live);
      setAmbientCaptureForcedOff(forcedOff);
    });
    return window.iris.onAmbientCaptureState(({ live }) => {
      setAmbientCaptureLive(live);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  useEffect(() => {
    document.documentElement.classList.toggle("hud-mode", uiMode === "hud");
  }, [uiMode]);

  // Click-through management: in HUD mode the window ignores the mouse except
  // when the pointer is over a `.hud-hit` element. elementFromPoint respects
  // pointer-events, so it only returns elements that opted in.
  //
  // While the drawing panel (or the second-brain galaxy, second-brain-galaxy-
  // view design.md D5/4.3) is active, interactivity is latched on for the
  // whole duration instead of being re-decided per pointermove (hud-drawing-
  // canvas design.md D3) — per-move flipping races with excalidraw/orbit-
  // control gestures, so a fast drag/marquee/wheel-zoom/orbit-drag crossing
  // the panel edge could otherwise drop the pointer stream mid-gesture.
  useEffect(() => {
    if (!hasBridge || uiMode !== "hud") return;
    if (drawingActive || secondBrainActive) {
      window.iris.setHudInteractive(true);
      return;
    }
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
            ".hud-hit, .reader-backdrop, .history-backdrop, .match-backdrop, .setup-backdrop, .boot, .excalidraw-modal-container",
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
  }, [hasBridge, uiMode, drawingActive, secondBrainActive]);

  // Esc force-closes the galaxy regardless of its internal state (design.md
  // D9/L3 of second-brain-galaxy-view) — a crashed WebGL layer (caught by
  // VaultGalaxy's own error boundary, which also force-closes) must not be
  // the only way out of the fullscreen click-through-disabled overlay.
  useEffect(() => {
    if (!secondBrainActive) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSecondBrainActive(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [secondBrainActive]);

  // The note reader's existence is derived from secondBrainActive at the
  // render call site below (`secondBrainActive && openNote`), which closes
  // the openNoteFromGalaxy await race — but that only suppresses rendering,
  // leaving `openNote` set. Without also clearing it here, toggling the
  // galaxy back on would pop the stale reader open again over a freshly-
  // loading graph (second-brain-gesture-nav design.md D7 — ship both).
  useEffect(() => {
    if (!secondBrainActive) {
      setOpenNote(null);
      window.iris.reportNoteClosed();
    }
  }, [secondBrainActive]);

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
    {
      threshold: fullConfig?.wakeThreshold ?? 0.15,
      consecutive: fullConfig?.wakeConsecutive ?? 2,
      debug: fullConfig?.wakeDebug ?? false,
    },
    () => {
      if (!sidecarRunning) start();
    },
    (message, fallbackDeviceId) => {
      pushLog("error", `Wake word: ${message}`);
      if (fallbackDeviceId) applyMicDeviceId(fallbackDeviceId);
    },
    micDeviceId,
    () => setWakeFailed(false),
    (message) => {
      pushLog("error", `Wake word: ${message}`);
      setWakeFailed(true);
    },
  );

  // Toggling wake word off tears down the listener with no callback (it
  // returns early on `enabled: false`), so a stale failure banner must be
  // cleared here rather than left next to a caption reading "press ⌥⇧W to wake
  // Iris" (design D3, wake-sleep-voice).
  useEffect(() => {
    if (!wakeWordEnabled) setWakeFailed(false);
  }, [wakeWordEnabled]);

  // Keyboard wake/sleep used to live here as a bare w/s keydown handler, which
  // only worked while this window had focus — useless in the case Iris is for,
  // HUD mode over another application. They are `globalShortcut` registrations
  // in the main process now (wake-sleep-voice), arriving over iris:wake and
  // iris:sleep like the tray's, so nothing renderer-side is needed. The
  // INPUT/TEXTAREA guard went with them: it existed only to keep a bare letter
  // from firing while the user typed.

  // Scoped autoscroll: scrollIntoView would also scroll every scrollable
  // ancestor (the rounded deck clips with overflow:hidden), shifting the whole
  // layout up. Scroll the comms panel directly instead.
  useEffect(() => {
    const el = commsScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  const working = useMemo(
    () => tasks.some((task) => !TERMINAL.has(task.status.toLowerCase())),
    [tasks],
  );

  // The intro is edge-triggered off the session starting, not derived from
  // (running, connected) — see src/lib/boot-gate.ts. A reconnect and a shutdown
  // both look like a start to any predicate over those two.
  const [booting, setBooting] = useState(false);
  const bootGateRef = useRef<BootGateState>({ running: false, introVisible: false });
  useEffect(() => {
    const previous = bootGateRef.current;
    const { introVisible, reportBootDone } = stepBootGate(previous, {
      running: sidecarRunning,
      connected: geminiStatus === "connected",
    });
    bootGateRef.current = { running: sidecarRunning, introVisible };
    setBooting(introVisible);
    // Tell main the boot screen is gone so Iris can speak its welcome now
    // (design.md D6) — only for an intro that actually played.
    if (reportBootDone && hasBridge) window.iris.notifyBootDone();
  }, [sidecarRunning, geminiStatus, hasBridge]);

  // The two facts every WebGL surface's pause decision is made from; which of
  // them a given surface honours lives in src/lib/orb-frameloop.ts.
  const surfaceActivity = useMemo(
    () => ({ awake: sidecarRunning, windowFocused }),
    [sidecarRunning, windowFocused],
  );

  const reactorState = useMemo(() => {
    if (!sidecarRunning) return "idle" as const;
    // Held for the whole time the mode is engaged, ahead of every per-turn
    // state below it (orb-expressions): the mode is a condition, not a turn,
    // and a "speaking" flash over it would announce a reply that reached
    // nobody. Iris produces none of those replies visibly anyway — they are
    // discarded in main — so this is the only thing the orb has to say.
    if (listenOnlyEngaged) return "listenMode" as const;
    if (audioState === "speaking") return "speaking" as const;
    if (audioState === "listening") return "listening" as const;
    if (working) return "working" as const;
    if (geminiStatus === "connected") return "online" as const;
    return "idle" as const;
  }, [audioState, geminiStatus, listenOnlyEngaged, sidecarRunning, working]);

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
  // What ran most recently, for display. There is no *current* verb: Iris picks
  // one per request, so a workstream has a history, not a mode.
  const lastVerb = activeSession?.last_verb_used ?? null;

  useEffect(() => {
    if (!hasBridge) return;
    window.iris
      .listVerbs(activeSessionId ?? undefined)
      .then(setVerbs)
      .catch(() => setVerbs(null));
  }, [hasBridge, activeSessionId, sessions, agentsTick]);

  useEffect(() => {
    if (!modelPopoverVerb) return;
    function onDocPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".agent-chip-model") || target?.closest(".model-popover")) return;
      setModelPopoverVerb(null);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [modelPopoverVerb]);

  // The verb-selection handler is gone with the chip that called it. Choosing
  // what kind of work a request is belongs to Iris, which is the component that
  // actually heard the request — a control here could only ever disagree with
  // it, and did.
  async function setVerbModelChoice(verb: Verb, model: string) {
    if (!hasBridge || !activeSessionId) return;
    setModelPopoverVerb(null);
    const result = await window.iris.setVerbModel(activeSessionId, verb, model);
    if (result.status === "error") {
      pushLog("error", result.error ?? "Could not change the model.");
      return;
    }
    setAgentsTick((tick) => tick + 1);
    // Two shaping verbs share one live conversation, so a change to either
    // applies to both. Say so rather than appearing to change one.
    const affected = result.verbs?.length ? result.verbs : [verb];
    pushLog(
      "info",
      `${affected.map(verbLabel).join(" and ")} now ${affected.length > 1 ? "run" : "runs"} on ${modelLabel(model)}${
        result.shared ? " — they share one live conversation" : ""
      }.`,
    );
  }

  // Secondary answer path: lets a sighted user click an option directly
  // instead of answering by voice. Picks accumulate locally; the batch is
  // submitted only once every question in this AskUserQuestion call has a
  // pick, matching the voice path's "collect all answers, then resolve"
  // batching. If the voice path answers first, the submit call is a no-op —
  // main resolves whichever side (voice or UI) completes first.
  function pickPoAnswer(question: string, choice: string) {
    if (!hasBridge || !pendingPoQuestion) return;
    const multi = pendingPoQuestion.questions.find((q) => q.question === question)?.multiSelect;
    const current = poAnswers[question] ?? [];
    // Multi-select toggles within a list; single-select replaces, as before.
    const picks = multi
      ? current.includes(choice)
        ? current.filter((label) => label !== choice)
        : [...current, choice]
      : [choice];
    const next = { ...poAnswers, [question]: picks };
    setPoAnswers(next);

    // A multi-select question cannot auto-submit on the last pick — the user
    // has to be able to say when they are done choosing, which is what the
    // banner's Send button is for.
    if (pendingPoQuestion.questions.some((q) => q.multiSelect)) return;
    if (!pendingPoQuestion.questions.every((q) => (next[q.question] ?? []).length > 0)) return;
    submitPoAnswers(next);
  }

  function submitPoAnswers(picks: Record<string, string[]>) {
    if (!hasBridge || !pendingPoQuestion) return;
    if (!pendingPoQuestion.questions.every((q) => (picks[q.question] ?? []).length > 0)) return;
    const questions = pendingPoQuestion.questions;
    setPendingPoQuestion(null);
    setPoAnswers({});
    window.iris.answerPoQuestion(
      questions.map((q) => ({ question: q.question, choice: picks[q.question] ?? [] })),
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

  async function setReviewMode(next: ReviewMode) {
    if (!hasBridge) return;
    const result = await window.iris.setPromptReviewMode(next);
    if (result.status === "error") {
      pushLog("error", result.error ?? "Could not change review mode.");
      return;
    }
    setReviewModeState(result.reviewMode);
  }

  function handleSidecarEvent(event: SidecarEvent) {
    if (event.type === "pipeline_availability") {
      setPipelineAvailable(Boolean(event.available));
      return;
    }

    if (event.type === "secondbrain_availability") {
      const available = Boolean(event.available);
      setSecondBrainAvailable(available);
      // On disappearance, force-close the galaxy and hide the toggle
      // (design.md D7/M4/M-5/L2).
      if (!available) setSecondBrainActive(false);
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

    // listen-mode-hears-system-audio: something Iris overheard tried to make
    // her act, and main refused it before dispatch. Surfaced as a notice rather
    // than a log line because the log list is discarded (see setLogs above) —
    // and an invisible refusal is indistinguishable from Iris quietly doing the
    // work anyway.
    if (event.type === "listen_only_refused") {
      setRefusedTool(readString(event.tool, "a task"));
      setListenOnlyNotice("refused");
      return;
    }

    if (event.type === "heard_live") {
      setHeardLive(readString(event.text));
      return;
    }

    if (event.type === "transcript") {
      const speaker = readString(event.speaker, "unknown");
      const text = readString(event.text);
      if (text.trim()) {
        // Your words just got locked in — the orb answers with a soft ripple.
        // The ripple means "your speech just locked in", so it must not fire
        // for a line Iris merely overheard — transcriptVoice keeps that
        // decision in one place for the two surfaces and this.
        if (transcriptVoice(speaker) === "self") setRippleKey((key) => key + 1);
        setTranscript((current) => [...current, { id: crypto.randomUUID(), speaker, text }].slice(-40));
      }
      return;
    }

    if (event.type === "claude_task_update") {
      const task = readString(event.task, "Claude task");
      const rawRunId = readString(event.run_id);
      const runId = rawRunId || taskKeyFor(task);
      const status = readString(event.status, "unknown");
      const verb = isVerb(event.verb) ? event.verb : null;
      const model = typeof event.model === "string" ? event.model : null;
      // Additive step-timeline fields (see electron/claude-stream.mjs) — a tool
      // call opens a step keyed by Claude's own tool_use id, the matching
      // tool_end closes it. Absent for plain activity/terminal updates, which
      // leave the existing steps untouched.
      const phase = readString(event.phase);
      const toolId = readString(event.tool_id);
      // What the run cost, off the runtime's own result message. Absent on
      // every update before the run finishes, so it must never overwrite a
      // figure already recorded.
      const usage = readTaskUsage(event.usage);

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
          verb: verb ?? existing?.verb ?? null,
          model: model ?? existing?.model ?? null,
          claudeSessionId: readString(event.claude_session_id) || existing?.claudeSessionId || null,
          usage: usage ?? existing?.usage ?? null,
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
      setReviewModeState((event.reviewMode as ReviewMode) ?? "verb");
      return;
    }

    if (event.type === "task_review") {
      const status = readString(event.status, "pending");
      if (status === "pending") {
        setPendingReview({
          workstreamId: readString(event.workstream_id),
          task: readString(event.task),
          urgency: readString(event.urgency, "normal"),
          verb: isVerb(event.verb) ? event.verb : null,
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
    const activeDevice = await audio.start();
    if (activeDevice && activeDevice !== micDeviceId) applyMicDeviceId(activeDevice);
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
  // The focus mode's one condition (hud-panels-stay-hand-reachable-under-galaxy
  // design.md D0/D6): an open reader — task run-reader or vault note reader —
  // paints a full-screen backdrop and takes EVERY gesture until it closes. One
  // value, read by both gesture loops, the galaxy, and the context resolver, so
  // the four cannot disagree about whether something is being read.
  const readerOpen = expandedTaskId != null || openNote != null;
  // Bookkeeping (which element, when it started, whether it already fired)
  // stays in a ref — only the render-visible facts below become state.
  const dwellRef = useRef<{ el: HTMLElement; startedAt: number; fired: boolean } | null>(null);
  const [dwellActive, setDwellActive] = useState(false);
  const [dwellFired, setDwellFired] = useState(false);

  const { state: hand, stateRef: liveHandRef, error: handError, stream: handStream } = useHandControl(
    handControl,
    cameraDeviceId,
  );

  // eye-tracking-hud: decorative only, and deliberately called HERE rather
  // than inside either camera component. The deck and the HUD are mutually
  // exclusive, so a component-level hook would tear down and re-create
  // FaceLandmarker on every mode switch; at App level it takes the stream
  // useHandControl already opened (no second getUserMedia, no second
  // permission prompt) and survives the switch untouched. Gated by the same
  // handControl boolean as everything else — no new toggle, no new preference.
  const { state: eye, stateRef: liveEyeRef } = useEyeTracking(handStream, handControl);

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
      // Focus mode: an open reader takes every gesture until it closes, so
      // nothing outside it dwells. (The shared mode's positional rule for a
      // coexisting layer is applied below, AFTER actionable resolves, since it
      // needs an element to test.)
      if (!handControl || !h.present || !h.point || !h.pointing || readerOpen) {
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

      // Shared mode: a coexisting HUD layer (the drawing panel or the
      // second-brain galaxy) owns only the surface it actually occupies. Both
      // are painted BENEATH `.hud-chrome`, where the islands stay visible and
      // mouse-clickable — so the hand reaches them too, and only the layer's
      // own surface is suppressed. Testing "is a layer active" instead left
      // every island but `.hud-controls` visible, clickable, and untouchable.
      if ((drawingActive || secondBrainActive) && !isHudChrome(actionable)) {
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
  }, [handControl, readerOpen, drawingActive, secondBrainActive]);

  // Open-palm hold-to-scroll: scrolls whichever scrollable region (Comms or
  // Work Stream column, on the deck or in the HUD) is under the hand.
  useEffect(() => {
    let raf = 0;
    // `.hud-work` / `.hud-comms` are the HUD's own scroll containers. Without
    // them this loop only ever named deck classes, so palm-scroll in the Glass
    // HUD never worked at all — layer or no layer (design.md D4).
    const SCROLLABLES =
      ".activity-timeline, .comms-scroll, .work-scroll, .history-grid, .hud-work, .hud-comms";
    const loop = () => {
      const h = liveHandRef.current;
      // Two open palms mean scale, and only scale (design.md D5) — otherwise a
      // palm drifting over a column mid-zoom would scroll it as well.
      const twoPalms = (h?.hands.filter((item) => item.openPalm).length ?? 0) >= 2;
      if (handControl && h?.openPalm && h.point && !twoPalms && !readerOpen && !showHistory) {
        const el = document.elementFromPoint(h.point.x, h.point.y);
        // Shared mode, same positional rule as the dwell: a coexisting layer
        // owns its own surface, the chrome above it keeps its own bindings.
        const layerOwnsPoint = (drawingActive || secondBrainActive) && !isHudChrome(el);
        const target = layerOwnsPoint ? null : el?.closest<HTMLElement>(SCROLLABLES) ?? null;
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
  }, [handControl, readerOpen, showHistory, drawingActive, secondBrainActive]);

  // Closed-fist rotates the Arc Reactor orb, pinch scales it — only on the
  // deck, with the reader closed and neither the drawing panel nor the
  // second-brain galaxy active. Excluded from the Glass HUD entirely: there
  // the orb is a small floating puck, not the stage, so the gesture surface
  // belongs to the HUD's own content instead (scope-orb-gesture-out-of-hud
  // design.md D1) — this never collides with the reader-open fist-close or
  // two-palm-resize bindings, nor with excalidraw/the galaxy's own input,
  // nor with whatever the HUD binds the fist to next. Written straight into
  // refs (not React state) every frame, same as the audio-level refs
  // ReactorCore already reads.
  const orbRotationRef = useRef({ x: 0, y: 0 });
  const orbScaleRef = useRef(1);
  useEffect(() => {
    let raf = 0;
    let prevFistPoint: HandPoint | null = null;
    const loop = () => {
      const h = liveHandRef.current;
      const engaged = orbGestureEngaged({
        handControl,
        handPresent: !!h?.present,
        uiMode,
        readerOpen: !!expandedTaskId,
        drawingActive,
        secondBrainActive,
      });

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
  }, [handControl, uiMode, expandedTaskId, drawingActive, secondBrainActive]);

  // Single authoritative context for the indicator (second-brain-gesture-nav
  // design.md D9/D10) — reader outranks the galaxy, which outranks the deck.
  const gestureContext = useMemo(
    () =>
      resolveGestureContext({
        readerOpen,
        secondBrainActive,
        drawingActive,
        historyOpen: showHistory,
      }),
    [readerOpen, secondBrainActive, drawingActive, showHistory],
  );

  const handAction = useMemo(() => {
    if (!hand.present) return { label: "Show your hand", tone: "idle" };

    if (gestureContext === "reader") {
      // Both readers (task and vault note) share ReaderCore's bindings — a
      // fist closes here, never orbits/rotates, fixing the fist branch's
      // prior expandedTaskId-only test (design.md M11).
      if (hand.hands.filter((item) => item.openPalm).length >= 2) return { label: "Two palms · resize", tone: "open" };
      if (hand.fist) return { label: "Closed_Fist · close", tone: "fist" };
      if (hand.openPalm) return { label: "Open_Palm · scroll", tone: "open" };
      return { label: `${hand.gesture} · idle`, tone: "idle" };
    }

    if (gestureContext === "galaxy") {
      // Mirrors driveFor's pose partition (src/lib/galaxy-nav.ts) so the
      // indicator names the binding actually live, not "idle" or an orb/
      // deck label the galaxy has taken over (design.md D10/D6). Reads the
      // open-palm count rather than pinchDistance: semanticEquals excludes
      // pinchDistance from republishing, so that field never forced this
      // memo to recompute — the label would show whatever it was when some
      // OTHER field last changed. openPalm is compared per hand, so it does.
      if (hand.hands.filter((item) => item.openPalm).length >= 2) return { label: "Two palms · zoom the view", tone: "open" };
      // Fist + palm reels in on the locked note (design.md D26) — a different
      // zoom from two palms, and the indicator has to separate them or the one
      // thing carried in the hands rather than in hidden state goes unnamed.
      if (hand.hands.some((item) => item.fist) && hand.hands.some((item) => item.openPalm)) {
        return { label: "Fist + palm · reel to note", tone: "open" };
      }
      if (hand.pointing) return { label: "Pointing_Up · open a node", tone: "move" };
      if (hand.fist) return { label: "Closed_Fist · turn the view", tone: "fist" };
      if (hand.openPalm) return { label: "Open_Palm · aim", tone: "open" };
      return { label: `${hand.gesture} · idle`, tone: "idle" };
    }

    // Deck (and drawing/history, which don't bind their own gestures here).
    if (hand.hands.filter((item) => item.openPalm).length >= 2) return { label: "Two palms · resize", tone: "open" };
    if (hand.fist) {
      return drawingActive || uiMode === "hud"
        ? { label: "Closed_Fist · idle", tone: "idle" }
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
    drawingActive,
    gestureContext,
    uiMode,
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
    // No local default for the chord: main owns what is registered, and until
    // that snapshot arrives the caption says nothing about the keyboard rather
    // than naming a key it hasn't confirmed (wake-sleep-voice).
    const wake = wakeCaption({
      sidecarRunning,
      wakeWordEnabled,
      wakeFailed,
      wakeHotkey: fullConfig?.wakeHotkey ?? "",
    });
    if (wake) return wake;
    // While the mode is engaged the caption becomes a live readout of what
    // Iris is hearing — ahead of every per-turn state below, because those
    // describe a conversation that is not happening. Without it, "hearing
    // perfectly" and "capture is dead" look identical until the mode ends.
    if (listenOnlyEngaged) {
      return heardLive
        ? { text: liveHeardCaption(heardLive), dim: false }
        : { text: "Listening — nothing heard yet…", dim: true };
    }
    if (audioState === "speaking") return { text: "Speaking…", dim: false };
    if (audioState === "listening") return { text: "Listening…", dim: false };
    if (working) return { text: "Working on it…", dim: false };
    const last = transcript[transcript.length - 1];
    if (last) return { text: last.text, dim: false };
    if (geminiStatus === "connected") return { text: "How can I help?", dim: true };
    return { text: "Connecting…", dim: true };
  }, [
    sidecarRunning,
    audioState,
    working,
    transcript,
    listenOnlyEngaged,
    heardLive,
    geminiStatus,
    wakeWordEnabled,
    wakeFailed,
    fullConfig?.wakeHotkey,
  ]);

  function openTask(task: TaskCard) {
    if (!(task.output || task.error)) return;
    setTaskChooser(null);
    setExpandedTaskId(task.id);
    setShowHistory(false);
    // Reader single-instance invariant, other direction (design.md D5).
    setOpenNote(null);
    window.iris.reportNoteClosed();
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
          running={surfaceAdvancesFrames("hud-orb", surfaceActivity)}
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
          listenOnlyEngaged={listenOnlyEngaged}
          systemAudioState={audio.systemAudioState}
          onToggleListenOnly={toggleListenOnly}
          ambientCaptureLive={ambientCaptureLive}
          onStopAmbientCapture={stopAmbientCapture}
          commsOpen={commsOpen}
          onToggleComms={() => setCommsOpen((current) => !current)}
          onWake={start}
          onSleep={stop}
          onExitHud={exitHud}
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
          eye={eye}
          eyeRef={liveEyeRef}
          handStream={handStream}
          handActionLabel={handAction.label}
          handActionTone={handAction.tone}
          cameraEnlarged={hudCameraEnlarged}
          onToggleCameraSize={toggleHudCameraSize}
          pipelineAvailable={pipelineAvailable}
          poQuestion={
            pendingPoQuestion
              ? {
                  questions: pendingPoQuestion.questions,
                  answers: poAnswers,
                  onPick: pickPoAnswer,
                  onSubmit: () => submitPoAnswers(poAnswers),
                }
              : null
          }
          taskReview={
            pendingReview ? { review: pendingReview, onApprove: approveReview, onCancel: cancelReview } : null
          }
          drawingActive={drawingActive}
          onToggleDrawing={toggleDrawing}
          secondBrainAvailable={secondBrainAvailable}
          secondBrainActive={secondBrainActive}
          onToggleSecondBrain={toggleSecondBrain}
          galaxyPositionsRef={galaxyPositionsRef}
          onOpenNote={openNoteFromGalaxy}
          onForceCloseSecondBrain={() => setSecondBrainActive(false)}
          readerOpen={readerOpen}
          webglHighFidelity={webglHighFidelity}
        />
      ) : (
      <div
        className={`deck ${sidecarRunning ? "awake" : "asleep"} ${
          modeTransition === "to-hud" ? "deck-leaving" : ""
        } ${modeTransition === "to-deck" ? "deck-entering" : ""}`}
      >
        <div className="hud-nebula" />
        <div className="hud-glow" />
        {webglSettings.backdrop.mount ? (
          <HoloBackdrop running={surfaceAdvancesFrames("backdrop", surfaceActivity)} />
        ) : null}

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
              eye={eye}
              eyeRef={liveEyeRef}
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
            orbRunning={surfaceAdvancesFrames("deck-orb", surfaceActivity)}
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
            listenOnlyEngaged={listenOnlyEngaged}
            systemAudioState={audio.systemAudioState}
            onToggleListenOnly={toggleListenOnly}
            ambientCaptureLive={ambientCaptureLive}
            onStopAmbientCapture={stopAmbientCapture}
            onSleep={stop}
            wakeHotkey={fullConfig?.wakeHotkey ?? ""}
            sleepHotkey={fullConfig?.sleepHotkey ?? ""}
            webglHighFidelity={webglHighFidelity}
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
                verbs={verbs}
                lastVerb={lastVerb}
                modelPopoverVerb={modelPopoverVerb}
                reviewMode={reviewMode}
                onToggleModelPopover={(verb) => setModelPopoverVerb((current) => (current === verb ? null : verb))}
                onSetVerbModel={setVerbModelChoice}
                onSetReviewMode={setReviewMode}
              />
              <ProjectBar project={activeProject} onChoose={chooseProjectFolder} />
              {pendingPoQuestion ? (
                <PoQuestionBanner
                  questions={pendingPoQuestion.questions}
                  answers={poAnswers}
                  onPick={pickPoAnswer}
                  onSubmit={() => submitPoAnswers(poAnswers)}
                />
              ) : null}
              {pendingReview ? (
                <ReviewBanner review={pendingReview} onApprove={approveReview} onCancel={cancelReview} />
              ) : null}
            </WorkStream>
          ) : null}
        </div>

        <footer className="deck-foot">
          <span className="build-meta">
            IRIS · build 0.2.0 · by MRQ Học Ứng Dụng AI ·{" "}
            <a href="https://www.mrqhocungdungai.io.vn" target="_blank" rel="noreferrer">
              Web
            </a>{" "}
            ·{" "}
            <a href="https://github.com/mrqhocungdungai-vn/myiris" target="_blank" rel="noreferrer">
              GitHub
            </a>{" "}
            · fork of{" "}
            <a href="https://github.com/ASHR12/iris" target="_blank" rel="noreferrer">
              ASHR12/iris
            </a>
          </span>
        </footer>

        {booting ? <BootSequence visible={booting} /> : null}
      </div>
      )}

      {expandedTask ? (
        <ReaderOverlay task={expandedTask} hand={handControl ? hand : null} handRef={liveHandRef} onClose={closeReader} />
      ) : null}

      {secondBrainActive && openNote ? (
        <NoteReader
          noteId={openNote.id}
          title={openNote.title}
          markdown={openNote.markdown}
          revision={openNote.revision}
          hand={handControl ? hand : null}
          handRef={liveHandRef}
          onClose={closeNoteReader}
          onSaved={noteSaved}
        />
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
          webglHighFidelity={webglHighFidelity}
          onToggleWebglQuality={toggleWebglQuality}
          ambientCaptureEnabled={ambientCaptureEnabled}
          onToggleAmbientCapture={toggleAmbientCapture}
          ambientCaptureForcedOff={ambientCaptureForcedOff}
          cameraDeviceId={cameraDeviceId}
          onChangeCameraDevice={setCameraDeviceId}
          micDeviceId={micDeviceId}
          onChangeMicDevice={setMicDeviceId}
          onClose={() => setSetup(null)}
          onSaved={setFullConfig}
          onStart={() => {
            if (!sidecarRunning) start();
          }}
          onRunWizard={() => setSetup({ mode: "onboarding" })}
        />
      ) : null}

      <HandoffLayer pulses={pulses} onPulseEnd={removePulse} />

      {handControl && hand.present ? (
        <HandReticles hand={hand} handRef={liveHandRef} dwelling={dwellActive && !dwellFired} />
      ) : null}

      <ListenOnlyNotice
        kind={listenOnlyNotice}
        tool={refusedTool}
        onDismiss={() => setListenOnlyNotice(null)}
      />
    </>
  );
}
