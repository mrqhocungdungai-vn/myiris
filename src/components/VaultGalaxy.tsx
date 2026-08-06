import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { HandState } from "../hooks/useHandControl";
import {
  dwellStep,
  driveFor,
  inspectingHand,
  orbitStep,
  zoomRadius,
  handDistance,
  nearestNodeAt,
  focusNeighborhood,
  INITIAL_DWELL_STATE,
  type DwellState,
  type GalaxyDrive,
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
const ZOOM_MIN_RADIUS = 15;
const ZOOM_MAX_RADIUS = 2500;

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
// indicator, not a second selection state. `relevantIds` is null (never dims
// anything) while nothing is focused, and the focus/neighborhood set while
// something is — a focused or directly-linked node is never dimmed, only
// nodes outside that one-hop neighborhood are.
//
// `pointedIds` is the pointed-at node plus ITS one hop, and it exempts those
// nodes from the dimming: pointing at a dimmed node reveals what it connects
// to without the user having to change the focus first
// (second-brain-galaxy-view, "Pointing at a dimmed node reveals its
// cluster"). It never lifts the dimming from anything else.
function makeNodeColor(
  pointedAtId: string | null,
  focusIds: Set<string>,
  relevantIds: Set<string> | null,
  pointedIds: Set<string> | null,
) {
  return (node: GalaxyNode) => {
    if (node.id === pointedAtId) return DWELL_HIGHLIGHT_COLOR;
    if (focusIds.has(node.id)) return FOCUS_HIGHLIGHT_COLOR;
    const base = colorForNode(node);
    if (pointedIds?.has(node.id)) return base;
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
//
// A link INCIDENT to the pointed-at node is drawn bright and outranks both the
// base colour and the dimming — that brightening is the substance of "what is
// this note connected to". Only incident links, not links among the
// neighborhood: lighting the neighbors' own edges too would draw a blob rather
// than a star, and the question being answered is what THIS node touches.
function makeLinkColor(relevantIds: Set<string> | null, pointedAtId: string | null) {
  return (link: GalaxyLink) => {
    if (pointedAtId !== null) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      if (source === pointedAtId || target === pointedAtId) return LINK_HIGHLIGHT_COLOR;
    }
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
  // focused (no dimming). Recomputed by repaintHighlight() below, whenever the
  // focus OR the graph's own links change, from whichever is current at that
  // moment (never stale — see repaintHighlight's own callers).
  const relevantIdsRef = useRef<Set<string> | null>(null);

  // Orbit center (design.md D3/6.1): recomputed from positionsRef at most
  // once per dirty flag, never inside applyGraph's own position-free moment.
  const centerRef = useRef(new THREE.Vector3());
  const centerDirtyRef = useRef(true);

  // Gesture state — all pure-module state objects threaded through
  // src/lib/galaxy-nav.ts, plus the imperative camera-drive bookkeeping the
  // thin driver below owns.
  const dwellStateRef = useRef<DwellState>(INITIAL_DWELL_STATE);
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
  const sphericalRef = useRef<THREE.Spherical | null>(null);
  const cameraEngagedRef = useRef<"orbit" | "zoom" | null>(null);
  const prevOrbitPointRef = useRef<{ x: number; y: number } | null>(null);
  const zoomReferenceRef = useRef<{ dist: number; radius: number } | null>(null);

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
    relevantIdsRef.current = focus.size ? focusNeighborhood(focus, links) : null;
    const pointedAt = handTargetRef.current ?? mouseHoverRef.current;
    const pointedIds = pointedAt ? focusNeighborhood([pointedAt], links) : null;
    fg.nodeColor(makeNodeColor(pointedAt, focus, relevantIdsRef.current, pointedIds));
    fg.linkColor(makeLinkColor(relevantIdsRef.current, pointedAt));
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
    repaintHighlight();
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
    let lastFrameTime = performance.now();

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

    // two-hand-gestures: the zoom reads the distance between the two open
    // palms — null when fewer than two are present, which driveFor's own
    // partition already guarantees never happens while "zoom" is live.
    function twoPalmDistance(hand: HandState): number | null {
      const palms = hand.hands.filter((item) => item.openPalm);
      if (palms.length < 2) return null;
      return handDistance(palms[0].point, palms[1].point);
    }

    // design.md D7: every defect this change fixed traced to a runtime
    // number nobody could see — this makes them observable while tuning.
    // Direct DOM write, not React state (design.md D7/M-A1): an enabled
    // readout must not turn a 60fps loop into 60 re-renders.
    function updateDebugReadout(hand: HandState, drive: GalaxyDrive, now: number) {
      const el = debugRef.current;
      if (!el) return;
      const dt = now - lastFrameTime;
      lastFrameTime = now;
      const fps = dt > 0 ? 1000 / dt : 0;
      const curDist = twoPalmDistance(hand);
      const ref = zoomReferenceRef.current;
      const refDist = ref?.dist ?? null;
      const ratio = curDist !== null && refDist !== null ? curDist / Math.max(80, refDist) : null;
      const radius = sphericalRef.current?.radius ?? null;
      const lines = [
        `hands: ${hand.hands.length}`,
        ...hand.hands.map((item) => `  ${item.id}: ${item.gesture}`),
        `curDist: ${curDist !== null ? curDist.toFixed(1) : "—"}`,
        `refDist: ${refDist !== null ? refDist.toFixed(1) : "—"}`,
        `ratio: ${ratio !== null ? ratio.toFixed(3) : "—"}`,
        `radius: ${radius !== null ? radius.toFixed(1) : "—"}`,
        `drive: ${drive ?? "none"}`,
        `fps: ${fps.toFixed(0)}`,
      ];
      el.textContent = lines.join("\n");
    }

    // The hand's highlight must not outlive the hand driving it: a reader
    // opening, hand control switching off, or Iris sleeping mid-point would
    // otherwise leave a node lit with nothing pointing at it. A live mouse
    // hover is untouched — repaintHighlight falls back to it.
    function clearHandTarget() {
      if (handTargetRef.current === null) return;
      handTargetRef.current = null;
      repaintHighlight();
    }

    function loop() {
      try {
        const fg = fgRef.current;
        if (!fg || readerOpenRef.current) {
          restoreControlsIfNeeded(fg);
          cameraEngagedRef.current = null;
          clearHandTarget();
          raf = requestAnimationFrame(loop);
          return;
        }

        const hand = handRef.current;
        const drive = driveFor(hand);
        const activeCameraDrive = drive === "orbit" || drive === "zoom" ? drive : null;

        // Which hand's point targets a node. The inspect drive uses the point of
        // the hand actually making the pose, not the primary hand's: the
        // primary is chosen with a preference for POINTING hands, so a Victory
        // hand can lose primacy while still being the hand the user is
        // inspecting with (design.md D4).
        const targetPoint =
          drive === "inspect" ? inspectingHand(hand)?.point ?? null : drive === "dwell" ? hand.point : null;

        // Only a pose that MEANS to point at something resolves a target
        // (design.md D3): the charging dwell, or the inspect pose. An earlier
        // pass resolved one under any non-camera pose, on the grounds that a
        // highlight is feedback rather than an action — in use that lit one
        // cluster after another as a hand drifted, which reads as the view
        // twitching at the hand rather than answering a question.
        //
        // The incumbent handed to nearestNodeAt is the currently-PAINTED target:
        // the dead-band exists to stop the highlight flickering between
        // neighbours in a dense cluster, so the thing it protects should be the
        // thing on screen.
        const candidate =
          targetPoint && containerRef.current
            ? nearestNodeAt(
                positionsRef.current.values(),
                fg.camera(),
                containerRef.current.getBoundingClientRect(),
                targetPoint,
                DWELL_THRESHOLD_PX,
                handTargetRef.current,
              )
            : null;

        // Only the opening dwell has a machine: it is the one pose that commits
        // to something. Leaving the pose feeds it a null candidate, which
        // dwellStep resets on, so a charge is abandoned rather than carried into
        // a different pose.
        const openCandidate = drive === "dwell" ? candidate : null;
        const openResult = dwellStep(dwellStateRef.current, openCandidate, performance.now(), DWELL_HOLD_MS);
        dwellStateRef.current = openResult.state;

        const pointedAt = candidate?.id ?? null;
        if (pointedAt !== handTargetRef.current) {
          handTargetRef.current = pointedAt;
          repaintHighlight();
        }
        if (openResult.fire && openCandidate) onOpenNoteRef.current(openCandidate.id, openCandidate.title);

        // Camera drive: orbit and zoom share one spherical — re-derived from
        // the LIVE camera on every engage (fist<->zoom switch or mouse-drag
        // handoff, design.md M13), never carried over stale.
        if (activeCameraDrive !== cameraEngagedRef.current) {
          if (activeCameraDrive) {
            ensureCenterFresh();
            sphericalRef.current = new THREE.Spherical().setFromVector3(
              fg.camera().position.clone().sub(centerRef.current),
            );
            const engageDist = activeCameraDrive === "zoom" ? twoPalmDistance(hand) : null;
            zoomReferenceRef.current =
              engageDist !== null ? { dist: engageDist, radius: sphericalRef.current.radius } : null;
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
          // A dropout (one palm briefly not open_palm) has already released
          // the reference above on the frame `activeCameraDrive` goes null —
          // here `zoomReferenceRef.current` staying set means both palms are
          // still live, so `twoPalmDistance` cannot return null.
          const curDist = twoPalmDistance(hand)!;
          const next = zoomRadius({
            refRadius: zoomReferenceRef.current.radius,
            refDist: zoomReferenceRef.current.dist,
            curDist,
            min: ZOOM_MIN_RADIUS,
            max: ZOOM_MAX_RADIUS,
          });
          sphericalRef.current.set(next, sphericalRef.current.phi, sphericalRef.current.theta);
          writeCameraFromSpherical(fg);
        }

        if (activeCameraDrive) {
          const controls = fg.controls() as unknown as TrackballControlsLike;
          if (controls.enabled) controls.enabled = false;
        } else {
          restoreControlsIfNeeded(fg);
        }

        if (debugEnabled) updateDebugReadout(hand, drive, performance.now());
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
      clearHandTarget();
    };
  }, [handControl, running]);

  return (
    <>
      <div ref={containerRef} className="hud-galaxy hud-hit" />
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
