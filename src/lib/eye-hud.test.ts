import { describe, it, expect } from "vitest";
import {
  ACQUIRE_MS,
  LOCK_MS,
  LOCK_STRETCH,
  PANEL_MS,
  READOUT_GEOMETRY,
  TETHER_MS,
  VIEW_H,
  VIEW_W,
  acquireScale,
  arcPath,
  createReadoutLayout,
  dashPattern,
  gaugeTicks,
  lockSettle,
  panelReveal,
  polarPoint,
  resolveReadoutLayout,
  segmentRing,
  tetherPath,
  tetherReveal,
  tickLine,
  wingPath,
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

describe("lockSettle", () => {
  it("is at full stretch exactly when convergence completes", () => {
    expect(lockSettle(ACQUIRE_MS)).toBe(1);
    expect(lockSettle(0)).toBe(1);
  });

  it("has fully settled by the end of the beat", () => {
    expect(lockSettle(ACQUIRE_MS + LOCK_MS)).toBe(0);
    expect(lockSettle(ACQUIRE_MS + LOCK_MS + 5000)).toBe(0);
  });

  it("decays monotonically, never rebounding", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let t = ACQUIRE_MS; t <= ACQUIRE_MS + LOCK_MS; t += 7) {
      const value = lockSettle(t);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it("stays in range, so the crosshair never inverts or overshoots its stretch", () => {
    for (let t = 0; t <= ACQUIRE_MS + LOCK_MS + 200; t += 11) {
      const value = lockSettle(t);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      // The multiplier the reticle actually applies.
      const stretch = 1 + (LOCK_STRETCH - 1) * value;
      expect(stretch).toBeGreaterThanOrEqual(1);
      expect(stretch).toBeLessThanOrEqual(LOCK_STRETCH);
    }
  });

  it("spends most of the beat nearly settled, so the lock snaps rather than fades", () => {
    expect(lockSettle(ACQUIRE_MS + LOCK_MS / 2)).toBeLessThan(0.2);
  });

  it("does not delay the tether or the panel", () => {
    // The beat runs alongside the staged arrival; it must not gate it.
    expect(tetherReveal(ACQUIRE_MS + TETHER_MS)).toBe(1);
    expect(panelReveal(ACQUIRE_MS + TETHER_MS + PANEL_MS)).toBe(1);
  });
});

describe("gaugeTicks", () => {
  it("marks nothing at rest and everything at full", () => {
    expect(gaugeTicks(0, 24)).toBe(0);
    expect(gaugeTicks(1, 24)).toBe(24);
  });

  it("marks nothing — not zero — when there is no measurement", () => {
    expect(gaugeTicks(null, 24)).toBe(0);
    expect(gaugeTicks(Number.NaN, 24)).toBe(0);
  });

  it("stays within the dial for out-of-range readings", () => {
    expect(gaugeTicks(-1, 24)).toBe(0);
    expect(gaugeTicks(4, 24)).toBe(24);
  });

  it("rises with the measurement and never falls back", () => {
    let previous = -1;
    for (let value = 0; value <= 1; value += 0.01) {
      const ticks = gaugeTicks(value, 24);
      expect(ticks).toBeGreaterThanOrEqual(previous);
      previous = ticks;
    }
  });
});

describe("resolveReadoutLayout", () => {
  // Spec: "the panel appears on the LEFT of the displayed frame". The readout
  // eye is the one on that side, and the panel hangs outward from it — so it
  // is anchored left of its eye, by exactly the offset.
  it("anchors the panel's right edge at the offset, left of its eye", () => {
    const layout = resolveReadoutLayout({ x: 0.42, y: 0.5 }, 10_000, createReadoutLayout());
    expect(layout.anchorX).toBeCloseTo(0.42 - READOUT_GEOMETRY.offset, 6);
  });

  // Spec: "The panel stays on its eye's outward side, even when that clips it".
  // This is the requirement the earlier flip-at-the-edge behavior broke: the
  // flipped panel landed on the other eye, where the ring is, and its position
  // depended on head pose — so it collided AND jumped. Sweeping the eye all
  // the way to the frame's left edge must move the panel with it and nothing
  // else, even where that puts the panel's far edge off-frame.
  it("keeps the panel left of its eye at every position, clipping rather than crossing it", () => {
    const layout = createReadoutLayout();
    for (let x = 0.02; x <= 0.98; x += 0.01) {
      resolveReadoutLayout({ x, y: 0.5 }, 10_000, layout);
      expect(layout.anchorX).toBeCloseTo(x - READOUT_GEOMETRY.offset, 6);
      // The panel's whole extent stays left of the eye — never over it, and
      // never out on the ring eye's side of the frame.
      expect(layout.anchorX).toBeLessThan(x);
    }
  });

  // Every position is a pure function of the eye's, so there is no state that
  // could make the panel move while the head does not — the failure the flip
  // produced, which no deadband would have fixed.
  it("does not move while the eye is still, however near an edge it sits", () => {
    const layout = createReadoutLayout();
    const at = (x: number) => {
      resolveReadoutLayout({ x, y: 0.5 }, 10_000, layout);
      return layout.anchorX;
    };
    for (const x of [0.05, 0.3, 0.5, 0.9]) {
      expect(at(x)).toBeCloseTo(at(x), 12);
      // …and returning to it from anywhere else gives the same answer.
      at(0.5);
      expect(at(x)).toBeCloseTo(x - READOUT_GEOMETRY.offset, 12);
    }
  });

  it("clamps the panel vertically, so it cannot oscillate", () => {
    const high = resolveReadoutLayout({ x: 0.5, y: 0.02 }, 10_000, createReadoutLayout());
    expect(high.anchorY).toBeCloseTo(READOUT_GEOMETRY.height / 2, 6);
    const low = resolveReadoutLayout({ x: 0.5, y: 0.98 }, 10_000, createReadoutLayout());
    expect(low.anchorY).toBeCloseTo(1 - READOUT_GEOMETRY.height / 2, 6);
  });

  // The panel may run off the frame's left edge, but never off its right —
  // that direction is the ring eye's, and reaching it would mean the panel had
  // crossed its own eye.
  it("never extends past its eye toward the frame's right", () => {
    const layout = createReadoutLayout();
    for (let x = 0.02; x <= 0.98; x += 0.01) {
      resolveReadoutLayout({ x, y: 0.5 }, 10_000, layout);
      expect(layout.anchorX).toBeLessThanOrEqual(x - READOUT_GEOMETRY.offset + 1e-9);
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

  it("bends its elbow inboard of the anchor, toward the eye it came from", () => {
    for (const x of [0.15, 0.4, 0.75]) {
      const center = { x, y: 0.45 };
      const layout = resolveReadoutLayout(center, 10_000, createReadoutLayout());
      const knee = Number(tetherPath(center, layout).match(/-?\d+(\.\d+)?/g)![2]);
      expect(knee).toBeGreaterThan(layout.anchorX * VIEW_W);
      expect(knee).toBeLessThanOrEqual(center.x * VIEW_W);
    }
  });
});
