import { describe, it, expect } from "vitest";
import {
  railNeighbours,
  railRoots,
  railEntriesFromMatches,
  connectedRegions,
  linkDegrees,
  RAIL_ISLAND_CLASS,
  RAIL_ENTRY_POINT_BUDGET,
  type RailNode,
} from "./galaxy-rail";
import { HUD_CHROME_CLASS } from "./hudChrome";
import { colorForNode, GHOST_COLOR } from "./galaxy-colors";
import { focusNeighborhood } from "./galaxy-nav";

const NODES: RailNode[] = [
  { id: "hub", title: "Hub", tags: ["project"] },
  { id: "a", title: "Alpha", tags: ["idea"] },
  { id: "b", title: "Beta", tags: [] },
  { id: "ghost", title: "Ghost", tags: [], ghost: true },
  { id: "far", title: "Far", tags: [] },
];

// hub -- a, hub -- b, hub -- ghost, a -- far
const LINKS = [
  { source: "hub", target: "a" },
  { source: "hub", target: "b" },
  { source: "hub", target: "ghost" },
  { source: "a", target: "far" },
];

describe("RAIL_ISLAND_CLASS", () => {
  // Omitting this class is the one failure that is silent rather than visible:
  // the rail would still render and still be mouse-clickable, but drop beneath
  // the galaxy layer and become unreachable by hand (design.md D9).
  it("carries HUD_CHROME_CLASS, which is the whole of the rail's hand reachability", () => {
    expect(RAIL_ISLAND_CLASS.split(" ")).toContain(HUD_CHROME_CLASS);
  });

  it("carries hud-hit, so the mouse reaches it through the click-through region", () => {
    expect(RAIL_ISLAND_CLASS.split(" ")).toContain("hud-hit");
  });
});

describe("linkDegrees", () => {
  it("counts a link once for each endpoint it touches", () => {
    const degrees = linkDegrees(LINKS);
    expect(degrees.get("hub")).toBe(3);
    expect(degrees.get("a")).toBe(2);
    expect(degrees.get("b")).toBe(1);
    expect(degrees.get("far")).toBe(1);
  });
});

