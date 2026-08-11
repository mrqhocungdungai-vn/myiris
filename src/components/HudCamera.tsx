import { useEffect, useRef, useState } from "react";
import { HandSkeleton } from "./CameraDock";
import EyeReticle from "./EyeReticle";
import EyeReadout from "./EyeReadout";
import EyeTokenAlert from "./EyeTokenAlert";
import CameraLog from "./CameraLog";
import type { TokenAlertSeenRef, TokenLedgerRef } from "../hooks/useTokenLedger";
import type { LogLine } from "../types";
import type { HandState } from "../hooks/useHandControl";
import type { EyeState } from "../hooks/useEyeTracking";
import { createAlertState, createReadoutLayout } from "../lib/eye-hud";
import { formatRecStamp } from "../lib/rec-clock";

// The HUD's camera frame — the live preview with the hand skeleton, the eye
// reticle and readout, the token alert, the activity strip and the REC stamp
// painted over it.
//
// Split out of HudShell.tsx, which was 668 lines against a 250-450 convention.
// This is the one part of that file with state and effects of its own (the REC
// clock ticks here), so it is a component in its own right rather than a block
// of the shell's JSX — everything else in HudShell reads from props.

export default function HudCamera({
  stream,
  hand,
  handRef,
  eye,
  eyeRef,
  telemetryRef,
  ledgerRef,
  alertSeenRef,
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
  /** token-accounting: the app's own spend, on its own channel and never gated on the camera. */
  ledgerRef: TokenLedgerRef;
  /** Which completed run has already been announced beside the ring. */
  alertSeenRef: TokenAlertSeenRef;
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
  // Per-surface too, and for the same reason: the reticle resolves the
  // announcement's position and the badge reads it within the same frame.
  const alertLayoutRef = useRef(createAlertState());

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
        <EyeReticle
          eye={eye}
          eyeRef={eyeRef}
          telemetryRef={telemetryRef}
          ledgerRef={ledgerRef}
          alertSeenRef={alertSeenRef}
          layoutRef={readoutLayoutRef}
          alertRef={alertLayoutRef}
        />
        <EyeReadout
          eye={eye}
          eyeRef={eyeRef}
          telemetryRef={telemetryRef}
          ledgerRef={ledgerRef}
          layoutRef={readoutLayoutRef}
        />
        {/* The same element in every surface that shows the camera preview,
            never specialized per surface: its size follows the frame, like
            every other overlay here. */}
        <EyeTokenAlert eye={eye} eyeRef={eyeRef} alertRef={alertLayoutRef} />
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
