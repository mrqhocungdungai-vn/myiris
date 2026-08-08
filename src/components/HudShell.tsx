import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  ChevronDown,
  Clock,
  Hand,
  Headphones,
  HeadphoneOff,
  Maximize2,
  MessageSquare,
  Minimize2,
  Mic,
  MicOff,
  Network,
  PenTool,
  Power,
  Radio,
  Terminal,
  XCircle,
} from "lucide-react";
import ReactorCore, { ORB_ACCENT, ORB_ENERGY } from "./ReactorCore";
import { listenOnlyControlTitle, type SystemAudioState } from "../lib/system-audio";
import { transcriptVoice, transcriptVoiceLabel } from "../lib/transcript-speaker";
import WorkCard from "./WorkCard";
import PoQuestionBanner from "./PoQuestionBanner";
import ReviewBanner from "./ReviewBanner";
import ContextSupplementInput from "./ContextSupplementInput";
import { HandSkeleton } from "./CameraDock";
import EyeReticle from "./EyeReticle";
import EyeReadout from "./EyeReadout";
import CameraLog from "./CameraLog";
import DrawingCanvas from "./DrawingCanvas";
import VaultGalaxy, { type GalaxyNode } from "./VaultGalaxy";
import type { HandoffTone, LogLine, ReactorState, TaskCard, TranscriptLine } from "../types";
import type { HandState } from "../hooks/useHandControl";
import type { EyeState } from "../hooks/useEyeTracking";
import { createReadoutLayout } from "../lib/eye-hud";
import { formatRecStamp } from "../lib/rec-clock";
import { acceptedKey } from "../lib/tasks";
import { HUD_CHROME_CLASS } from "../lib/hudChrome";

