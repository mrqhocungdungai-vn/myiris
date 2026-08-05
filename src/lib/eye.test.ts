import { describe, it, expect } from "vitest";
import { FRAME_ASPECT, irisCenter, irisRadius, presenceEquals } from "./eye";
import type { EyePoint, EyeState, TrackedEye } from "../hooks/useEyeTracking";

// A boundary ring of `count` points at `radius` (in frame-width units) around
// `center`, laid out the way the model's four iris boundary landmarks are:
// evenly spaced around the circle. The y offsets are multiplied by
// FRAME_ASPECT because the ring lives in per-axis-normalized coordinates,
// where a y unit is shorter than an x unit by exactly that factor.
function ringAround(center: EyePoint, radius: number, count = 4): EyePoint[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * FRAME_ASPECT,
    };
  });
}

function makeEye(overrides: Partial<TrackedEye> = {}): TrackedEye {
  return { id: "left", center: { x: 0.4, y: 0.45 }, radius: 0.015, ...overrides };
}

function makeState(overrides: Partial<EyeState> = {}): EyeState {
  return {
    active: true,
    present: true,
    acquiredAt: 1000,
    eyes: [makeEye({ id: "left" }), makeEye({ id: "right", center: { x: 0.6, y: 0.45 } })],
    ...overrides,
  };
}

describe("irisCenter", () => {
  it("averages the boundary ring rather than trusting one landmark", () => {
    const center = irisCenter([
      { x: 0.4, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.6 },
      { x: 0.4, y: 0.6 },
    ]);
    expect(center.x).toBeCloseTo(0.45, 10);
    expect(center.y).toBeCloseTo(0.55, 10);
  });

  it("recovers the true center of a symmetric ring", () => {
    const truth = { x: 0.62, y: 0.38 };
    const center = irisCenter(ringAround(truth, 0.02, 8));
    expect(center.x).toBeCloseTo(truth.x, 10);
    expect(center.y).toBeCloseTo(truth.y, 10);
  });

  it("returns the origin for an empty ring instead of NaN", () => {
    expect(irisCenter([])).toEqual({ x: 0, y: 0 });
  });
});

describe("irisRadius", () => {
  it("returns the radius in frame-width units", () => {
    const center = { x: 0.5, y: 0.5 };
    expect(irisRadius(center, ringAround(center, 0.018))).toBeCloseTo(0.018, 10);
  });

  it("is isotropic — a purely vertical offset measures the same as a horizontal one", () => {
    const center = { x: 0.5, y: 0.5 };
    // The bug this guards: reading a y offset as if a y unit spanned the same
    // distance as an x unit would make this ring 4/3 too large.
    const horizontal = irisRadius(center, [
      { x: 0.5 + 0.02, y: 0.5 },
      { x: 0.5 - 0.02, y: 0.5 },
    ]);
    const vertical = irisRadius(center, [
      { x: 0.5, y: 0.5 + 0.02 * FRAME_ASPECT },
      { x: 0.5, y: 0.5 - 0.02 * FRAME_ASPECT },
    ]);
    expect(vertical).toBeCloseTo(horizontal, 10);
    expect(horizontal).toBeCloseTo(0.02, 10);
  });

  it("does not change when the head tilts", () => {
    const center = { x: 0.5, y: 0.5 };
    const upright = irisRadius(center, ringAround(center, 0.016, 4));
    // The same ring rotated 45°: an anisotropic measure would report a
    // different radius for the same eye purely because the head turned.
    const tilted = irisRadius(
      center,
      Array.from({ length: 4 }, (_, i) => {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return {
          x: center.x + Math.cos(angle) * 0.016,
          y: center.y + Math.sin(angle) * 0.016 * FRAME_ASPECT,
        };
      }),
    );
    expect(tilted).toBeCloseTo(upright, 10);
  });

  it("returns 0 for an empty ring instead of NaN", () => {
    expect(irisRadius({ x: 0.5, y: 0.5 }, [])).toBe(0);
  });
});

describe("presenceEquals", () => {
  it("treats states as equal when only the per-frame center/radius differ", () => {
    const a = makeState();
    const b = makeState({
      eyes: [
        makeEye({ id: "left", center: { x: 0.41, y: 0.46 }, radius: 0.017 }),
        makeEye({ id: "right", center: { x: 0.61, y: 0.46 }, radius: 0.017 }),
      ],
    });
    expect(presenceEquals(a, b)).toBe(true);
  });

  it("ignores acquiredAt on its own — presence already reports that transition", () => {
    expect(presenceEquals(makeState(), makeState({ acquiredAt: 99999 }))).toBe(true);
  });

  it("treats states as different when presence changes", () => {
    expect(presenceEquals(makeState({ present: true }), makeState({ present: false, eyes: [] }))).toBe(false);
  });

  it("treats states as different when tracking is switched off", () => {
    expect(presenceEquals(makeState(), makeState({ active: false }))).toBe(false);
  });

  it("treats states as different when an eye disappears", () => {
    expect(presenceEquals(makeState(), makeState({ eyes: [makeEye({ id: "left" })] }))).toBe(false);
  });

  it("treats states as different when the eye order changes", () => {
    // The eye-to-element assignment is keyed off this array's order, so a
    // reordering is a semantic change even though both eyes are still present.
    const swapped = makeState({ eyes: [makeEye({ id: "right" }), makeEye({ id: "left" })] });
    expect(presenceEquals(makeState(), swapped)).toBe(false);
  });
});
