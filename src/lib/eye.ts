import type { EyePoint, EyeState } from "../hooks/useEyeTracking";

// Extracted from useEyeTracking for the same reason lib/hand.ts is extracted
// from useHandControl: vitest's `unit` project runs under environment "node"
// with no DOM, so logic that must be verified has to be a pure function here
// rather than living inside the hook or a component (design D11).

/**
 * The camera frame's aspect ratio — 4/3 in both surfaces (`.camera-frame` in
 * deck.css and hud.css), and the shape useHandControl requests from
 * getUserMedia (640×480), so `object-fit: cover` crops nothing and one value
 * is correct everywhere.
 *
 * It is needed because landmark coordinates are normalized *independently per
 * axis*: one unit of x spans the frame's width and one unit of y spans its
 * height. A distance taken straight from them is therefore anisotropic, and
 * an iris radius computed that way would come out different for a head tilted
 * sideways than for the same head upright.
 */
export const FRAME_ASPECT = 4 / 3;

/**
 * Iris center as the centroid of its boundary ring, rather than the model's
 * own center landmark — the four boundary points average out the per-frame
 * jitter that a single landmark carries in full.
 */
export function irisCenter(ring: EyePoint[]): EyePoint {
  if (!ring.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point.x;
    y += point.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/**
 * Mean center-to-boundary distance, **in units of the frame's width** — the
 * one unit the overlays can scale by directly, since their viewBox is square
 * by construction and spans the frame's width. The y term is divided by
 * FRAME_ASPECT to undo the per-axis normalization described above.
 */
export function irisRadius(center: EyePoint, ring: EyePoint[]): number {
  if (!ring.length) return 0;
  let total = 0;
  for (const point of ring) {
    const dx = point.x - center.x;
    const dy = (point.y - center.y) / FRAME_ASPECT;
    total += Math.hypot(dx, dy);
  }
  return total / ring.length;
}

/**
 * Compares only what decides whether the overlays are mounted at all —
 * presence and which eyes exist. Center and radius change every frame and are
 * excluded deliberately: they reach the renderer through the ref, so tracking
 * a moving face never triggers a React re-render (the same gate
 * lib/hand.ts's semanticEquals applies to hand tracking).
 *
 * `acquiredAt` is excluded for a different reason: it only ever changes on the
 * absent → present transition, which `present` already reports, and the
 * acquire animation reads it from the per-frame ref, not from React.
 */
export function presenceEquals(a: EyeState, b: EyeState): boolean {
  return (
    a.active === b.active &&
    a.present === b.present &&
    a.eyes.length === b.eyes.length &&
    a.eyes.every((eye, index) => eye.id === b.eyes[index].id)
  );
}
