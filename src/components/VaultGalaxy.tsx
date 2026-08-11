import { useEffect, useRef, useState } from "react";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { HandState } from "../hooks/useHandControl";
import { focusNeighborhood, type GalaxyNavNode } from "../lib/galaxy-nav";
import { colorForNode, makeNodeColor, makeLinkColor, LINK_BASE_COLOR } from "../lib/galaxy-colors";
import {
  escapeHtml,
  reconcile,
  stepFlightTarget,
  DWELL_THRESHOLD_PX,
  DWELL_HOLD_MS,
  ZOOM_MIN_RADIUS,
  ZOOM_MAX_RADIUS,
  ANCHOR_THRESHOLD_PX,
  ORBIT_SENSITIVITY,
  ZOOM_LOCK_HOLD_MS,
  STEP_FLIGHT_MS,
  STEP_FLIGHT_DISTANCE,
  LABEL_MAX_DISTANCE,
  LABEL_BUDGET_CEILING,
  LABEL_WORLD_HEIGHT,
  LABEL_Y_OFFSET,
  SELECT_INTERVAL_MS,
} from "../lib/galaxy-graph";
import { addStarfield, addBloom } from "../lib/galaxy-scene";
import { useGalaxyRail } from "../hooks/useGalaxyRail";
import { useGalaxyCameraDrive } from "../hooks/useGalaxyCameraDrive";
import { useGalaxyAnchor } from "../hooks/useGalaxyAnchor";
import { selectLabels } from "../lib/galaxy-labels";
import { createLabelPool, type LabelPool } from "../lib/galaxy-label-sprites";
import { createRingPair, type AnchorRings } from "../lib/galaxy-anchor-rings";
import { RAIL_ISLAND_CLASS } from "../lib/galaxy-rail";
import GalaxyStepRail from "./GalaxyStepRail";
import GalaxyErrorBoundary from "./GalaxyErrorBoundary";
import type { GalaxyNode, GalaxyLink, TrackballControlsLike } from "../lib/galaxy-types";
import { readFlag, GESTURE_DEBUG_STORAGE_KEY } from "../lib/preferences";

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



// two-palm-galaxy-zoom design.md D7: a tuning instrument, not a shipped
// surface — off by default, following the same localStorage preference
// pattern App.tsx's own toggles use, but with no Settings UI of its own; a
// developer flips it with `localStorage.setItem(...)` in devtools.
const loadGestureDebugEnabled = () => readFlag(GESTURE_DEBUG_STORAGE_KEY, false);




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
  // The step rail: what it lists, what is typed, where it is centred.
  const rail = useGalaxyRail({ graph });

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
    orbitSensitivity: ORBIT_SENSITIVITY,
    zoomLockHoldMs: ZOOM_LOCK_HOLD_MS,
    candidateIntervalMs: SELECT_INTERVAL_MS,
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
    const controls = fg.controls() as unknown as TrackballControlsLike;
    const aim = controls.target ?? anchor.centroidRef.current;
    // The direction/distance decision, including the degenerate-camera guard,
    // is `stepFlightTarget` in lib/galaxy-graph.ts, where it is tested.
    const { position, destination } = stepFlightTarget(
      { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
      aim,
      fg.camera().position,
      STEP_FLIGHT_DISTANCE,
    );

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
    rail.markStepped(id);
  }


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
        roots={rail.roots}
        neighbours={rail.neighbours}
        matches={rail.matches}
        query={rail.query}
        onQueryChange={rail.setQuery}
        centreTitle={rail.centreTitle}
        locked={rail.locked}
        onStep={stepToNote}
      />
      {debugEnabled && <pre ref={debugRef} className="hud-galaxy-gesture-debug" />}
    </>
  );
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