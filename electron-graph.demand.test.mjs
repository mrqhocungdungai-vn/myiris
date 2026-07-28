// Import-graph test — demand side (design.md D3, add-electron-test-signal):
// statically parses the import statements of every module under electron/,
// including Electron-dependent ones like main.mjs, and asserts each relative
// sibling import actually exists and is exported by its target. Importers
// are only ever parsed, never imported — that's what lets this cover
// main.mjs without booting Electron. Target export lists come from
// dynamically importing the Electron-free targets (this file runs under the
// "graph" vitest project — see vitest.config.mjs — so those imports go
// through Node's native loader). Lives at the repo root for the same reason
// as electron-graph.supply.test.mjs (design.md task 3.1b).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "electron");

// Every file under electron/ (recursively — design.md D10/task 5.5, so
// electron/capabilities/ isn't silently dropped) that could hold import
// statements — including test files (their imports can be wrong too) and
// .cjs (preload.cjs, whose only require() is the bare "electron" specifier —
// nothing relative to resolve, but it's still parsed so a future relative
// require wouldn't be silently uncovered).
function listElectronFiles() {
  return fs
    .readdirSync(electronDir, { recursive: true })
    .filter((name) => name.endsWith(".mjs") || name.endsWith(".cjs"))
    .sort();
}

// Splits an import clause (the part between `import` and `from`) into its
// default / namespace / named-binding pieces. Only named and default names
// are checked against the target's real exports; a namespace import
// (`* as ns`) is valid for any resolving target.
function parseImportClause(clause) {
  const trimmed = clause.trim();
  if (/^\*\s*as\s+[\w$]+$/.test(trimmed)) return { namespace: true, defaultImport: false, named: [] };

  const braceMatch = trimmed.match(/\{([\s\S]*)\}/);
  const beforeBrace = (braceMatch ? trimmed.slice(0, braceMatch.index) : trimmed).replace(/,\s*$/, "").trim();
  const named = braceMatch
    ? braceMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.split(/\s+as\s+/)[0].trim())
    : [];
  return { namespace: false, defaultImport: Boolean(beforeBrace), named };
}

// Static parse of one file's import statements. Two regexes cover the two
// syntactic shapes: `import ... from "spec"` (default/named/namespace) and
// side-effect-only `import "spec"`. Both anchor `^import` per line (`m`
// flag) so a multi-line named-import block (e.g. main.mjs's 12-line
// po-session.mjs import) is still exactly one statement, matching how a
// naive `grep ^import` count would see it too (task 4.4's guard).
const WITH_FROM_RE = /^import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']\s*;?\s*$/gm;
const SIDE_EFFECT_RE = /^import\s*["']([^"']+)["']\s*;?\s*$/gm;

function parseImports(source) {
  const statements = [];
  for (const m of source.matchAll(WITH_FROM_RE)) {
    statements.push({ specifier: m[2], ...parseImportClause(m[1]) });
  }
  for (const m of source.matchAll(SIDE_EFFECT_RE)) {
    statements.push({ specifier: m[1], namespace: false, defaultImport: false, named: [] });
  }
  return statements;
}

function naiveImportLineCount(source) {
  return (source.match(/^import\b/gm) || []).length;
}

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

const exportCache = new Map();
async function getExports(targetAbsPath) {
  if (exportCache.has(targetAbsPath)) return exportCache.get(targetAbsPath);
  const mod = await import(pathToFileURL(targetAbsPath).href);
  const names = new Set(Object.keys(mod));
  exportCache.set(targetAbsPath, names);
  return names;
}

// Precomputed once, at module load, so individual `it()` blocks stay small
// and synchronous over already-parsed/resolved data. Vitest test files run
// as ES modules, so top-level await is fine here.
const files = listElectronFiles();
/** @type {Map<string, { statements: any[], lineCount: number }>} */
const parsedByFile = new Map();
for (const name of files) {
  const source = fs.readFileSync(path.join(electronDir, name), "utf8");
  parsedByFile.set(name, { statements: parseImports(source), lineCount: naiveImportLineCount(source) });
}

