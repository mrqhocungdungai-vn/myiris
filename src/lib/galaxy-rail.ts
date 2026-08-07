import { focusNeighborhood, type GalaxyLinkRef } from "./galaxy-nav";
import { colorForNode } from "./galaxy-colors";
import { HUD_CHROME_CLASS } from "./hudChrome";

// The step rail's data derivation (galaxy-note-reachable-by-hand design.md
// D7/D12): what the rail lists, and in what order. Kept apart from
// `galaxy-anchor.ts` because anchor policy and rail ordering change for
// different reasons — the anchor answers "what does the camera turn around",
// the rail answers "where could the user go next".
//
// Pure by construction: no React, no DOM, no live graph instance. Even the
// island's class string is composed here and exported, so the one thing that
// silently makes the rail unreachable by hand — omitting `HUD_CHROME_CLASS` —
// is assertable in a `node`-environment test with nothing rendered.

/**
 * The rail island's class list. `HUD_CHROME_CLASS` is what puts the island
 * above the galaxy layer AND what makes the universal point-and-hold dwell
 * reach it (`src/lib/hudChrome.ts`, and the archived
 * hud-panels-stay-hand-reachable-under-galaxy change): one declaration, both
 * consequences. `hud-hit` is what lets the mouse click through the HUD's
 * click-through region onto it.
 */
export const RAIL_ISLAND_CLASS = `hud-galaxy-rail hud-hit ${HUD_CHROME_CLASS}`;

// How many entry points a rail with no centre note offers. The one-hop case is
// deliberately NOT capped — the spec requires the rail's neighbourhood to be
// exactly the one the focus declutter uses, which a top-N cut would quietly
// break for a well-connected note — so the island scrolls instead. Entry
// points have no such requirement: "drawn from the graph itself, ordered so the
// most connected notes come first" is satisfied by a prefix of that order.
export const RAIL_ENTRY_POINT_LIMIT = 12;

export type RailNode = { id: string; title: string; tags: string[]; ghost?: boolean };

export type RailEntry = {
  id: string;
  title: string;
  /** The colour this note's dot has in the graph behind the rail — same function, never a second copy. */
  tagColor: string;
  /** How many links touch this note — the "how connected is it" the spec asks each entry to show. */
  linkCount: number;
  /** False for an unresolved `[[wikilink]]` target: steppable, but there is no file to open. */
  openable: boolean;
};

/** Link count per node id, counting a link once for each endpoint it touches. */
export function linkDegrees(links: Iterable<GalaxyLinkRef>): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const link of links) {
    degrees.set(link.source, (degrees.get(link.source) ?? 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) ?? 0) + 1);
  }
  return degrees;
}

function toEntry(node: RailNode, degrees: Map<string, number>): RailEntry {
  return {
    id: node.id,
    title: node.title,
    tagColor: colorForNode(node),
    linkCount: degrees.get(node.id) ?? 0,
    openable: !node.ghost,
  };
}

// Most-connected first, then by title, then by id — the last two only so the
// order is total and a rail does not reshuffle between two equally-connected
// notes on every recompute.
function byConnectedness(a: RailEntry, b: RailEntry): number {
  if (a.linkCount !== b.linkCount) return b.linkCount - a.linkCount;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * The rail's entries for `centreId` — its one-hop neighbours, most connected
 * first — or, when the rail is centred on nothing, the vault's most connected
 * notes as entry points so a first step needs no aiming at all.
 *
 * The one-hop set comes from `focusNeighborhood`, the same function the focus
 * declutter and the pointed-at highlight use, which is what makes "nothing in
 * the galaxy can disagree about what one hop means" true rather than intended.
 * That function returns the queried id inside its result, so the centre note is
 * filtered out of its own list here.
 */
export function railEntries({
  centreId,
  nodes,
  links,
  entryPointLimit = RAIL_ENTRY_POINT_LIMIT,
}: {
  centreId: string | null;
  nodes: Iterable<RailNode>;
  links: Iterable<GalaxyLinkRef>;
  entryPointLimit?: number;
}): RailEntry[] {
  const linkList = Array.from(links);
  const degrees = linkDegrees(linkList);
  const nodeList = Array.from(nodes);

  if (centreId === null) {
    return nodeList
      .map((node) => toEntry(node, degrees))
      .sort(byConnectedness)
      .slice(0, entryPointLimit);
  }

  const neighborhood = focusNeighborhood([centreId], linkList);
  return nodeList
    .filter((node) => node.id !== centreId && neighborhood.has(node.id))
    .map((node) => toEntry(node, degrees))
    .sort(byConnectedness);
}
