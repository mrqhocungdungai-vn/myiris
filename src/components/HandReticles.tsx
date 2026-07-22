import { useEffect, useRef } from "react";
import type { HandState } from "../hooks/useHandControl";

// Floating gesture cursors (one per tracked hand) rendered above everything.
// `hand` (React state, semantically gated) decides which reticles mount;
// `handRef` (per-frame ref) drives their position every rAF via direct
// transform writes, so tracking a moving hand never re-renders the app.
export default function HandReticles({
  hand,
  handRef,
  dwelling,
}: {
  hand: HandState;
  handRef: { current: HandState };
  dwelling: boolean;
}) {
  const items = hand.hands.length
    ? hand.hands
    : hand.point
      ? [{ ...hand, id: "hand-0", point: hand.point }]
      : [];

  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const live = handRef.current;
      const liveItems = live.hands.length
        ? live.hands
        : live.point
          ? [{ ...live, id: "hand-0", point: live.point }]
          : [];
      for (const item of liveItems) {
        const node = nodeRefs.current[item.id];
        if (node && item.point) {
          node.style.transform = `translate(${item.point.x}px, ${item.point.y}px)`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handRef]);

  return (
    <>
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={(el) => {
            nodeRefs.current[item.id] = el;
          }}
          className={`hand-reticle ${index > 0 ? "secondary" : ""} ${
            index === 0 && dwelling ? "dwell" : ""
          } ${item.pointing ? "pointing" : ""} ${item.openPalm ? "open" : ""} ${item.fist ? "fist" : ""}`}
          style={{ transform: `translate(${item.point.x}px, ${item.point.y}px)` }}
        >
          <span className="hand-ring" />
          <span className="hand-dot" />
        </div>
      ))}
    </>
  );
}
