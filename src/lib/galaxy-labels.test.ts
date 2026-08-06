import { describe, it, expect } from "vitest";
import { selectLabels } from "./galaxy-labels";
import type { GalaxyNavNode } from "./galaxy-nav";

const ORIGIN = { x: 0, y: 0, z: 0 };

function node(id: string, x: number, extra: Partial<GalaxyNavNode> = {}): GalaxyNavNode {
  return { id, title: id, x, y: 0, z: 0, ...extra };
}

describe("selectLabels", () => {
  it("excludes a node beyond maxDistance and includes one inside it", () => {
    const near = node("near", 10);
    const far = node("far", 200);
    const result = selectLabels([near, far], ORIGIN, { maxDistance: 100, budget: 24, eligible: null });
    expect(result.map((n) => n.id)).toEqual(["near"]);
  });

  it("includes a node exactly at the maxDistance boundary", () => {
    const boundary = node("boundary", 100);
    const result = selectLabels([boundary], ORIGIN, { maxDistance: 100, budget: 24, eligible: null });
    expect(result.map((n) => n.id)).toEqual(["boundary"]);
  });

  it("orders results nearest-camera-first", () => {
    const a = node("a", 50);
    const b = node("b", 10);
    const c = node("c", 30);
    const result = selectLabels([a, b, c], ORIGIN, { maxDistance: 100, budget: 24, eligible: null });
    expect(result.map((n) => n.id)).toEqual(["b", "c", "a"]);
  });

  it("truncates a selection longer than budget to the nearest ones", () => {
    const nodes = [node("far", 40), node("near", 10), node("mid", 20)];
    const result = selectLabels(nodes, ORIGIN, { maxDistance: 100, budget: 2, eligible: null });
    expect(result.map((n) => n.id)).toEqual(["near", "mid"]);
  });

  it("filters nothing when eligible is null, and excludes non-members when it is a set", () => {
    const a = node("a", 10);
    const b = node("b", 20);
    const all = selectLabels([a, b], ORIGIN, { maxDistance: 100, budget: 24, eligible: null });
    expect(all.map((n) => n.id)).toEqual(["a", "b"]);

    const filtered = selectLabels([a, b], ORIGIN, { maxDistance: 100, budget: 24, eligible: new Set(["b"]) });
    expect(filtered.map((n) => n.id)).toEqual(["b"]);
  });

  it("includes ghost nodes", () => {
    const ghost = node("ghost", 10, { ghost: true });
    const result = selectLabels([ghost], ORIGIN, { maxDistance: 100, budget: 24, eligible: null });
    expect(result.map((n) => n.id)).toEqual(["ghost"]);
  });

  it("skips nodes with no position yet", () => {
    const noPos: GalaxyNavNode = { id: "no-pos", title: "No position" };
    const withPos = node("with-pos", 10);
    const result = selectLabels([noPos, withPos], ORIGIN, { maxDistance: 100, budget: 24, eligible: null });
    expect(result.map((n) => n.id)).toEqual(["with-pos"]);
  });
});
