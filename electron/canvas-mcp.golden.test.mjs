// @vitest-environment jsdom
//
// Golden reference test (design.md D5/H1): main can never import excalidraw
// (its build touches window/document — see canvas-mcp.mjs's module comment),
// so the pure element builder in canvas-mcp.mjs hand-rolls every field
// excalidraw's own convertToExcalidrawElements would fill in. This test is
// the guard against that field set silently rotting on an excalidraw version
// bump: it runs the same skeleton through the REAL convertToExcalidrawElements
// (importable here only because this file runs under jsdom) and asserts our
// builder's output is a field-key superset of it. Keep @excalidraw/excalidraw
// version-pinned in package.json — a bump should re-run this test on purpose.
import { describe, it, expect, beforeAll } from "vitest";
import { buildElement } from "./canvas-mcp.mjs";

// jsdom ships no real 2D canvas backend (getContext("2d") -> null) and no
// FontFace — excalidraw's module-eval-time feature probe and its text
// measurement path touch both. Neither is exercised by
// convertToExcalidrawElements's actual geometry/id logic, so bare stubs are
// enough to let the import and the conversion run.
let convertToExcalidrawElements;

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = () => ({
    measureText: (text) => ({ width: String(text).length * 7 }),
    font: "",
  });
  global.FontFace = class FontFace {
    load() {
      return Promise.resolve(this);
    }
  };
  if (!document.fonts) {
    Object.defineProperty(document, "fonts", { value: { add() {}, ready: Promise.resolve() } });
  }
  ({ convertToExcalidrawElements } = await import("@excalidraw/excalidraw"));
});

function keysOf(el) {
  return new Set(Object.keys(el));
}

function expectSuperset(mineKeys, realKeys, label) {
  const missing = [...realKeys].filter((k) => !mineKeys.has(k));
  expect(missing, `${label}: builder is missing fields ${JSON.stringify(missing)}`).toEqual([]);
}

describe("buildElement is a field-key superset of excalidraw's convertToExcalidrawElements", () => {
  it("rectangle / ellipse / diamond", () => {
    for (const type of ["rectangle", "ellipse", "diamond"]) {
      const skeleton = { type, x: 10, y: 20, width: 100, height: 50, id: "shape1" };
      const [real] = convertToExcalidrawElements([skeleton], { regenerateIds: false });
      const mine = buildElement(skeleton, { index: "a0" });
      expectSuperset(keysOf(mine), keysOf(real), type);
    }
  });

  it("text", () => {
    const skeleton = { type: "text", x: 0, y: 0, text: "hello", id: "text1" };
    const [real] = convertToExcalidrawElements([skeleton], { regenerateIds: false });
    const mine = buildElement(skeleton, { index: "a0" });
    expectSuperset(keysOf(mine), keysOf(real), "text");
  });

  it("arrow bound to two existing shapes", () => {
    const shapes = [
      { type: "rectangle", id: "a", x: 0, y: 0, width: 50, height: 50 },
      { type: "rectangle", id: "b", x: 200, y: 0, width: 50, height: 50 },
    ];
    const skeleton = { type: "arrow", id: "arr1", start: { id: "a" }, end: { id: "b" } };
    const realAll = convertToExcalidrawElements([...shapes, skeleton], { regenerateIds: false });
    const real = realAll.find((e) => e.id === "arr1");

    const lookup = new Map(shapes.map((s) => [s.id, buildElement(s, { index: "a0" })]));
    const mine = buildElement(skeleton, { index: "a1", lookup });
    expectSuperset(keysOf(mine), keysOf(real), "arrow");
  });

  // A labelled skeleton produces TWO elements from the real converter — the
  // container and a bound text element — and the builder has to match both.
  // This is the only mechanism tying the label's field set (fontFamily 5,
  // containerId, autoResize, lineHeight...) to excalidraw's own; hand-written
  // fixtures would only re-assert what we already believe.
  it("labelled rectangle: container and its bound label", () => {
    const skeleton = { type: "rectangle", id: "r", x: 10, y: 20, width: 200, height: 80, label: { text: "Auth Service" } };
    const realAll = convertToExcalidrawElements([skeleton], { regenerateIds: false });
    const realContainer = realAll.find((e) => e.id === "r");
    const realLabel = realAll.find((e) => e.type === "text");

    const labels = [];
    const mine = buildElement(skeleton, { index: "a0", labels });
    expect(labels).toHaveLength(1);
    expectSuperset(keysOf(mine), keysOf(realContainer), "labelled rectangle");
    expectSuperset(keysOf(labels[0]), keysOf(realLabel), "bound label");
    expect(labels[0].containerId).toBe("r");
    expect(labels[0].fontFamily).toBe(realLabel.fontFamily);
  });

  it("labelled arrow: connector and its bound label", () => {
    const shapes = [
      { type: "rectangle", id: "a", x: 0, y: 0, width: 50, height: 50 },
      { type: "rectangle", id: "b", x: 300, y: 0, width: 50, height: 50 },
    ];
    const skeleton = { type: "arrow", id: "arr", start: { id: "a" }, end: { id: "b" }, label: { text: "yes" } };
    const realAll = convertToExcalidrawElements([...shapes, skeleton], { regenerateIds: false });
    const realArrow = realAll.find((e) => e.id === "arr");
    const realLabel = realAll.find((e) => e.type === "text");

    const lookup = new Map(shapes.map((s) => [s.id, buildElement(s, { index: "a0" })]));
    const labels = [];
    const mine = buildElement(skeleton, { index: "a1", lookup, labels });
    expectSuperset(keysOf(mine), keysOf(realArrow), "labelled arrow");
    expectSuperset(keysOf(labels[0]), keysOf(realLabel), "bound connector label");
    expect(labels[0].containerId).toBe("arr");
  });

  it("elbowed arrow carries the extra fields an elbow arrow has", () => {
    const skeleton = { type: "arrow", id: "m", x: 0, y: 0, points: [[0, 0], [50, 0], [50, 60], [120, 60]], elbowed: true };
    const [real] = convertToExcalidrawElements([skeleton], { regenerateIds: false });
    const mine = buildElement(skeleton, { index: "a0" });
    expectSuperset(keysOf(mine), keysOf(real), "elbowed arrow");
  });

  it("line", () => {
    const skeleton = { type: "line", x: 0, y: 0, points: [[0, 0], [40, 40]] };
    const [real] = convertToExcalidrawElements([skeleton], { regenerateIds: false });
    const mine = buildElement({ ...skeleton, id: "line1" }, { index: "a0" });
    expectSuperset(keysOf(mine), keysOf(real), "line");
  });
});
