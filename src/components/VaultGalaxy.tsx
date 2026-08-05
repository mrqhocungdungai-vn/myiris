import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { HandState } from "../hooks/useHandControl";
import {
  dwellStep,
  driveFor,
  orbitStep,
  radiusStep,
  nearestNodeAt,
  focusNeighborhood,
  INITIAL_DWELL_STATE,
  INITIAL_POSE_DRIVE_STATE,
  type DwellState,
  type PoseDriveState,
} from "../lib/galaxy-nav";

// second-brain-galaxy-view: 3d-force-graph is a vanilla (non-React) library
// that attaches imperatively to a container element — it has no React
// component to hand to `React.lazy`, so freshness-on-first-activation (the
// same goal DrawingCanvas.tsx serves with `lazy(() => import(...))`) is done
// here via a plain dynamic `import()` of `3d-force-graph` itself inside a
// mount effect instead. `three` stays a normal static import — it's already
// eagerly bundled by ReactorCore/HoloBackdrop's r3f usage, so dynamically
// importing it here would only add noise, not savings.
//
// The package is a "kapsule" component: its default export is callable as
// `ForceGraph3D(configOptions?)(domElement)` — a curried factory, NOT a
// `new`-able constructor. The package's own `.d.ts` describes it as
// construct-only (`new (el) => Instance`), which doesn't match this actual
// runtime calling convention (a known kapsule-family .d.ts/runtime mismatch
// — see 3d-force-graph's own README/examples), hence the cast below. Once
// called, though, `ForceGraph3DInstance` IS the accurate instance type —
// use it (not a hand-rolled guess) so the compiler catches API mistakes
// like a method that doesn't actually exist on the public instance.
type ForceGraph3DFactory = () => (el: HTMLElement) => ForceGraph3DInstance<GalaxyNode, GalaxyLink>;

// Exported so App.tsx can type the position-map ref it hoists above this
// component (design.md M-3: the map must outlive VaultGalaxy's own mounts).
// `fx`/`fy`/`fz` are `number | undefined` (never `null`) to match
// three-forcegraph's own `NodeObject` type exactly — its JSDoc says either
// `null` or deleting the property unfixes a node, but the type only
// declares `number`, so this component always uses `undefined`.
export type GalaxyNode = VaultGraphNode & {
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};
type GalaxyLink = { source: string; target: string };

// Escapes text before it reaches 3d-force-graph's built-in tooltip, which
// assigns the `.nodeLabel()` accessor's return value to `innerHTML`
// (design.md D9/H2) — an ingested note titled `<img src=x onerror=…>` would
// otherwise execute in the privileged renderer. Escaped entities render as
// literal text in the tooltip, exactly like the title itself.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

