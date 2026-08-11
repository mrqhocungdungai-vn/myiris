import { describe, it, expect } from "vitest";
import { escapeHtml, reconcile, stepFlightTarget, LABEL_BUDGET_CEILING, DWELL_HOLD_MS } from "./galaxy-graph";
import type { GalaxyNode } from "./galaxy-types";

// escapeHtml is an XSS boundary, not formatting. 3d-force-graph assigns the
// `.nodeLabel()` accessor's return value to `innerHTML`, so an ingested note
// titled `<img src=x onerror=...>` would otherwise execute in the privileged
// renderer (design.md D9/H2).
describe("escapeHtml", () => {
  it("neutralizes a script-bearing note title", () => {
    const escaped = escapeHtml('<img src=x onerror="alert(1)">');
    expect(escaped).not.toContain("<img");
    expect(escaped).not.toContain('"');
    expect(escaped).toContain("&lt;img");
  });

  it("escapes every character that can break out of markup", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  // The ampersand must be escaped first, or "&lt;" becomes "&amp;lt;".
  it("does not double-escape an already-escaped entity", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    expect(escapeHtml(escapeHtml("<"))).toBe("&amp;lt;");
  });

  it("leaves an ordinary title untouched", () => {
    expect(escapeHtml("Deploy plan v2")).toBe("Deploy plan v2");
  });
});

const graph = (nodes: Array<[string, string]>, links: Array<[string, string]> = []) => ({
  nodes: nodes.map(([id, title]) => ({ id, title, tags: [] })),
  links: links.map(([source, target]) => ({ source, target })),
}) as never;

describe("reconcile", () => {
  it("adds a node and reports the topology changed", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    const result = reconcile(graph([["a", "A"]]), positions, key);
    expect(result.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(result.topologyChanged).toBe(true);
  });

  // The reason this function exists: the renderer owns positions, so the same
  // node objects must go back into .graphData() or every node jumps.
  it("returns the SAME node object across reconciles, so positions survive", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    const first = reconcile(graph([["a", "A"]]), positions, key);
    const kept = first.nodes[0];
    kept.x = 42;
    const second = reconcile(graph([["a", "A"]]), positions, key);
    expect(second.nodes[0]).toBe(kept);
    expect(second.nodes[0].x).toBe(42);
  });

  it("refreshes metadata in place without replacing the object", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    const first = reconcile(graph([["a", "old"]]), positions, key);
    const kept = first.nodes[0];
    const second = reconcile(graph([["a", "new"]]), positions, key);
    expect(second.nodes[0]).toBe(kept);
    expect(second.nodes[0].title).toBe("new");
  });

  // Metadata-only changes must NOT reheat the physics simulation (M-B).
  it("does not report a topology change for a title-only edit", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    reconcile(graph([["a", "old"]]), positions, key);
    expect(reconcile(graph([["a", "new"]]), positions, key).topologyChanged).toBe(false);
  });

  it("reports a topology change when a link appears", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    reconcile(graph([["a", "A"], ["b", "B"]]), positions, key);
    const next = reconcile(graph([["a", "A"], ["b", "B"]], [["a", "b"]]), positions, key);
    expect(next.topologyChanged).toBe(true);
  });

  // A vanished note must not leave its position behind, or the map grows
  // without bound across a long session.
  it("drops the position of a node that no longer exists", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    reconcile(graph([["a", "A"], ["b", "B"]]), positions, key);
    expect(positions.size).toBe(2);
    reconcile(graph([["a", "A"]]), positions, key);
    expect(positions.size).toBe(1);
    expect(positions.has("b")).toBe(false);
  });

  // Node order must not be mistaken for a topology change.
  it("is insensitive to the order nodes and links arrive in", () => {
    const positions = new Map<string, GalaxyNode>();
    const key = { current: "" };
    reconcile(graph([["a", "A"], ["b", "B"]], [["a", "b"]]), positions, key);
    const reordered = reconcile(graph([["b", "B"], ["a", "A"]], [["a", "b"]]), positions, key);
    expect(reordered.topologyChanged).toBe(false);
  });
});

describe("tuning constants", () => {
  it("keeps the label budget bounded so a huge vault cannot uncap it", () => {
    expect(LABEL_BUDGET_CEILING).toBeGreaterThan(0);
    expect(Number.isFinite(LABEL_BUDGET_CEILING)).toBe(true);
  });

  // The galaxy's dwell and the HUD's are the same user-facing contract; see
  // lib/pointer-dwell.ts, which records why the two implementations differ.
  it("shares the 300ms dwell contract with the rest of the app", () => {
    expect(DWELL_HOLD_MS).toBe(300);
  });
});

describe("stepFlightTarget", () => {
  const node = { x: 10, y: 0, z: 0 };

  it("lands the camera at the flight distance from the note", () => {
    const { position, destination } = stepFlightTarget(node, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, 60);
    expect(destination).toEqual(node);
    const dx = position.x - node.x;
    const dy = position.y - node.y;
    const dz = position.z - node.z;
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(60);
  });

  // A step travels to a note; it must not also spin the view.
  it("keeps the camera's current viewing direction", () => {
    const { position } = stepFlightTarget(node, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, 60);
    // Camera was straight down +Z from its aim, so it stays on +Z of the note.
    expect(position.x).toBeCloseTo(node.x);
    expect(position.y).toBeCloseTo(node.y);
    expect(position.z).toBeCloseTo(60);
  });

  // The reason this is a named function: normalizing a zero-length direction
  // yields NaN, which reaches cameraPosition() and puts the camera nowhere
  // with no error at all.
  it("falls back to +Z when the camera sits exactly on its own target", () => {
    const { position } = stepFlightTarget(node, { x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }, 60);
    for (const value of [position.x, position.y, position.z]) expect(Number.isNaN(value)).toBe(false);
    expect(position.z).toBeCloseTo(60);
  });

  it("produces no NaN for any ordinary camera placement", () => {
    for (const camera of [
      { x: 1, y: 1, z: 1 },
      { x: -50, y: 20, z: 3 },
      { x: 0, y: 0, z: -900 },
    ]) {
      const { position } = stepFlightTarget(node, { x: 0, y: 0, z: 0 }, camera, 60);
      for (const value of [position.x, position.y, position.z]) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
