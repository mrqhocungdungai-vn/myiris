// Import-graph test — supply side (design.md D3, add-electron-test-signal):
// dynamically imports every Electron-free module under electron/ and
// asserts it loads. Runs under this repo's "graph" vitest project, which
// externalizes electron/**/*.mjs (see vitest.config.mjs) so these imports go
// through Node's native ESM loader rather than Vite's SSR transform — the
// transform rewrites named imports into namespace property accesses, which
// silently converts a missing named export into `undefined` instead of
// throwing (design.md M5). Lives at the repo root, not under electron/,
// because package.json's build.files globs electron/** and excludes only
// *.test.mjs — anything else dropped there would ship inside the packaged
// app (design.md task 3.1b).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "electron");

// Text-match on an actual import/require statement, anchored to the start
// of a line so a comment merely mentioning "electron" (e.g. `// see
// electron/main.mjs`) cannot masquerade as a real import and silently drop
// a module out of coverage (design.md task 3.3's named risk).
const ELECTRON_IMPORT_RE = /^import\s+[^;]*from\s+["']electron["']|^const\s+.*=\s*require\(["']electron["']\)/m;

// Intentional exclusions, named explicitly per design.md task 3.3 — an
// unexpected exclusion (a module that stops matching `*.mjs` under
// electron/, or a text-match false negative) fails the count assertion
// below instead of silently shrinking coverage.
const EXPECTED_ELECTRON_DEPENDENT = ["ipc.mjs", "main.mjs", "renderer-security.mjs", "window.mjs"];

// preload.cjs uses `require("electron")` (CommonJS) and is not matched by
// the `*.mjs` glob at all — this test covers .mjs modules only. It is not a
// gap: preload.cjs is a flat, largely declarative `contextBridge.exposeInMainWorld`
// registration list with no logic of the kind this test's failure modes
// (bad import, circular import) apply to.

function discoverCandidates() {
  const allMjs = fs
    .readdirSync(electronDir)
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));

  const electronDependent = [];
  const candidates = [];
  for (const name of allMjs) {
    const source = fs.readFileSync(path.join(electronDir, name), "utf8");
    if (ELECTRON_IMPORT_RE.test(source)) {
      electronDependent.push(name);
    } else {
      candidates.push(name);
    }
  }
  return { candidates, electronDependent, allMjs };
}

describe("electron/ import graph — supply side", () => {
  const { candidates, electronDependent, allMjs } = discoverCandidates();

  it("the candidate set matches the expected count and exclusions exactly", () => {
    // Guards against the exact hole this test exists to close: a module
    // silently dropping out of coverage because the Electron-exclusion
    // text-match no longer applies to it (or newly, wrongly, does).
    expect(electronDependent.sort()).toEqual(EXPECTED_ELECTRON_DEPENDENT.sort());
    expect(candidates.length).toBe(allMjs.length - EXPECTED_ELECTRON_DEPENDENT.length);
    expect(candidates.length).toBeGreaterThan(0);
  });

  for (const name of discoverCandidates().candidates) {
    it(`imports cleanly under Node's native loader: electron/${name}`, async () => {
      const url = pathToFileURL(path.join(electronDir, name)).href;
      await expect(import(url)).resolves.toBeTruthy();
    });
  }
});
