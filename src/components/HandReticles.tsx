import type { HandState } from "../hooks/useHandControl";

// Floating gesture cursors (one per tracked hand) rendered above everything.
export default function HandReticles({
  hand,
  dwelling,
}: {
  hand: HandState;
  dwelling: boolean;
}) {
  const items = hand.hands.length
    ? hand.hands
    : hand.point
      ? [{ ...hand, id: "hand-0", point: hand.point }]
      : [];

  return (
    <>
      {items.map((item, index) => (
        <div
          key={item.id}
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
