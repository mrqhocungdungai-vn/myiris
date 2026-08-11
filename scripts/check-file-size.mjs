// File-size ratchet for the 250-450 line convention in CLAUDE.md.
//
// The convention was enforced by prose alone, and prose rotted: docs/TESTING.md
// listed App.tsx at 1738 lines when it was 2226, canvas-mcp.mjs at 557 when it
// was 804, omitted second-brain.mjs (1317) entirely — and listed SetupPanel.tsx
// at 1023 when it had *shrunk* to 858. Stale in both directions, so a reader
// could not tell a live constraint from a fossil. Meanwhile the one rule in
// this repo with an automated guard (the Electron-free import rule, pinned by
// electron-graph.supply.test.mjs) has never drifted.
//
// This is a RATCHET, not a mandate. It does not require anything to be split
// today. It records what each oversized file measures now and fails only if a
// file grows past that recorded number. Files at or under the ceiling are not
// listed at all and are simply held to the ceiling.
//
// So the baseline may only ever shrink:
//   * a file over its recorded size  -> fail (it grew)
//   * a file under it                -> fail, asking for the baseline to be
//                                       lowered, so progress is banked and
//                                       cannot silently reverse
//   * a NEW file over the ceiling    -> fail (the convention applies to it)
//
// Reports and fails; never edits. `*.test.*` files are exempt, matching the
// convention's own carve-out in CLAUDE.md.
import fs from "node:fs";
import path from "node:path";

/** The convention's upper bound. A file at or under this is never listed. */
export const LINE_CEILING = 450;

const SCAN_ROOTS = ["electron", "src", "scripts"];
const SCAN_EXTENSIONS = new Set([".mjs", ".cjs", ".ts", ".tsx"]);
const BASELINE_RELATIVE_PATH = "scripts/file-size-baseline.json";

const TAG = "[file-size]";

/**
 * Counts the lines that are actually code — comments and blanks excluded.
 *
 * This is the measure the ratchet uses, and the choice is load-bearing. Counting
 * raw lines penalizes exactly the discipline this codebase runs on: the reasoning
 * behind a decision is recorded in comments next to it, and several modules are
 * 40-55% comment by line. Measured raw, `src/hooks/useGalaxyCameraDrive.ts` is
 * 812 lines and "violates" the convention; measured as code it is 405 and sits
 * inside it, because its pure math was already extracted into tested
 * `src/lib/` modules and what remains is imperative glue plus the explanation
 * of why it is shaped that way.
 *
 * A gate that pushed back on that would be telling authors to delete the
 * explanations to get under a number — the opposite of what the convention is
 * for. 18 of the 24 files over the raw ceiling are in exactly this position.
 *
 * Deliberately naive: it does not parse. A `//` inside a string literal counts
 * as a comment. That is acceptable for a size heuristic and keeps this readable.
 */
export function countCodeLines(text) {
  let code = 0;
  let inBlockComment = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (line.startsWith("//") || line.startsWith("*")) continue;
    code += 1;
  }
  return code;
}

function isExempt(relativePath) {
  const base = path.basename(relativePath);
  // Test files are exempt by the convention itself.
  if (/\.test\./.test(base)) return true;
  // Ambient type declarations are one long list by nature, not a module with a
  // responsibility that could be split.
  if (base.endsWith(".d.ts")) return true;
  return false;
}

function walk(dir, repoRoot, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, repoRoot, out);
      continue;
    }
    if (!SCAN_EXTENSIONS.has(path.extname(entry.name))) continue;
    const relative = path.relative(repoRoot, full).split(path.sep).join("/");
    if (isExempt(relative)) continue;
    out.set(relative, countCodeLines(fs.readFileSync(full, "utf8")));
  }
  return out;
}

/** Measures every non-exempt source file. Exported for the test. */
export function measureFiles({ repoRoot }) {
  const sizes = new Map();
  for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root), repoRoot, sizes);
  return sizes;
}

export function readBaseline({ repoRoot }) {
  const file = path.join(repoRoot, BASELINE_RELATIVE_PATH);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Compares measured sizes against the recorded baseline.
 *
 * Pure: takes the two maps and returns the verdict, so the test can drive it
 * without a filesystem.
 */
export function compareToBaseline(sizes, baseline, ceiling = LINE_CEILING) {
  const grew = [];
  const shrank = [];
  const newlyOver = [];

  for (const [file, lines] of sizes) {
    const recorded = baseline[file];
    if (recorded === undefined) {
      if (lines > ceiling) newlyOver.push({ file, lines });
      continue;
    }
    if (lines > recorded) grew.push({ file, lines, recorded });
    else if (lines < recorded) shrank.push({ file, lines, recorded });
  }

  // A baselined file that no longer exists is progress too: drop its entry.
  const removed = Object.keys(baseline).filter((file) => !sizes.has(file));

  return { grew, shrank, newlyOver, removed };
}

function describe(result, ceiling) {
  const lines = [];
  for (const { file, lines: n, recorded } of result.grew) {
    lines.push(`  ${file}: ${n} lines, over its recorded ${recorded}`);
  }
  for (const { file, lines: n } of result.newlyOver) {
    lines.push(`  ${file}: ${n} lines, over the ${ceiling}-line ceiling (new file)`);
  }
  for (const { file, lines: n, recorded } of result.shrank) {
    lines.push(`  ${file}: ${n} lines, under its recorded ${recorded} — lower the baseline to bank it`);
  }
  for (const file of result.removed) {
    lines.push(`  ${file}: no longer exists — remove it from the baseline`);
  }
  return lines;
}

/** The gate entry point. */
export function checkFileSizes({ repoRoot }) {
  const sizes = measureFiles({ repoRoot });
  const baseline = readBaseline({ repoRoot });
  const result = compareToBaseline(sizes, baseline);
  const problems = describe(result, LINE_CEILING);

  if (!problems.length) {
    const over = Object.keys(baseline).length;
    return { ok: true, output: `${TAG} OK — ${sizes.size} files, ${over} over the ${LINE_CEILING}-line ceiling and none grew.` };
  }

  return {
    ok: false,
    output: [
      `${TAG} the ${LINE_CEILING}-line convention ratchet moved the wrong way:`,
      ...problems,
      "",
      "Counts are CODE lines — comments and blanks excluded.",
      `Update ${BASELINE_RELATIVE_PATH} with: node scripts/update-file-size-baseline.mjs`,
      "Lowering an entry is always fine. Raising one needs a reason in the PR.",
    ].join("\n"),
  };
}
