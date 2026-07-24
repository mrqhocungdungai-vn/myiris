import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";

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
}: {
  graph: VaultGraph;
  running: boolean;
  positionsRef: { current: Map<string, GalaxyNode> };
  onOpenNote: (id: string, title: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraph3DInstance<GalaxyNode, GalaxyLink> | null>(null);
  const topologyKeyRef = useRef("");
  const pendingGraphRef = useRef(graph);
  pendingGraphRef.current = graph;

  function applyGraph(nextGraph: VaultGraph) {
    const fg = fgRef.current;
    if (!fg) return;
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
        .onNodeClick((node) => {
          if (node.ghost) return; // unresolved wikilink target — no backing file to open (D8)
          onOpenNote(node.id, node.title);
        });
      addStarfield(fg.scene());
      await addBloom(fg);
      if (disposed) return;
      fgRef.current = fg;
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
}: {
  running: boolean;
  positionsRef: { current: Map<string, GalaxyNode> };
  onOpenNote: (id: string, title: string) => void;
  onForceClose: () => void;
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
  }, []);

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
      <GalaxyCanvas graph={state.graph} running={running} positionsRef={positionsRef} onOpenNote={onOpenNote} />
    </GalaxyErrorBoundary>
  );
}