describe("railNeighbours", () => {
  it("lists the centre note's one-hop neighbours and excludes the centre itself", () => {
    const entries = railNeighbours({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id).sort()).toEqual(["a", "b", "ghost"]);
  });

  it("lists exactly what focusNeighborhood keeps bright, so the rail cannot disagree about one hop", () => {
    const entries = railNeighbours({ centreId: "hub", nodes: NODES, links: LINKS });
    const bright = focusNeighborhood(["hub"], LINKS);
    bright.delete("hub");
    expect(new Set(entries.map((e) => e.id))).toEqual(bright);
  });

  it("orders neighbours most connected first", () => {
    const entries = railNeighbours({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id)).toEqual(["a", "b", "ghost"]);
    expect(entries.map((e) => e.linkCount)).toEqual([2, 1, 1]);
  });

  it("includes a ghost neighbour but flags it not openable", () => {
    const entries = railNeighbours({ centreId: "hub", nodes: NODES, links: LINKS });
    const ghost = entries.find((e) => e.id === "ghost");
    expect(ghost).toBeDefined();
    expect(ghost!.openable).toBe(false);
    expect(entries.find((e) => e.id === "a")!.openable).toBe(true);
  });

  it("does NOT reach a second hop", () => {
    const entries = railNeighbours({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id)).not.toContain("far");
  });

  it("shows each note in the colour its dot has in the graph", () => {
    const entries = railNeighbours({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.find((e) => e.id === "a")!.tagColor).toBe(colorForNode({ tags: ["idea"] }));
    expect(entries.find((e) => e.id === "ghost")!.tagColor).toBe(colorForNode({ tags: [], ghost: true }));
  });

  it("is empty for a note with no neighbours", () => {
    expect(railNeighbours({ centreId: "far", nodes: NODES, links: [] })).toEqual([]);
  });

  it("is NOT capped, so a well-connected note's rail still matches the declutter exactly", () => {
    const many: RailNode[] = [{ id: "hub", title: "Hub", tags: [] }];
    const manyLinks = [];
    for (let i = 0; i < RAIL_ENTRY_POINT_BUDGET * 3; i++) {
      many.push({ id: `n${i}`, title: `N${i}`, tags: [] });
      manyLinks.push({ source: "hub", target: `n${i}` });
    }
    expect(railNeighbours({ centreId: "hub", nodes: many, links: manyLinks })).toHaveLength(
      RAIL_ENTRY_POINT_BUDGET * 3,
    );
  });
});

describe("connectedRegions", () => {
  it("groups notes reachable from one another in either direction", () => {
    const regions = connectedRegions(NODES, LINKS).map((r) => r.slice().sort());
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual(["a", "b", "far", "ghost", "hub"]);
  });

  it("separates a cloud that links to nothing in the main body", () => {
    const nodes: RailNode[] = [...NODES, { id: "x", title: "X", tags: [] }, { id: "y", title: "Y", tags: [] }];
    const links = [...LINKS, { source: "x", target: "y" }];
    const regions = connectedRegions(nodes, links).map((r) => r.slice().sort());
    expect(regions).toHaveLength(2);
    expect(regions).toContainEqual(["x", "y"]);
  });

  it("treats an unlinked note as its own region", () => {
    const regions = connectedRegions([{ id: "lonely", title: "Lonely", tags: [] }], []);
    expect(regions).toEqual([["lonely"]]);
  });

  it("ignores a link whose endpoint is not a node", () => {
    const regions = connectedRegions([{ id: "a", title: "A", tags: [] }], [{ source: "a", target: "missing" }]);
    expect(regions).toEqual([["a"]]);
  });

  it("handles a long chain without recursing", () => {
    const nodes: RailNode[] = [];
    const links = [];
    for (let i = 0; i < 20000; i++) {
      nodes.push({ id: `n${i}`, title: `N${i}`, tags: [] });
      if (i > 0) links.push({ source: `n${i - 1}`, target: `n${i}` });
    }
    expect(connectedRegions(nodes, links)).toHaveLength(1);
  });
});

describe("railRoots — the entry points", () => {
  it("offers the most connected notes first in a single-region vault", () => {
    const entries = railRoots({ nodes: NODES, links: LINKS });
    expect(entries[0].id).toBe("hub");
  });

  it("still offers a spread of hubs when the whole vault is one region", () => {
    // The coverage guarantee alone would give exactly one entry here; the fill
    // pass is what keeps a single-cloud vault usable (design.md D7b).
    expect(railRoots({ nodes: NODES, links: LINKS }).length).toBeGreaterThan(1);
  });

  it("gives an entry point to a cloud that links to nothing in the main body", () => {
    const nodes: RailNode[] = [...NODES, { id: "x", title: "X", tags: [] }, { id: "y", title: "Y", tags: [] }];
    const links = [...LINKS, { source: "x", target: "y" }];
    const ids = railRoots({ nodes, links }).map((e) => e.id);
    expect(ids.some((id) => id === "x" || id === "y")).toBe(true);
  });

  it("keeps every region's entry point even when regions outnumber the budget", () => {
    // The budget bounds the FILL, never the guarantee — dropping a region to
    // keep the list short is the exact defect entry points exist to remove.
    const nodes: RailNode[] = [];
    const links = [];
    const regionCount = 5;
    for (let r = 0; r < regionCount; r++) {
      nodes.push({ id: `r${r}a`, title: `R${r}A`, tags: [] });
      nodes.push({ id: `r${r}b`, title: `R${r}B`, tags: [] });
      links.push({ source: `r${r}a`, target: `r${r}b` });
    }
    const entries = railRoots({ nodes, links, budget: 2 });
    expect(entries.length).toBe(regionCount);
    for (let r = 0; r < regionCount; r++) {
      expect(entries.some((e) => e.id === `r${r}a` || e.id === `r${r}b`)).toBe(true);
    }
  });

  it("leads with the largest regions", () => {
    const nodes: RailNode[] = [
      { id: "big1", title: "Big1", tags: [] },
      { id: "big2", title: "Big2", tags: [] },
      { id: "big3", title: "Big3", tags: [] },
      { id: "small1", title: "Small1", tags: [] },
      { id: "small2", title: "Small2", tags: [] },
    ];
    const links = [
      { source: "big1", target: "big2" },
      { source: "big2", target: "big3" },
      { source: "small1", target: "small2" },
    ];
    expect(railRoots({ nodes, links, budget: 2 })[0].id).toBe("big2");
  });

  it("excludes a lone unlinked note — stepping to it would land on an empty rail", () => {
    const nodes: RailNode[] = [...NODES, { id: "lonely", title: "Lonely", tags: [] }];
    expect(railRoots({ nodes, links: LINKS }).map((e) => e.id)).not.toContain("lonely");
  });

  it("never lists the same note twice across the guarantee and the fill", () => {
    const entries = railRoots({ nodes: NODES, links: LINKS });
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("yields nothing for an empty graph", () => {
    expect(railRoots({ nodes: [], links: [] })).toEqual([]);
  });
});

describe("railEntriesFromMatches — colouring what main matched", () => {
  it("preserves the order it was given, rather than re-ranking it", () => {
    // The ordering contract lives in electron/note-name-match.mjs and is tested
    // there. What matters here is that the renderer does not have a second
    // opinion about it: a mapper that sorted would silently break
    // "spoken and typed searches agree" without failing that module's tests.
    const matches = [
      { id: "c", title: "C", tags: [], ghost: false, linkCount: 0, openable: true },
      { id: "a", title: "A", tags: [], ghost: false, linkCount: 99, openable: true },
      { id: "b", title: "B", tags: [], ghost: false, linkCount: 5, openable: true },
    ];
    expect(railEntriesFromMatches(matches).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("colours an entry with the same function the node's dot uses", () => {
    const tagged = { id: "n", title: "N", tags: ["arch"], ghost: false, linkCount: 0, openable: true };
    const [entry] = railEntriesFromMatches([tagged]);
    expect(entry.tagColor).toBe(colorForNode({ tags: ["arch"] }));
  });

  it("colours a ghost match as a ghost, and keeps it not openable", () => {
    const ghost = { id: "g", title: "G", tags: [], ghost: true, linkCount: 0, openable: false };
    const [entry] = railEntriesFromMatches([ghost]);
    expect(entry.tagColor).toBe(GHOST_COLOR);
    expect(entry.openable).toBe(false);
  });

  it("carries the link count through rather than recomputing it", () => {
    const match = { id: "n", title: "N", tags: [], ghost: false, linkCount: 7, openable: true };
    expect(railEntriesFromMatches([match])[0].linkCount).toBe(7);
  });

  it("yields nothing for no matches", () => {
    expect(railEntriesFromMatches([])).toEqual([]);
  });
});
