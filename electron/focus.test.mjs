// Electron-free coverage of the shared focus (second-brain-focus design D1/D2):
// pure state transitions over { ids, at }, resolved late against a literal
// graph object passed in by the caller — never imported from vault-graph.mjs.
import { describe, it, expect } from "vitest";
import { INITIAL_FOCUS, FOCUS_BOUND, FOCUS_PROMPT_BOUND, toggle, set, clear, resolve } from "./focus.mjs";

function node(id, { title = id, tags = [], ghost = false } = {}) {
  return { id, title, tags, ghost };
}

describe("set", () => {
  it("sets a selection", () => {
    const focus = set(INITIAL_FOCUS, ["a", "b"], 1);
    expect(focus.ids).toEqual(["a", "b"]);
  });

  it("de-duplicates and bounds the same way toggle does", () => {
    const many = Array.from({ length: FOCUS_BOUND + 5 }, (_, i) => `n${i}`);
    const focus = set(INITIAL_FOCUS, many, 1);
    expect(focus.ids).toHaveLength(FOCUS_BOUND);
    expect(focus.ids[focus.ids.length - 1]).toBe(`n${many.length - 1}`);
  });
});

describe("toggle", () => {
  it("adds an id that is not yet in the focus", () => {
    const focus = toggle(INITIAL_FOCUS, "a", null, 1);
    expect(focus.ids).toEqual(["a"]);
  });

  it("toggles an id off when it is already selected", () => {
    const withA = toggle(INITIAL_FOCUS, "a", null, 1);
    const withoutA = toggle(withA, "a", null, 2);
    expect(withoutA.ids).toEqual([]);
  });

  it("drops the oldest id when selecting past the bound", () => {
    let focus = INITIAL_FOCUS;
    for (let i = 0; i < FOCUS_BOUND; i++) focus = toggle(focus, `n${i}`, null, i);
    expect(focus.ids).toHaveLength(FOCUS_BOUND);
    focus = toggle(focus, "one-more", null, FOCUS_BOUND);
    expect(focus.ids).toHaveLength(FOCUS_BOUND);
    expect(focus.ids).not.toContain("n0"); // oldest dropped
    expect(focus.ids).toContain("one-more"); // newest kept
  });

  it("does not add a ghost node when a graph is supplied", () => {
    const graph = { nodes: [node("real"), node("ghost-target", { ghost: true })] };
    const focus = toggle(INITIAL_FOCUS, "ghost-target", graph, 1);
    expect(focus.ids).toEqual([]);
  });

  it("does not add an id absent from the supplied graph", () => {
    const graph = { nodes: [node("real")] };
    const focus = toggle(INITIAL_FOCUS, "unknown", graph, 1);
    expect(focus.ids).toEqual([]);
  });

  it("still allows removing an id already selected, graph or not", () => {
    const graph = { nodes: [node("real")] };
    const withReal = toggle(INITIAL_FOCUS, "real", graph, 1);
    const cleared = toggle(withReal, "real", graph, 2);
    expect(cleared.ids).toEqual([]);
  });
});

describe("clear", () => {
  it("empties the focus", () => {
    const withIds = set(INITIAL_FOCUS, ["a", "b"], 1);
    expect(clear(2).ids).toEqual([]);
    expect(clear(2)).not.toBe(withIds);
  });
});

describe("resolve", () => {
  const graph = {
    nodes: [
      node("a", { title: "Alpha", tags: ["x"] }),
      node("b", { title: "Beta", tags: [] }),
      node("ghost", { ghost: true }),
    ],
  };

  it("resolves ids against a literal graph, returning ids/titles/tags", () => {
    const focus = set(INITIAL_FOCUS, ["a", "b"], 1);
    expect(resolve(focus, graph)).toEqual([
      { id: "a", title: "Alpha", tags: ["x"] },
      { id: "b", title: "Beta", tags: [] },
    ]);
  });

  it("drops an id that is absent from the graph", () => {
    const focus = set(INITIAL_FOCUS, ["a", "removed", "b"], 1);
    expect(resolve(focus, graph).map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("drops a ghost node from the resolved result", () => {
    const focus = set(INITIAL_FOCUS, ["a", "ghost"], 1);
    expect(resolve(focus, graph).map((n) => n.id)).toEqual(["a"]);
  });

  it("applies a tighter limit at the point of use, keeping the most recent", () => {
    const focus = set(INITIAL_FOCUS, ["a", "b"], 1);
    expect(resolve(focus, graph, 1)).toEqual([{ id: "b", title: "Beta", tags: [] }]);
  });

  it("FOCUS_PROMPT_BOUND is tighter than the retention bound", () => {
    expect(FOCUS_PROMPT_BOUND).toBeLessThan(FOCUS_BOUND);
  });
});
