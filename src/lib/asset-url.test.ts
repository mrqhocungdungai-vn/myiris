import { describe, it, expect } from "vitest";
import { resolveVendoredAssetUrl } from "./asset-url";

describe("resolveVendoredAssetUrl", () => {
  it("resolves a production input to an absolute file:// URL under dist/, not dist/assets/", () => {
    const result = resolveVendoredAssetUrl("runtime/ort/", "./", "file:///app/dist/index.html");
    expect(result).toBe("file:///app/dist/runtime/ort/");
    expect(result).not.toContain("assets/");
  });

  it("resolves a dev-server input to the same origin, absolute", () => {
    const result = resolveVendoredAssetUrl("runtime/ort/", "/", "http://127.0.0.1:5173/");
    expect(result).toBe("http://127.0.0.1:5173/runtime/ort/");
    expect(result).not.toContain("assets/");
  });

  it("preserves a sub-path with no trailing slash", () => {
    const result = resolveVendoredAssetUrl("runtime/mediapipe", "./", "file:///app/dist/index.html");
    expect(result).toBe("file:///app/dist/runtime/mediapipe");
    expect(result.endsWith("/")).toBe(false);
  });

  it("never produces a path through the bundler's assets/ chunk directory", () => {
    expect(resolveVendoredAssetUrl("runtime/ort/", "./", "file:///app/dist/index.html")).not.toContain("assets/");
    expect(resolveVendoredAssetUrl("runtime/mediapipe", "/", "http://127.0.0.1:5173/")).not.toContain("assets/");
  });
});
