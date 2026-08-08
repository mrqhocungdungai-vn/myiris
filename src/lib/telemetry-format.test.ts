import { describe, it, expect } from "vitest";
import {
  BAND_DWELL_MS,
  BAR_CLASS,
  FIGURE_SPACE,
  HISTORY_LEVELS,
  LOAD_THRESHOLDS,
  PERCENT_WIDTH,
  RATE_METER_CEILING,
  RATE_METER_FLOOR,
  RATE_WIDTH,
  easeToward,
  formatPercent,
  formatRate,
  higherOf,
  historyLevel,
  logMeterLevel,
  meterLevel,
  nextLoadBand,
  quantize,
} from "./telemetry-format";

describe("formatPercent", () => {
  it("is exactly PERCENT_WIDTH characters across the whole range", () => {
    for (let value = -0.05; value <= 1.05; value += 0.001) {
      expect(formatPercent(value)).toHaveLength(PERCENT_WIDTH);
    }
  });

  it("is exactly PERCENT_WIDTH characters when absent", () => {
    expect(formatPercent(null)).toHaveLength(PERCENT_WIDTH);
    expect(formatPercent(Number.NaN)).toHaveLength(PERCENT_WIDTH);
  });

  it("rounds up to 100 without gaining a character", () => {
    // The naive guard here is a clamp AFTER formatting; 0.996 is the value that
    // catches its absence.
    expect(formatPercent(0.996)).toBe("100%");
  });

  it("pads with a figure space, not a normal space", () => {
    expect(formatPercent(0.07)).toBe(`${FIGURE_SPACE}${FIGURE_SPACE}7%`);
    expect(formatPercent(0.07)).not.toContain(" ");
  });

  it("shows absence rather than zero", () => {
    expect(formatPercent(null)).not.toContain("0");
    expect(formatPercent(0)).toContain("0%");
  });

  it("clamps out-of-range readings rather than propagating them", () => {
    expect(formatPercent(1.8)).toBe("100%");
    expect(formatPercent(-3)).toBe(`${FIGURE_SPACE}${FIGURE_SPACE}0%`);
  });
});

