import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ChevronDown, Hand, Maximize2, MessageSquare, Mic, MicOff, Power, Terminal } from "lucide-react";
import ReactorCore from "./ReactorCore";
import WorkCard from "./WorkCard";
import PoQuestionBanner from "./PoQuestionBanner";
import ReviewBanner from "./ReviewBanner";
import ContextSupplementInput from "./ContextSupplementInput";
import { HandSkeleton } from "./CameraDock";
import type { HandoffTone, ReactorState, TaskCard, TranscriptLine } from "../types";
import type { HandState } from "../hooks/useHandControl";
import { acceptedKey } from "../lib/tasks";

const ORB_ACCENT: Record<ReactorState, string> = {
  idle: "120, 170, 150",
  online: "18, 163, 148",
  listening: "40, 205, 170",
  speaking: "238, 122, 92",
  working: "120, 180, 120",
};

function HudCamera({
  stream,
  hand,
  handRef,
  actionLabel,
  actionTone,
}: {
  stream: MediaStream | null;
  hand: HandState;
  handRef: { current: HandState };
  actionLabel: string;
  actionTone: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="hud-camera hud-hit">
      <div className="camera-frame">
        <video ref={videoRef} autoPlay playsInline muted />
        <div className="cam-scan" />
        <HandSkeleton hands={hand.hands} handsRef={handRef} />
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
  handStream,
  handActionLabel,
  handActionTone,
  pipelineAvailable,
  poQuestion,
  taskReview,
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
  handStream: MediaStream | null;
  handActionLabel: string;
  handActionTone: string;
  // Pipeline master switch (pipeline-availability spec) — hides the tasks
  // column and PO question banner in chat-only mode.
  pipelineAvailable: boolean;
  // Claude-specific delta vs upstream (design.md D2): a pending PO question
  // must stay answerable (voice, click, or dwell-click) while floating.
  poQuestion: {
    questions: PoQuestion[];
    answers: Record<string, string>;
    onPick: (question: string, choice: string) => void;
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
}) {
  // Show the full stream (state caps at 20); the column has a fixed max height
  // and palm-scrolls like Comms.
  const visibleTasks = tasks;
  const recentTranscript = transcript.slice(-8);
  // Comms is glanceable, not essential — collapsed by default (the caption
  // pill by the orb already shows the latest line). Tasks are the core of the
  // HUD, so they start open but can be tucked away the same way.
  const [commsOpen, setCommsOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(true);

  return (
    <div className={`hud-shell ${awake ? "awake" : "asleep"}`}>
      {/* A pending PO question outranks everything else in the HUD — it stays
          a lit, always-visible island rather than tucked behind a toggle. A
          parked review stacks beneath it (design.md D3) in the same island. */}
      {pipelineAvailable && (poQuestion || taskReview) ? (
        <div className="hud-review-stack hud-hit">
          {poQuestion ? (
            <PoQuestionBanner
              questions={poQuestion.questions}
              answers={poQuestion.answers}
              onPick={poQuestion.onPick}
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
        <div className="hud-right">
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
      <div className="hud-left">
        {recentTranscript.length > 0 ? (
          <>
            <button
              type="button"
              className={`hud-comms-toggle hud-hit ${commsOpen ? "open" : ""}`}
              onClick={() => setCommsOpen((current) => !current)}
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
                    const self = /you|user/i.test(line.speaker);
                    return (
                      <div className={`bubble ${self ? "self" : "iris"}`} key={line.id}>
                        <span className="who">{self ? "You" : "Iris"}</span>
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
          <HudCamera
            stream={handStream}
            hand={hand}
            handRef={handRef}
            actionLabel={handActionLabel}
            actionTone={handActionTone}
          />
        ) : null}
      </div>

      {/* Orb cluster, bottom-right */}
      <div className="hud-orb-cluster hud-hit">
        <div className={`hud-caption ${captionDim ? "dim" : ""}`}>
          {awake ? caption : wakeWordEnabled ? "Say “Hey Iris”" : "Iris is asleep"}
        </div>
        <div
          className="orb-stage hud-orb"
          ref={orbStageRef}
          style={{ "--orb-accent": ORB_ACCENT[reactorState] } as CSSProperties}
        >
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
          <button className="hud-btn" onClick={onExitHud} title="Back to deck (⌥Space)">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
