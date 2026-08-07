import { useRef } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { GalaxyNode, GalaxyLink, TrackballControlsLike } from "../lib/galaxy-types";
import {
  CENTROID_ANCHOR,
  anchorsEqual,
  easeAnchor,
  resolveAnchor,
  type GalaxyAnchor,
  type Vec3,
} from "../lib/galaxy-anchor";

// Ownership of the galaxy's anchor (galaxy-note-reachable-by-hand design.md
// D1/D4b): the state itself, the centroid it falls back to, the graph extent
// the zoom-out release is measured against, and the two writes every anchor
// mutation has to make — `controls.target`, and the eased aim that gets it
// there.
//
// This lives beside the camera drive rather than inside it because the MOUSE
// sets the anchor too (a wheel over a node, a pan, opening a note), and those
// paths run with no drive engaged and no per-frame loop of their own.

type Fg = ForceGraph3DInstance<GalaxyNode, GalaxyLink>;

export type GalaxyAnchorApi = {
  /** The live anchor. Read per frame by the camera drive; written only through `setAnchor`/`recordPan`. */
  anchorRef: { current: GalaxyAnchor };
  /** The graph's centroid, recomputed at most once per dirty flag. */
  centroidRef: { current: THREE.Vector3 };
  /** Set by `applyGraph` and `onEngineStop`; cleared by `ensureCentroidFresh`. */
  centroidDirtyRef: { current: boolean };
  /** The graph's own extent, computed in the same pass as the centroid (design.md D5). */
  boundingRadiusRef: { current: number };
  /** The easing look-at point the camera drive aims with (design.md D3). Never feeds the camera's POSITION. */
  displayedAnchorRef: { current: Vec3 };
  ensureCentroidFresh(): void;
  /** The anchor's world position right now, with the centroid refreshed first. */
  resolveCurrent(): Vec3;
  /** Moves the anchor. Returns whether it actually changed. */
  setAnchor(next: GalaxyAnchor, options?: { ease?: boolean }): boolean;
  /** Copies the resolved anchor straight into `controls.target`, for the release path. */
  writeControlsTarget(): void;
  /** One frame of the mouse-path aim ease. No-op unless an anchor change armed it. */
  stepControlsTargetEase(dtMs: number): void;
  /** Records a mouse pan as a `point` anchor, if `controls.target` has drifted off the anchor. */
  recordPanIfMoved(): void;
  /** Suppresses pan detection for `ms` while a library camera tween owns `controls.target`. */
  suppressPanDetection(ms: number): void;
};

// A `controls.target` this far (squared, world units) from the resolved anchor
// was moved by something other than us — which, with the controls enabled and
// no tween running, can only be a mouse pan.
const PAN_EPSILON_SQ = 1e-4;

