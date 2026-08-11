import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every test file on disk must be matched by a vitest `include` glob.
//
// The globs are extension-exact — `src/**/*.test.ts` does not match `.tsx`,
// and `electron/**/*.test.mjs` does not match `.ts`. A test file with the
// wrong extension therefore runs **zero tests and exits 0**: it can be
// written, committed, and reviewed as coverage while asserting nothing, and
// no gate says a word.
//
// That is not hypothetical. Probing it with a deliberately failing
// `src/lib/__probe.test.tsx` produced "Test Files 104 passed / Tests 1836
// passed", exit 0 — the file was never collected. This test is the alarm for
// exactly that, and it is why it lives in `scripts/` (matched by
// `scripts/**/*.test.mjs`) rather than in the tree it polices.
//
// If this fails, the fix is usually one of:
//   * rename the file to an extension the project already collects, or
//   * widen the glob in vitest.config.mjs — and then make sure a NEW project
//     with the right `environment` exists if the file needs a DOM.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = ["electron", "src", "scripts"];
const IGNORED_DIRS = new Set(["node_modules", "dist", "release", "build"]);

/** Every `*.test.*` file under the scanned roots, repo-relative with `/`. */
function findTestFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.test\.[a-z]+$/.test(entry.name)) {
        found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root));
  return found.sort();
}

/** The include globs, read from the config rather than restated here. */
function configuredIncludes() {
  const config = fs.readFileSync(path.join(repoRoot, "vitest.config.mjs"), "utf8");
  const includes = [];
  for (const match of config.matchAll(/include:\s*\[([^\]]*)\]/g)) {
    for (const entry of match[1].matchAll(/"([^"]+)"/g)) includes.push(entry[1]);
  }
  return includes;
}

/** Minimal glob match for the `dir/**\/*.ext` and `prefix.*.ext` shapes used. */
function globToRegExp(glob) {
  const pattern = glob
    .split("")
    .reduce((acc, char, index, chars) => {
      if (char === "*" && chars[index - 1] === "*") return acc; // handled below
      if (char === "*" && chars[index + 1] === "*") return `${acc}.*`;
      if (char === "*") return `${acc}[^/]*`;
      if (char === ".") return `${acc}\\.`;
      if (char === "/") return `${acc}/`;
      return acc + char;
    }, "")
    .replace(/\.\*\//g, ".*/?");
  return new RegExp(`^${pattern}$`);
}

describe("the vitest include globs reach every test file", () => {
  const includes = configuredIncludes();
  const matchers = includes.map(globToRegExp);
  const testFiles = findTestFiles();

  it("reads the globs out of vitest.config.mjs", () => {
    expect(includes.length).toBeGreaterThan(0);
    expect(includes).toContain("src/**/*.test.ts");
  });

  it("finds the test files on disk", () => {
    expect(testFiles.length).toBeGreaterThan(50);
  });

  // The assertion this file exists for.
  it("collects every *.test.* file under electron/, src/ and scripts/", () => {
    const orphans = testFiles.filter((file) => !matchers.some((re) => re.test(file)));
    expect(orphans).toEqual([]);
  });

  // Guards the guard: if the matcher were broken open, the check above would
  // pass vacuously and this file would be worse than useless.
  it("would actually reject an unmatched extension", () => {
    const orphan = "src/lib/example.test.tsx";
    expect(matchers.some((re) => re.test(orphan))).toBe(false);
    // ...while the extension the project does collect matches.
    expect(matchers.some((re) => re.test("src/lib/example.test.ts"))).toBe(true);
  });
});
