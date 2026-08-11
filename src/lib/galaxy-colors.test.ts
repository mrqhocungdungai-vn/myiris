import { describe, it, expect } from "vitest";
import {
  colorForNode,
  makeNodeColor,
  makeLinkColor,
  linkEndpointId,
  withAlpha,
  TAG_COLORS,
  GHOST_COLOR,
  UNTAGGED_COLOR,
  DWELL_HIGHLIGHT_COLOR,
  FOCUS_HIGHLIGHT_COLOR,
  LINK_BASE_COLOR,
  LINK_HIGHLIGHT_COLOR,
} from "./galaxy-colors";
import type { GalaxyNode, GalaxyLink } from "./galaxy-types";

const node = (id: string, tags: string[] = [], ghost = false) => ({ id, tags, ghost }) as GalaxyNode;
const link = (source: string, target: string) => ({ source, target }) as GalaxyLink;

describe("colorForNode", () => {
  it("marks an unresolved wikilink target as a ghost, whatever its tags", () => {
    expect(colorForNode({ tags: ["a"], ghost: true })).toBe(GHOST_COLOR);
  });

  it("gives an untagged note the neutral colour, not a tag colour", () => {
    expect(colorForNode({ tags: [] })).toBe(UNTAGGED_COLOR);
    expect(TAG_COLORS).not.toContain(UNTAGGED_COLOR);
  });

  // The point of hashing: nobody assigns colours, but a tag looks the same
  // everywhere in a vault.
  it("gives the same tag the same colour every time", () => {
    expect(colorForNode({ tags: ["project"] })).toBe(colorForNode({ tags: ["project"] }));
    expect(TAG_COLORS).toContain(colorForNode({ tags: ["project"] }));
  });

  it("colours by the first tag only", () => {
    expect(colorForNode({ tags: ["project", "zzz"] })).toBe(colorForNode({ tags: ["project"] }));
  });
});

describe("withAlpha", () => {
  it("re-expresses a colour at a new alpha, discarding whatever it had", () => {
    expect(withAlpha("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(withAlpha("rgba(255, 255, 255, 0.9)", 0.1)).toBe("rgba(255, 255, 255, 0.1)");
  });

  it("is stable across calls (it caches)", () => {
    expect(withAlpha("#123456", 0.25)).toBe(withAlpha("#123456", 0.25));
  });
});

// The order is the substance: several of these can apply to one node at once.
describe("makeNodeColor precedence", () => {
  const focus = new Set(["f"]);

  it("lets the pointed-at highlight win over the focus highlight", () => {
    const color = makeNodeColor("f", focus, null);
    expect(color(node("f"))).toBe(DWELL_HIGHLIGHT_COLOR);
  });

  // Losing sight of what you have selected because you pointed elsewhere would
  // be a worse trade than the spotlight is worth.
  it("keeps a focused node bright even when the spotlight is elsewhere", () => {
    const color = makeNodeColor("other", focus, new Set(["other"]));
    expect(color(node("f"))).toBe(FOCUS_HIGHLIGHT_COLOR);
  });

  it("dims a node outside the lit set", () => {
    const color = makeNodeColor(null, new Set(), new Set(["lit"]));
    const dimmed = color(node("dark", ["x"]));
    expect(dimmed).toMatch(/^rgba\(/);
    expect(dimmed).not.toBe(colorForNode({ tags: ["x"] }));
  });

  it("dims nothing when there is no lit set", () => {
    const color = makeNodeColor(null, new Set(), null);
    expect(color(node("any", ["x"]))).toBe(colorForNode({ tags: ["x"] }));
  });
});

describe("linkEndpointId", () => {
  // three-forcegraph rewrites an endpoint from an id string into the node
  // object once the simulation initializes, so both shapes must work.
  it("reads an endpoint whether it is still an id or already a node", () => {
    expect(linkEndpointId("a")).toBe("a");
    expect(linkEndpointId(node("a"))).toBe("a");
  });
});

describe("makeLinkColor precedence", () => {
  it("brightens a link incident to the pointed-at node above everything else", () => {
    const color = makeLinkColor(new Set(["z"]), "p");
    expect(color(link("p", "q"))).toBe(LINK_HIGHLIGHT_COLOR);
    expect(color(link("q", "p"))).toBe(LINK_HIGHLIGHT_COLOR);
  });

  // Lighting the neighbours' own edges too would draw a blob rather than a
  // star: the question is what THIS node touches.
  it("does not brighten links merely among the neighbourhood", () => {
    const color = makeLinkColor(new Set(["p", "q", "r"]), "p");
    expect(color(link("q", "r"))).not.toBe(LINK_HIGHLIGHT_COLOR);
  });

  it("uses the base colour when nothing is dimmed", () => {
    expect(makeLinkColor(null, null)(link("a", "b"))).toBe(LINK_BASE_COLOR);
  });

  it("keeps a link bright while either endpoint is lit, and dims it otherwise", () => {
    const color = makeLinkColor(new Set(["a"]), null);
    expect(color(link("a", "b"))).toBe(LINK_BASE_COLOR);
    expect(color(link("c", "d"))).not.toBe(LINK_BASE_COLOR);
  });
});
