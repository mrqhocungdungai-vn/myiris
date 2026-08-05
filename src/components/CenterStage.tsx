import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { Headphones, HeadphoneOff, Mic, MicOff, Power, Radio } from "lucide-react";
import ReactorCore, { ORB_ACCENT, ORB_ENERGY } from "./ReactorCore";
import type { HandoffTone, ReactorState } from "../types";

function Telemetry({
  awake,
  gemini,
  claude,
  runs,
  sessionStartRef,
}: {
  awake: boolean;
  gemini: string;
  claude: string;
  runs: number;
  sessionStartRef: { current: number | null };
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = awake && sessionStartRef.current ? Date.now() - sessionStartRef.current : 0;
  const mm = String(Math.floor(elapsed / 60000)).padStart(2, "0");
  const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0");

  return (
    <div className={`telemetry ${awake ? "live" : ""}`} aria-hidden="true">
      <span>
        <i>UPLINK</i>
        {gemini === "connected" ? "LIVE" : awake ? "SYNC" : "OFFLINE"}
      </span>
      <span className="sep">/</span>
      <span>
        <i>CLAUDE</i>
        {claude === "ready" ? "READY" : awake ? "···" : "—"}
      </span>
      <span className="sep">/</span>
      <span>
        <i>RUNS</i>
        {String(runs).padStart(2, "0")}
      </span>
      <span className="sep">/</span>
      <span>
        <i>SESSION</i>
        {mm}:{ss}
      </span>
    </div>
  );
}

export default function CenterStage({
  reactorState,
  inputLevelRef,
  outputLevelRef,
  thinking,
  wakeKey,
  rippleKey,
  orbRunning,
  orbRotationRef,
  orbScaleRef,
  orbStageRef,
  orbFlash,
  onOrbFlashEnd,
  awake,
  geminiStatus,
  claudeStatus,
  runs,
  sessionStartRef,
  caption,
  captionDim,
  muted,
  onToggleMute,
  listenOnlyEngaged,
  onToggleListenOnly,
  ambientCaptureLive,
  onStopAmbientCapture,
  onSleep,
  webglHighFidelity,
}: {
  reactorState: ReactorState;
  inputLevelRef: { current: number };
  outputLevelRef: { current: number };
  thinking: boolean;
  wakeKey: number;
  rippleKey: number;
  /** Pauses the orb's WebGL render loop (0 GPU) while false; resumes without state loss. */
  orbRunning?: boolean;
  /** Gesture-driven orb rotation (radians), read every frame — not React state. */
  orbRotationRef?: { current: { x: number; y: number } };
  /** Gesture-driven orb scale, read every frame — not React state. */
  orbScaleRef?: { current: number };
  orbStageRef: RefObject<HTMLDivElement | null>;
  orbFlash: { id: string; tone: HandoffTone } | null;
  onOrbFlashEnd: () => void;
  awake: boolean;
  geminiStatus: string;
  claudeStatus: string;
  runs: number;
  sessionStartRef: { current: number | null };
  caption: string;
  captionDim: boolean;
  muted: boolean;
  onToggleMute: () => void;
  // Listen-only mode's only affordance (replace-listening-mode-with-listen-only
  // design.md D3): pure display of main-owned state, toggled by request only.
  listenOnlyEngaged: boolean;
  onToggleListenOnly: () => void;
  // ambient-memory (design D7): shown only while retention is actually
  // live — never a settings mirror — with its own stop affordance so
  // stopping never requires opening Settings.
  ambientCaptureLive: boolean;
  onStopAmbientCapture: () => void;
  onSleep: () => void;
  /** webgl-quality-mode: high-fidelity path (bloom) vs the light-path default. */
  webglHighFidelity: boolean;
}) {
  return (
    <div className="deck-center">
      <div
        className="orb-stage"
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
          running={orbRunning}
          rotationRef={orbRotationRef}
          scaleRef={orbScaleRef}
          highFidelity={webglHighFidelity}
        />
        {orbFlash ? (
          <span key={orbFlash.id} className={`orb-flash ${orbFlash.tone}`} onAnimationEnd={onOrbFlashEnd} />
        ) : null}
      </div>
      <Telemetry awake={awake} gemini={geminiStatus} claude={claudeStatus} runs={runs} sessionStartRef={sessionStartRef} />
      <div className={`caption ${captionDim ? "dim" : ""}`}>
        {caption}
        {awake ? <span className="caption-caret" /> : null}
      </div>
      {awake ? (
        <div className="transport">
          <button
            className={`t-btn small ${muted ? "muted" : ""}`}
            onClick={onToggleMute}
            title={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            className={`t-btn small ${listenOnlyEngaged ? "" : "muted"}`}
            onClick={onToggleListenOnly}
            title={listenOnlyEngaged ? "Disable listen-only mode" : "Enable listen-only mode"}
          >
            {listenOnlyEngaged ? <Headphones size={18} /> : <HeadphoneOff size={18} />}
          </button>
          {ambientCaptureLive ? (
            <button
              className="t-btn small ambient-live"
              onClick={onStopAmbientCapture}
              title="Recording this conversation to your notes — click to stop"
            >
              <Radio size={18} />
            </button>
          ) : null}
          <button className="t-btn small danger" onClick={onSleep} title="Sleep (S)">
            <Power size={18} />
          </button>
        </div>
      ) : (
        <div className="transport-hint">
          <span className="key">W</span> wake · <span className="key">S</span> sleep
        </div>
      )}
    </div>
  );
}
