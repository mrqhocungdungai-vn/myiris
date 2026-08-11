#!/usr/bin/env node
// Rewrites scripts/file-size-baseline.json from what is on disk now.
//
// Run this after splitting a file, to bank the progress.
//
// **It refuses to raise an entry unless `--allow-growth` is passed.** That
// guard exists because of a real mistake: the natural workflow is "make a
// change, rebaseline, run the gate", and rebaselining first makes the ratchet
// unconditionally green — it silently records whatever the file now measures,
// including growth. A ratchet you can bypass by running the tool that maintains
// it is not a ratchet. Lowering an entry, or dropping one for a deleted file,
// needs no flag; those are the directions the ratchet exists to encourage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureFiles, readBaseline, LINE_CEILING } from "./check-file-size.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowGrowth = process.argv.includes("--allow-growth");
const sizes = measureFiles({ repoRoot });
const previous = readBaseline({ repoRoot });

const baseline = {};
for (const file of [...sizes.keys()].sort()) {
  const lines = sizes.get(file);
  if (lines > LINE_CEILING) baseline[file] = lines;
}

const grew = Object.entries(baseline)
  .filter(([file, lines]) => previous[file] !== undefined && lines > previous[file])
  .map(([file, lines]) => `  ${file}: ${previous[file]} -> ${lines}`);

if (grew.length && !allowGrowth) {
  process.stderr.write(
    [
      "[file-size] refusing to raise the baseline for a file that grew:",
      ...grew,
      "",
      "Counts are CODE lines (comments and blanks excluded).",
      "Shrink the file, or re-run with --allow-growth and say why in the pull request.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const target = path.join(repoRoot, "scripts/file-size-baseline.json");
fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`);
process.stdout.write(
  `[file-size] baseline written: ${Object.keys(baseline).length} files over the ${LINE_CEILING}-line ceiling` +
    `${grew.length ? ` (${grew.length} raised with --allow-growth)` : ""}.\n`,
);
