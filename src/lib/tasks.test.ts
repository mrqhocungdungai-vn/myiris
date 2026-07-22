// BUG D: an empty terminal result must replace the activity log shown
// during a run, not fall back to it. resolveMergedString is the pure merge
// decision extracted from the App.tsx reducer — see
// openspec/changes/show-real-result-not-activity-log/design.md D1.
import { describe, it, expect } from "vitest";
import { resolveMergedString } from "./tasks";

describe("resolveMergedString", () => {
  it("replaces the existing value with a non-empty incoming string", () => {
    expect(resolveMergedString("result", "old activity")).toBe("result");
  });

  it("replaces the existing value with an empty incoming string", () => {
    expect(resolveMergedString("", "old activity")).toBe("");
  });

  it("keeps the existing value when the field is absent", () => {
    expect(resolveMergedString(undefined, "old activity")).toBe("old activity");
  });

  it("falls back to empty when both the field and existing value are absent", () => {
    expect(resolveMergedString(undefined, undefined)).toBe("");
  });
});