const TAG_COLORS = ["#5ec8ff", "#ff8a5e", "#8affc1", "#c98aff", "#ffe45e", "#ff5ec8"];
function colorForNode(node: GalaxyNode): string {
  if (node.ghost) return "rgba(200, 210, 230, 0.35)";
  const tag = node.tags[0];
  if (!tag) return "#9fb4ff";
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

// second-brain-gesture-nav tuning constants (design.md R2/R3/5.1/6.x) — tuned
// during the manual pass, not further pre-optimized.
const DWELL_THRESHOLD_PX = 48;
const DWELL_HOLD_MS = 300;
const ORBIT_SENSITIVITY = 0.006; // radians per pixel, matching the orb loop's feel
const ZOOM_SENSITIVITY = 600;
const ZOOM_MIN_RADIUS = 15;
const ZOOM_MAX_RADIUS = 2500;
const DWELL_HIGHLIGHT_COLOR = "#fff2a8";
// second-brain-focus 5.1: distinguishes a focused node from an ordinary one —
// distinct from every TAG_COLORS entry, the ghost gray, and the dwell color,
// so a focused node reads unambiguously regardless of its tag.
const FOCUS_HIGHLIGHT_COLOR = "#39ff88";
// A large galaxy converges into a dense mass as the vault grows, and
// rotating in 3D to reach the cluster around whatever is focused is a real
// cost (a shared-focus follow-on). Rather than changing what data is
// simulated or positioned, everything outside the focus's one-hop
// neighborhood (focusNeighborhood, galaxy-nav.ts) is dimmed near-invisible —
// decluttering the view around a selection without moving or hiding a
// single node.
const DIM_NODE_ALPHA = 0.08;
const DIM_LINK_ALPHA = 0.05;
const LINK_BASE_COLOR = "rgba(140, 170, 255, 0.35)";

// Both node and link colors above are CSS color strings, some already
// carrying their own alpha (colorForNode's ghost gray, LINK_BASE_COLOR) —
// three-forcegraph reads that alpha and multiplies it into the material's
// final opacity (nodeOpacity/linkOpacity are a single graph-wide constant,
// not a per-element accessor, so alpha-in-the-color-string is the only lever
// for dimming one element differently from another). This re-expresses any
// color as an rgba string at a new alpha, discarding whatever alpha it had.
const alphaCache = new Map<string, string>();
function withAlpha(color: string, alpha: number): string {
  const key = `${color}|${alpha}`;
  const cached = alphaCache.get(key);
  if (cached) return cached;
  const c = new THREE.Color(color);
  const result = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
  alphaCache.set(key, result);
  return result;
}

// Re-assigning `nodeColor` (rather than mutating a ref the existing accessor
// closes over) is what forces 3d-force-graph to re-digest and repaint
// (design.md D2/M6) — a fresh closure each call is simplest since the caller
// only invokes this on an actual target change, already debounced by
// dwellStep's own dead-band/hold (M14). The dwell highlight wins over the
// focus highlight when both apply to the same node — dwell is a momentary
// pre-open indicator, not a second selection state. `relevantIds` is null
// (never dims anything) while nothing is focused, and the focus/neighborhood
// set while something is — a focused or directly-linked node is never
// dimmed, only nodes outside that one-hop neighborhood are.
function makeNodeColor(targetId: string | null, focusIds: Set<string>, relevantIds: Set<string> | null) {
  return (node: GalaxyNode) => {
    if (node.id === targetId) return DWELL_HIGHLIGHT_COLOR;
    if (focusIds.has(node.id)) return FOCUS_HIGHLIGHT_COLOR;
    const base = colorForNode(node);
    if (relevantIds && !relevantIds.has(node.id)) return withAlpha(base, DIM_NODE_ALPHA);
    return base;
  };
}

// three-forcegraph mutates a link's source/target from the id string we
// supply into a reference to the actual node object, once the simulation
// initializes (documented in its own LinkObject type) — so an endpoint here
// may be either shape depending on whether a tick has run yet.
function linkEndpointId(endpoint: string | GalaxyNode): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

// Mirrors makeNodeColor's dimming for the edges themselves — otherwise a
// dense mesh of undimmed link lines would still read as clutter even with
// the nodes they connect dimmed.
function makeLinkColor(relevantIds: Set<string> | null) {
  return (link: GalaxyLink) => {
    if (!relevantIds) return LINK_BASE_COLOR;
    const touchesRelevant = relevantIds.has(linkEndpointId(link.source)) || relevantIds.has(linkEndpointId(link.target));
    return touchesRelevant ? LINK_BASE_COLOR : withAlpha(LINK_BASE_COLOR, DIM_LINK_ALPHA);
  };
}

// 3d-force-graph types `controls()` as `object` (it's a TrackballControls
// instance internally — design.md D3) — this is the minimal shape the
// gesture loop actually touches, confirmed against three-render-objects'
// source (tick() gates its `.update()` on `.enabled`; `cameraPosition`'s
// `setLookAt` only writes `.target` while `.enabled` is true, replacing the
// Vector3 outright rather than mutating it — R1/M5/L16).
type TrackballControlsLike = { enabled: boolean; target?: THREE.Vector3 };

// Deep-space backdrop mechanism (design.md D4, spike-resolved 3.2b): the
// composer's UnrealBloomPass forces full-screen opacity, so the backdrop is
// painted *inside* the graph scene (opaque `backgroundColor` + a starfield
// of points) rather than as a CSS layer behind a transparent canvas.
function addStarfield(scene: THREE.Scene) {
  const count = 1200;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = 400 + Math.random() * 1600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x9fb4ff, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.7 });
  scene.add(new THREE.Points(geometry, material));
}

async function addBloom(fg: ForceGraph3DInstance<GalaxyNode, GalaxyLink>) {
  // fg.postProcessingComposer() already owns the EffectComposer 3d-force-graph
  // created internally (see three-render-objects) — just add a pass to it.
  const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
  const composer = fg.postProcessingComposer();
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.1, 0.6, 0.15));
}

