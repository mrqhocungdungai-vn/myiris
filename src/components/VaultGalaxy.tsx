import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { HandState } from "../hooks/useHandControl";
import { focusNeighborhood, type GalaxyNavNode } from "../lib/galaxy-nav";
import { colorForNode } from "../lib/galaxy-colors";
import { useGalaxyCameraDrive } from "../hooks/useGalaxyCameraDrive";
import { useGalaxyAnchor } from "../hooks/useGalaxyAnchor";
import { selectLabels } from "../lib/galaxy-labels";
import { createLabelPool, type LabelPool } from "../lib/galaxy-label-sprites";
import { createRingPair, type AnchorRings } from "../lib/galaxy-anchor-rings";
import { railNeighbours, railRoots, railSearch, RAIL_ISLAND_CLASS } from "../lib/galaxy-rail";
import GalaxyStepRail from "./GalaxyStepRail";
import type { GalaxyNode, GalaxyLink, TrackballControlsLike } from "../lib/galaxy-types";

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

// Re-exported so App.tsx can type the position-map ref it hoists above this
// component (design.md M-3: the map must outlive VaultGalaxy's own mounts).
// Declared in `src/lib/galaxy-types.ts` so the camera hooks can name it
// without importing the component that mounts them.
export type { GalaxyNode } from "../lib/galaxy-types";

// Escapes text before it reaches 3d-force-graph's built-in tooltip, which
// assigns the `.nodeLabel()` accessor's return value to `innerHTML`
// (design.md D9/H2) — an ingested note titled `<img src=x onerror=…>` would
// otherwise execute in the privileged renderer. Escaped entities render as
// literal text in the tooltip, exactly like the title itself.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

// second-brain-gesture-nav tuning constants (design.md R2/R3/5.1/6.x) — tuned
// during the manual pass, not further pre-optimized.
const DWELL_THRESHOLD_PX = 48;
const DWELL_HOLD_MS = 300;
const ORBIT_SENSITIVITY = 0.006; // radians per pixel, matching the orb loop's feel
// 8, not the 15 this used to be: the floor is now a distance to a SINGLE
// anchored node rather than to the middle of the whole ball, so it can sit just
// clear of a node's own ~4-unit sphere and let "dolly all the way in" actually
// arrive at the note (galaxy-note-reachable-by-hand design.md D4).
const ZOOM_MIN_RADIUS = 8;
const ZOOM_MAX_RADIUS = 2500;

// galaxy-note-reachable-by-hand tuning constants, in the style of the galaxy's
// existing ones — tuned during the manual pass, not further pre-optimized.
//
// How near the centre of the screen a node has to project before a grab takes
// hold of it. Wider than DWELL_THRESHOLD_PX because the user aims this one with
// the whole camera rather than with a fingertip, and the reticle marks exactly
// where the query point is.
// Widened from 90 after the manual pass: at 90 a grab over a sparse region
// found nothing and silently kept the old anchor, which reads as the grab
// having failed rather than as "there was nothing there". The reticle and the
// candidate ring are what keep a wider radius predictable — the user can see
// which node it has picked before committing.
const ANCHOR_THRESHOLD_PX = 130;
// A rail step's flight: long enough that the user sees where in the galaxy they
// were taken (the spec requires the travel to be visible), short enough not to
// feel like waiting.
const STEP_FLIGHT_MS = 600;
// How far from the destination note the flight parks. A little above
// ZOOM_MIN_RADIUS, so a step frames the note and its immediate neighbours
// rather than pressing right up against it.
const STEP_FLIGHT_DISTANCE = 60;
// How long the rail stays inert after a step (design.md D11). Must exceed the
// universal dwell's own 300 ms hold, or a still-held hand would charge a fresh
// dwell on the repopulated rail and fire a second step.
const STEP_LOCK_MS = 700;

