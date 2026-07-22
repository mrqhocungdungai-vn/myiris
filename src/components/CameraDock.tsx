import { useEffect, useRef } from "react";
import { Camera } from "lucide-react";
import type { HandState } from "../hooks/useHandControl";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
] as const;

// Renders the skeleton for up to 2 tracked hands (numHands: 2). `hands`
// (React state, semantically gated) decides how many hands/landmarks mount;
// `handsRef` (per-frame ref) drives every line/circle's position each rAF via
// direct attribute writes, so a moving hand never re-renders the app.
export function HandSkeleton({
  hands,
  handsRef,
}: {
  hands: HandState["hands"];
  handsRef: { current: HandState };
}) {
  const lineRefs = useRef<Array<Array<SVGLineElement | null>>>([[], []]);
  const circleRefs = useRef<Array<Array<SVGCircleElement | null>>>([[], []]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const liveHands = handsRef.current.hands;
      liveHands.forEach((hand, handIndex) => {
        const lines = lineRefs.current[handIndex];
        const circles = circleRefs.current[handIndex];
        HAND_CONNECTIONS.forEach(([from, to], i) => {
          const line = lines?.[i];
          const a = hand.landmarks[from];
          const b = hand.landmarks[to];
          if (line && a && b) {
            line.setAttribute("x1", String(a.x * 100));
            line.setAttribute("y1", String(a.y * 100));
            line.setAttribute("x2", String(b.x * 100));
            line.setAttribute("y2", String(b.y * 100));
          }
        });
        hand.landmarks.forEach((landmark, i) => {
          const circle = circles?.[i];
          if (circle) {
            circle.setAttribute("cx", String(landmark.x * 100));
            circle.setAttribute("cy", String(landmark.y * 100));
          }
        });
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handsRef]);

  if (!hands.length) return null;
  return (
    <svg className="hand-skeleton" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {hands.map((hand, handIndex) => (
        <g key={hand.id} className={handIndex > 0 ? "secondary" : ""}>
          {HAND_CONNECTIONS.map(([from, to], i) => {
            const a = hand.landmarks[from];
            const b = hand.landmarks[to];
            if (!a || !b) return null;
            return (
              <line
                key={`${from}-${to}`}
                ref={(el) => {
                  lineRefs.current[handIndex][i] = el;
                }}
                x1={a.x * 100}
                y1={a.y * 100}
                x2={b.x * 100}
                y2={b.y * 100}
              />
            );
          })}
          {hand.landmarks.map((landmark, index) => (
            <circle
              key={index}
              ref={(el) => {
                circleRefs.current[handIndex][index] = el;
              }}
              cx={landmark.x * 100}
              cy={landmark.y * 100}
              r={index === 8 ? 1.45 : 1.05}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

export default function CameraDock({
  handControl,
  hand,
  handRef,
  stream,
  actionLabel,
  actionTone,
}: {
  handControl: boolean;
  hand: HandState;
  /** Per-frame hand data (useHandControl's stateRef) — feeds the skeleton overlay. */
  handRef: { current: HandState };
  stream: MediaStream | null;
  actionLabel: string;
  actionTone: string;
}) {
  // Owns its own srcObject assignment so the feed survives remounts (e.g.
  // returning from HUD mode re-creates this video element).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, handControl]);
  return (
    <section className={`deck-panel camera-dock ${handControl ? "" : "off"}`}>
      <div className="col-head">
        <Camera size={13} />
        <span>Camera / Gesture</span>
        {!handControl ? <span className="head-state">off</span> : null}
      </div>
      {handControl ? (
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
      ) : (
        <div className="camera-off">Gesture control is off. Tap the hand icon to enable the camera.</div>
      )}
    </section>
  );
}
