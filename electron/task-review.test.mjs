import { describe, expect, it } from "vitest";
import { MAX_REVIEW_TASK_LENGTH, resolveApprovedTask } from "./task-review.mjs";

describe("resolveApprovedTask", () => {
  it("falls back to the parked task when no edit is provided", () => {
    expect(resolveApprovedTask(undefined, "do the thing")).toBe("do the thing");
    expect(resolveApprovedTask(null, "do the thing")).toBe("do the thing");
  });

  it("uses the trimmed edited text when provided", () => {
    expect(resolveApprovedTask("  do the other thing  ", "do the thing")).toBe("do the other thing");
  });

  it("throws on an empty or whitespace-only edit instead of falling back", () => {
    expect(() => resolveApprovedTask("", "fallback")).toThrow(/empty/i);
    expect(() => resolveApprovedTask("   ", "fallback")).toThrow(/empty/i);
  });

  it("caps length at the configured maximum", () => {
    const long = "x".repeat(MAX_REVIEW_TASK_LENGTH + 500);
    const result = resolveApprovedTask(long, "fallback");
    expect(result.length).toBe(MAX_REVIEW_TASK_LENGTH);
  });
});
