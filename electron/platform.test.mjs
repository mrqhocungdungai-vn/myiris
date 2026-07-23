import { describe, it, expect } from "vitest";
import { shouldRefuseLaunch } from "./platform.mjs";

describe("shouldRefuseLaunch", () => {
  it("allows darwin with no override", () => {
    expect(shouldRefuseLaunch("darwin", {})).toBe(false);
  });

  it("refuses linux with no override", () => {
    expect(shouldRefuseLaunch("linux", {})).toBe(true);
  });

  it("refuses win32 with no override", () => {
    expect(shouldRefuseLaunch("win32", {})).toBe(true);
  });

  it("allows linux when IRIS_ALLOW_ANY_PLATFORM is 1", () => {
    expect(shouldRefuseLaunch("linux", { IRIS_ALLOW_ANY_PLATFORM: "1" })).toBe(false);
  });

  it("allows darwin when IRIS_ALLOW_ANY_PLATFORM is 1", () => {
    expect(shouldRefuseLaunch("darwin", { IRIS_ALLOW_ANY_PLATFORM: "1" })).toBe(false);
  });

  it("refuses linux when IRIS_ALLOW_ANY_PLATFORM is 0", () => {
    expect(shouldRefuseLaunch("linux", { IRIS_ALLOW_ANY_PLATFORM: "0" })).toBe(true);
  });

  it("refuses linux when IRIS_ALLOW_ANY_PLATFORM is a non-'1' truthy string", () => {
    expect(shouldRefuseLaunch("linux", { IRIS_ALLOW_ANY_PLATFORM: "true" })).toBe(true);
  });

  it("allows linux when IRIS_ALLOW_ANY_PLATFORM has surrounding whitespace around 1", () => {
    expect(shouldRefuseLaunch("linux", { IRIS_ALLOW_ANY_PLATFORM: " 1 " })).toBe(false);
  });
});
