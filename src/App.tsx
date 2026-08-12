import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskCard } from "./types";
import {
  TERMINAL,
  findTaskMatches,
} from "./lib/tasks";
import { modelLabel, verbLabel } from "./lib/verbs";
import { resolveGestureContext } from "./lib/gestureContext";
import { handActionFor } from "./lib/gesture-label";
import { resolveCaption, resolveAudioDot, resolveReactorState } from "./lib/caption";
import { usePersistedFlag, usePersistedChoice } from "./hooks/usePersistedPreference";
import { deriveWebglSettings, WEBGL_QUALITY_STORAGE_KEY } from "./lib/webgl-quality";
import {
  SOUNDS_STORAGE_KEY,
  CAMERA_STORAGE_KEY,
  MIC_STORAGE_KEY,
  HAND_STORAGE_KEY,
  HUD_CAMERA_SIZE_STORAGE_KEY,
} from "./lib/preferences";
import { uiSounds } from "./lib/sounds";
import { useAudioPipeline } from "./hooks/useAudioPipeline";
import { useHandoffFx } from "./hooks/useHandoffFx";
import { useHandControl, SYSTEM_DEFAULT_CAMERA } from "./hooks/useHandControl";
import { useEyeTracking } from "./hooks/useEyeTracking";
import { useSystemTelemetry } from "./hooks/useSystemTelemetry";
import { useTokenLedger } from "./hooks/useTokenLedger";
import { useWakeControl } from "./hooks/useWakeControl";
import { useStreams } from "./hooks/useStreams";
import { useClaudeQuestion } from "./hooks/useClaudeQuestion";
import { useListenOnlyMode } from "./hooks/useListenOnlyMode";
import { revealStep, INITIAL_REVEAL_LATCH } from "./lib/reveal-latch";
import { useReaderSlot } from "./hooks/useReaderSlot";
import { useOrbExpressions } from "./hooks/useOrbExpressions";
import { useHudMode } from "./hooks/useHudMode";
import { useAmbientCapture } from "./hooks/useAmbientCapture";
import { useSessions } from "./hooks/useSessions";
import { useTaskStream } from "./hooks/useTaskStream";
import { useReviewGate } from "./hooks/useReviewGate";
import { useSessionStatus } from "./hooks/useSessionStatus";
import { routeSidecarEvent } from "./lib/sidecar-router";
import { useHandGestures } from "./hooks/useHandGestures";
import { useHudClickThrough } from "./hooks/useHudClickThrough";
import { useAppConfig } from "./hooks/useAppConfig";
import { useEscapeToClose } from "./hooks/useEscapeToClose";
import { useDropNavigationGuard } from "./hooks/useDropNavigationGuard";
import { useBootGate } from "./hooks/useBootGate";
import { useIrisSubscriptions } from "./hooks/useIrisSubscriptions";
import { useSessionLifecycle } from "./hooks/useSessionLifecycle";
import { applyUiAction, buildUiContext, resolveTaskQuery } from "./lib/ui-actions";
import { SYSTEM_DEFAULT_MIC } from "./lib/mic-device";
import { surfaceAdvancesFrames } from "./lib/orb-frameloop";
import TopBar from "./components/TopBar";
import HudShell from "./components/HudShell";
import CommsPanel from "./components/CommsPanel";
import CameraDock from "./components/CameraDock";
import CenterStage from "./components/CenterStage";
import ListenOnlyNotice from "./components/ListenOnlyNotice";
import WorkStream from "./components/WorkStream";
import PipelineBar from "./components/PipelineBar";
import ClaudeQuestionBanner from "./components/ClaudeQuestionBanner";
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


