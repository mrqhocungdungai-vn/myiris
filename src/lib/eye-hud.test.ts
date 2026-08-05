import { describe, it, expect } from "vitest";
import {
  ACQUIRE_MS,
  PANEL_MS,
  READOUT_GEOMETRY,
  TETHER_MS,
  VIEW_H,
  VIEW_W,
  acquireScale,
  arcPath,
  chooseReadoutSide,
  createReadoutLayout,
  dashPattern,
  panelReveal,
  polarPoint,
  readoutSlack,
  resolveReadoutLayout,
  segmentRing,
  tetherPath,
  tetherReveal,
  tickLine,
  wingPath,
  type ReadoutGeometry,
  type ReadoutSide,
} from "./eye-hud";

function sumDashArray(pattern: string): number {
  return pattern.split(" ").reduce((sum, part) => sum + Number(part), 0);
}

describe("polarPoint", () => {
  it("measures degrees clockwise from 12 o'clock in SVG's y-down space", () => {
    expect(polarPoint(10, 0)).toEqual({ x: 0, y: -10 });
    expect(polarPoint(10, 90)).toEqual({ x: 10, y: 0 });
    expect(polarPoint(10, 180)).toEqual({ x: 0, y: 10 });
    expect(polarPoint(10, 270)).toEqual({ x: -10, y: 0 });
  });

  it("stays on the circle at every angle", () => {
    for (let deg = 0; deg < 360; deg += 17) {
      const point = polarPoint(42, deg);
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(42, 2);
    }
  });
});

describe("tickLine", () => {
  it("runs radially between the two radii at one angle", () => {
    const tick = tickLine(90, 106, 118);
    expect(tick.x1).toBeCloseTo(106, 2);
    expect(tick.x2).toBeCloseTo(118, 2);
    expect(tick.y1).toBeCloseTo(0, 2);
    expect(tick.y2).toBeCloseTo(0, 2);
  });
});

describe("arcPath", () => {
  it("starts and ends on the circle at the requested angles", () => {
    expect(arcPath(50, 0, 90)).toBe("M 0 -50 A 50 50 0 0 1 50 0");
  });

  // "M x y A rx ry rot largeArc sweep x2 y2" — flags are tokens 7 and 8.
  it("sets the large-arc flag only past a half turn", () => {
    expect(arcPath(50, 0, 110).split(" ")[7]).toBe("0");
    expect(arcPath(50, 0, 260).split(" ")[7]).toBe("1");
  });

  it("flips the sweep flag for a counter-clockwise arc", () => {
    expect(arcPath(50, 0, 90).split(" ")[8]).toBe("1");
    expect(arcPath(50, 0, -90).split(" ")[8]).toBe("0");
  });
});

