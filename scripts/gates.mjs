// The definitions of the lint, secret-scanning, and spec-drift gates.
//
// This module is the single place each gate is defined. Callers import it —
// `npm run lint`, `npm run scan:secrets`, `npm run spec:check`, and the Claude
// Code hooks — so the hand-run check and the automatic one cannot drift into
// checking different things under different flags.
//
// Exported as functions rather than run as scripts because the hooks would
// otherwise spawn a `node` process per gate. Measured: node startup is 92ms,
// against 223ms for the lint itself and 76ms for a single-file secret scan.
// Spawning per gate spent 276ms of a 572ms hook on process startup alone —
// the same tax that made `npm run` the wrong hook entry point, just relabelled.
//
// See the `workflow-quality-gates` capability spec.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { checkDeadClaudeCss } from "./dead-claude-css.mjs";
import { checkSpecDrift } from "./check-spec-drift.mjs";

const require = createRequire(import.meta.url);

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** Matches the IRIS_ALLOW_ANY_PLATFORM=1 convention: explicit, announced, never a silent default. */
export function isBypassed() {
  return process.env.IRIS_SKIP_HOOKS === "1";
}

function combined(result) {
  return `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trim();
}

function failClosed(tag, what, fix) {
  return {
    ok: false,
    output: [
      `${tag} ${what} is not available, so nothing was checked.`,
      `${tag} This gate fails closed rather than reporting a pass it cannot justify.`,
      `${tag} Fix: ${fix}`,
      `${tag} One-off bypass: IRIS_SKIP_HOOKS=1`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

const LINT_TAG = "[lint]";
const LINT_TARGETS = ["src", "electron", "scripts"];

/** File extensions oxlint reads. Everything else skips lint but is still secret-scanned. */
export const LINTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * Run the lint gate over the whole tree.
 *
 * `--deny-warnings` is load-bearing, not decoration: these rules report at
 * warning severity and oxlint exits 0 without it. Measured on this tree — 7
 * findings, exit 0 without the flag, exit 1 with it. The zero-warning threshold
 * IS the gate. Rule selection lives in .oxlintrc.json, with the measured cost of
 * every excluded rule group recorded there.
 *
 * Also runs the dead-Claude-CSS check (remove-dead-role-era-styles design D4):
 * not a fifth gate, folded into this one, since it is itself a whole-tree
 * zero-tolerance scan with the same shape as oxlint's.
 */
export function runLint() {
  if (isBypassed()) return { ok: true, output: `${LINT_TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set.` };

  let oxlintBin;
  try {
    // Resolved through the installed package rather than a hardcoded
    // node_modules path, so hoisting cannot break it.
    oxlintBin = path.join(path.dirname(require.resolve("oxlint/package.json")), "bin", "oxlint");
  } catch {
    return failClosed(LINT_TAG, "oxlint", "npm ci");
  }

  const result = spawnSync(process.execPath, [oxlintBin, "--deny-warnings", ...LINT_TARGETS], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });

  if (result.error) return { ok: false, output: `${LINT_TAG} oxlint could not be run: ${result.error.message}` };

  const oxlintOk = result.status === 0;
  const deadCss = checkDeadClaudeCss({ repoRoot: REPO_ROOT });

  return {
    ok: oxlintOk && deadCss.ok,
    output: [combined(result), deadCss.output].filter(Boolean).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Spec drift
// ---------------------------------------------------------------------------

const SPEC_TAG = "[spec-drift]";

/**
 * Run the spec-drift gate over `openspec/specs/`.
 *
 * The fifth gate, and the first that checks something other than code. The
 * living spec is what CLAUDE.md names as the source of truth and what the next
 * change is authored from, yet it was the one artifact with no automated check:
 * `openspec validate --specs --strict` reported 43/43 while the tree carried
 * retired vocabulary from a deleted concept, seven `TBD` Purposes, a requirement
 * duplicated verbatim across two capabilities, and a requirement whose own
 * scenarios mandated the thing it forbade — which shipped as a real defect.
 *
 * Kept out of `runLint()` rather than folded in like the dead-CSS check: that
 * one scans the same `src/` tree oxlint already reads, whereas this reads a
 * different tree entirely, and the Stop hook needs to decide independently
 * whether spec files changed. See openspec/specs/workflow-quality-gates/spec.md.
 */
export function runSpecDrift() {
  if (isBypassed()) return { ok: true, output: `${SPEC_TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set.` };
  try {
    return checkSpecDrift({});
  } catch (error) {
    // Fails closed: the check breaking is not the check passing.
    return { ok: false, output: `${SPEC_TAG} the spec-drift check itself failed: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// Secret scanning
// ---------------------------------------------------------------------------

const SECRETS_TAG = "[scan-secrets]";

function runGitleaks(args) {
  return spawnSync("gitleaks", [...args, "--redact", "--no-banner", "-v"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

function interpret(result, what) {
  // gitleaks exits 1 on findings and 0 on clean. Anything else is the tool
  // itself failing, which must never be read as "clean".
  if (result.error?.code === "ENOENT") return failClosed(SECRETS_TAG, "gitleaks", "brew install gitleaks");
  if (result.error) return { ok: false, output: `${SECRETS_TAG} gitleaks could not be run: ${result.error.message}` };
  if (result.status === 0) return { ok: true, output: "" };

  const detail = combined(result);
  if (result.status === 1) {
    return {
      ok: false,
      output: [
        `${SECRETS_TAG} SECRET DETECTED in ${what}.`,
        detail,
        `${SECRETS_TAG} Values above are redacted. Remove the credential; do not commit it.`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return {
    ok: false,
    output: `${SECRETS_TAG} gitleaks exited ${result.status} scanning ${what} — treating as a failure.\n${detail}`.trim(),
  };
}

function isIgnored(target) {
  // `git check-ignore -q` exits 0 when the path IS ignored, 1 when it is not.
  return spawnSync("git", ["check-ignore", "-q", "--", target], { cwd: REPO_ROOT }).status === 0;
}

/**
 * Scan the staged changes (~0.07s).
 *
 * Reads exactly the content about to be committed. A full-history scan was
 * rejected at 0.79s: 10x slower, and it re-reads commits already known clean
 * while never looking at what is staged.
 */
export function scanStaged() {
  if (isBypassed()) return { ok: true, output: `${SECRETS_TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set.` };
  return interpret(runGitleaks(["git", "--staged", "."]), "the staged changes");
}

/**
 * Scan one file (~0.08s).
 *
 * Whole-tree scanning was rejected at 7.6s and, worse, 2 false findings — the
 * developer's real .env and a third-party key inside a vendored bundle in dist/.
 * `gitleaks dir` does not read .gitignore, so a whole-tree scope necessarily
 * reports ignored paths. Handing it one file at a time avoids that structurally
 * instead of papering over it with an ignore list.
 *
 * Ignored paths are determined by `git check-ignore` — the repository's own
 * rules — so this gate's exclusion set cannot drift from the repo's.
 */
export function scanFile(target) {
  if (isBypassed()) return { ok: true, output: `${SECRETS_TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set.` };
  if (!target) return { ok: false, output: `${SECRETS_TAG} scanFile requires a path.` };
  // Not a pass being granted: ignored content cannot reach the repository, so it
  // is outside this gate's scope entirely.
  if (isIgnored(target)) return { ok: true, output: "" };
  return interpret(runGitleaks(["dir", target]), target);
}