// Each preference's default is stated once, here, next to the reason for it.
// The keys, the parse, and the best-effort storage handling live in
// `lib/preferences.ts`; these thunks exist only to name the default that goes
// with each key so a `useState` initializer reads as the preference it is.
// ambient-memory: default OFF, unlike sounds above — this is the one
// preference whose safer default is off, not on (design D1).
// glass-hud-mode: enlarging is the deliberate act, so the standard size is the
// default and anything absent or unreadable resolves to it — the failure mode
// is "reverts to standard", never "stuck enlarged with no way back".
// The WebGL preference keeps its own parser: `webgl-quality.ts` owns both the
// key and what the value means for every WebGL surface.

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
  // The transcript and diagnostic log — see useStreams.
  const { transcript, logs, pushLog, pushTranscript } = useStreams();
  // The 4th slot is the transient setter: stopping the session turns hand
  // control off without un-choosing the preference (see the hook).
  const [handControl, toggleHand, , setHandControlTransient] = usePersistedFlag(HAND_STORAGE_KEY, false);
  const [hudCameraEnlarged, toggleHudCameraSize] = usePersistedFlag(HUD_CAMERA_SIZE_STORAGE_KEY, false);
  // The non-blocking confirm dialog is gone with its only caller: the soft gate
  // that warned before switching pipeline roles. Nothing asks the user to
  // confirm anything now — Iris picks the verb, and the review gate is where a
  // consequential dispatch stops for a human decision.
  // Master switch for the whole pipeline surface (Work Stream, PipelineBar,
  // workstream switcher, task chooser, HUD work.tasks column, question banner) —
  // determined by main from whether the `claude` binary resolves. Defaults to
  // false (chat-only) until the boot-time fetch or a pipeline_availability
  // sidecar event says otherwise, so first paint never flashes pipeline UI
  // that immediately disappears.
  const [pipelineAvailable, setPipelineAvailable] = useState(false);

  // Toggleable excalidraw drawing panel (hud-drawing-canvas), HUD-only and
  // hidden by default; unmounting DrawingCanvas when false keeps its lazy
  // chunk from ever loading unless the user opens it.
  const [secondBrainAvailable, setSecondBrainAvailable] = useState(false);
  // Hoisted above VaultGalaxy's own mount (design.md M-3) so toggling the
  // galaxy off and back on rehydrates node positions instead of
  // re-scrambling the force-directed layout on every reopen.
  const secondBrainPositionsRef = useRef<Map<string, GalaxyNode>>(new Map());
  // Listen-only mode (replace-listening-mode-with-listen-only design.md D3):
  // main is the sole owner of this state — this is pure display, seeded from
  // a query on mount/reload and updated only by main's push. Never asserted
  // back. Feeds the audio pipeline's suppression flag from the same push.
  // Comms's open state. The reveal-while-listening rule reads `commsOpenRef`
  // to record what was showing before it forces the panel open (design.md D7);
  // the latch that owns that rule is lib/reveal-latch.
  const [commsOpen, setCommsOpen] = useState(false);
  const commsOpenRef = useRef(commsOpen);
  commsOpenRef.current = commsOpen;

  // Interface sounds default ON; every other flag here defaults OFF.
  const [soundsEnabled, toggleSounds] = usePersistedFlag(SOUNDS_STORAGE_KEY, true);
  const soundsRef = useRef(soundsEnabled);
  soundsRef.current = soundsEnabled;
  const [cameraDeviceId, setCameraDeviceId] = usePersistedChoice(CAMERA_STORAGE_KEY, SYSTEM_DEFAULT_CAMERA);
  const [micDeviceId, applyMicDeviceId] = usePersistedChoice(MIC_STORAGE_KEY, SYSTEM_DEFAULT_MIC);
  // webgl-quality-mode: defaults to the light path (false/off) — see design.md D6.
  const [webglHighFidelity, toggleWebglQuality] = usePersistedFlag(WEBGL_QUALITY_STORAGE_KEY, false);
  const webglSettings = useMemo(
    () => deriveWebglSettings(webglHighFidelity, window.devicePixelRatio),
    [webglHighFidelity],
  );

  const hasBridge = typeof window.iris !== "undefined";
  const orbStageRef = useRef<HTMLDivElement | null>(null);
  const workScrollRef = useRef<HTMLDivElement | null>(null);
  const commsScrollRef = useRef<HTMLDivElement | null>(null);

  // The voice session and everything it reports — see useSessionStatus.
  const session = useSessionStatus({ hasBridge });

  // The effective config and the setup panel it drives — see useAppConfig.
  const appConfig = useAppConfig({
    hasBridge,
    // Keeps the wake-word toggle in step with what was actually saved.
    onConfig: (config) => wake.setEnabled(config.wakeWord),
  });

  // The prompt-review gate — see useReviewGate.
  const review = useReviewGate({ hasBridge, onError: (message) => pushLog("error", message) });

  // The work stream: run cards, focus, timelines and the chooser — see
  // useTaskStream.
  const work = useTaskStream();

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
  // A run that has paused to ask, and the picks against it — see
  // useClaudeQuestion.
  const claudeQuestion = useClaudeQuestion({
    hasBridge,
    answer: (payload) => window.iris.answerClaudeQuestion(payload),
  });

  // Listen-only mode — see useListenOnlyMode. Main owns the mode; this only
  // displays it and executes the audio drop.
  const listenOnly = useListenOnlyMode({
    hasBridge,
    applyAudio: (state) => audio.applyListenOnlyState(state),
    outputIsSpeakers,
  });

  function toggleListenOnly() {
    if (!hasBridge) return;
    window.iris.requestListenOnlyToggle();
  }

  // Comms is revealed while the mode is engaged and restored afterwards
  // (design.md D7). That is the panel's behavior, not the mode's, so it is
  // driven from `engaged` here rather than written from inside the mode — the
  // transition-only rule lives in lib/reveal-latch.
  const commsRevealRef = useRef(INITIAL_REVEAL_LATCH);
  useEffect(() => {
    const { latch, open } = revealStep(commsRevealRef.current, listenOnly.engaged, commsOpenRef.current);
    commsRevealRef.current = latch;
    if (open !== null) setCommsOpen(open);
  }, [listenOnly.engaged]);

  // Which reader is open, as one slot — see useReaderSlot. `revision` is the
  // token for the note's content: the editor hands it back on save so main can
  // refuse a write when the file has changed under it.
  const reader = useReaderSlot({
    onNoteClosed: () => {
      if (hasBridge) window.iris.reportNoteClosed();
    },
  });

  // The wake domain (state, listener and its one coupling rule) is
  // useWakeControl — see openspec/changes/decompose-app-orchestrator.
  const wake = useWakeControl({
    hasBridge,
    awake: session.running,
    config: appConfig.config,
    micDeviceId,
    onWake: () => {
      if (!session.running) start();
    },
    onLog: (message) => pushLog("error", message),
    onMicFallback: applyMicDeviceId,
  });

  const { pulses, removePulse, orbFlash, clearOrbFlash, acceptedIds } = useHandoffFx(
    work.tasks,
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

  async function openNoteFromSecondBrain(id: string, title: string) {
    const result = await window.iris.readSecondBrainNote(id);
    if (!result.ok) return;
    // The single-reader invariant is the slot's, not this call site's.
    reader.openNote({ id, title, markdown: result.content, revision: result.revision });
    // open-note-session: main is the single authority on which note is open —
    // the renderer reports every step of this lifecycle to it.
    window.iris.reportNoteOpened(id);
  }

  function exitHud() {
    // Drawing/galaxy are HUD-only (glass-hud-mode design.md D7); hide them
    // before leaving so neither is left mounted the next time the HUD is entered.
    hud.closeLayers();
    window.iris.toggleHud();
  }

  // Updates state + persistence only, with no hot-swap side effect — used both
  // for an explicit user pick (setMicDeviceId below) and to reconcile the
  // selector/persisted value after either mic consumer's auto-fallback to
  // System Default (design.md's "return value, not a callback" decision).
  // The user picked a mic from Settings. The wake listener (via
  // useWakeControl) picks up the new micDeviceId through its own
  // [enabled, deviceId] effect dependency (it only
  // holds a stream while idle, i.e. exactly when a session isn't capturing),
  // so only the useAudioPipeline path needs an explicit hot-swap here — the
  // two consumers are temporally exclusive and never both fire for one change.
  function setMicDeviceId(next: string) {
    applyMicDeviceId(next);
    if (session.running) {
      audio.restartCapture(next).then((active) => {
        if (active && active !== next) applyMicDeviceId(active);
      });
    }
  }

  // Wake/sleep edges: fire the orb's double-pulse and the audio cues.
  // The orb's micro-expressions — see useOrbExpressions.
  const orb = useOrbExpressions({
    awake: session.running,
    inputLevelRef: audio.inputLevelRef,
    audioStateRef: session.audioRef,
  });


  // Claude workstreams and the verb roster keyed to the active one — see
  // useSessions.
  const workstreams = useSessions({ hasBridge, onLog: pushLog });

  // Ambient session capture — see useAmbientCapture.
  const ambient = useAmbientCapture({ hasBridge });

  // Deck ⇄ HUD and the exclusive layer — see useHudMode.
  const hud = useHudMode();

  // Chromium would otherwise navigate this window to a dropped file — see
  // useDropNavigationGuard.
  useDropNavigationGuard();


  // Starting and stopping the session, and the cues that mark each transition
  // — see useSessionLifecycle.
  const { start, stop } = useSessionLifecycle({
    hasBridge,
    running: session.running,
    micDeviceId,
    audio,
    session,
    onLog: pushLog,
    onMicFallback: applyMicDeviceId,
    onSessionStopped: () => setHandControlTransient(false),
    onWake: () => {
      orb.wake();
      if (soundsRef.current) uiSounds.wake();
    },
    onSleep: () => {
      orb.sleep();
      if (soundsRef.current) uiSounds.sleep();
    },
  });

  const sidecarHandlerRef = useRef(handleSidecarEvent);
  useEffect(() => {
    sidecarHandlerRef.current = handleSidecarEvent;
  });

  // Everything the renderer subscribes to from main — see useIrisSubscriptions.
  useIrisSubscriptions({
    hasBridge,
    sidecarHandlerRef,
    session,
    applySessions: workstreams.apply,
    applyReviewMode: review.applyMode,
    setPipelineAvailable,
    setSecondBrainAvailable,
    onAudioChunk: (chunk) => audio.playGeminiAudio(chunk as never),
    onAudioInterrupt: () => audio.flushPlayback(),
    onSleep: stop,
    onWake: start,
    applyHudMode: hud.applyMode,
    openNoteFromSecondBrain,
    openSecondBrain: hud.openSecondBrain,
  });


  useEffect(() => {
    document.documentElement.classList.toggle("hud-mode", hud.mode === "hud");
  }, [hud.mode]);

  // HUD click-through: the window ignores the mouse except over `.hud-hit`
  // elements — see useHudClickThrough.
  useHudClickThrough({
    hasBridge,
    hudMode: hud.mode,
    layerActive: hud.secondBrainActive || hud.drawingActive,
  });


  // Esc force-closes the second brain regardless of its internal state
  // (second-brain-layer, "The second-brain vault is shown as an exclusive HUD
  // layer") — a crashed WebGL layer (caught by
  // VaultGalaxy's own error boundary, which also force-closes) must not be
  // the only way out of the fullscreen click-through-disabled overlay.
  useEscapeToClose(hud.secondBrainActive, hud.closeSecondBrain);

  // The same escape hatch for the drawing surface (the-canvas-stops-fighting-
  // back, task 3.4), with the two differences useEscapeToClose names: capture
  // phase, because excalidraw can stop the event before it bubbles; and
  // standing down while excalidraw's own dialog owns Escape.
  useEscapeToClose(hud.drawingActive, hud.closeDrawing, {
    capture: true,
    standDown: () => Boolean(document.querySelector(".excalidraw-modal-container")),
  });

  // The note reader's existence is derived from hud.secondBrainActive at the
  // render call site below (`hud.secondBrainActive && reader.note`), which closes
  // the openNoteFromSecondBrain await race — but that only suppresses rendering,
  // leaving `reader.note` set. Without also clearing it here, toggling the
  // galaxy back on would pop the stale reader open again over a freshly-
  // loading graph (second-brain-gesture-nav design.md D7 — ship both).
  useEffect(() => {
    if (!hud.secondBrainActive) reader.closeNote();
  }, [hud.secondBrainActive]);



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
    () => work.tasks.some((task) => !TERMINAL.has(task.status.toLowerCase())),
    [work.tasks],
  );

  // The boot intro and the boot-done report — see useBootGate.
  useBootGate({
    running: session.running,
    connected: session.gemini === "connected",
    hasBridge,
    onBootingChange: session.setBooting,
  });

  // The two facts every WebGL surface's pause decision is made from; which of
  // them a given surface honours lives in src/lib/orb-frameloop.ts.
  const surfaceActivity = useMemo(
    () => ({ awake: session.running, windowFocused: session.focused }),
    [session.running, session.focused],
  );

  const reactorState = useMemo(
    () =>
      resolveReactorState({
        running: session.running,
        listenOnlyEngaged: listenOnly.engaged,
        audioState: session.audio,
        working,
        geminiStatus: session.gemini,
      }),
    [session.audio, session.gemini, listenOnly.engaged, session.running, working],
  );

  async function sendContextSupplement(text: string) {
    if (!hasBridge) return;
    pushTranscript("you", text);
    const result = await window.iris.sendContextSupplement(text);
    if (result.status === "error") {
      pushLog("error", result.error ?? "Could not send that to Iris.");
    }
  }


  // The verb-selection handler is gone with the chip that called it. Choosing
  // what kind of work a request is belongs to Iris, which is the component that
  // actually heard the request — a control here could only ever disagree with
  // it, and did.
  async function setVerbModelChoice(verb: Verb, model: string) {
    if (!hasBridge || !workstreams.activeId) return;
    review.openModelPopover(null);
    const result = await window.iris.setVerbModel(workstreams.activeId, verb, model);
    if (result.status === "error") {
      pushLog("error", result.error ?? "Could not change the model.");
      return;
    }
    workstreams.refreshVerbs();
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


  // Every sidecar event routes to whichever domain owns it — see
  // lib/sidecar-router.ts, where the routing is tested against fakes.
  function handleSidecarEvent(event: SidecarEvent) {
    routeSidecarEvent(event, {
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
    });
  }


  function dotState(value: string, goodValues: string[]) {
    if (!session.running) return "off";
    if (value === "error") return "err";
    return goodValues.includes(value) ? "on" : "warn";
  }

  const expandedTask = useMemo(() => work.tasks.find((task) => task.id === reader.taskId) ?? null, [work.tasks, reader.taskId]);

  const { state: hand, stateRef: liveHandRef, error: handError, stream: handStream } = useHandControl(
    handControl,
    cameraDeviceId,
  );

  // The hand-driven gesture loops — see useHandGestures. They also own the two
  // orb drive refs, which are written every frame and never rendered.
  const gestures = useHandGestures({
    handControl,
    liveHandRef,
    readerOpen: reader.isOpen,
    drawingActive: hud.drawingActive,
    secondBrainActive: hud.secondBrainActive,
    showHistory: work.showHistory,
    uiMode: hud.mode,
    onFocusTask: work.focus,
  });
  const { orbRotationRef, orbScaleRef } = gestures;

  // eye-tracking-hud: decorative only, and deliberately called HERE rather
  // than inside either camera component. The deck and the HUD are mutually
  // exclusive, so a component-level hook would tear down and re-create
  // FaceLandmarker on every mode switch; at App level it takes the stream
  // useHandControl already opened (no second getUserMedia, no second
  // permission prompt) and survives the switch untouched. Gated by the same
  // handControl boolean as everything else — no new toggle, no new preference.
  const { state: eye, stateRef: liveEyeRef } = useEyeTracking(handStream, handControl);

  // The readout panel's host measurements, on the same gate and here for the
  // same reason: EyeReadout mounts in BOTH camera surfaces and unmounts on every
  // face loss, so subscribing inside it would open two subscriptions and thrash
  // the sampler on every blink. Gated on the camera rather than on a face being
  // present — presence flickers by design, and the sampler needs a second of
  // observation before it can report a rate at all.
  const { sampleRef: liveTelemetryRef } = useSystemTelemetry(handControl);

  // The token account (token-accounting), here for the same "called once, read
  // by both surfaces" reason — but deliberately NOT gated on handControl.
  // Counting runs in main from app start whether or not anything is displaying
  // it, and subscribing only while the camera was on would show a panel opened
  // late an apparent fresh start.
  const { ledgerRef: liveTokenLedgerRef, alertSeenRef: tokenAlertSeenRef } = useTokenLedger();

  useEffect(() => {
    if (handError) pushLog("error", `Hand control: ${handError}`);
  }, [handError]);


  // Single authoritative context for the indicator (second-brain-gesture-nav
  // design.md D9/D10) — reader outranks the second brain, which outranks the deck.
  const gestureContext = useMemo(
    () =>
      resolveGestureContext({
        readerOpen: reader.isOpen,
        secondBrainActive: hud.secondBrainActive,
        drawingActive: hud.drawingActive,
        historyOpen: work.showHistory,
      }),
    [reader.isOpen, hud.secondBrainActive, hud.drawingActive, work.showHistory],
  );

  // The decision table itself is `handActionFor` in lib/gesture-label.ts,
  // where the mirroring of galaxy-nav's and ReaderCore's bindings is tested.
  const handAction = useMemo(
    () => handActionFor(hand, gestureContext, { drawingActive: hud.drawingActive, uiMode: hud.mode, dwellActive: gestures.dwellActive }),
    [hand, gestureContext, hud.drawingActive, hud.mode, gestures.dwellActive],
  );

  const activeProject = workstreams.active?.cwd ?? null;

  function openTaskByQuery(query?: string) {
    // The clear-winner margin and the banner-precedence rule are
    // `resolveTaskQuery` in lib/ui-actions.ts, where both are tested.
    const outcome = resolveTaskQuery(
      findTaskMatches(work.sorted, query),
      query,
      Boolean(claudeQuestion.pending || review.pending),
    );
    if (outcome.kind === "open") openTask(outcome.task);
    else if (outcome.kind === "choose") work.setChooser({ query: outcome.query, matches: outcome.matches });
  }

  // Voice-driven UI context (design.md D1, spec voice-ui-control): throttled by
  // React batching a snapshot after every relevant state change, mirroring
  // upstream's sendUiContext effect.
  useEffect(() => {
    if (!hasBridge) return;
    // The projection is `buildUiContext` in lib/ui-actions.ts, where the
    // model-facing field contract is tested.
    window.iris.sendUiContext(
      buildUiContext({
        expandedTaskId: reader.taskId,
        focusedTaskId: work.focusedId,
        latestResult: work.latestResult,
        chooserMatches: work.chooser?.matches ?? [],
        showHistory: work.showHistory,
        sorted: work.sorted,
        stepsOpen: work.stepsOpen,
        uiMode: hud.mode,
      }),
    );
  }, [
    hasBridge,
    reader.taskId,
    work.focusedId,
    work.latestResult?.id,
    work.showHistory,
    work.sorted,
    work.stepsOpen,
    work.chooser,
    hud.mode,
  ]);

  // Gemini's control_ui tool forwards here over iris:ui-action. Suppressed
  // implicitly for disambiguation purposes while a question is pending: the
  // question banner already occupies the "answer by voice" surface, and Iris's own
  // system prompt is told not to issue open_task_by_query in that state — see
  // design.md D2 and specs/voice-ui-control's question-precedence requirement.
  useEffect(() => {
    if (!hasBridge) return;
    return window.iris.onUiAction(({ action, target_id, query }) => {
      // Which task an action refers to — and the two different fallback chains
      // — are in lib/ui-actions.ts, where they are tested.
      const byId = target_id ? (work.tasks.find((task) => task.id === target_id) ?? null) : null;
      const current = reader.taskId ? (work.tasks.find((task) => task.id === reader.taskId) ?? null) : null;
      const focused = work.focusedId ? (work.tasks.find((task) => task.id === work.focusedId) ?? null) : null;
      applyUiAction(
        action,
        query,
        { byId, current, focused, latestResult: work.latestResult },
        work.tasks,
        work.sorted,
        {
          openTask,
          openTaskByQuery,
          closeReader,
          setShowHistory: work.setShowHistory,
          setChooser: work.setChooser,
          setStepsOpen: work.setStepsOpen,
        },
      );
    });
  }, [hasBridge, work.tasks, work.sorted, reader.taskId, work.focusedId, work.latestResult, claudeQuestion.pending, review.pending]);

  // The precedence order is `resolveCaption` in lib/caption.ts, where it is
  // tested; this only gathers the inputs.
  const caption = useMemo(
    () =>
      resolveCaption({
        sidecarRunning: session.running,
        wakeWordEnabled: wake.enabled,
        wakeFailed: wake.failed,
        wakeHotkey: appConfig.config?.wakeHotkey ?? "",
        listenOnlyEngaged: listenOnly.engaged,
        heardLive: listenOnly.heardLive,
        audioState: session.audio,
        working,
        lastTranscriptText: transcript[transcript.length - 1]?.text ?? null,
        geminiStatus: session.gemini,
      }),
    [
      session.running,
      session.audio,
      working,
      transcript,
      listenOnly.engaged,
      listenOnly.heardLive,
      session.gemini,
      wake.enabled,
      wake.failed,
      appConfig.config?.wakeHotkey,
    ],
  );

  function openTask(task: TaskCard) {
    if (!(task.output || task.error)) return;
    work.setChooser(null);
    work.setShowHistory(false);
    // Opening the task reader closes the note reader — the slot enforces it.
    reader.openTask(task.id);
    window.iris.reportNoteClosed();
  }

  function closeReader() {
    reader.closeTask();
  }

  const audioDot = resolveAudioDot({ sidecarRunning: session.running, muted: audio.muted, audioState: session.audio });

  return (
    <>
      {hud.mode === "hud" ? (
        <HudShell
          reactorState={reactorState}
          inputLevelRef={audio.inputLevelRef}
          outputLevelRef={audio.outputLevelRef}
          thinking={orb.thinking}
          wakeKey={orb.wakeKey}
          rippleKey={orb.rippleKey}
          running={surfaceAdvancesFrames("hud-orb", surfaceActivity)}
          orbRotationRef={orbRotationRef}
          orbScaleRef={orbScaleRef}
          orbStageRef={orbStageRef}
          orbFlash={orbFlash}
          onOrbFlashEnd={clearOrbFlash}
          awake={session.running}
          caption={caption.text}
          captionDim={caption.dim}
          wakeWordEnabled={wake.enabled}
          muted={audio.muted}
          onToggleMute={audio.toggleMute}
          listenOnlyEngaged={listenOnly.engaged}
          systemAudioState={audio.systemAudioState}
          onToggleListenOnly={toggleListenOnly}
          ambientCaptureLive={ambient.live}
          onStopAmbientCapture={ambient.stop}
          commsOpen={commsOpen}
          onToggleComms={() => setCommsOpen((current) => !current)}
          onWake={start}
          onSleep={stop}
          onExitHud={exitHud}
          tasks={work.sorted}
          acceptedIds={acceptedIds}
          stepsOpenIds={work.stepsOpen}
          workScrollRef={workScrollRef}
          onToggleSteps={work.toggleSteps}
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
          telemetryRef={liveTelemetryRef}
          ledgerRef={liveTokenLedgerRef}
          alertSeenRef={tokenAlertSeenRef}
          logs={logs}
          handStream={handStream}
          handActionLabel={handAction.label}
          handActionTone={handAction.tone}
          cameraEnlarged={hudCameraEnlarged}
          onToggleCameraSize={toggleHudCameraSize}
          pipelineAvailable={pipelineAvailable}
          claudeQuestion={
            claudeQuestion.pending
              ? {
                  questions: claudeQuestion.pending.questions,
                  answers: claudeQuestion.answers,
                  onPick: claudeQuestion.pick,
                  onSubmit: () => claudeQuestion.submit(),
                }
              : null
          }
          taskReview={
            review.pending ? { review: review.pending, onApprove: review.approve, onCancel: review.cancel } : null
          }
          drawingActive={hud.drawingActive}
          onToggleDrawing={hud.toggleDrawing}
          secondBrainAvailable={secondBrainAvailable}
          secondBrainActive={hud.secondBrainActive}
          onToggleSecondBrain={hud.toggleSecondBrain}
          secondBrainPositionsRef={secondBrainPositionsRef}
          onOpenNote={openNoteFromSecondBrain}
          onForceCloseSecondBrain={() => hud.closeSecondBrain()}
          readerOpen={reader.isOpen}
          webglHighFidelity={webglHighFidelity}
        />
      ) : (
      <div
        className={`deck ${session.running ? "awake" : "asleep"} ${
          hud.transition === "to-hud" ? "deck-leaving" : ""
        } ${hud.transition === "to-deck" ? "deck-entering" : ""}`}
      >
        <div className="hud-nebula" />
        <div className="hud-glow" />
        {webglSettings.backdrop.mount ? (
          <HoloBackdrop running={surfaceAdvancesFrames("backdrop", surfaceActivity)} />
        ) : null}

        <TopBar
          geminiDot={dotState(session.gemini, ["connected"])}
          claudeDot={dotState(session.claude, ["ready"])}
          audioDot={audioDot}
          linked={session.running}
          pid={session.pid}
          handControl={handControl}
          onToggleHand={toggleHand}
          onOpenSettings={appConfig.openSettings}
        />

        <div className={`deck-body ${pipelineAvailable ? "" : "chat-only"}`}>
          {/* LEFT — You */}
          <div className="deck-left">
            <CommsPanel
              transcript={transcript}
              scrollRef={commsScrollRef}
              awake={session.running}
              onSendSupplement={sendContextSupplement}
            />
            <CameraDock
              handControl={handControl}
              hand={hand}
              handRef={liveHandRef}
              eye={eye}
              eyeRef={liveEyeRef}
              telemetryRef={liveTelemetryRef}
              ledgerRef={liveTokenLedgerRef}
              alertSeenRef={tokenAlertSeenRef}
              logs={logs}
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
            thinking={orb.thinking}
            wakeKey={orb.wakeKey}
            rippleKey={orb.rippleKey}
            orbRunning={surfaceAdvancesFrames("deck-orb", surfaceActivity)}
            orbRotationRef={orbRotationRef}
            orbScaleRef={orbScaleRef}
            orbStageRef={orbStageRef}
            orbFlash={orbFlash}
            onOrbFlashEnd={clearOrbFlash}
            awake={session.running}
            geminiStatus={session.gemini}
            claudeStatus={session.claude}
            runs={work.tasks.length}
            sessionStartRef={audio.sessionStartRef}
            caption={caption.text}
            captionDim={caption.dim}
            muted={audio.muted}
            onToggleMute={audio.toggleMute}
            listenOnlyEngaged={listenOnly.engaged}
            systemAudioState={audio.systemAudioState}
            onToggleListenOnly={toggleListenOnly}
            ambientCaptureLive={ambient.live}
            onStopAmbientCapture={ambient.stop}
            onSleep={stop}
            wakeHotkey={appConfig.config?.wakeHotkey ?? ""}
            sleepHotkey={appConfig.config?.sleepHotkey ?? ""}
            webglHighFidelity={webglHighFidelity}
          />

          {/* RIGHT — Work (pipeline-only, see pipeline-availability spec) */}
          {pipelineAvailable ? (
            <WorkStream
              tasks={work.tasks}
              sortedTasks={work.sorted}
              scrollRef={workScrollRef}
              acceptedIds={acceptedIds}
              session={workstreams.active}
              sessions={workstreams.sessions}
              onSwitchSession={workstreams.choose}
              onNewSession={workstreams.create}
              onShowHistory={() => work.setShowHistory(true)}
              onOpenTask={openTask}
              stepsOpenIds={work.stepsOpen}
              onToggleTaskSteps={work.toggleSteps}
            >
              <PipelineBar
                verbs={workstreams.verbs}
                lastVerb={workstreams.lastVerb}
                modelPopoverVerb={review.modelPopoverVerb}
                reviewMode={review.mode}
                onToggleModelPopover={review.toggleModelPopover}
                onSetVerbModel={setVerbModelChoice}
                onSetReviewMode={review.setMode}
              />
              <ProjectBar project={activeProject} onChoose={workstreams.chooseProjectFolder} />
              {claudeQuestion.pending ? (
                <ClaudeQuestionBanner
                  questions={claudeQuestion.pending.questions}
                  answers={claudeQuestion.answers}
                  onPick={claudeQuestion.pick}
                  onSubmit={() => claudeQuestion.submit()}
                />
              ) : null}
              {review.pending ? (
                <ReviewBanner review={review.pending} onApprove={review.approve} onCancel={review.cancel} />
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

        {session.booting ? <BootSequence visible={session.booting} /> : null}
      </div>
      )}

      {expandedTask ? (
        <ReaderOverlay task={expandedTask} hand={handControl ? hand : null} handRef={liveHandRef} onClose={closeReader} />
      ) : null}

      {hud.secondBrainActive && reader.note ? (
        <NoteReader
          noteId={reader.note.id}
          title={reader.note.title}
          markdown={reader.note.markdown}
          revision={reader.note.revision}
          hand={handControl ? hand : null}
          handRef={liveHandRef}
          onClose={reader.closeNote}
          onSaved={reader.noteSaved}
        />
      ) : null}

      {work.showHistory ? (
        <HistoryDrawer
          tasks={work.sorted}
          onOpen={openTask}
          onClose={() => work.setShowHistory(false)}
          stepsOpenIds={work.stepsOpen}
          onToggleTaskSteps={work.toggleSteps}
        />
      ) : null}

      {work.chooser && pipelineAvailable ? (
        <TaskChooser
          query={work.chooser.query}
          matches={work.chooser.matches}
          onOpen={openTask}
          onClose={() => work.setChooser(null)}
        />
      ) : null}

      {appConfig.setup && appConfig.config ? (
        <SetupPanel
          mode={appConfig.setup.mode}
          config={appConfig.config}
          soundsEnabled={soundsEnabled}
          onToggleSounds={toggleSounds}
          webglHighFidelity={webglHighFidelity}
          onToggleWebglQuality={toggleWebglQuality}
          ambientCaptureEnabled={ambient.enabled}
          onToggleAmbientCapture={ambient.toggle}
          ambientCaptureForcedOff={ambient.forcedOff}
          cameraDeviceId={cameraDeviceId}
          onChangeCameraDevice={setCameraDeviceId}
          micDeviceId={micDeviceId}
          onChangeMicDevice={setMicDeviceId}
          onClose={() => appConfig.closeSetup()}
          onSaved={appConfig.applyConfig}
          onStart={() => {
            if (!session.running) start();
          }}
          onRunWizard={appConfig.openWizard}
        />
      ) : null}

      <HandoffLayer pulses={pulses} onPulseEnd={removePulse} />

      {handControl && hand.present ? (
        <HandReticles hand={hand} handRef={liveHandRef} dwelling={gestures.dwellActive && !gestures.dwellFired} />
      ) : null}

      <ListenOnlyNotice
        kind={listenOnly.notice}
        tool={listenOnly.refusedTool}
        deadlineAt={listenOnly.deadline}
        onDismiss={listenOnly.dismissNotice}
      />
    </>
  );
}