describe("formatRate", () => {
  it("is exactly RATE_WIDTH characters across six decades", () => {
    // Log-spaced sweep: 200 points from 0 to well past a saturated link.
    for (let i = 0; i <= 200; i += 1) {
      const value = 10 ** (i / 20) - 1;
      expect(formatRate(value)).toHaveLength(RATE_WIDTH);
    }
  });

  it("is exactly RATE_WIDTH characters at every decade boundary and just around it", () => {
    for (const decade of [1e3, 1e6, 1e9, 1e12]) {
      for (const offset of [-1, -0.5, -0.4, 0, 0.4, 0.5, 1]) {
        expect(formatRate(decade + offset)).toHaveLength(RATE_WIDTH);
      }
    }
  });

  it("is exactly RATE_WIDTH characters when absent", () => {
    expect(formatRate(null)).toHaveLength(RATE_WIDTH);
    expect(formatRate(Number.NaN)).toHaveLength(RATE_WIDTH);
  });

  // The three rounding boundaries, named individually because each is a
  // one-in-a-thousand silent width bug that a coarse sweep can step over.
  it("promotes the unit rather than letting Math.round produce a fourth digit", () => {
    // Math.round(999.6) is 1000 — four characters — if the loop bound is 1000.
    expect(formatRate(999_600)).toBe("1.0M/s");
  });

  it("drops the decimal rather than letting toFixed produce a fourth character", () => {
    // (9.96).toFixed(1) is "10.0" — four characters — if the branch bound is 10.
    expect(formatRate(9_960_000)).toBe(`${FIGURE_SPACE}10M/s`);
  });

  it("keeps the byte unit integral right up to the promotion point", () => {
    expect(formatRate(999.4)).toBe("999B/s");
    expect(formatRate(999.6)).toBe("1.0K/s");
  });

  it("formats the shapes the panel will actually show", () => {
    expect(formatRate(0)).toBe(`${FIGURE_SPACE}${FIGURE_SPACE}0B/s`);
    expect(formatRate(842_000)).toBe("842K/s");
    expect(formatRate(9_400_000)).toBe("9.4M/s");
    expect(formatRate(12_000_000)).toBe(`${FIGURE_SPACE}12M/s`);
  });

  it("pins an absurd rate rather than widening", () => {
    expect(formatRate(1e18)).toHaveLength(RATE_WIDTH);
    expect(formatRate(Number.MAX_SAFE_INTEGER)).toHaveLength(RATE_WIDTH);
  });

  it("never decreases as the underlying rate increases", () => {
    // A unit promotion must not make the displayed magnitude go backwards.
    const UNIT_SCALE: Record<string, number> = { B: 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
    let previous = -1;
    for (let i = 0; i <= 400; i += 1) {
      const value = 10 ** (i / 40) - 1;
      const text = formatRate(value);
      const magnitude = Number(text.slice(0, 3).replace(FIGURE_SPACE, "").trim()) * UNIT_SCALE[text[3]];
      expect(magnitude).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = magnitude;
    }
  });

  it("shows absence rather than zero", () => {
    expect(formatRate(null)).not.toContain("0");
  });
});

describe("meterLevel / logMeterLevel / quantize", () => {
  it("reads absence as an empty meter", () => {
    expect(meterLevel(null)).toBe(0);
    expect(logMeterLevel(null)).toBe(0);
  });

  it("clamps the linear meter into range", () => {
    expect(meterLevel(-1)).toBe(0);
    expect(meterLevel(2)).toBe(1);
    expect(meterLevel(0.42)).toBeCloseTo(0.42, 10);
  });

  it("spans the log meter from its floor to its ceiling", () => {
    expect(logMeterLevel(RATE_METER_FLOOR)).toBe(0);
    expect(logMeterLevel(RATE_METER_CEILING)).toBe(1);
    expect(logMeterLevel(RATE_METER_CEILING * 100)).toBe(1);
    expect(logMeterLevel(0)).toBe(0);
  });

  it("gives every decade the same span, which is why the meter moves at all", () => {
    const decades = [1e4, 1e5, 1e6, 1e7, 1e8].map((v) => logMeterLevel(v));
    const steps = decades.slice(1).map((v, i) => v - decades[i]);
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 10);
    // And it is genuinely usable: a megabyte per second is mid-scale, where a
    // linear meter against the same ceiling would show a single cell.
    expect(logMeterLevel(1e6)).toBeGreaterThan(0.5);
  });

  it("quantizes into discrete positions, inclusive of both ends", () => {
    expect(quantize(0, 14)).toBe(0);
    expect(quantize(1, 14)).toBe(14);
    expect(quantize(0.5, 14)).toBe(7);
    expect(quantize(-1, 14)).toBe(0);
    expect(quantize(5, 14)).toBe(14);
  });
});

describe("easeToward", () => {
  it("converges toward the target without overshooting", () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = easeToward(value, 1, 16, 160);
    expect(value).toBeGreaterThan(0.99);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("is monotone toward the target", () => {
    let value = 1;
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 50; i += 1) {
      value = easeToward(value, 0, 16, 160);
      expect(value).toBeLessThan(previous);
      previous = value;
    }
    expect(value).toBeGreaterThanOrEqual(0);
  });

  it("is frame-rate independent — same elapsed time, same result", () => {
    let fast = 0;
    for (let i = 0; i < 60; i += 1) fast = easeToward(fast, 1, 1000 / 60, 250);
    let slow = 0;
    for (let i = 0; i < 30; i += 1) slow = easeToward(slow, 1, 1000 / 30, 250);
    expect(fast).toBeCloseTo(slow, 3);
  });

  it("reaches most of the way to a sample before the next one arrives", () => {
    // The claim the 1 Hz sample rate rests on: no visible staircase.
    let value = 0;
    for (let i = 0; i < 60; i += 1) value = easeToward(value, 1, 1000 / 60, 240);
    expect(value).toBeGreaterThan(0.95);
  });

  it("snaps rather than easing when given no elapsed time", () => {
    expect(easeToward(0.2, 0.9, 0, 160)).toBe(0.9);
  });
});

