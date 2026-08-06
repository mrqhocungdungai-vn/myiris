import type { GalaxyNavNode } from "./galaxy-nav";

// Pure selection policy for the galaxy's proximity titles (add-galaxy-node-
// labels design.md D3): which node titles should be drawn this pass, given
// the camera's position. No React, no `three`, no live sprite pool — the
// mechanics live in galaxy-label-sprites.ts, which just applies whatever this
// returns.

export type LabelSelectionOptions = {
  /** A node farther than this from the camera is never selected. */
  maxDistance: number;
  /** At most this many nodes are returned, nearest first. */
  budget: number;
  /** Non-eligible nodes are excluded; `null` means "no filtering" (galaxy-nav.ts's focusNeighborhood convention). */
  eligible: Set<string> | null;
};

/**
 * Returns the ≤`budget` nodes nearest `cameraPos` within `maxDistance`,
 * nearest first. Distance compares use squared distances — no `sqrt` per
 * node per pass, and the ordering is identical. A node with no position yet
 * (`x === undefined`) is skipped, matching `nearestNodeAt`'s own guard.
 */
export function selectLabels(
  nodes: Iterable<GalaxyNavNode>,
  cameraPos: { x: number; y: number; z: number },
  { maxDistance, budget, eligible }: LabelSelectionOptions,
): GalaxyNavNode[] {
  const maxDistanceSq = maxDistance * maxDistance;
  const candidates: { node: GalaxyNavNode; distSq: number }[] = [];
  for (const node of nodes) {
    if (node.x === undefined) continue;
    if (eligible && !eligible.has(node.id)) continue;
    const dx = node.x - cameraPos.x;
    const dy = (node.y ?? 0) - cameraPos.y;
    const dz = (node.z ?? 0) - cameraPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxDistanceSq) continue;
    candidates.push({ node, distSq });
  }
  candidates.sort((a, b) => a.distSq - b.distSq);
  return candidates.slice(0, budget).map((c) => c.node);
}
