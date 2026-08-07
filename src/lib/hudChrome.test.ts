// @vitest-environment jsdom
//
// The `unit` project runs node-default; this one file opts into a DOM because
// the predicate under test is about ancestor traversal and real hit-testing,
// and a hand-built fake `closest` would only restate the implementation.
import { describe, it, expect, beforeEach } from "vitest";
import { HUD_CHROME_CLASS, isHudChrome, hudChromeAtPoint } from "./hudChrome";

function build() {
  document.body.innerHTML = `
    <div class="hud-shell">
      <div class="hud-right hud-hit ${HUD_CHROME_CLASS}" id="tasks">
        <button id="toggle">Tasks</button>
        <div class="hud-work">
          <article data-task-id="t1" id="card"><button id="steps">Steps</button></article>
        </div>
      </div>
      <div class="hud-orb-cluster hud-hit ${HUD_CHROME_CLASS}" id="orb">
        <div class="hud-controls"><button id="close-galaxy">x</button></div>
      </div>
      <div class="hud-galaxy hud-hit" id="galaxy"><canvas id="canvas"></canvas></div>
    </div>
  `;
}

beforeEach(build);

const byId = (id: string) => document.getElementById(id);

describe("isHudChrome", () => {
  it("recognises a chrome island itself", () => {
    expect(isHudChrome(byId("tasks"))).toBe(true);
    expect(isHudChrome(byId("orb"))).toBe(true);
  });

  it("recognises a control nested deep inside one", () => {
    // The dwell loop hands it the resolved `actionable`, which is always a
    // descendant — never the island — so ancestor traversal is the whole point.
    expect(isHudChrome(byId("toggle"))).toBe(true);
    expect(isHudChrome(byId("card"))).toBe(true);
    expect(isHudChrome(byId("steps"))).toBe(true);
    expect(isHudChrome(byId("close-galaxy"))).toBe(true);
  });

  it("does not recognise the layer or anything inside it", () => {
    expect(isHudChrome(byId("galaxy"))).toBe(false);
    expect(isHudChrome(byId("canvas"))).toBe(false);
  });

  it("treats a missing element as not chrome", () => {
    // elementFromPoint returns null off-viewport; that must read as "no chrome
    // here", not throw and kill the rAF loop.
    expect(isHudChrome(null)).toBe(false);
  });
});

describe("hudChromeAtPoint", () => {
  it("reports what the topmost element at the point is", () => {
    // jsdom has no layout, so elementFromPoint is stubbed per call — the
    // contract under test is the wiring (topmost element -> isHudChrome), not
    // jsdom's hit-testing.
    document.elementFromPoint = () => byId("steps");
    expect(hudChromeAtPoint(10, 10)).toBe(true);

    document.elementFromPoint = () => byId("canvas");
    expect(hudChromeAtPoint(10, 10)).toBe(false);

    document.elementFromPoint = () => null;
    expect(hudChromeAtPoint(-1, -1)).toBe(false);
  });
});