// Renderer owns positions (design.md D3/H2): reconciles the incoming
// position-free graph against `positionsRef`'s live node objects in place —
// same references go back into `.graphData()` — and only reheats the sim
// when the topology (not just metadata) actually changed (M-B).
function reconcile(
  nextGraph: VaultGraph,
  positions: Map<string, GalaxyNode>,
  lastTopologyKey: { current: string },
): { nodes: GalaxyNode[]; links: GalaxyLink[]; topologyChanged: boolean } {
  const nextIds = new Set(nextGraph.nodes.map((n) => n.id));
  for (const id of Array.from(positions.keys())) {
    if (!nextIds.has(id)) positions.delete(id);
  }
  let topologyChanged = false;
  const nodes = nextGraph.nodes.map((n) => {
    let obj = positions.get(n.id);
    if (!obj) {
      obj = { ...n };
      positions.set(n.id, obj);
      topologyChanged = true;
    } else {
      obj.title = n.title;
      obj.tags = n.tags;
      obj.ghost = n.ghost;
      obj.malformed = n.malformed;
    }
    return obj;
  });
  const links: GalaxyLink[] = nextGraph.links.map((l) => ({ source: l.source, target: l.target }));
  const topologyKey = JSON.stringify({
    n: nextGraph.nodes.map((n) => n.id).sort(),
    l: nextGraph.links.map((l) => `${l.source}>${l.target}`).sort(),
  });
  if (topologyKey !== lastTopologyKey.current) topologyChanged = true;
  lastTopologyKey.current = topologyKey;
  return { nodes, links, topologyChanged };
}

