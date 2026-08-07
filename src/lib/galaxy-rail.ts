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

// How many entry points the rail aims for. A FLOOR on the fill, never a cap on
// the coverage guarantee (design.md D7b): a vault with more disconnected regions
// than this yields more entries than this, because the spec requires every
// region to have one and a cap that dropped a region would silently restore the
// exact defect entry points exist to remove.
//
// The one-hop neighbour list is not capped either, for a different reason: the
// spec requires it to be exactly the set the focus declutter uses, which a top-N
// cut would break for a well-connected note. The island scrolls in both cases.
export const RAIL_ENTRY_POINT_BUDGET = 12;

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
 * The one-hop neighbours of `centreId`, most connected first.
 *
 * The set comes from `focusNeighborhood`, the same function the focus declutter
 * and the pointed-at highlight use, which is what makes "nothing in the galaxy
 * can disagree about what one hop means" true rather than intended. That
 * function returns the queried id inside its result, so the centre note is
 * filtered out of its own list here.
 *
 * Deliberately a separate function from `railRoots`: "where can I go from here"
 * and "where else is there" are different questions, and one function answering
 * both by branching on a null centre is what let the second one go unanswered
 * once a centre was set (design.md D7b).
 */
export function railNeighbours({
  centreId,
  nodes,
  links,
}: {
  centreId: string;
  nodes: Iterable<RailNode>;
  links: Iterable<GalaxyLinkRef>;
}): RailEntry[] {
  const linkList = Array.from(links);
  const degrees = linkDegrees(linkList);
  const neighborhood = focusNeighborhood([centreId], linkList);
  return Array.from(nodes)
    .filter((node) => node.id !== centreId && neighborhood.has(node.id))
    .map((node) => toEntry(node, degrees))
    .sort(byConnectedness);
}

/**
 * The graph's connected regions, as arrays of node ids — links read
 * undirectionally, over the same link list every other galaxy consumer reads.
 *
 * A "region" here is a cloud of notes reachable from one another by links in
 * either direction. A vault routinely has several: notes written about a
 * separate subject need not link to anything in the main body at all.
 */
export function connectedRegions(nodes: Iterable<RailNode>, links: Iterable<GalaxyLinkRef>): string[][] {
  const adjacency = new Map<string, string[]>();
  const ids = new Set<string>();
  for (const node of nodes) {
    ids.add(node.id);
    adjacency.set(node.id, []);
  }
  for (const link of links) {
    if (!ids.has(link.source) || !ids.has(link.target)) continue;
    adjacency.get(link.source)!.push(link.target);
    adjacency.get(link.target)!.push(link.source);
  }

  const seen = new Set<string>();
  const regions: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    // Iterative rather than recursive: a long chain of notes is an ordinary
    // vault shape, and recursion would blow the stack on one.
    const region: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const current = queue.pop()!;
      region.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    regions.push(region);
  }
  return regions;
}

/**
 * The rail's entry points: notes the user can jump to regardless of where the
 * rail is centred (design.md D7b).
 *
 * Two passes, and the order between them is the substance:
 *
 * 1. **Guarantee** — every region contributes its most connected note, so "no
 *    region is without an entry point" holds by construction rather than by the
 *    ordering happening to work out. Taking the top N by degree over the whole
 *    vault does NOT achieve this: the top N can all sit inside the largest
 *    cloud, which is exactly the cloud the user is already in.
 * 2. **Fill** — whatever `budget` remains goes to the next most connected notes
 *    overall, so a vault that is one big cloud still offers a spread of hubs
 *    rather than a single entry.
 *
 * `budget` therefore bounds the fill and never the guarantee: more regions than
 * budget yields more entries than budget, and the island scrolls. Dropping a
 * region to keep the list short would silently restore the defect this exists to
 * remove.
 *
 * A region of one note with no links contributes nothing — it has no neighbours
 * to step to, so an entry for it would lead to an empty rail.
 */
export function railRoots({
  nodes,
  links,
  budget = RAIL_ENTRY_POINT_BUDGET,
}: {
  nodes: Iterable<RailNode>;
  links: Iterable<GalaxyLinkRef>;
  budget?: number;
}): RailEntry[] {
  const linkList = Array.from(links);
  const nodeList = Array.from(nodes);
  const degrees = linkDegrees(linkList);
  const byId = new Map(nodeList.map((node) => [node.id, node]));

  const regions = connectedRegions(nodeList, linkList).filter((region) => region.length > 1);
  const chosen: RailEntry[] = [];
  const taken = new Set<string>();
  for (const region of regions) {
    const best = region
      .map((id) => byId.get(id))
      .filter((node): node is RailNode => node !== undefined)
      .map((node) => toEntry(node, degrees))
      .sort(byConnectedness)[0];
    if (!best) continue;
    chosen.push(best);
    taken.add(best.id);
  }
  // Largest regions first, so a vault whose regions exceed the budget still
  // leads with the clouds most of the vault lives in.
  const regionSizeById = new Map<string, number>();
  for (const region of regions) for (const id of region) regionSizeById.set(id, region.length);
  chosen.sort((a, b) => {
    const sizeDelta = (regionSizeById.get(b.id) ?? 0) - (regionSizeById.get(a.id) ?? 0);
    return sizeDelta !== 0 ? sizeDelta : byConnectedness(a, b);
  });

  const fill = nodeList
    .filter((node) => !taken.has(node.id) && (degrees.get(node.id) ?? 0) > 0)
    .map((node) => toEntry(node, degrees))
    .sort(byConnectedness)
    .slice(0, Math.max(0, budget - chosen.length));

  return [...chosen, ...fill];
}
