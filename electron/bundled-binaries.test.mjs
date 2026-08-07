import { describe, it, expect } from "vitest";
import path from "node:path";
import { toUnpackedPath, resolveBundledClaude, resolveBundledOpenspec } from "./bundled-binaries.mjs";

// A stand-in for `require.resolve` that answers only for the specifiers a test
// sets up, and throws like the real thing otherwise.
function fakeRequire(map) {
  return {
    resolve(specifier) {
      if (specifier in map) return map[specifier];
      throw new Error(`Cannot find module '${specifier}'`);
    },
  };
}

describe("toUnpackedPath", () => {
  it("leaves a dev path (no asar segment) untouched", () => {
    const dev = "/repo/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude";
    expect(toUnpackedPath(dev, { existsSync: () => false })).toBe(dev);
  });

  it("rewrites a packaged path to its app.asar.unpacked twin", () => {
    const packed = "/Applications/MyIris.app/Contents/Resources/app.asar/node_modules/x/claude";
    expect(toUnpackedPath(packed, { existsSync: () => true })).toBe(
      "/Applications/MyIris.app/Contents/Resources/app.asar/node_modules/x/claude".replace(
        "/app.asar/",
        "/app.asar.unpacked/",
      ),
    );
  });

  it("falls back to the packed path when asarUnpack was misconfigured", () => {
    // Without the fallback the caller would report ENOENT on an app.asar.unpacked
    // path the user has never heard of; the packed path at least names the app.
    const packed = "/Applications/MyIris.app/Contents/Resources/app.asar/node_modules/x/claude";
    expect(toUnpackedPath(packed, { existsSync: () => false })).toBe(packed);
  });

  it("rewrites only the archive segment, not a coincidental substring", () => {
    const packed = "/tmp/app.asar.backup/Resources/app.asar/node_modules/x/claude";
    expect(toUnpackedPath(packed, { existsSync: () => true })).toBe(
      "/tmp/app.asar.backup/Resources/app.asar.unpacked/node_modules/x/claude",
    );
  });
});

describe("resolveBundledClaude", () => {
  it("resolves the platform binary package and points at its `claude`", () => {
    const requireImpl = fakeRequire({
      "@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json":
        "/repo/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json",
    });

    expect(resolveBundledClaude({ requireImpl, existsSync: () => false, platform: "darwin", arch: "arm64" })).toBe(
      path.join("/repo/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64", "claude"),
    );
  });

  it("uses claude.exe on Windows", () => {
    const requireImpl = fakeRequire({
      "@anthropic-ai/claude-agent-sdk-win32-x64/package.json": "/repo/node_modules/pkg/package.json",
    });

    expect(resolveBundledClaude({ requireImpl, existsSync: () => false, platform: "win32", arch: "x64" })).toBe(
      path.join("/repo/node_modules/pkg", "claude.exe"),
    );
  });

  it("throws a reinstall-shaped error when the platform package is absent", () => {
    // The realistic cause is npm having skipped the optional dependency for a
    // foreign arch, so the message has to point at the fix, not at the internals.
    expect(() =>
      resolveBundledClaude({ requireImpl: fakeRequire({}), platform: "darwin", arch: "arm64" }),
    ).toThrow(/claude-agent-sdk-darwin-arm64.*npm ci/s);
  });

  it("returns the unpacked path when packaged", () => {
    const requireImpl = fakeRequire({
      "@anthropic-ai/claude-agent-sdk-darwin-x64/package.json":
        "/MyIris.app/Contents/Resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/package.json",
    });

    expect(resolveBundledClaude({ requireImpl, existsSync: () => true, platform: "darwin", arch: "x64" })).toBe(
      "/MyIris.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude",
    );
  });
});

describe("resolveBundledOpenspec", () => {
  it("points at the package's bin entry", () => {
    const requireImpl = fakeRequire({
      "@fission-ai/openspec/package.json": "/repo/node_modules/@fission-ai/openspec/package.json",
    });

    expect(resolveBundledOpenspec({ requireImpl, existsSync: () => false })).toBe(
      path.join("/repo/node_modules/@fission-ai/openspec", "bin", "openspec.js"),
    );
  });

  it("falls back to walking up from the main entry when an exports map hides package.json", () => {
    // The real @fission-ai/openspec ships an `exports` map without a
    // "./package.json" entry, which makes the direct subpath resolve a hard
    // error rather than a miss — resolving the package entry is the only way in.
    const root = "/repo/node_modules/@fission-ai/openspec";
    const requireImpl = fakeRequire({ "@fission-ai/openspec": `${root}/dist/index.js` });

    expect(
      resolveBundledOpenspec({ requireImpl, existsSync: (p) => p === path.join(root, "package.json") }),
    ).toBe(path.join(root, "bin", "openspec.js"));
  });

  it("throws a reinstall-shaped error when the package is absent", () => {
    expect(() => resolveBundledOpenspec({ requireImpl: fakeRequire({}) })).toThrow(/@fission-ai\/openspec.*npm ci/s);
  });
});