// add-galaxy-node-labels tuning constants (design.md D9, revised D11).
// No distance cutoff: every eligible note's title is always a selection
// candidate (design.md D11) — `sizeAttenuation` on the sprite material
// already shrinks a distant title toward illegible-and-ignorable on its own,
// the same way a distant node's dot is already small, so a second, hard
// on/off gate on top of that added a failure mode (a note that never gets
// close enough to the camera's orbit target never got named at all) without
// actually improving readability. `Infinity` here reads as "no cutoff" at
// every call site that squares or compares it, with no special-casing needed.
const LABEL_MAX_DISTANCE = Infinity;
// The number of label sprites is still a fixed pool sized once at mount
// (design.md D2's cost argument stands — this is a ceiling, not a target).
// Sized to the vault's own note count so a normal personal vault gets every
// note titled with room to spare; capped so a pathologically large vault
// (thousands of notes) can't allocate thousands of canvases up front. Raise
// this if a real vault's note count exceeds it (design.md D11).
const LABEL_BUDGET_CEILING = 500;
// Text a bit above a default-sized node (radius ~4).
const LABEL_WORLD_HEIGHT = 5;
const LABEL_Y_OFFSET = 6;
// A reveal is a threshold crossing during navigation, and 10Hz is
// imperceptible for that — positions still update every frame (design.md D5).
const SELECT_INTERVAL_MS = 100;

// two-palm-galaxy-zoom design.md D7: a tuning instrument, not a shipped
// surface — off by default, following the same localStorage preference
// pattern App.tsx's own toggles use, but with no Settings UI of its own; a
// developer flips it with `localStorage.setItem(...)` in devtools.
const GESTURE_DEBUG_STORAGE_KEY = "iris.galaxyGestureDebug";

function loadGestureDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem(GESTURE_DEBUG_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}
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
// Every link alpha below is the FINAL rendered opacity, because `linkOpacity` is
// set to 1 (design.md D1b). three-forcegraph computes
// `opacity = state.linkOpacity * colorAlpha(color)`, so a graph-wide
// `linkOpacity` below 1 is a *ceiling* on every link, not just a default: with
// the previous `linkOpacity(0.5)`, a highlight colour at 0.95 alpha rendered at
// 0.475 and no link could ever exceed half opacity however bright its colour —
// which is why the lit cluster did not read as lit. Moving that factor out of the
// global and into these alphas leaves the resting graph pixel-identical
// (0.5 x 0.35 = 0.175, 0.5 x 0.05 = 0.025) while freeing the lit colour to reach
// near-full intensity.
const DIM_LINK_ALPHA = 0.025;
const LINK_BASE_COLOR = "rgba(140, 170, 255, 0.175)";
// The links incident to whatever node is being pointed at, lifted from the
// faint base colour to near-opaque so the cluster reads at a glance
// (second-brain-galaxy-view: "The node being pointed at reveals its link
// cluster"). Colour is the ONLY lever used, deliberately — in
// three-forcegraph `useCylinder = !!linkWidth`, so a non-zero width switches
// that link from a `Line` primitive to cylinder geometry, and changing the
// `linkWidth` accessor clears `linkDataMapper` outright and rebuilds every
// link object in the graph. Per hover. `linkColor` changes only update
// materials — the same path the focus dimming below already takes.
//
// 0.98 rather than 1: three-forcegraph switches a link's material to
// `transparent: false` / `depthWrite: true` at exactly `opacity >= 1`, so a lit
// link at full alpha would flip rendering mode mid-hover. A hair under keeps
// every link on the same transparent path.
const LINK_HIGHLIGHT_COLOR = "rgba(255, 245, 190, 0.98)";

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
// nearestNodeAt's own dead-band (M14) and, for the mouse, coalesced to one
// repaint per frame. The pointed-at highlight wins over the focus highlight
// when both apply to the same node — being pointed at is a momentary
// indicator, not a second selection state.
//
// `litIds` is the ONE set of nodes exempt from dimming, and the caller decides
// what it is: the pointed-at node's one-hop cluster while something is pointed
// at, otherwise the focus's, otherwise null (dim nothing). Collapsing "what the
// focus keeps bright" and "what the pointer keeps bright" into a single set is
// what makes a spotlight and the focus declutter the same mechanism instead of
// two that have to be reconciled at every call site (design.md D7).
//
// A FOCUSED node is returned before the dimming is considered at all, so a
// selection stays visible even while the spotlight is somewhere else — losing
// sight of what you have selected because you pointed elsewhere would be a
// worse trade than the spotlight is worth.
function makeNodeColor(pointedAtId: string | null, focusIds: Set<string>, litIds: Set<string> | null) {
  return (node: GalaxyNode) => {
    if (node.id === pointedAtId) return DWELL_HIGHLIGHT_COLOR;
    if (focusIds.has(node.id)) return FOCUS_HIGHLIGHT_COLOR;
    const base = colorForNode(node);
    if (litIds && !litIds.has(node.id)) return withAlpha(base, DIM_NODE_ALPHA);
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
// the nodes they connect dimmed. `litIds` is the same single set makeNodeColor
// takes, so the nodes that stay bright and the links that stay bright can never
// be computed from different sets.
//
// A link INCIDENT to the pointed-at node is drawn bright and outranks both the
// base colour and the dimming — that brightening is the substance of "what is
// this note connected to". Only incident links, not links among the
// neighborhood: lighting the neighbors' own edges too would draw a blob rather
// than a star, and the question being answered is what THIS node touches.
function makeLinkColor(litIds: Set<string> | null, pointedAtId: string | null) {
  return (link: GalaxyLink) => {
    if (pointedAtId !== null) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      if (source === pointedAtId || target === pointedAtId) return LINK_HIGHLIGHT_COLOR;
    }
    if (!litIds) return LINK_BASE_COLOR;
    const touchesLit = litIds.has(linkEndpointId(link.source)) || litIds.has(linkEndpointId(link.target));
    return touchesLit ? LINK_BASE_COLOR : withAlpha(LINK_BASE_COLOR, DIM_LINK_ALPHA);
  };
}


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
  // The focus declutter's one-hop neighbourhood, written by repaintHighlight
  // — the single place that set is derived — and read by the label loop
  // below as its `eligible` set (design.md D7), so titles never disagree with
  // the dimming about which nodes are relevant. Null means "no filtering".
  const relevantIdsRef = useRef<Set<string> | null>(null);
  // The proximity-title sprite pool (design.md D2) — created once per mount
  // alongside the graph instance, disposed in the same effect's cleanup.
  const labelPoolRef = useRef<LabelPool | null>(null);
  // The pool's actual slot count (design.md D11) — sized to this mount's node
  // count (capped at LABEL_BUDGET_CEILING), so `selectLabels`'s `budget`
  // option can match whatever the pool was actually built with.
  const labelBudgetRef = useRef(0);
  // The candidate/anchor marks (galaxy-note-reachable-by-hand design.md D10) —
  // created once per mount alongside the graph instance, disposed in the same
  // effect's cleanup, exactly like the label pool above.
  const ringsRef = useRef<AnchorRings | null>(null);
  // Detaches the `change` listener the pan detector rides on (design.md D1).
  const detachControlsRef = useRef<(() => void) | null>(null);
  // The centre reticle's element, so the drive can mark it engaged without a
  // re-render (tasks.md 6.5).
  const reticleRef = useRef<HTMLDivElement | null>(null);

  // The orbit anchor and the centroid it falls back to
  // (galaxy-note-reachable-by-hand design.md D1/D4b). `centerRef` used to carry
  // both jobs at once, which is why orbiting always circled the middle of the
  // ball and why a fist thrown after a mouse pan threw the pan away.
  const anchor = useGalaxyAnchor({ fgRef, positionsRef });

  // The note the step rail is currently showing the neighbours of (design.md
  // D7/D12). React state, not a ref: the rail is ordinary DOM and has to
  // re-render when it moves. Held in this component, which unmounts on every
  // galaxy-close route (HudShell renders it under `secondBrainActive`), so the
  // spec's "the note it was centred on SHALL be cleared" needs no separate
  // clearing path — the same structural reason the note reader and the focus
  // are cleared on those terms (5.7).
  const [railCentreId, setRailCentreId] = useState<string | null>(null);
  // Inert for a moment after a step, so a hand still held over the rail cannot
  // step again (design.md D11).
  const [railLocked, setRailLocked] = useState(false);
  // The note-name search (design.md D16). Local to this component: the renderer
  // already holds the whole graph, so matching titles needs no IPC at all.
  const [railQuery, setRailQuery] = useState("");
  const railLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (railLockTimerRef.current) clearTimeout(railLockTimerRef.current);
  }, []);

  // The node the HAND is pointing at — written by the gesture loop while the
  // pose is `dwell` or `inspect`, and null otherwise. The inspect pose needs no
  // dwell machine of its own: a reveal commits to nothing, so there is nothing
  // to debounce into a decision and nothing to fire.
  const handTargetRef = useRef<string | null>(null);
  // The node the MOUSE is hovering, from `onNodeHover`. The effective
  // pointed-at node is `handTargetRef ?? mouseHoverRef` (design.md D2): two
  // separate refs, not one written by both, because with hand control on the
  // hand writes `null` on every frame it has no target and would erase a live
  // mouse hover ~60 times a second.
  const mouseHoverRef = useRef<string | null>(null);
  // Coalesces mouse-hover repaints to at most one per frame: a repaint
  // re-digests every node's material, and sweeping a pointer across a dense
  // cluster fires `onNodeHover` once per node crossed.
  const hoverRepaintRafRef = useRef(0);

  // Gesture debug readout (design.md D7) — read once at mount, matching the
  // renderer's other localStorage-backed preferences. Written by the
  // gesture loop below via direct DOM text, never React state, so an
  // enabled readout costs one `textContent` write per frame instead of a
  // re-render.
  const [debugEnabled] = useState(loadGestureDebugEnabled);
  const debugRef = useRef<HTMLPreElement | null>(null);

  function applyGraph(nextGraph: VaultGraph) {
    const fg = fgRef.current;
    if (!fg) return;
    anchor.centroidDirtyRef.current = true;
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
    repaintHighlight();
  }

  // Recomputes BOTH one-hop sets from whatever is CURRENT in the refs (never
  // stale) and repaints node and link colors from them. The single place every
  // producer funnels through — applyGraph (graph changed — e.g. a fresh link
  // from "connect these two"), the focus-change effect, the mouse's hover
  // handler and the gesture loop's target change alike — so no two of them can
  // compute the sets differently.
  //
  // Both sets come from the same `focusNeighborhood`: the declutter's hop set
  // and the pointed-at hop set are the same question asked about different
  // ids, and one function answering it is what keeps the dimming and the
  // highlight agreeing about what "one hop" means.
  function repaintHighlight() {
    const fg = fgRef.current;
    if (!fg) return;
    const links = pendingGraphRef.current.links;
    const focus = focusIdsRef.current;
    // Both sets are derived here and nowhere else, and neither is cached across
    // calls: every producer funnels through this function, so recomputing from
    // whatever is current is what makes a stale set impossible rather than
    // something to keep in sync.
    const focusLitIds = focus.size ? focusNeighborhood(focus, links) : null;
    // The label loop's `eligible` set is the focus declutter's neighbourhood
    // specifically — NOT the pointed-at spotlight below, which is momentary
    // and would otherwise make titles flicker with whatever the pointer
    // happens to be over (design.md D7).
    relevantIdsRef.current = focusLitIds;
    const pointedAt = handTargetRef.current ?? mouseHoverRef.current;
    // Precedence, and the whole of the spotlight (design.md D7): whatever is
    // POINTED AT decides what stays bright while it is pointed at; the focus
    // decides when nothing is; nothing dims when neither applies. Pointing
    // therefore darkens the rest of the galaxy around the cluster rather than
    // merely brightening its links, and it temporarily overrides the focus's own
    // dimming instead of adding a second bright island beside it — one question
    // is being answered at a time. Releasing restores the focus's dimming
    // because this recomputes from whatever is current, never from a saved copy.
    const litIds = pointedAt ? focusNeighborhood([pointedAt], links) : focusLitIds;
    fg.nodeColor(makeNodeColor(pointedAt, focus, litIds));
    fg.linkColor(makeLinkColor(litIds, pointedAt));
  }

  // The mouse's producer never repaints inline — it records the id and lets at
  // most one repaint land per frame.
  function scheduleHighlightRepaint() {
    if (hoverRepaintRafRef.current) return;
    hoverRepaintRafRef.current = requestAnimationFrame(() => {
      hoverRepaintRafRef.current = 0;
      repaintHighlight();
    });
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
        .linkColor(() => LINK_BASE_COLOR)
        // 1, not a fraction: this is a ceiling multiplied into every link's own
        // colour alpha, and those alphas above already carry the resting dimness
        // (design.md D1b).
        .linkOpacity(1)
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
          // Opening a note anchors on it, so closing the reader leaves the
          // camera around that note's neighbourhood rather than the middle of
          // the vault (galaxy-note-reachable-by-hand 3.9).
          anchor.setAnchor({ kind: "node", id: node.id });
          onOpenNoteRef.current(node.id, node.title);
        })
        // The mouse's half of the pointed-at highlight
        // (second-brain-galaxy-view: "The node being pointed at reveals its
        // link cluster"). A ghost is never pointed at — the hand's target
        // resolution already excludes it as unopenable, and a highlight that
        // appeared under the mouse but never under the hand would make the same
        // node behave differently per input device.
        .onNodeHover((node) => {
          const next = node && !node.ghost ? node.id : null;
          if (next === mouseHoverRef.current) return;
          mouseHoverRef.current = next;
          scheduleHighlightRepaint();
        });
      // The other half of the dirty-flag center (design.md D3/6.1): the sim
      // settling long after applyGraph last ran (cooldownTicks(Infinity) on
      // fresh topology) must also invalidate the cached orbit center.
      fg.onEngineStop(() => {
        anchor.centroidDirtyRef.current = true;
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
      // Sized to this mount's actual node count (design.md D11), not a small
      // fixed constant — every note is meant to get a title, with the
      // ceiling only a defensive cap against a pathologically large vault.
      const labelBudget = Math.min(pendingGraphRef.current.nodes.length, LABEL_BUDGET_CEILING);
      labelBudgetRef.current = labelBudget;
      const labelPool = createLabelPool(labelBudget, LABEL_Y_OFFSET, LABEL_WORLD_HEIGHT);
      fg.scene().add(labelPool.group);
      labelPoolRef.current = labelPool;
      const rings = createRingPair();
      fg.scene().add(rings.group);
      ringsRef.current = rings;
      // A mouse PAN is invisible to everything else: `TrackballControls`
      // implements it by mutating `.target` in place (`_panCamera`), dispatching
      // only its generic `change`. Without this the release path would keep
      // writing a stale anchor over whatever the user had framed
      // (galaxy-note-reachable-by-hand design.md D1/D4b).
      const controls = fg.controls() as unknown as TrackballControlsLike;
      controls.addEventListener?.("change", anchor.recordPanIfMoved);
      detachControlsRef.current = () => controls.removeEventListener?.("change", anchor.recordPanIfMoved);
      // applyGraph's own repaintHighlight() call paints the ring/dimming on
      // whatever is already focused (second-brain-focus "survives a
      // remount") — the focus-change effect below only fires on a LATER
      // change, so the very first paint has to happen here too.
      applyGraph(pendingGraphRef.current);
      if (!running) fg.pauseAnimation();
    });
    return () => {
      disposed = true;
      // A coalesced repaint must not land after the instance is gone — it
      // would call into a destructed graph.
      if (hoverRepaintRafRef.current) {
        cancelAnimationFrame(hoverRepaintRafRef.current);
        hoverRepaintRafRef.current = 0;
      }
      const fg = fgRef.current;
      fgRef.current = null;
      detachControlsRef.current?.();
      detachControlsRef.current = null;
      const labelPool = labelPoolRef.current;
      labelPoolRef.current = null;
      if (labelPool) labelPool.dispose();
      const rings = ringsRef.current;
      ringsRef.current = null;
      if (rings) rings.dispose();
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

  // Proximity-title drive (design.md D4/D5): a second rAF loop, gated on
  // `running` ONLY — unlike the gesture loop it is not additionally gated on
  // `handControl` (mouse-only navigation must still reveal titles) and is
  // deliberately NOT suspended while the reader is open: it only writes
  // sprite transforms rather than driving the camera, and staying live means
  // no stale-position pop when the reader closes.
  //
  // Two rates in one loop: re-selecting is O(nodes) with an ordering step, so
  // it runs at most every SELECT_INTERVAL_MS; positions must be exact every
  // frame or a title visibly lags its node while the layout is still
  // settling, so `apply()` runs on every tick regardless.
  //
  // It also carries the mouse-path aim ease (galaxy-note-reachable-by-hand
  // design.md D3/D4b): with no drive engaged there is no per-frame camera write
  // at all, so the eased move of `controls.target` onto a newly-set anchor —
  // opening a note, a wheel over a node — needs a frame tick of its own, and
  // this is the loop that runs on exactly the terms the galaxy renders on.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastSelect = 0;
    let lastFrame = performance.now();
    let selection: GalaxyNavNode[] = [];

    function loop() {
      try {
        const fg = fgRef.current;
        const pool = labelPoolRef.current;
        const now = performance.now();
        anchor.stepControlsTargetEase(now - lastFrame);
        lastFrame = now;
        if (fg && pool) {
          if (now - lastSelect >= SELECT_INTERVAL_MS) {
            lastSelect = now;
            // The orbit TARGET, not the eye position (design.md D10): mouse
            // scroll-wheel zoom dollies the eye toward this fixed point
            // rather than toward whatever's on screen, so measuring from the
            // eye made reveal depend on which node happened to sit on the
            // camera's exact line of sight. Falls back to the eye position
            // only if `target` is ever absent (`TrackballControls` always
            // sets one in practice).
            const controls = fg.controls() as unknown as TrackballControlsLike;
            const origin = controls.target ?? fg.camera().position;
            selection = selectLabels(positionsRef.current.values(), origin, {
              maxDistance: LABEL_MAX_DISTANCE,
              budget: labelBudgetRef.current,
              eligible: relevantIdsRef.current,
            });
          }
          pool.apply(selection);
        }
      } catch (err) {
        // Mirrors the gesture loop's try/catch (a rAF throw escapes React's
        // error boundary and would otherwise repeat every frame), but a label
        // crash hides the labels and stops this loop rather than force-
        // closing the galaxy: labels failing is not a reason to tear down the
        // view they annotate (design.md Risks).
        console.error("[add-galaxy-node-labels] label loop crashed, hiding labels:", err);
        labelPoolRef.current?.apply([]);
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      labelPoolRef.current?.apply([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // second-brain-focus 4.2/4.4: repaints the focus ring and the declutter
  // dimming whenever the selection changes — independent of the gesture loop
  // below, which is gated on handControl, so a mouse-only selection (no hand
  // control at all) still renders. `focusIds.join(",")` gives this a
  // primitive dependency key for an array that is a fresh reference on every
  // parent render.
  const focusIdsKey = focusIds.join(",");
  useEffect(() => {
    repaintHighlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdsKey]);

  // Gesture drive — the rAF loop lives in `useGalaxyCameraDrive`
  // (galaxy-note-reachable-by-hand design.md D12), which owns the drive's own
  // bookkeeping and reads this component's refs per frame.
  useGalaxyCameraDrive({
    handControl,
    running,
    containerRef,
    fgRef,
    positionsRef,
    handRef,
    readerOpenRef,
    onOpenNoteRef,
    onForceCloseRef,
    handTargetRef,
    repaintHighlight,
    anchor,
    ringsRef,
    reticleRef,
    debugEnabled,
    debugRef,
    dwellThresholdPx: DWELL_THRESHOLD_PX,
    dwellHoldMs: DWELL_HOLD_MS,
    anchorThresholdPx: ANCHOR_THRESHOLD_PX,
    candidateIntervalMs: SELECT_INTERVAL_MS,
    orbitSensitivity: ORBIT_SENSITIVITY,
    zoomMinRadius: ZOOM_MIN_RADIUS,
    zoomMaxRadius: ZOOM_MAX_RADIUS,
  });

  // 3.10: scrolling with the pointer resting on a node zooms into THAT dot.
  // Capture phase, so the anchor (and with it `controls.target`, which is what
  // TrackballControls dollies toward) has already moved by the time the
  // controls' own wheel handler runs on the same event.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel() {
      const hovered = mouseHoverRef.current;
      if (!hovered) return;
      anchor.setAnchor({ kind: "node", id: hovered });
    }
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A rail step (design.md D8). Lives here rather than in the rail component
  // because it needs `fgRef`; the rail takes it as a prop.
  function stepToNote(id: string) {
    const fg = fgRef.current;
    if (!fg) return;
    const node = positionsRef.current.get(id);
    if (!node || node.x === undefined) return;
    const destination = new THREE.Vector3(node.x, node.y ?? 0, node.z ?? 0);
    const controls = fg.controls() as unknown as TrackballControlsLike;
    const aim = controls.target ?? anchor.centroidRef.current;
    // Keep the camera's CURRENT viewing direction and change only distance, so
    // a step reads as travelling to a note rather than as being spun to a new
    // orientation as well. A degenerate direction (camera sitting exactly on
    // its own target) falls back to the +Z axis rather than producing NaN.
    const direction = fg.camera().position.clone().sub(aim);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    const position = destination.clone().add(direction.normalize().multiplyScalar(STEP_FLIGHT_DISTANCE));

    // The one place a library transition is safe: no drive is engaged, so
    // nothing is writing the camera per frame, and `cameraPosition` animates
    // BOTH the eye and `controls.target` for us — which is why the anchor below
    // is set with the mouse-path ease suppressed rather than in addition to it.
    //
    // If the user engages a camera drive mid-flight, the drive wins and the
    // view does not jump. That is worth recording because it is not evident
    // from this code (5.9): the drive's first frame calls
    // `cameraPosition(..., 0)`, whose `povPosTween.end()` snaps the camera to
    // the flight's DESTINATION — but `setCameraPos(finalPos)` overwrites it
    // inside the same synchronous call, so no frame ever renders at the snapped
    // position, and the spherical the drive seeds is taken from the camera
    // after that overwrite.
    fg.cameraPosition(
      { x: position.x, y: position.y, z: position.z },
      { x: destination.x, y: destination.y, z: destination.z },
      STEP_FLIGHT_MS,
    );
    // The tween owns `controls.target` for the duration, so the pan detector
    // must not read its interpolated value as a user pan.
    anchor.suppressPanDetection(STEP_FLIGHT_MS);
    anchor.setAnchor({ kind: "node", id }, { ease: false });
    // Navigation only: no focus is toggled, no note is opened, and nothing the
    // voice layer or a run reads is touched (5.8) — the rail navigates, it does
    // not select.
    setRailCentreId(id);
    setRailLocked(true);
    if (railLockTimerRef.current) clearTimeout(railLockTimerRef.current);
    railLockTimerRef.current = setTimeout(() => setRailLocked(false), STEP_LOCK_MS);
  }

  // Memoised (design.md D7): both derivations are O(nodes + links) and this
  // component re-renders on every focus change. The entry points depend on the
  // graph ALONE — they are deliberately the one part of the rail that stepping
  // does not change, so they are not recomputed when the centre moves.
  const roots = useMemo(() => railRoots({ nodes: graph.nodes, links: graph.links }), [graph]);
  const neighbours = useMemo(
    () => (railCentreId === null ? [] : railNeighbours({ centreId: railCentreId, nodes: graph.nodes, links: graph.links })),
    [graph, railCentreId],
  );
  const matches = useMemo(
    () => railSearch({ query: railQuery, nodes: graph.nodes, links: graph.links }),
    [graph, railQuery],
  );
  const centreTitle = railCentreId === null ? null : graph.nodes.find((n) => n.id === railCentreId)?.title ?? railCentreId;

  return (
    <>
      <div ref={containerRef} className="hud-galaxy hud-hit" />
      {/* The centre reticle (design.md D10). Deliberately NOT inside a chrome
          island and `pointer-events: none`, following the
          `.hud-galaxy-gesture-debug` precedent: `hudChromeAtPoint` nulls the
          galaxy's pointing target wherever the hand is over chrome, so a
          reticle carrying HUD_CHROME_CLASS at screen centre would kill node
          dwell and inspect on the most-used part of the view. */}
      {handControl && running && !readerOpen ? <div ref={reticleRef} className="hud-galaxy-reticle" /> : null}
      <GalaxyStepRail
        className={RAIL_ISLAND_CLASS}
        roots={roots}
        neighbours={neighbours}
        matches={matches}
        query={railQuery}
        onQueryChange={setRailQuery}
        centreTitle={centreTitle}
        locked={railLocked}
        onStep={stepToNote}
      />
      {debugEnabled && <pre ref={debugRef} className="hud-galaxy-gesture-debug" />}
    </>
  );
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
