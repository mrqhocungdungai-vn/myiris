import { describe, it, expect } from "vitest";
import { railEntries, linkDegrees, RAIL_ISLAND_CLASS, RAIL_ENTRY_POINT_LIMIT, type RailNode } from "./galaxy-rail";
import { HUD_CHROME_CLASS } from "./hudChrome";
import { colorForNode } from "./galaxy-colors";
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

describe("railEntries — centred on a note", () => {
  it("lists the centre note's one-hop neighbours and excludes the centre itself", () => {
    const entries = railEntries({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id).sort()).toEqual(["a", "b", "ghost"]);
  });

  it("lists exactly what focusNeighborhood keeps bright, so the rail cannot disagree about one hop", () => {
    const entries = railEntries({ centreId: "hub", nodes: NODES, links: LINKS });
    const bright = focusNeighborhood(["hub"], LINKS);
    bright.delete("hub");
    expect(new Set(entries.map((e) => e.id))).toEqual(bright);
  });

  it("orders neighbours most connected first", () => {
    const entries = railEntries({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id)).toEqual(["a", "b", "ghost"]);
    expect(entries.map((e) => e.linkCount)).toEqual([2, 1, 1]);
  });

  it("includes a ghost neighbour but flags it not openable", () => {
    const entries = railEntries({ centreId: "hub", nodes: NODES, links: LINKS });
    const ghost = entries.find((e) => e.id === "ghost");
    expect(ghost).toBeDefined();
    expect(ghost!.openable).toBe(false);
    expect(entries.find((e) => e.id === "a")!.openable).toBe(true);
  });

  it("does NOT reach a second hop", () => {
    const entries = railEntries({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id)).not.toContain("far");
  });

  it("shows each note in the colour its dot has in the graph", () => {
    const entries = railEntries({ centreId: "hub", nodes: NODES, links: LINKS });
    expect(entries.find((e) => e.id === "a")!.tagColor).toBe(colorForNode({ tags: ["idea"] }));
    expect(entries.find((e) => e.id === "ghost")!.tagColor).toBe(colorForNode({ tags: [], ghost: true }));
  });

  it("is empty for a note with no neighbours", () => {
    expect(railEntries({ centreId: "far", nodes: NODES, links: [] })).toEqual([]);
  });

  it("is NOT capped, so a well-connected note's rail still matches the declutter exactly", () => {
    const many: RailNode[] = [{ id: "hub", title: "Hub", tags: [] }];
    const manyLinks = [];
    for (let i = 0; i < RAIL_ENTRY_POINT_LIMIT * 3; i++) {
      many.push({ id: `n${i}`, title: `N${i}`, tags: [] });
      manyLinks.push({ source: "hub", target: `n${i}` });
    }
    expect(railEntries({ centreId: "hub", nodes: many, links: manyLinks })).toHaveLength(
      RAIL_ENTRY_POINT_LIMIT * 3,
    );
  });
});

describe("railEntries — entry points, with no centre note", () => {
  it("offers the most connected notes first, so a first step needs no aiming", () => {
    const entries = railEntries({ centreId: null, nodes: NODES, links: LINKS });
    expect(entries.map((e) => e.id)).toEqual(["hub", "a", "b", "far", "ghost"]);
  });

  it("caps the entry points at the limit", () => {
    const entries = railEntries({ centreId: null, nodes: NODES, links: LINKS, entryPointLimit: 2 });
    expect(entries.map((e) => e.id)).toEqual(["hub", "a"]);
  });

  it("yields an empty rail for an empty graph", () => {
    expect(railEntries({ centreId: null, nodes: [], links: [] })).toEqual([]);
  });

  it("orders deterministically between equally-connected notes", () => {
    const nodes: RailNode[] = [
      { id: "z", title: "Zulu", tags: [] },
      { id: "m", title: "Mike", tags: [] },
    ];
    expect(railEntries({ centreId: null, nodes, links: [] }).map((e) => e.id)).toEqual(["m", "z"]);
  });
});
