import type { GalaxyNode, GalaxyLink } from "./galaxy-types";

// The galaxy view's pure parts: the tuning constants, the tooltip escaper, and
// the graph reconciliation. Split out of `VaultGalaxy.tsx`, which held them
// beside ~500 lines of THREE and force-graph wiring they have nothing to do
// with.
//
// Two of these are load-bearing in ways a reader would not guess, which is why
// they are here and tested rather than inline:
//
//   * `escapeHtml` is an XSS boundary, not a formatting nicety.
//   * `reconcile` mutates in place on purpose, and decides when the physics
//     simulation is allowed to reheat.

// second-brain-gesture-nav tuning constants (design.md R2/R3/5.1/6.x) — tuned
// during the manual pass, not further pre-optimized.
export const DWELL_THRESHOLD_PX = 48;
export const DWELL_HOLD_MS = 300;
// How close the dolly may get to the note it is flying to. 40, not the 8 this
// briefly was (design.md D21): at radius 8 the camera sits about two node-radii
// off the dot's surface, so the note fills the viewport as a wall of colour
// with its own label clipped and no neighbours in frame — arriving, but with
// nothing to arrive AT. Dwell accuracy does not improve past this point either,
// since DWELL_THRESHOLD_PX measures from the node's projected centre, so an
// enormous dot buys nothing; what helps is having no competing node within that
// threshold. 40 sits just inside STEP_FLIGHT_DISTANCE (60, what a rail step
// already parks at, for the same framing reason) — the note is unmistakably
// the subject, its one-hop neighbours are still visible as context.
export const ZOOM_MIN_RADIUS = 40;
export const ZOOM_MAX_RADIUS = 2500;

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
export const ANCHOR_THRESHOLD_PX = 130;
// Radians per pixel of hand travel for the fist orbit (design.md D25), matching
// the orb loop's feel — the same value this carried before D20 removed the
// drive, restored with it.
export const ORBIT_SENSITIVITY = 0.006;
// How long a NEW note must stay under the sight before the camera commits to it
// (design.md D23). This replaced a sight-movement dead-band, which asked the
// wrong question: "has the hand travelled far enough" cannot separate a
// deliberate move to another note from a hand wobbling between two of them in a
// dense region, and the wobble is what made the camera jump note to note. "Has
// the sight STAYED on it" separates them exactly.
//
// Acquiring a target when there is none stays instant — only SWITCHING costs
// this. The acquiring ring closes over the same interval, so the wait is
// visible; that is what lets it be this long without reading as lag. This is
// the one number to change if it still feels twitchy, or now too slow.
export const ZOOM_LOCK_HOLD_MS = 1500;
// A rail step's flight: long enough that the user sees where in the galaxy they
// were taken (the spec requires the travel to be visible), short enough not to
// feel like waiting.
export const STEP_FLIGHT_MS = 600;
// How far from the destination note the flight parks. A little above
// ZOOM_MIN_RADIUS, so a step frames the note and its immediate neighbours
// rather than pressing right up against it.
export const STEP_FLIGHT_DISTANCE = 60;
// How long the rail stays inert after a step (design.md D11). Must exceed the
// universal dwell's own 300 ms hold, or a still-held hand would charge a fresh
// dwell on the repopulated rail and fire a second step.
export const STEP_LOCK_MS = 700;
// How long the find field waits before asking main (voice-finds-a-note D2).
// Matching moved out of the renderer, so each query is now a local IPC round
// trip rather than an array filter — short enough that typing still feels
// answered, long enough that a fast typist does not fire one scan per
// character. This is the number to change if the field ever reads as laggy;
// the answer is never a second matcher in the renderer.
export const RAIL_SEARCH_DEBOUNCE_MS = 120;

// add-galaxy-node-labels tuning constants (design.md D9, revised D11).
// No distance cutoff: every eligible note's title is always a selection
// candidate (design.md D11) — `sizeAttenuation` on the sprite material
// already shrinks a distant title toward illegible-and-ignorable on its own,
// the same way a distant node's dot is already small, so a second, hard
// on/off gate on top of that added a failure mode (a note that never gets
// close enough to the camera's orbit target never got named at all) without
// actually improving readability. `Infinity` here reads as "no cutoff" at
// every call site that squares or compares it, with no special-casing needed.
export const LABEL_MAX_DISTANCE = Infinity;
// The number of label sprites is still a fixed pool sized once at mount
// (design.md D2's cost argument stands — this is a ceiling, not a target).
// Sized to the vault's own note count so a normal personal vault gets every
// note titled with room to spare; capped so a pathologically large vault
// (thousands of notes) can't allocate thousands of canvases up front. Raise
// this if a real vault's note count exceeds it (design.md D11).
export const LABEL_BUDGET_CEILING = 500;
// Text a bit above a default-sized node (radius ~4).
export const LABEL_WORLD_HEIGHT = 5;
export const LABEL_Y_OFFSET = 6;
// A reveal is a threshold crossing during navigation, and 10Hz is
// imperceptible for that — positions still update every frame (design.md D5).
export const SELECT_INTERVAL_MS = 100;

// Escapes text before it reaches 3d-force-graph's built-in tooltip, which
// assigns the `.nodeLabel()` accessor's return value to `innerHTML`
// (design.md D9/H2) — an ingested note titled `<img src=x onerror=…>` would
// otherwise execute in the privileged renderer. Escaped entities render as
// literal text in the tooltip, exactly like the title itself.
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

// Renderer owns positions (design.md D3/H2): reconciles the incoming
// position-free graph against `positionsRef`'s live node objects in place —
// same references go back into `.graphData()` — and only reheats the sim
// when the topology (not just metadata) actually changed (M-B).
export function reconcile(
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

/** A point in the galaxy's world space. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * Where the camera should fly to when the rail steps to a note.
 *
 * Keeps the camera's **current viewing direction** and changes only distance,
 * so a step reads as travelling to a note rather than being spun to a new
 * orientation as well.
 *
 * The degenerate case is the reason this is worth its own function: when the
 * camera sits exactly on its own target the direction vector has zero length,
 * and normalizing it yields `NaN` for every component — which reaches
 * `cameraPosition()` and puts the camera nowhere, with no error. Falling back
 * to the +Z axis keeps the step boring instead of fatal.
 */
export function stepFlightTarget(node: Vec3, aim: Vec3, camera: Vec3, distance: number): { position: Vec3; destination: Vec3 } {
  let dx = camera.x - aim.x;
  let dy = camera.y - aim.y;
  let dz = camera.z - aim.z;
  if (dx * dx + dy * dy + dz * dz < 1e-6) {
    dx = 0;
    dy = 0;
    dz = 1;
  }
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    destination: { x: node.x, y: node.y, z: node.z },
    position: {
      x: node.x + (dx / length) * distance,
      y: node.y + (dy / length) * distance,
      z: node.z + (dz / length) * distance,
    },
  };
}