export function useGalaxyAnchor({
  fgRef,
  positionsRef,
}: {
  fgRef: { current: Fg | null };
  positionsRef: { current: Map<string, GalaxyNode> };
}): GalaxyAnchorApi {
  const anchorRef = useRef<GalaxyAnchor>(CENTROID_ANCHOR);
  const centroidRef = useRef(new THREE.Vector3());
  const centroidDirtyRef = useRef(true);
  const boundingRadiusRef = useRef(0);
  const displayedAnchorRef = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  // Armed by an anchor change made with the controls enabled, disarmed once the
  // aim arrives. A one-shot ease rather than a permanent servo: a loop that
  // forever pulled `controls.target` back onto the anchor would fight a mouse
  // pan for as long as the pan lasted.
  const easeActiveRef = useRef(false);
  const suppressPanUntilRef = useRef(0);

  function controlsOf(): TrackballControlsLike | null {
    const fg = fgRef.current;
    if (!fg) return null;
    return fg.controls() as unknown as TrackballControlsLike;
  }

  // The centroid AND the graph's extent in one pass, under one dirty flag — the
  // release threshold is a multiple of the extent, so the two are always read
  // together and must never be a frame apart (design.md D5).
  function ensureCentroidFresh() {
    if (!centroidDirtyRef.current) return;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    for (const node of positionsRef.current.values()) {
      if (node.x === undefined) continue;
      sx += node.x;
      sy += node.y ?? 0;
      sz += node.z ?? 0;
      n++;
    }
    if (n > 0) centroidRef.current.set(sx / n, sy / n, sz / n);
    let maxSq = 0;
    for (const node of positionsRef.current.values()) {
      if (node.x === undefined) continue;
      const dx = node.x - centroidRef.current.x;
      const dy = (node.y ?? 0) - centroidRef.current.y;
      const dz = (node.z ?? 0) - centroidRef.current.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > maxSq) maxSq = distSq;
    }
    boundingRadiusRef.current = Math.sqrt(maxSq);
    centroidDirtyRef.current = false;
  }

  function resolveCurrent(): Vec3 {
    ensureCentroidFresh();
    return resolveAnchor(anchorRef.current, positionsRef.current, centroidRef.current);
  }

  function setAnchor(next: GalaxyAnchor, { ease = true }: { ease?: boolean } = {}): boolean {
    if (anchorsEqual(anchorRef.current, next)) return false;
    anchorRef.current = next;
    // D4b: every anchor mutation must also reach `controls.target`, or the
    // mouse would keep orbiting the old point while the hand orbits the new
    // one. With the controls DISABLED (a hand drive is engaged) that write is
    // left to the release path — `setLookAt` only writes `.target` while
    // enabled, and writing it here would be discarded anyway.
    //
    // The write is eased rather than instant because the spec requires it: the
    // anchor is chosen from what is *near* the centre of the screen, so it is
    // routinely a little off-centre and a snap would read as the view flinching.
    if (ease && controlsOf()?.enabled) easeActiveRef.current = true;
    return true;
  }

  function writeControlsTarget() {
    const controls = controlsOf();
    if (!controls?.target) return;
    const position = resolveCurrent();
    controls.target.set(position.x, position.y, position.z);
    easeActiveRef.current = false;
  }

  function stepControlsTargetEase(dtMs: number) {
    if (!easeActiveRef.current) return;
    const controls = controlsOf();
    if (!controls?.enabled || !controls.target) {
      easeActiveRef.current = false;
      return;
    }
    const goal = resolveCurrent();
    const next = easeAnchor(controls.target, goal, dtMs);
    controls.target.set(next.x, next.y, next.z);
    if (next.x === goal.x && next.y === goal.y && next.z === goal.z) easeActiveRef.current = false;
  }

  function suppressPanDetection(ms: number) {
    suppressPanUntilRef.current = performance.now() + ms;
    easeActiveRef.current = false;
  }

  function recordPanIfMoved() {
    if (performance.now() < suppressPanUntilRef.current) return;
    // Our own eased write moves `target` too — it is not a pan.
    if (easeActiveRef.current) return;
    const controls = controlsOf();
    if (!controls?.enabled || !controls.target) return;
    const anchorPosition = resolveCurrent();
    const dx = controls.target.x - anchorPosition.x;
    const dy = controls.target.y - anchorPosition.y;
    const dz = controls.target.z - anchorPosition.z;
    if (dx * dx + dy * dy + dz * dz <= PAN_EPSILON_SQ) return;
    // A pan SETS the anchor rather than being overwritten by it. Without the
    // `point` variant this would be unrepresentable and the release path would
    // keep writing a stale anchor over the user's framing — the exact defect
    // this change exists to remove.
    anchorRef.current = { kind: "point", position: { x: controls.target.x, y: controls.target.y, z: controls.target.z } };
  }

  return {
    anchorRef,
    centroidRef,
    centroidDirtyRef,
    boundingRadiusRef,
    displayedAnchorRef,
    ensureCentroidFresh,
    resolveCurrent,
    setAnchor,
    writeControlsTarget,
    stepControlsTargetEase,
    recordPanIfMoved,
    suppressPanDetection,
  };
}
