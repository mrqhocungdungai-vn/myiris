import { describe, it, expect } from "vitest";
import { formatRecStamp } from "./rec-clock";

// Dates are constructed with the local-time constructor, not an ISO string —
// `new Date("2026-08-05T09:07:03Z")` is UTC and would make every assertion
// depend on the machine's timezone. The formatter reads local fields, so the
// tests state local fields.
const at = (y: number, m: number, d: number, hh: number, mm: number, ss: number) =>
  new Date(y, m - 1, d, hh, mm, ss);

describe("formatRecStamp", () => {
  it("renders day-first date and a 24-hour time", () => {
    expect(formatRecStamp(at(2026, 8, 5, 14, 30, 9))).toBe("05/08/2026 · 14:30:09");
  });

  // The three cases a 12-hour slip or a bad pad survives unnoticed: midnight
  // must be 00, not 24 and not 12; noon must be 12, not 00.
  it("renders midnight as 00, not 24 and not 12", () => {
    expect(formatRecStamp(at(2026, 1, 1, 0, 0, 0))).toBe("01/01/2026 · 00:00:00");
  });

  it("renders noon as 12", () => {
    expect(formatRecStamp(at(2026, 6, 15, 12, 0, 0))).toBe("15/06/2026 · 12:00:00");
  });

  it("renders the last second before midnight", () => {
    expect(formatRecStamp(at(2026, 12, 31, 23, 59, 59))).toBe("31/12/2026 · 23:59:59");
  });

  it("zero-pads single-digit days and months", () => {
    expect(formatRecStamp(at(2026, 3, 7, 8, 5, 4))).toBe("07/03/2026 · 08:05:04");
  });

  // Spec: "The displayed value SHALL be zero-padded and of fixed width, so the
  // stamp does not change width or shift position as its digits change." With
  // tabular figures, equal length is what that reduces to.
  it("is the same length at every one of those", () => {
    const samples = [
      at(2026, 8, 5, 14, 30, 9),
      at(2026, 1, 1, 0, 0, 0),
      at(2026, 6, 15, 12, 0, 0),
      at(2026, 12, 31, 23, 59, 59),
      at(2026, 3, 7, 8, 5, 4),
    ].map(formatRecStamp);
    const lengths = new Set(samples.map((sample) => sample.length));
    expect(lengths.size).toBe(1);
  });

  it("advances by one second without changing anything else", () => {
    const before = formatRecStamp(at(2026, 8, 5, 14, 30, 58));
    const after = formatRecStamp(at(2026, 8, 5, 14, 30, 59));
    expect(before).toBe("05/08/2026 · 14:30:58");
    expect(after).toBe("05/08/2026 · 14:30:59");
    expect(before.length).toBe(after.length);
  });
});
