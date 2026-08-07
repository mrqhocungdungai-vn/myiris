#!/usr/bin/env node
// Stop hook — the whole-tree gates, bound once per turn instead of per edit.
//
// Lint and typecheck both read relationships BETWEEN files, which makes them
// necessarily wrong partway through any multi-edit sequence: the moment after an
// import line changes but before its use does. Binding them to the end of the
// turn is what makes them correct, not merely affordable. (Cost matters too —
// typecheck is 2.6s + 3.4s, which no per-edit budget survives — but scope is the
// reason, and cost is why the reason was initially missed.)
//
// Neither can be scoped to a single file: `tsc -p` is a project-level operation
// by construction, and lint's value is precisely that it sees the whole tree.
// What typecheck CAN be scoped to is which of the two projects runs, since src/
// and electron/ are separate projects. The per-session ledger written by the
// PostToolUse hook is what makes that decision possible — the Stop event itself
// does not report which files changed.
//
// The spec-drift gate joins them here for the same reason and not for cost: it
// reads the whole of `openspec/specs/` and a multi-file spec edit is mid-flight
// until the turn ends — a term rewritten in one file while its allowance still
// names the old wording is the same wrong-about-an-intermediate-state failure
// lint had. It is scoped the same way lint and typecheck are, off the ledger:
// a turn that touched no spec file does not pay for it.
//
// The behavioral suite joins them here (claude-config-earns-its-place) for the
// third instance of the same reason: a test asserts a relationship between a
// module and its collaborators, so mid-sequence it is wrong about the intent in
// exactly the way lint is. Until it was bound it was the largest check in the repo
// and the only one that ran when someone remembered it — which this capability's
// own purpose calls protecting nothing. Unlike typecheck it is NOT sub-scoped by
// project; `runTests()` records the measurement that decided that.
//
// A turn that wrote no files finds an empty ledger and costs nothing, which is
// the common case for a question-answering turn.
//
// See the `workflow-quality-gates` capability spec.
import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { LINTABLE_EXTENSIONS, REPO_ROOT, isBypassed, runLint, runSpecDrift, runTests } from "../gates.mjs";
import { checkPluginSync } from "../check-plugin-sync.mjs";
import { block, ledgerPath, readHookInput } from "./lib.mjs";

const TAG = "[gate:turn]";
const require = createRequire(import.meta.url);

const input = readHookInput();

// Loop guard. Claude Code sets this when the turn is already continuing because
// this hook blocked once. Re-blocking here would trap an unresolvable failure in
// a loop; the ledger is deliberately left in place so the NEXT turn re-checks.
if (input?.stop_hook_active) process.exit(0);

if (isBypassed()) {
  console.error(`${TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set. No gate ran.`);
  process.exit(0);
}

const ledger = ledgerPath(input?.session_id);

let changed = [];
try {
  changed = readFileSync(ledger, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
} catch {
  process.exit(0); // No ledger — nothing was written this turn.
}
if (changed.length === 0) process.exit(0);

// The same two invocations `npm run build` performs, run conditionally rather
// than always. Kept as one mapping so the project→command pairing has a single
// place to be wrong.
const PROJECTS = [
  { name: "renderer", prefix: "src", args: ["--noEmit"] },
  { name: "electron", prefix: "electron", args: ["-p", "tsconfig.electron.json"] },
];

const neededProjects = PROJECTS.filter(({ prefix }) =>
  changed.some((file) => file === prefix || file.startsWith(`${prefix}/`)),
);

// Lint and the behavioral suite read the same set of files — every first-party
// source extension — so one predicate answers both rather than two near-identical
// extension sets drifting apart. Named for the shared fact, not for either
// caller.
const codeChanged = changed.some((file) => LINTABLE_EXTENSIONS.has(path.extname(file)));

// The living spec, plus the checker itself: editing an allowance or a term is
// the one other way to change what the gate reports, and skipping it there
// would let an allowance be widened without the tree it exempts being re-read.
const SPEC_TRIGGERS = ["openspec/specs", "scripts/check-spec-drift.mjs"];
const specNeeded = changed.some((file) =>
  SPEC_TRIGGERS.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)),
);

// The vendored-config check reads two trees plus the lock, so the same scoping
// logic applies — and, like the spec gate, editing the check's own allowance list
// is the other way to change what it reports.
const PLUGIN_TRIGGERS = [".claude", "resources/iris-plugin", "skills-lock.json", "scripts/check-plugin-sync.mjs"];
const pluginNeeded = changed.some((file) =>
  PLUGIN_TRIGGERS.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)),
);

// Files outside both projects, outside lint's reach, and outside the spec tree
// (other docs, configuration) leave nothing for this gate to do.
if (neededProjects.length === 0 && !codeChanged && !specNeeded && !pluginNeeded) {
  rmSync(ledger, { force: true });
  process.exit(0);
}

// Ordered cheapest first, so the fastest correctable failure is reported first:
// lint (223ms) → spec drift → typecheck (2.6s + 3.4s) → the suite (~7.6s).
// Failures accumulate rather than short-circuit, which is the existing shape and
// worth keeping — an agent handed every failure at once fixes them in one pass.
const failures = [];

if (codeChanged) {
  const lint = runLint();
  if (!lint.ok) failures.push(`${TAG} Lint failed:`, lint.output);
}

if (specNeeded) {
  const spec = runSpecDrift();
  if (!spec.ok) failures.push(`${TAG} Spec-drift check failed:`, spec.output);
}

// Pure hashing, so it is the cheapest thing here. Build-attached as well, like
// its two siblings — it is not a sixth gate.
if (pluginNeeded) {
  const plugin = checkPluginSync();
  if (!plugin.ok) failures.push(`${TAG} Vendored-config check failed:`, plugin.output);
}

if (neededProjects.length > 0) {
  let tscBin;
  try {
    tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  } catch {
    block([
      `${TAG} typescript is not installed, so nothing was typechecked.`,
      `${TAG} This gate fails closed rather than reporting a pass it cannot justify.`,
      `${TAG} Fix: npm ci`,
      `${TAG} One-off bypass: IRIS_SKIP_HOOKS=1`,
    ]);
  }

  for (const project of neededProjects) {
    const result = spawnSync(process.execPath, [tscBin, ...project.args], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status !== 0) failures.push(`${TAG} Typecheck failed (${project.name}):`, output);
  }
}

// Last, because it is the most expensive. A turn that wrote no code file has
// already exited above, so this is never paid for a documentation-only turn.
// Why the whole suite rather than a dependency-selected subset is recorded on
// `runTests()` itself, with the measurement that decided it.
if (codeChanged) {
  const tests = runTests();
  if (!tests.ok) failures.push(`${TAG} Tests failed:`, tests.output);
}

if (failures.length > 0) {
  // Ledger survives a failure on purpose: clearing it here would let the next
  // Stop pass without ever re-checking the fix.
  block(failures);
}

rmSync(ledger, { force: true });
process.exit(0);