/** @type {Array<{ importer: string, specifier: string, targetAbsPath: string, defaultImport: boolean, named: string[] }>} */
const relativeEdges = [];
for (const [name, { statements }] of parsedByFile) {
  for (const stmt of statements) {
    if (!isRelative(stmt.specifier)) continue;
    // Resolved against the importer's own directory, not electronDir's root
    // — required once discovery went recursive (task 5.5): a capability
    // module's "../foo.mjs" is one directory below electron/, not relative
    // to electron/ itself.
    const targetAbsPath = path.resolve(path.dirname(path.join(electronDir, name)), stmt.specifier);
    relativeEdges.push({ importer: name, specifier: stmt.specifier, targetAbsPath, defaultImport: stmt.defaultImport, named: stmt.named });
  }
}

describe("electron/ import graph — demand side (static)", () => {
  it("the parser's statement count matches a naive `^import` line count, per file", () => {
    // Guards against an import form the parser can't interpret (dynamic
    // import(), re-export, an unusual multi-statement line) going uncovered
    // silently — a mismatch fails loudly instead (design.md task 4.4).
    for (const [name, { statements, lineCount }] of parsedByFile) {
      expect(statements.length, `${name}: parsed ${statements.length} import statement(s), expected ${lineCount}`).toBe(lineCount);
    }
  });

  it("every relative import target file exists", () => {
    for (const edge of relativeEdges) {
      expect(fs.existsSync(edge.targetAbsPath), `${edge.importer} imports "${edge.specifier}" which does not resolve to an existing file`).toBe(true);
    }
  });

  it("every named and default import is actually exported by its target", async () => {
    for (const edge of relativeEdges) {
      if (!fs.existsSync(edge.targetAbsPath)) continue; // reported by the previous test
      const exported = await getExports(edge.targetAbsPath);
      for (const name of edge.named) {
        expect(exported.has(name), `${edge.importer} imports "${name}" from "${edge.specifier}", which does not export it`).toBe(true);
      }
      if (edge.defaultImport) {
        expect(exported.has("default"), `${edge.importer} imports a default export from "${edge.specifier}", which has none`).toBe(true);
      }
    }
  });

  it("covers main.mjs's sibling imports specifically, without importing it", () => {
    // main.mjs requires Electron, so this file is only ever parsed, never
    // imported (design.md D3/D5) — this asserts it's actually in the parsed
    // set and non-trivially covered, rather than silently excluded. The
    // exact name count is deliberately not hardcoded here: it shifts as
    // main.mjs changes (group 2's own noUnusedLocals fix removed one import
    // mid-change — see design.md task 4.2; the wiring.mjs extraction later
    // dropped main.mjs's own direct sibling-import count sharply, by design
    // — most construction it used to do directly now happens inside
    // wiring.mjs, itself covered by the checks above since it's
    // Electron-free), so asserting a fixed number would go stale by design.
    const mainEdges = relativeEdges.filter((e) => e.importer === "main.mjs");
    const allNames = mainEdges.flatMap((e) => e.named);
    expect(mainEdges.length).toBeGreaterThan(3);
    expect(allNames.length).toBeGreaterThan(5);
  });

  it("covers sibling-to-sibling edges main.mjs cannot reveal", () => {
    // These two are invisible to anything that only looks at main.mjs's own
    // imports — canvas-store.mjs and vault-graph.mjs each import a sibling
    // main.mjs never touches directly (design.md task 4.3).
    const canvasStoreEdge = relativeEdges.find((e) => e.importer === "canvas-store.mjs" && e.specifier === "./atomic-file.mjs");
    expect(canvasStoreEdge?.named).toContain("writeFileAtomicAsync");

    const vaultGraphEdge = relativeEdges.find((e) => e.importer === "vault-graph.mjs" && e.specifier === "./vault-graph-parse.mjs");
    expect(vaultGraphEdge?.named).toContain("parseVaultFiles");
  });
});