describe("wingPath", () => {
  it("closes the arc with an inward tick at each end", () => {
    const path = wingPath(130, 90, 40, 10);
    // Both endpoints sit on the inner radius; the arc between them on the outer.
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const first = { x: numbers[0], y: numbers[1] };
    const last = { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(120, 1);
    expect(Math.hypot(last.x, last.y)).toBeCloseTo(120, 1);
  });
});

// Spec: "Rotation is perceptible on every moving element" — the dash arrays
// are how each rotating layer carries its asymmetric interruption, so what
// matters is that they close on the circle AND that they are not uniform.
describe("dashPattern", () => {
  it("sums to exactly the path length, so the pattern closes on the circle", () => {
    expect(sumDashArray(dashPattern(120, 9, 0.7, 15))).toBeCloseTo(120, 6);
    expect(sumDashArray(dashPattern(100, 24, 0.5, 8))).toBeCloseTo(100, 6);
  });

  it("leaves one gap distinctly larger than the rest — the asymmetry the requirement is about", () => {
    const parts = dashPattern(120, 9, 0.7, 15).split(" ").map(Number);
    const gaps = parts.filter((_, index) => index % 2 === 1);
    const [lastGap, ...evenGaps] = [gaps[gaps.length - 1], ...gaps.slice(0, -1)];
    expect(new Set(evenGaps.map((gap) => gap.toFixed(3))).size).toBe(1);
    expect(lastGap).toBeGreaterThan(evenGaps[0] * 2);
  });

  it("keeps every dash the same length, so only the gap reads as the break", () => {
    const dashes = dashPattern(120, 9, 0.7, 15)
      .split(" ")
      .filter((_, index) => index % 2 === 0)
      .map(Number);
    expect(new Set(dashes.map((dash) => dash.toFixed(3))).size).toBe(1);
  });
});

describe("segmentRing", () => {
  it("sums to exactly the path length", () => {
    expect(sumDashArray(segmentRing(120, [5, 3, 2], 4))).toBeCloseTo(120, 6);
  });

  it("produces arcs of unequal length in the requested proportion", () => {
    const arcs = segmentRing(120, [5, 3, 2], 4)
      .split(" ")
      .filter((_, index) => index % 2 === 0)
      .map(Number);
    expect(arcs).toHaveLength(3);
    expect(new Set(arcs).size).toBe(3);
    expect(arcs[0] / arcs[2]).toBeCloseTo(2.5, 3);
  });
});

// Spec: "A newly detected face is acquired, not toggled on" and "Acquisition
// does not fight per-frame tracking" — this is the factor the rAF loop
// multiplies into the scale it already writes, so it must be a plain function
// of elapsed time with no state of its own.
describe("acquireScale", () => {
  it("starts well above 1 so the ring converges inward", () => {
    expect(acquireScale(0)).toBeGreaterThan(1.5);
  });

  it("reaches exactly 1 by the end and stays there", () => {
    expect(acquireScale(ACQUIRE_MS)).toBe(1);
    expect(acquireScale(ACQUIRE_MS * 10)).toBe(1);
  });

  it("shrinks monotonically until it overshoots, then settles back — not a linear stop", () => {
    const samples = Array.from({ length: 33 }, (_, i) => acquireScale((i / 32) * ACQUIRE_MS));
    const minimum = Math.min(...samples);
    expect(minimum).toBeLessThan(1);
    // The overshoot is the settle beat; without it easeOut would just decay to 1.
    expect(samples[samples.length - 1]).toBe(1);
    expect(samples[0]).toBeGreaterThan(samples[16]);
  });

  it("is defined for a negative elapsed time rather than exploding", () => {
    expect(acquireScale(-50)).toBe(acquireScale(0));
  });
});

// Spec: "The panel arrives after the ring locks" — tether first, then panel.
describe("the acquisition stagger", () => {
  it("holds the tether back until the ring has finished converging", () => {
    expect(tetherReveal(ACQUIRE_MS - 1)).toBe(0);
    expect(tetherReveal(ACQUIRE_MS + TETHER_MS)).toBe(1);
  });

  it("holds the panel back until the tether has landed", () => {
    expect(panelReveal(ACQUIRE_MS + TETHER_MS - 1)).toBe(0);
    expect(panelReveal(ACQUIRE_MS + TETHER_MS + PANEL_MS)).toBe(1);
  });

  it("never lets the panel lead the tether", () => {
    for (let t = 0; t < ACQUIRE_MS + TETHER_MS + PANEL_MS + 100; t += 13) {
      expect(panelReveal(t)).toBeLessThanOrEqual(tetherReveal(t));
    }
  });
});

// Spec: "An eye near the frame edge puts the panel on its other side" and
// "Dwelling at the switch point does not strobe".
describe("chooseReadoutSide", () => {
  const geom: ReadoutGeometry = { offset: 0.075, width: 0.3, height: 0.5, rise: -0.08, hysteresis: 0.04 };

  it("keeps the panel on its current side while that side still fits", () => {
    expect(chooseReadoutSide(0.4, "right", geom)).toBe("right");
  });

  it("moves the panel to the other side once its own side would clip the frame", () => {
    expect(readoutSlack(0.7, "right", geom)).toBeLessThan(0);
    expect(chooseReadoutSide(0.7, "right", geom)).toBe("left");
  });

  it("mirrors that for an eye near the left edge", () => {
    expect(chooseReadoutSide(0.2, "left", geom)).toBe("right");
  });

  it("stays put when neither side has room, rather than picking the lesser clipping", () => {
    const wide: ReadoutGeometry = { ...geom, width: 0.9 };
    expect(chooseReadoutSide(0.5, "right", wide)).toBe("right");
    expect(chooseReadoutSide(0.5, "left", wide)).toBe("left");
  });

  it("does not strobe while the eye dwells exactly at the switch point", () => {
    // The eye x at which the right side stops fitting.
    const threshold = 1 - geom.offset - geom.width;
    let side: ReadoutSide = "right";
    const visited: ReadoutSide[] = [];
    // Jitter across the threshold the way a head at rest actually does.
    for (let i = 0; i < 200; i++) {
      const jitter = Math.sin(i * 1.9) * 0.004;
      side = chooseReadoutSide(threshold + jitter, side, geom);
      visited.push(side);
    }
    const flips = visited.filter((value, index) => index > 0 && value !== visited[index - 1]).length;
    expect(flips).toBeLessThanOrEqual(1);
  });

  it("settles on one side across a slow sweep out and back, without oscillating at the boundary", () => {
    let side: ReadoutSide = "right";
    let flips = 0;
    let previous = side;
    for (let step = 0; step <= 400; step++) {
      // Sweep 0.30 → 0.95 → 0.30, one small increment at a time.
      const phase = step <= 200 ? step / 200 : (400 - step) / 200;
      side = chooseReadoutSide(0.3 + phase * 0.65, side, geom);
      if (side !== previous) flips += 1;
      previous = side;
    }
    // Exactly one flip out and one back — never a burst at either crossing.
    expect(flips).toBe(2);
  });
});

describe("resolveReadoutLayout", () => {
  it("anchors the panel's near edge at the offset, on its current side", () => {
    const layout = resolveReadoutLayout({ x: 0.5, y: 0.5 }, 10_000, createReadoutLayout());
    expect(layout.side).toBe("right");
    expect(layout.anchorX).toBeCloseTo(0.5 + READOUT_GEOMETRY.offset, 6);
  });

  it("clamps the panel vertically instead of flipping it, so it cannot oscillate", () => {
    const high = resolveReadoutLayout({ x: 0.5, y: 0.02 }, 10_000, createReadoutLayout());
    expect(high.anchorY).toBeCloseTo(READOUT_GEOMETRY.height / 2, 6);
    const low = resolveReadoutLayout({ x: 0.5, y: 0.98 }, 10_000, createReadoutLayout());
    expect(low.anchorY).toBeCloseTo(1 - READOUT_GEOMETRY.height / 2, 6);
  });

  it("keeps the panel fully inside the frame on whichever side it lands", () => {
    const layout = createReadoutLayout();
    for (let x = 0.05; x <= 0.95; x += 0.01) {
      resolveReadoutLayout({ x, y: 0.5 }, 10_000, layout);
      const near = layout.anchorX;
      const far = layout.side === "right" ? near + READOUT_GEOMETRY.width : near - READOUT_GEOMETRY.width;
      // The only escape is an eye so close to an edge that neither side fits,
      // which the geometry above never produces.
      expect(Math.min(near, far)).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(near, far)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("carries the reveal stagger through", () => {
    const layout = resolveReadoutLayout({ x: 0.5, y: 0.5 }, 0, createReadoutLayout());
    expect(layout.tether).toBe(0);
    expect(layout.panel).toBe(0);
  });
});

describe("tetherPath", () => {
  it("starts at the tracked eye and ends exactly at the panel's anchor", () => {
    const center = { x: 0.4, y: 0.45 };
    const layout = resolveReadoutLayout(center, 10_000, createReadoutLayout());
    const numbers = tetherPath(center, layout).match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(numbers[0]).toBeCloseTo(center.x * VIEW_W, 2);
    expect(numbers[1]).toBeCloseTo(center.y * VIEW_H, 2);
    expect(numbers[numbers.length - 2]).toBeCloseTo(layout.anchorX * VIEW_W, 2);
    expect(numbers[numbers.length - 1]).toBeCloseTo(layout.anchorY * VIEW_H, 2);
  });

  it("bends its elbow toward the panel, whichever side that is", () => {
    const center = { x: 0.4, y: 0.45 };
    const right = createReadoutLayout();
    resolveReadoutLayout(center, 10_000, right);
    const rightKnee = Number(tetherPath(center, right).match(/-?\d+(\.\d+)?/g)![2]);
    expect(rightKnee).toBeLessThan(right.anchorX * VIEW_W);

    const left = { ...createReadoutLayout(), side: "left" as ReadoutSide };
    resolveReadoutLayout({ x: 0.9, y: 0.45 }, 10_000, left);
    const leftKnee = Number(tetherPath({ x: 0.9, y: 0.45 }, left).match(/-?\d+(\.\d+)?/g)![2]);
    expect(leftKnee).toBeGreaterThan(left.anchorX * VIEW_W);
  });
});