function GalaxyCanvas({
  graph,
  running,
  positionsRef,
  onOpenNote,
  handRef,
  handControl,
  readerOpen,
  onForceClose,
  highFidelity,
  focusIds,
  onToggleNode,
}: {
  graph: VaultGraph;
  running: boolean;
  positionsRef: { current: Map<string, GalaxyNode> };
  onOpenNote: (id: string, title: string) => void;
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handRef: { current: HandState };
  handControl: boolean;
  readerOpen: boolean;
  onForceClose: () => void;
  /** webgl-quality-mode: read once at mount (design.md D5) — the galaxy adopts a live preference change only the next time it's opened, so its settled node positions survive. */
  highFidelity: boolean;
  /** second-brain-focus: ids of the currently-focused notes, for the ring highlight. */
  focusIds: string[];
  /** Toggles one node's focus — called by a pinch-tap and by a modifier-click alike. */
  onToggleNode: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraph3DInstance<GalaxyNode, GalaxyLink> | null>(null);
  const topologyKeyRef = useRef("");
  const pendingGraphRef = useRef(graph);
  pendingGraphRef.current = graph;
  // Frames the WHOLE graph in view exactly once, on this mount's first
  // settle — otherwise the default camera distance is a fixed constant that
  // doesn't scale with the graph's actual spread, so a vault with many notes
  // starts looking into the converged core with no sense of what else is
  // out there or which direction to head. Never re-fires after that first
  // settle (a later topology change — e.g. "connect these two" adding a
  // link — must not yank the camera away from wherever the user has since
  // navigated to).
  const hasFramedOnceRef = useRef(false);

  // Props mirrored into refs so the gesture loop's rAF closure — created
  // once per [handControl, running] pair, not per render — always reads the
  // current value instead of one captured at mount (design.md H2/M5).
  const readerOpenRef = useRef(readerOpen);
  readerOpenRef.current = readerOpen;
  const onOpenNoteRef = useRef(onOpenNote);
  onOpenNoteRef.current = onOpenNote;
  const onForceCloseRef = useRef(onForceClose);
  onForceCloseRef.current = onForceClose;
  const onToggleNodeRef = useRef(onToggleNode);
  onToggleNodeRef.current = onToggleNode;
  // Mirrored into a ref (not read as a plain Set prop) for the identical
  // reason readerOpenRef exists: the rAF closure below is created once per
  // [handControl, running] pair and must see the LATEST focus, not the one
  // captured at that time.
  const focusIdsRef = useRef(new Set(focusIds));
  focusIdsRef.current = new Set(focusIds);
  // The one-hop declutter set (focusNeighborhood) — null while nothing is
  // focused (no dimming). Recomputed by repaintFocus() below, whenever the
  // focus OR the graph's own links change, from whichever is current at that
  // moment (never stale — see repaintFocus's own callers).
  const relevantIdsRef = useRef<Set<string> | null>(null);

  // Orbit center (design.md D3/6.1): recomputed from positionsRef at most
  // once per dirty flag, never inside applyGraph's own position-free moment.
  const centerRef = useRef(new THREE.Vector3());
  const centerDirtyRef = useRef(true);

  // Gesture state — all pure-module state objects threaded through
  // src/lib/galaxy-nav.ts, plus the imperative camera-drive bookkeeping the
  // thin driver below owns.
  const dwellStateRef = useRef<DwellState>(INITIAL_DWELL_STATE);
  const lastHighlightedRef = useRef<string | null>(null);
  const poseStateRef = useRef<PoseDriveState>(INITIAL_POSE_DRIVE_STATE);
  const sphericalRef = useRef<THREE.Spherical | null>(null);
  const cameraEngagedRef = useRef<"orbit" | "zoom" | null>(null);
  const prevOrbitPointRef = useRef<{ x: number; y: number } | null>(null);
  const zoomReferenceRef = useRef<{ pinch: number; radius: number } | null>(null);

  function applyGraph(nextGraph: VaultGraph) {
    const fg = fgRef.current;
    if (!fg) return;
    centerDirtyRef.current = true;
    const { nodes, links, topologyChanged } = reconcile(nextGraph, positionsRef.current, topologyKeyRef);
    if (!topologyChanged) {
      // Metadata-only change (a tag/title edit) — pin current positions so
      // graphData()'s alpha reset doesn't visibly jiggle the layout, and
      // stop the engine ticking altogether (cooldownTicks(0)) since nothing
      // needs to move (design.md M-B). Note: `d3AlphaTarget` looks like the
      // obvious lever here but is NOT part of 3d-force-graph's public API
      // (excluded from its wrapper around the inner three-forcegraph engine
      // — confirmed via the package's own .d.ts `ExcludedInnerProps`);
      // calling it throws and previously crashed this whole layer (a
      // synchronous throw inside this effect propagates to the error
      // boundary below, which force-closes the galaxy) — pinning + cooldown
      // are the real, public mechanism.
      for (const node of nodes) {
        if (node.x !== undefined) {
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;
        }
      }
      fg.cooldownTicks(0);
      fg.graphData({ nodes, links });
    } else {
      for (const node of nodes) {
        node.fx = undefined;
        node.fy = undefined;
        node.fz = undefined;
      }
      fg.cooldownTicks(Infinity); // 3d-force-graph's own default — let new/changed topology settle
      fg.graphData({ nodes, links });
    }
    repaintFocus();
  }

  // Recomputes the one-hop declutter set from whatever is CURRENT in both
  // refs (never stale) and repaints both node and link colors from it. The
  // single place both applyGraph (graph changed — e.g. a fresh link from
  // "connect these two") and the focus-change effect below funnel through,
  // so the two can never compute it differently.
  function repaintFocus() {
    const fg = fgRef.current;
    if (!fg) return;
    const focus = focusIdsRef.current;
    relevantIdsRef.current = focus.size ? focusNeighborhood(focus, pendingGraphRef.current.links) : null;
    fg.nodeColor(makeNodeColor(lastHighlightedRef.current, focus, relevantIdsRef.current));
    fg.linkColor(makeLinkColor(relevantIdsRef.current));
  }

  useEffect(() => {
    let disposed = false;
    import("3d-force-graph").then(async (forceGraphMod) => {
      if (disposed || !containerRef.current) return;
      const ForceGraph3D = forceGraphMod.default as unknown as ForceGraph3DFactory;
      const fg = ForceGraph3D()(containerRef.current);
      fg.backgroundColor("#05060c")
        .nodeLabel((node) => escapeHtml(node.title))
        .nodeColor(colorForNode)
        .nodeOpacity(0.95)
        .linkColor(() => "rgba(140, 170, 255, 0.35)")
        .linkOpacity(0.5)
        .onNodeClick((node, event) => {
          if (node.ghost) return; // unresolved wikilink target — no backing file to open (D8)
          // second-brain-gesture-nav "Focus is reachable without hands": a
          // Cmd/Ctrl-click toggles focus instead of opening the note, so
          // selection stays reachable by mouse without breaking the existing
          // plain-click-opens-the-note behavior.
          if (event.metaKey || event.ctrlKey) {
            onToggleNodeRef.current(node.id);
            return;
          }
          onOpenNoteRef.current(node.id, node.title);
        });
      // The other half of the dirty-flag center (design.md D3/6.1): the sim
      // settling long after applyGraph last ran (cooldownTicks(Infinity) on
      // fresh topology) must also invalidate the cached orbit center.
      fg.onEngineStop(() => {
        centerDirtyRef.current = true;
        if (!hasFramedOnceRef.current) {
          hasFramedOnceRef.current = true;
          fg.zoomToFit(800, 80);
        }
      });
      addStarfield(fg.scene());
      // webgl-quality-mode design.md D5: read once here at open time. The
      // galaxy is the app's most expensive surface (bloom on top of a live
      // force simulation), so the light path skips the pass entirely — the
      // opaque backdrop/vignette/starfield above are unconditional, painted
      // inside the scene rather than by this composer pass.
      if (highFidelity) await addBloom(fg);
      if (disposed) return;
      fgRef.current = fg;
      // applyGraph's own repaintFocus() call paints the ring/dimming on
      // whatever is already focused (second-brain-focus "survives a
      // remount") — the focus-change effect below only fires on a LATER
      // change, so the very first paint has to happen here too.
      applyGraph(pendingGraphRef.current);
      if (!running) fg.pauseAnimation();
    });
    return () => {
      disposed = true;
      const fg = fgRef.current;
      fgRef.current = null;
      if (fg) {
        fg.pauseAnimation();
        fg._destructor();
      }
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyGraph(graph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (running) fg.resumeAnimation();
    else fg.pauseAnimation();
  }, [running]);

  // second-brain-focus 4.2/4.4: repaints the focus ring and the declutter
  // dimming whenever the selection changes — independent of the gesture loop
  // below, which is gated on handControl, so a mouse-only selection (no hand
  // control at all) still renders. `focusIds.join(",")` gives this a
  // primitive dependency key for an array that is a fresh reference on every
  // parent render.
  const focusIdsKey = focusIds.join(",");
  useEffect(() => {
    repaintFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdsKey]);

  // Gesture drive (design.md D4b/D5): a thin driver over the pure policy in
  // src/lib/galaxy-nav.ts. Schedules NOTHING while gestures are off or the
  // HUD is asleep (H-1/M-1) — `backgroundThrottling:false` means nothing
  // else would throttle a spinning loop, and driving the camera while
  // `pauseAnimation()` holds the render would let it silently drift and
  // snap on wake.
  useEffect(() => {
    if (!handControl || !running) return;
    let raf = 0;

    function restoreControlsIfNeeded(fg: ForceGraph3DInstance<GalaxyNode, GalaxyLink> | null) {
      if (!fg) return;
      const controls = fg.controls() as unknown as TrackballControlsLike;
      if (!controls || controls.enabled) return;
      // Re-sync target before re-enabling (R1/M5): `setLookAt` only writes
      // `.target` while `.enabled` is true and REPLACES the Vector3 outright
      // on every enabled `cameraPosition()` call, so it must be re-read
      // (never cached) and copied into, not assumed still valid, here.
      controls.target?.copy(centerRef.current);
      controls.enabled = true;
    }

    function ensureCenterFresh() {
      if (!centerDirtyRef.current) return;
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
      if (n > 0) centerRef.current.set(sx / n, sy / n, sz / n);
      centerDirtyRef.current = false;
    }

    function writeCameraFromSpherical(fg: ForceGraph3DInstance<GalaxyNode, GalaxyLink>) {
      const spherical = sphericalRef.current;
      if (!spherical) return;
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      const pos = centerRef.current.clone().add(offset);
      const center = centerRef.current;
      fg.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: center.x, y: center.y, z: center.z }, 0);
    }

    function loop() {
      try {
        const fg = fgRef.current;
        if (!fg || readerOpenRef.current) {
          restoreControlsIfNeeded(fg);
          cameraEngagedRef.current = null;
          raf = requestAnimationFrame(loop);
          return;
        }

        const hand = handRef.current;
        const { drive, state: poseState } = driveFor(hand, poseStateRef.current, performance.now());
        poseStateRef.current = poseState;

        // Node-dwell: dwellStep runs every frame (candidate null when the
        // pose isn't Pointing_Up) so leaving the pose immediately drops any
        // charging dwell — "leave the node" per design.md D2.
        const candidate =
          drive === "dwell" && hand.point && containerRef.current
            ? nearestNodeAt(
                positionsRef.current.values(),
                fg.camera(),
                containerRef.current.getBoundingClientRect(),
                hand.point,
                DWELL_THRESHOLD_PX,
                dwellStateRef.current.target,
              )
            : null;
        const dwellResult = dwellStep(dwellStateRef.current, candidate, performance.now(), DWELL_HOLD_MS);
        dwellStateRef.current = dwellResult.state;
        if (dwellResult.target !== lastHighlightedRef.current) {
          lastHighlightedRef.current = dwellResult.target;
          fg.nodeColor(makeNodeColor(dwellResult.target, focusIdsRef.current, relevantIdsRef.current));
        }
        if (dwellResult.fire && candidate) onOpenNoteRef.current(candidate.id, candidate.title);

        // second-brain-focus 4.1: a pinch tap resolves its target the same
        // way the dwell does (same hit-testing, same depth filter) — a tap
        // that resolves to no node, or (by construction of nearestNodeAt,
        // which already skips ghosts) a ghost node, does nothing.
        if (drive === "tap" && hand.point && containerRef.current) {
          const tapped = nearestNodeAt(
            positionsRef.current.values(),
            fg.camera(),
            containerRef.current.getBoundingClientRect(),
            hand.point,
            DWELL_THRESHOLD_PX,
            null,
          );
          if (tapped) onToggleNodeRef.current(tapped.id);
        }

        // Camera drive: orbit and zoom share one spherical — re-derived from
        // the LIVE camera on every engage (fist<->zoom switch or mouse-drag
        // handoff, design.md M13), never carried over stale.
        const activeCameraDrive = drive === "orbit" || drive === "zoom" ? drive : null;
        if (activeCameraDrive !== cameraEngagedRef.current) {
          if (activeCameraDrive) {
            ensureCenterFresh();
            sphericalRef.current = new THREE.Spherical().setFromVector3(
              fg.camera().position.clone().sub(centerRef.current),
            );
            zoomReferenceRef.current =
              activeCameraDrive === "zoom" ? { pinch: hand.pinchDistance, radius: sphericalRef.current.radius } : null;
            prevOrbitPointRef.current = activeCameraDrive === "orbit" ? hand.point : null;
          } else {
            zoomReferenceRef.current = null;
            prevOrbitPointRef.current = null;
          }
          cameraEngagedRef.current = activeCameraDrive;
        } else if (activeCameraDrive === "orbit" && sphericalRef.current && prevOrbitPointRef.current && hand.point) {
          const delta = {
            x: hand.point.x - prevOrbitPointRef.current.x,
            y: hand.point.y - prevOrbitPointRef.current.y,
          };
          const next = orbitStep(sphericalRef.current, delta, ORBIT_SENSITIVITY);
          sphericalRef.current.set(next.radius, next.phi, next.theta);
          prevOrbitPointRef.current = hand.point;
          writeCameraFromSpherical(fg);
        } else if (activeCameraDrive === "zoom" && sphericalRef.current && zoomReferenceRef.current) {
          const pinchDelta = hand.pinchDistance - zoomReferenceRef.current.pinch;
          const next = radiusStep(
            zoomReferenceRef.current.radius,
            pinchDelta,
            ZOOM_SENSITIVITY,
            ZOOM_MIN_RADIUS,
            ZOOM_MAX_RADIUS,
          );
          sphericalRef.current.set(next, sphericalRef.current.phi, sphericalRef.current.theta);
          writeCameraFromSpherical(fg);
        }

        if (activeCameraDrive) {
          const controls = fg.controls() as unknown as TrackballControlsLike;
          if (controls.enabled) controls.enabled = false;
        } else {
          restoreControlsIfNeeded(fg);
        }
      } catch (err) {
        // The error boundary does NOT catch rAF throws (design.md R6) — a
        // per-frame throw must force-close instead of throwing into the void
        // every frame with the click-through-disabled overlay left trapped.
        console.error("[second-brain-gesture-nav] gesture loop crashed, force-closing:", err);
        onForceCloseRef.current();
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      restoreControlsIfNeeded(fgRef.current);
    };
  }, [handControl, running]);

  return <div ref={containerRef} className="hud-galaxy hud-hit" />;
}

class GalaxyErrorBoundary extends Component<{ onCrash: () => void; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: unknown) {
    // A crashed WebGL layer must not leave the fullscreen click-through-
    // disabled overlay trapping desktop clicks (design.md D9/L3) — force the
    // whole galaxy closed, same as Esc. Logged (not swallowed silently) so a
    // regression like the d3AlphaTarget bug above is visible in devtools
    // instead of just "the galaxy closed for no apparent reason".
    console.error("[second-brain-galaxy-view] galaxy layer crashed, force-closing:", error);
    this.props.onCrash();
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}

// Toggled on/off by HudShell exactly like DrawingCanvas — mount fetches the
// current graph and starts the main-process watcher; unmount stops it
// (design.md D3 M-2). `positionsRef` is owned by App.tsx (hoisted above this
// component's own lazy/conditional mount, M-3) so toggling the galaxy off
// and back on rehydrates positions instead of re-scrambling the layout.
export default function VaultGalaxy({
  running,
  positionsRef,
  onOpenNote,
  onForceClose,
  handRef,
  handControl,
  readerOpen,
  highFidelity,
  focus,
  onFocusChanged,
}: {
  running: boolean;
  positionsRef: { current: Map<string, GalaxyNode> };
  onOpenNote: (id: string, title: string) => void;
  onForceClose: () => void;
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handRef: { current: HandState };
  handControl: boolean;
  readerOpen: boolean;
  /** webgl-quality-mode: read once when the galaxy (re)mounts (design.md D5). */
  highFidelity: boolean;
  /** second-brain-focus: owned by HudShell (shared with the chip and the clear control), not by this component. */
  focus: SecondBrainFocusState;
  onFocusChanged: (next: SecondBrainFocusState) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "empty" } | { status: "ready"; graph: VaultGraph }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    window.iris
      .getSecondBrainGraph()
      .then((result) => {
        if (cancelled) return;
        if (!result.available) {
          setState({ status: "empty" });
          return;
        }
        const hasNotes = result.graph.nodes.some((n) => !n.ghost);
        setState(hasNotes ? { status: "ready", graph: result.graph } : { status: "empty" });
        // Start the watcher only after the initial scan (design.md D3: "after
        // a fresh scan for get-graph") — this call, not this component's
        // mount, is what actually engages fs.watch.
        window.iris.activateSecondBrain();
      })
      .catch(() => setState({ status: "empty" }));
    // second-brain-focus "The focus SHALL survive the galaxy layer
    // remounting" — main is the sole owner, so a (re)mount always rehydrates
    // from it rather than assuming empty.
    window.iris
      .getSecondBrainFocus()
      .then((result) => {
        if (!cancelled) onFocusChanged(result);
      })
      .catch(() => {});
    const unsubscribe = window.iris.onSecondBrainGraphUpdated((graph) => {
      if (cancelled) return;
      const hasNotes = graph.nodes.some((n) => !n.ghost);
      setState(hasNotes ? { status: "ready", graph } : { status: "empty" });
    });
    return () => {
      cancelled = true;
      unsubscribe();
      window.iris.deactivateSecondBrain();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleFocusNode(id: string) {
    const result = await window.iris.toggleSecondBrainFocus(id);
    if (result.ok) onFocusChanged({ ids: result.ids, notes: result.notes });
  }

  if (state.status === "loading") return <div className="hud-galaxy-loading hud-hit">Loading galaxy…</div>;
  if (state.status === "empty") {
    return (
      <div className="hud-galaxy-empty hud-hit">
        <p>No notes yet</p>
        <p className="hint">Capture a note with Iris and it will appear here.</p>
      </div>
    );
  }

  return (
    <GalaxyErrorBoundary onCrash={onForceClose}>
      <GalaxyCanvas
        graph={state.graph}
        running={running}
        positionsRef={positionsRef}
        onOpenNote={onOpenNote}
        handRef={handRef}
        handControl={handControl}
        readerOpen={readerOpen}
        onForceClose={onForceClose}
        highFidelity={highFidelity}
        focusIds={focus.ids}
        onToggleNode={toggleFocusNode}
      />
    </GalaxyErrorBoundary>
  );
}
