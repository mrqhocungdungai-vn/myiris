// How a note is coloured in the galaxy, in one place.
//
// Lifted out of `VaultGalaxy.tsx` by galaxy-note-reachable-by-hand: the step
// rail names notes the user has not yet flown to, and it shows each entry in
// the same colour that note's dot has in the view behind it — so the rail and
// the graph must derive it from one function rather than two that agree today.
import * as THREE from "three";
import type { GalaxyNode, GalaxyLink } from "./galaxy-types";

export const TAG_COLORS = ["#5ec8ff", "#ff8a5e", "#8affc1", "#c98aff", "#ffe45e", "#ff5ec8"];

// An unresolved `[[wikilink]]` target: named but not openable, so it reads as
// present-but-inert rather than as another tagged note.
export const GHOST_COLOR = "rgba(200, 210, 230, 0.35)";

// A note with no tags at all — a neutral blue that is not one of TAG_COLORS.
export const UNTAGGED_COLOR = "#9fb4ff";

/**
 * A note's colour: its first tag hashed into `TAG_COLORS`, so the same tag is
 * always the same colour within a vault without anyone assigning one.
 */
export function colorForNode(node: { tags: string[]; ghost?: boolean }): string {
  if (node.ghost) return GHOST_COLOR;
  const tag = node.tags[0];
  if (!tag) return UNTAGGED_COLOR;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

// ---------------------------------------------------------------------------
// Highlighting and dimming — the visual encoding the galaxy view paints with.
//
// Moved out of VaultGalaxy.tsx (which was 1100 lines) because these are
// precedence rules, not rendering: several conditions can apply to the same
// node or link at once and the ORDER decides what the user sees. That order is
// the substance, and inside a component module nothing could exercise it.
//
// THREE is needed only to parse a CSS colour string in `withAlpha`.
// ---------------------------------------------------------------------------

export const DWELL_HIGHLIGHT_COLOR = "#fff2a8";
// second-brain-focus 5.1: distinguishes a focused node from an ordinary one —
// distinct from every TAG_COLORS entry, the ghost gray, and the dwell color,
// so a focused node reads unambiguously regardless of its tag.
export const FOCUS_HIGHLIGHT_COLOR = "#39ff88";
// A large galaxy converges into a dense mass as the vault grows, and
// rotating in 3D to reach the cluster around whatever is focused is a real
// cost (a shared-focus follow-on). Rather than changing what data is
// simulated or positioned, everything outside the focus's one-hop
// neighborhood (focusNeighborhood, galaxy-nav.ts) is dimmed near-invisible —
// decluttering the view around a selection without moving or hiding a
// single node.
export const DIM_NODE_ALPHA = 0.08;
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
export const DIM_LINK_ALPHA = 0.025;
export const LINK_BASE_COLOR = "rgba(140, 170, 255, 0.175)";
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
export const LINK_HIGHLIGHT_COLOR = "rgba(255, 245, 190, 0.98)";

// Both node and link colors above are CSS color strings, some already
// carrying their own alpha (colorForNode's ghost gray, LINK_BASE_COLOR) —
// three-forcegraph reads that alpha and multiplies it into the material's
// final opacity (nodeOpacity/linkOpacity are a single graph-wide constant,
// not a per-element accessor, so alpha-in-the-color-string is the only lever
// for dimming one element differently from another). This re-expresses any
// color as an rgba string at a new alpha, discarding whatever alpha it had.
const alphaCache = new Map<string, string>();
export function withAlpha(color: string, alpha: number): string {
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
export function makeNodeColor(pointedAtId: string | null, focusIds: Set<string>, litIds: Set<string> | null) {
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
export function linkEndpointId(endpoint: string | GalaxyNode): string {
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
export function makeLinkColor(litIds: Set<string> | null, pointedAtId: string | null) {
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