function HudCamera({
  stream,
  hand,
  handRef,
  eye,
  eyeRef,
  telemetryRef,
  logs,
  actionLabel,
  actionTone,
  enlarged,
  stampOn,
}: {
  stream: MediaStream | null;
  hand: HandState;
  handRef: { current: HandState };
  eye: EyeState;
  eyeRef: { current: EyeState };
  telemetryRef: { current: TelemetrySample };
  logs: LogLine[];
  actionLabel: string;
  actionTone: string;
  /** glass-hud-mode: the camera-size control's state. Standard size is the default. */
  enlarged: boolean;
  /** hud-rec-timestamp: its control sits beside the size control, outside this frame, so the state arrives as a prop. */
  stampOn: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Per-surface, for the same reason as CameraDock's: the eye readout's layout
  // is resolved by the reticle and read by the panel within the same frame.
  const readoutLayoutRef = useRef(createReadoutLayout());

  const [stamp, setStamp] = useState("");

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!stampOn) return;
    // 1 Hz via setInterval, not rAF: nothing here changes per frame, and this
    // thread already carries the WebGL orb and two MediaPipe loops
    // (main-thread-budget, design D4). The tick exists only while the overlay
    // does — the cleanup is the point of the decision, not the frequency.
    const tick = () => setStamp(formatRecStamp(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [stampOn]);

  return (
    <div className={`hud-camera hud-hit ${enlarged ? "enlarged" : ""}`}>
      <div className="camera-frame">
        <video ref={videoRef} autoPlay playsInline muted />
        <div className="cam-scan" />
        <HandSkeleton hands={hand.hands} handsRef={handRef} />
        <EyeReticle eye={eye} eyeRef={eyeRef} telemetryRef={telemetryRef} layoutRef={readoutLayoutRef} />
        <EyeReadout eye={eye} eyeRef={eyeRef} telemetryRef={telemetryRef} layoutRef={readoutLayoutRef} />
        <CameraLog logs={logs} />
        {/* Top-left, the one corner not already taken: `.cam-status` is
            top-right and `.gesture-chip` bottom-left (design D2). The
            RECORDING line and the clock are one block, so an audience reads
            them together as the stamp on the footage. */}
        {stampOn ? (
          <span className="cam-stamp">
            <span className="rec">
              <i />
              RECORDING
            </span>
            <span className="clock">{stamp}</span>
          </span>
        ) : null}
        <span className="cam-status">
          <i />
          {hand.present ? "tracking" : "no hand"}
        </span>
        <span className={`gesture-chip ${actionTone}`}>
          <span className="dot" />
          {actionLabel}
        </span>
      </div>
    </div>
  );
}

/**
 * Glass HUD layout: Iris floating over the whole desktop. Everything is
 * pointer-transparent except elements marked `.hud-hit` — the main process
 * toggles window click-through based on what the pointer is over, so you can
 * keep working in the apps underneath.
 */
export default function HudShell({
  reactorState,
  inputLevelRef,
  outputLevelRef,
  thinking,
  wakeKey,
  rippleKey,
  running,
  orbRotationRef,
  orbScaleRef,
  orbStageRef,
  orbFlash,
  onOrbFlashEnd,
  awake,
  caption,
  captionDim,
  wakeWordEnabled,
  muted,
  onToggleMute,
  listenOnlyEngaged,
  systemAudioState,
  onToggleListenOnly,
  ambientCaptureLive,
  onStopAmbientCapture,
  commsOpen,
  onToggleComms,
  onWake,
  onSleep,
  onExitHud,
  tasks,
  acceptedIds,
  stepsOpenIds,
  workScrollRef,
  onToggleSteps,
  onOpenTask,
  transcript,
  commsScrollRef,
  onSendSupplement,
  handControl,
  onToggleHand,
  hand,
  handRef,
  eye,
  eyeRef,
  telemetryRef,
  logs,
  handStream,
  handActionLabel,
  handActionTone,
  cameraEnlarged,
  onToggleCameraSize,
  pipelineAvailable,
  poQuestion,
  taskReview,
  drawingActive,
  onToggleDrawing,
  secondBrainAvailable,
  secondBrainActive,
  onToggleSecondBrain,
  galaxyPositionsRef,
  onOpenNote,
  onForceCloseSecondBrain,
  readerOpen,
  webglHighFidelity,
}: {
  reactorState: ReactorState;
  inputLevelRef: { current: number };
  outputLevelRef: { current: number };
  thinking: boolean;
  wakeKey: number;
  rippleKey: number;
  /** Pauses the HUD orb's WebGL render loop (0 GPU) while false; resumes without state loss — awake, not focus, per orb-expressions. */
  running: boolean;
  /** Gesture-driven orb rotation (radians), read every frame — not React state. */
  orbRotationRef: { current: { x: number; y: number } };
  /** Gesture-driven orb scale, read every frame — not React state. */
  orbScaleRef: { current: number };
  orbStageRef: RefObject<HTMLDivElement | null>;
  orbFlash: { id: string; tone: HandoffTone } | null;
  onOrbFlashEnd: () => void;
  awake: boolean;
  caption: string;
  captionDim: boolean;
  wakeWordEnabled: boolean;
  muted: boolean;
  onToggleMute: () => void;
  // Listen-only mode's only affordance (replace-listening-mode-with-listen-only
  // design.md D3): pure display of main-owned state, toggled by request only.
  listenOnlyEngaged: boolean;
  /** Whether the mode's system-audio half is actually delivering audio. */
  systemAudioState: SystemAudioState;
  onToggleListenOnly: () => void;
  // ambient-memory (design D7): shown only while retention is actually live.
  ambientCaptureLive: boolean;
  onStopAmbientCapture: () => void;
  // Lifted out of this component's local state (design.md D7) so engaging
  // listen-only mode can force it open, and disengaging can restore it.
  commsOpen: boolean;
  onToggleComms: () => void;
  onWake: () => void;
  onSleep: () => void;
  onExitHud: () => void;
  tasks: TaskCard[];
  acceptedIds: Record<string, number>;
  stepsOpenIds: Record<string, boolean>;
  workScrollRef: RefObject<HTMLDivElement | null>;
  onToggleSteps: (id: string) => void;
  onOpenTask: (task: TaskCard) => void;
  transcript: TranscriptLine[];
  commsScrollRef: RefObject<HTMLDivElement | null>;
  onSendSupplement: (text: string) => void;
  handControl: boolean;
  onToggleHand: () => void;
  hand: HandState;
  /** Per-frame hand data (useHandControl's stateRef) — feeds the HUD camera skeleton. */
  handRef: { current: HandState };
  // eye-tracking-hud: the same pair the deck's camera dock receives — the
  // overlays are not specialized per surface, so both get identical props.
  eye: EyeState;
  eyeRef: { current: EyeState };
  telemetryRef: { current: TelemetrySample };
  /** camera-activity-log: the app's own log store, newest first. */
  logs: LogLine[];
  handStream: MediaStream | null;
  handActionLabel: string;
  handActionTone: string;
  // glass-hud-mode: the camera-size control. HUD mode is both the livestream
  // surface (a bigger face reads better to an audience) and the working
  // overlay (where a big camera costs room), so the size is a control rather
  // than a constant. Owned and persisted in App.tsx; the deck has no such
  // control and is unaffected.
  cameraEnlarged: boolean;
  onToggleCameraSize: () => void;
  // Pipeline master switch (pipeline-availability spec) — hides the tasks
  // column and PO question banner in chat-only mode.
  pipelineAvailable: boolean;
  // Claude-specific delta vs upstream (design.md D2): a pending PO question
  // must stay answerable (voice, click, or dwell-click) while floating.
  poQuestion: {
    questions: PoQuestion[];
    answers: Record<string, string[]>;
    onPick: (question: string, choice: string) => void;
    onSubmit?: () => void;
  } | null;
  // A parked review (prompt-review-gate spec) stacks BENEATH a pending PO
  // question when both are live — the PO question blocks a token-burning
  // run, so it keeps precedence (design.md D3). HUD editing is voice-only
  // (D7), so ReviewBanner renders with editable={false} here.
  taskReview: {
    review: PendingTaskReview;
    onApprove: (editedTask?: string) => void;
    onCancel: () => void;
  } | null;
  // Toggleable excalidraw drawing panel (hud-drawing-canvas) — hidden by
  // default, unmounted when off so its lazy chunk never loads unless opened.
  drawingActive: boolean;
  onToggleDrawing: () => void;
  // second-brain-galaxy-view: the toggle itself is shown only when the vault
  // exists (design.md D7), independent of pipelineAvailable. The galaxy
  // layer is unmounted when off, mirroring the drawing panel.
  secondBrainAvailable: boolean;
  secondBrainActive: boolean;
  onToggleSecondBrain: () => void;
  /** Hoisted above this component in App.tsx (design.md M-3) so toggling off/on rehydrates positions instead of re-scrambling. */
  galaxyPositionsRef: { current: Map<string, GalaxyNode> };
  onOpenNote: (id: string, title: string) => void;
  onForceCloseSecondBrain: () => void;
  // second-brain-gesture-nav design.md D5: `openNote != null || expandedTaskId
  // != null`, computed in App.tsx and forwarded so the galaxy's gesture loop
  // can suppress node-dwell + camera nav while a reader is open.
  readerOpen: boolean;
  /** webgl-quality-mode: high-fidelity path (bloom) vs the light-path default. */
  webglHighFidelity: boolean;
}) {
  // Show the full stream (state caps at 20); the column has a fixed max height
  // and palm-scrolls like Comms.
  const visibleTasks = tasks;
  const recentTranscript = transcript.slice(-8);
  // Comms is glanceable, not essential — collapsed by default (the caption
  // pill by the orb already shows the latest line), and lifted to App.tsx so
  // engaging listen-only mode can force it open (design.md D7). Tasks are the
  // core of the HUD, so they start open but can be tucked away the same way.
  const [workOpen, setWorkOpen] = useState(true);

  // hud-rec-timestamp: owned here because the control sits in this column
  // beside the camera-size button while the stamp it drives renders inside the
  // frame. Deliberately NOT lifted to App.tsx and NOT persisted (design D3) —
  // a REC indicator restored from disk would claim a recording that is not
  // happening. Off on every launch.
  const [stampOn, setStampOn] = useState(false);

  // second-brain-focus: owned here (not lifted to App.tsx) — the chip and the
  // clear control both live in this component's own tree, alongside the
  // galaxy that produces the selection. Mirrors the note-reader-clearing
  // pattern below it: cleared on exactly the terms the galaxy itself goes
  // inactive, so a stale selection never lingers in this local mirror after
  // main's own authoritative copy has already been cleared.
  const [secondBrainFocus, setSecondBrainFocus] = useState<SecondBrainFocusState>({ ids: [], notes: [] });
  useEffect(() => {
    if (!secondBrainActive) setSecondBrainFocus({ ids: [], notes: [] });
  }, [secondBrainActive]);

  async function clearSecondBrainFocus() {
    const result = await window.iris.clearSecondBrainFocus();
    setSecondBrainFocus(result);
  }

  return (
    <div className={`hud-shell ${awake ? "awake" : "asleep"}`}>
      {/* A pending PO question outranks everything else in the HUD — it stays
          a lit, always-visible island rather than tucked behind a toggle. A
          parked review stacks beneath it (design.md D3) in the same island. */}
      {pipelineAvailable && (poQuestion || taskReview) ? (
        <div className={`hud-review-stack hud-hit ${HUD_CHROME_CLASS}`}>
          {poQuestion ? (
            <PoQuestionBanner
              questions={poQuestion.questions}
              answers={poQuestion.answers}
              onPick={poQuestion.onPick}
              onSubmit={poQuestion.onSubmit}
            />
          ) : null}
          {taskReview ? (
            <ReviewBanner
              review={taskReview.review}
              editable={false}
              onApprove={taskReview.onApprove}
              onCancel={taskReview.onCancel}
            />
          ) : null}
        </div>
      ) : null}

      {/* Slim work stream, top-right — collapsible like Comms (pipeline-only) */}
      {pipelineAvailable && visibleTasks.length > 0 ? (
        <div className={`hud-right ${HUD_CHROME_CLASS}`}>
          <button
            type="button"
            className={`hud-comms-toggle hud-hit ${workOpen ? "open" : ""}`}
            onClick={() => setWorkOpen((current) => !current)}
            title={workOpen ? "Collapse tasks" : "Show tasks"}
          >
            <Terminal size={12} />
            Tasks
            <span className="count">{visibleTasks.length}</span>
            <ChevronDown size={12} className="chev" />
          </button>
          {workOpen ? (
            <div className="hud-work hud-hit" ref={workScrollRef}>
              {visibleTasks.map((task) => (
                <WorkCard
                  key={task.id}
                  task={task}
                  accepted={Boolean(acceptedIds[acceptedKey(task.task)])}
                  stepsOpen={Boolean(stepsOpenIds[task.id])}
                  onToggleSteps={() => onToggleSteps(task.id)}
                  onOpen={() => onOpenTask(task)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Left column, bottom-left: collapsible comms on top, camera at the corner */}
      <div className={`hud-left ${HUD_CHROME_CLASS}`}>
        {recentTranscript.length > 0 ? (
          <>
            <button
              type="button"
              className={`hud-comms-toggle hud-hit ${commsOpen ? "open" : ""}`}
              onClick={onToggleComms}
              title={commsOpen ? "Collapse conversation" : "Show conversation"}
            >
              <MessageSquare size={12} />
              Comms
              <span className="count">{recentTranscript.length}</span>
              <ChevronDown size={12} className="chev" />
            </button>
            {commsOpen ? (
              <>
                <div className="hud-comms hud-hit" ref={commsScrollRef}>
                  {recentTranscript.map((line) => {
                    const voice = transcriptVoice(line.speaker);
                    return (
                      <div className={`bubble ${voice}`} key={line.id}>
                        <span className="who">{transcriptVoiceLabel(voice)}</span>
                        {line.text}
                      </div>
                    );
                  })}
                </div>
                <div className="hud-hit">
                  <ContextSupplementInput disabled={!awake} onSubmit={onSendSupplement} />
                </div>
              </>
            ) : null}
          </>
        ) : null}
        {handControl ? (
          <>
            {/* A row of camera controls ABOVE the frame, so they keep
                `.hud-left`'s 300px width and do not move when the frame
                resizes. `.hud-hit` is not optional on either: HUD mode is
                click-through by default, so a control without it cannot be
                clicked at all. */}
            <div className="hud-camera-controls">
              <button
                type="button"
                className={`hud-comms-toggle hud-camera-size hud-hit ${cameraEnlarged ? "open" : ""}`}
                onClick={onToggleCameraSize}
                title={cameraEnlarged ? "Return the camera to its standard size" : "Enlarge the camera for streaming"}
              >
                {cameraEnlarged ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                Cam
                <span className="count">{cameraEnlarged ? "+35%" : "1×"}</span>
              </button>
              {/* hud-rec-timestamp. It wears REC vocabulary because that is
                  what reads as "this footage is timestamped" to an audience —
                  but the app records nothing, and the title says what it
                  actually does. Never label this start/stop recording, and
                  never give it an elapsed timer or a file readout: those are
                  the affordances only a real recorder has (spec: "The
                  recording indicator SHALL NOT imply the app is capturing
                  video"). */}
              <button
                type="button"
                className={`hud-comms-toggle hud-camera-rec hud-hit ${stampOn ? "open" : ""}`}
                onClick={() => setStampOn((current) => !current)}
                title={
                  stampOn
                    ? "Hide the date and time on the camera"
                    : "Show the date and time on the camera (Iris records nothing — this only stamps the picture)"
                }
              >
                <Clock size={12} />
                Rec
                <span className="count">{stampOn ? "on" : "off"}</span>
              </button>
            </div>
            <HudCamera
              stream={handStream}
              hand={hand}
              handRef={handRef}
              eye={eye}
              eyeRef={eyeRef}
              telemetryRef={telemetryRef}
              logs={logs}
              actionLabel={handActionLabel}
              actionTone={handActionTone}
              enlarged={cameraEnlarged}
              stampOn={stampOn}
            />
          </>
        ) : null}
      </div>

      {/* Orb cluster, bottom-right */}
      <div className={`hud-orb-cluster hud-hit ${HUD_CHROME_CLASS}`}>
        <div className={`hud-caption ${captionDim ? "dim" : ""}`}>
          {awake ? caption : wakeWordEnabled ? "Say “Hey Iris”" : "Iris is asleep"}
        </div>
        <div
          className="orb-stage hud-orb"
          ref={orbStageRef}
          style={
            {
              "--orb-accent": ORB_ACCENT[reactorState],
              "--orb-glow-energy": ORB_ENERGY[reactorState],
            } as CSSProperties
          }
        >
          {webglHighFidelity ? null : <span className="orb-glow" aria-hidden="true" />}
          <span className="orb-ring" />
          <span className="orb-radar" />
          <ReactorCore
            state={reactorState}
            inputLevelRef={inputLevelRef}
            outputLevelRef={outputLevelRef}
            thinking={thinking}
            wakeKey={wakeKey}
            rippleKey={rippleKey}
            running={running}
            rotationRef={orbRotationRef}
            scaleRef={orbScaleRef}
            highFidelity={webglHighFidelity}
          />
          {orbFlash ? (
            <span key={orbFlash.id} className={`orb-flash ${orbFlash.tone}`} onAnimationEnd={onOrbFlashEnd} />
          ) : null}
        </div>
        <div className={`hud-controls ${hand.present ? "show" : ""}`}>
          {awake ? (
            <>
              <button
                className={`hud-btn ${muted ? "muted" : ""}`}
                onClick={onToggleMute}
                title={muted ? "Unmute microphone" : "Mute microphone"}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              <button
                className={`hud-btn ${listenOnlyEngaged ? "" : "muted"} ${
                  listenOnlyEngaged && systemAudioState === "degraded" ? "system-audio-degraded" : ""
                }`}
                onClick={onToggleListenOnly}
                title={listenOnlyControlTitle(listenOnlyEngaged, systemAudioState)}
              >
                {listenOnlyEngaged ? <Headphones size={14} /> : <HeadphoneOff size={14} />}
              </button>
              {ambientCaptureLive ? (
                <button
                  className="hud-btn ambient-live"
                  onClick={onStopAmbientCapture}
                  title="Recording this conversation to your notes — click to stop"
                >
                  <Radio size={14} />
                </button>
              ) : null}
              <button className="hud-btn danger" onClick={onSleep} title="Sleep">
                <Power size={14} />
              </button>
            </>
          ) : (
            <button className="hud-btn wake" onClick={onWake} title="Wake Iris">
              <Power size={14} />
            </button>
          )}
          <button
            className={`hud-btn ${handControl ? "active" : ""}`}
            onClick={onToggleHand}
            title={handControl ? "Disable hand control" : "Enable hand control (camera)"}
          >
            <Hand size={14} />
          </button>
          <button
            className={`hud-btn ${drawingActive ? "active" : ""}`}
            onClick={onToggleDrawing}
            title={drawingActive ? "Hide drawing panel" : "Show drawing panel"}
          >
            <PenTool size={14} />
          </button>
          {secondBrainAvailable ? (
            <button
              className={`hud-btn ${secondBrainActive ? "active" : ""}`}
              onClick={onToggleSecondBrain}
              title={secondBrainActive ? "Hide second brain" : "Show second brain"}
            >
              <Network size={14} />
            </button>
          ) : null}
          {/* second-brain-focus 5.2: not [data-no-dwell] — clearing a
              selection is not destructive, so it stays dwell-reachable like
              every other control in this island. */}
          {secondBrainActive && secondBrainFocus.notes.length > 0 ? (
            <button className="hud-btn" onClick={clearSecondBrainFocus} title="Clear focused notes">
              <XCircle size={14} />
            </button>
          ) : null}
          <button className="hud-btn" onClick={onExitHud} title="Back to deck (⌥Space)">
            <Maximize2 size={14} />
          </button>
        </div>
        {/* second-brain-focus 5.1: named so the user can confirm what "these"
            refers to before speaking — shown only while the galaxy is active
            and something is focused. React escapes note.title as ordinary
            text content (never HTML), which is what the galaxy's own
            untrusted-title rule requires here too. */}
        {secondBrainActive && secondBrainFocus.notes.length > 0 ? (
          <div className="hud-focus-chip hud-hit">
            Focused: {secondBrainFocus.notes.map((note) => note.title).join(", ")}
          </div>
        ) : null}
      </div>

      {drawingActive ? <DrawingCanvas /> : null}
      {secondBrainActive ? (
        <VaultGalaxy
          focus={secondBrainFocus}
          onFocusChanged={setSecondBrainFocus}
          running={running}
          positionsRef={galaxyPositionsRef}
          onOpenNote={onOpenNote}
          onForceClose={onForceCloseSecondBrain}
          handRef={handRef}
          handControl={handControl}
          readerOpen={readerOpen}
          highFidelity={webglHighFidelity}
        />
      ) : null}
    </div>
  );
}
