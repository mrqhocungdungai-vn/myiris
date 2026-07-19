import { type CSSProperties } from "react";
import type { Pulse } from "../types";

// Purely decorative layer: comets that fly between the orb and the Work Stream
// when Gemini delegates to Claude and when a run completes.
export default function HandoffLayer({
  pulses,
  onPulseEnd,
}: {
  pulses: Pulse[];
  onPulseEnd: (id: string) => void;
}) {
  return (
    <div className="handoff-layer" aria-hidden="true">
      {pulses.map((pulse) => (
        <span
          key={pulse.id}
          className={`handoff-pulse ${pulse.kind} ${pulse.tone}`}
          style={
            {
              "--fx": `${pulse.fromX}px`,
              "--fy": `${pulse.fromY}px`,
              "--dx": `${pulse.dx}px`,
              "--dy": `${pulse.dy}px`,
              "--lift": `${pulse.lift}px`,
              "--angle": `${pulse.angle}deg`,
            } as CSSProperties
          }
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) {
              onPulseEnd(pulse.id);
            }
          }}
        >
          <span className="comet-tail" />
          <span className="comet-head" />
        </span>
      ))}
    </div>
  );
}
