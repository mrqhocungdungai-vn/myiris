import type { GalaxyNavNode } from "./galaxy-nav";

// Pure selection policy for the galaxy's proximity titles (add-galaxy-node-
// labels design.md D3): which node titles should be drawn this pass, given
// an origin point. No React, no `three`, no live sprite pool — the mechanics
// live in galaxy-label-sprites.ts, which just applies whatever this returns.
//
// The caller passes the camera's orbit TARGET as the origin, not its literal
// eye position (design.md D10) — measuring from the eye made reveal
// rotation-dependent: with mouse-only navigation, scroll-wheel zoom dollies
// the eye toward a fixed target rather than toward whatever is on screen, so
// a node directly along the eye-to-target line closed distance fast while an
// equally-close node just off that line never did, no matter how far the
// user zoomed. Measuring from the target instead is rotation-invariant — a
// node's distance from it does not depend on which angle the camera is
// currently viewing from — while "far out = nothing shown" and "the far side
// stays unlabelled" still hold, since both only depend on the target's own
// distance to a node.

export type LabelSelectionOptions = {
  /** A node farther than this from `originPos` is never selected. */
  maxDistance: number;
  /** At most this many nodes are returned, nearest first. */
  budget: number;
  /** Non-eligible nodes are excluded; `null` means "no filtering" (galaxy-nav.ts's focusNeighborhood convention). */
  eligible: Set<string> | null;
};

/**
 * Returns the ≤`budget` nodes nearest `originPos` within `maxDistance`,
 * nearest first. Distance compares use squared distances — no `sqrt` per
 * node per pass, and the ordering is identical. A node with no position yet
 * (`x === undefined`) is skipped, matching `nearestNodeAt`'s own guard.
 */
export function selectLabels(
  nodes: Iterable<GalaxyNavNode>,
  originPos: { x: number; y: number; z: number },
  { maxDistance, budget, eligible }: LabelSelectionOptions,
): GalaxyNavNode[] {
  const maxDistanceSq = maxDistance * maxDistance;
  const candidates: { node: GalaxyNavNode; distSq: number }[] = [];
  for (const node of nodes) {
    if (node.x === undefined) continue;
    if (eligible && !eligible.has(node.id)) continue;
    const dx = node.x - originPos.x;
    const dy = (node.y ?? 0) - originPos.y;
    const dz = (node.z ?? 0) - originPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxDistanceSq) continue;
    candidates.push({ node, distSq });
  }
  candidates.sort((a, b) => a.distSq - b.distSq);
  return candidates.slice(0, budget).map((c) => c.node);
}