describe("nextLoadBand", () => {
  const settled = BAND_DWELL_MS + 1;

  it("rises through the bands at their rise levels", () => {
    expect(nextLoadBand("nom", LOAD_THRESHOLDS.elvRise, settled)).toBe("elv");
    expect(nextLoadBand("elv", LOAD_THRESHOLDS.satRise, settled)).toBe("sat");
  });

  it("does not rise just below a rise level", () => {
    expect(nextLoadBand("nom", LOAD_THRESHOLDS.elvRise - 0.001, settled)).toBe("nom");
    expect(nextLoadBand("elv", LOAD_THRESHOLDS.satRise - 0.001, settled)).toBe("elv");
  });

  it("holds a band between its fall and rise levels — the hysteresis gap", () => {
    const between = (LOAD_THRESHOLDS.elvFall + LOAD_THRESHOLDS.elvRise) / 2;
    expect(nextLoadBand("elv", between, settled)).toBe("elv");
    expect(nextLoadBand("nom", between, settled)).toBe("nom");
    const satGap = (LOAD_THRESHOLDS.satFall + LOAD_THRESHOLDS.satRise) / 2;
    expect(nextLoadBand("sat", satGap, settled)).toBe("sat");
    expect(nextLoadBand("elv", satGap, settled)).toBe("elv");
  });

  it("falls only below the fall level", () => {
    expect(nextLoadBand("sat", LOAD_THRESHOLDS.satFall - 0.001, settled)).toBe("elv");
    expect(nextLoadBand("elv", LOAD_THRESHOLDS.elvFall - 0.001, settled)).toBe("nom");
  });

  it("does not change before the dwell has elapsed", () => {
    expect(nextLoadBand("nom", 0.99, BAND_DWELL_MS - 1)).toBe("nom");
    expect(nextLoadBand("sat", 0, BAND_DWELL_MS - 1)).toBe("sat");
  });

  it("holds the band on an absent measurement rather than reporting all-clear", () => {
    expect(nextLoadBand("sat", null, settled)).toBe("sat");
    expect(nextLoadBand("elv", Number.NaN, settled)).toBe("elv");
  });

  it("cannot flicker across a boundary on a value sitting exactly on it", () => {
    // The failure this guards: a value pinned at the rise level alternating on
    // every sample. With hysteresis it settles into one band and stays.
    let band = nextLoadBand("nom", LOAD_THRESHOLDS.elvRise, settled);
    for (let i = 0; i < 20; i += 1) {
      const next = nextLoadBand(band, LOAD_THRESHOLDS.elvRise, settled);
      expect(next).toBe(band);
      band = next;
    }
  });
});

describe("higherOf", () => {
  it("takes the higher of two present values", () => {
    expect(higherOf(0.3, 0.7)).toBe(0.7);
    expect(higherOf(0.9, 0.1)).toBe(0.9);
  });

  it("falls through to whichever value is present", () => {
    expect(higherOf(null, 0.4)).toBe(0.4);
    expect(higherOf(0.4, null)).toBe(0.4);
    expect(higherOf(Number.NaN, 0.4)).toBe(0.4);
  });

  it("is absent when neither is present", () => {
    expect(higherOf(null, null)).toBeNull();
  });
});

describe("the history strip", () => {
  it("has one class per level, plus the empty one", () => {
    expect(BAR_CLASS).toHaveLength(HISTORY_LEVELS + 1);
    expect(BAR_CLASS[0]).toBe("bar h0");
    expect(BAR_CLASS[HISTORY_LEVELS]).toBe(`bar h${HISTORY_LEVELS}`);
  });

  it("distinguishes a measured zero from no measurement at all", () => {
    // 0 is the gap; a measured idle machine still draws a floor bar, so a hole
    // in the strip means "nothing was measured" and nothing else.
    expect(historyLevel(null)).toBe(0);
    expect(historyLevel(0)).toBe(1);
  });

  it("indexes a real level for every measurement in range", () => {
    for (let value = 0; value <= 1; value += 0.01) {
      const level = historyLevel(value);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(HISTORY_LEVELS);
      expect(BAR_CLASS[level]).toBeDefined();
    }
  });
});
