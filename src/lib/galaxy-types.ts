import type * as THREE from "three";

// The handful of types the galaxy's component, its hooks and its pure modules
// all need. Held here rather than in `VaultGalaxy.tsx` so the hooks that drive
// the camera do not have to import the component that mounts them
// (galaxy-note-reachable-by-hand design.md D12).

// `fx`/`fy`/`fz` are `number | undefined` (never `null`) to match
// three-forcegraph's own `NodeObject` type exactly — its JSDoc says either
// `null` or deleting the property unfixes a node, but the type only declares
// `number`, so the galaxy always uses `undefined`.
export type GalaxyNode = VaultGraphNode & {
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};

export type GalaxyLink = { source: string; target: string };

// 3d-force-graph types `controls()` as `object` (it's a TrackballControls
// instance internally — see galaxy-view) — this is the minimal shape the
// gesture loop actually touches, confirmed against
// three-render-objects' source (tick() gates its `.update()` on `.enabled`;
// `cameraPosition`'s `setLookAt` only writes `.target` while `.enabled` is
// true, replacing the Vector3 outright rather than mutating it — R1/M5/L16).
//
// `_lastAngle` is TrackballControls' own rotation-momentum scalar (private,
// unexported): normally it decays toward 0 every `update()` call once a
// mouse-drag rotate ends (`dynamicDampingFactor`), but `update()` itself is
// gated on `.enabled` (three-render-objects' own render loop), so a momentum
// left over from mouse rotation freezes UNDECAYED for as long as the gesture
// loop holds `.enabled = false` — then applies in one sudden, undamped jump the
// instant controls are re-enabled. Read at the same call site as `target` for
// exactly that reason.
//
// `addEventListener`/`removeEventListener` come from TrackballControls'
// `EventDispatcher` base. The galaxy listens for `change` to notice a mouse
// PAN, which TrackballControls performs by mutating `target` in place
// (`_panCamera`) — no other code would ever see it happen
// (galaxy-note-reachable-by-hand design.md D1).
export type TrackballControlsLike = {
  enabled: boolean;
  target?: THREE.Vector3;
  _lastAngle?: number;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};
