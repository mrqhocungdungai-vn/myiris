// The definitions of the lint, secret-scanning, spec-drift, and behavioral
// gates, plus the destructive-command guard.
//
// This module is the single place each gate is defined. Callers import it —
// `npm run lint`, `npm run scan:secrets`, `npm run spec:check`, and the Claude
// Code hooks — so the hand-run check and the automatic one cannot drift into
// checking different things under different flags.
//
// The guard (`checkForbiddenCommand`) is the one export here that is NOT a
// quality gate, and it is deliberately kept in this file anyway: it is the same
// kind of thing — one definition, imported by its binding — and splitting it out
// would make the hook import from two places for no gain. What differs is that
// `isBypassed()` must never be consulted for it; see the guard's own comment.
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
import { checkFileSizes } from "./check-file-size.mjs";
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
// Destructive-command guard (claude-config-earns-its-place D1/D2)
//
// A guard against accident, NOT a sandbox and NOT containment. It observes
// commands issued through Claude Code; a command typed directly in a terminal
// does not reach it, and a subprocess that deletes files by other means (a node
// or python script) is outside what it can see. That boundary is the same one
// `pre-bash.mjs` already records for the commit gate, and it is stated here so
// nobody reads this list as a security control.
//
// Why a hook and not permission rules alone: the editing loop for this repo runs
// with prompting disabled. Deny rules ARE still evaluated in that mode — bypass
// skips prompts, and a deny rule is not a prompt — and they are evaluated before
// this hook. But a rule pattern cannot express "a destructive verb anywhere
// inside a compound command line", which is what this does. A PreToolUse hook
// exiting 2 stops the call before permission rules are read, so this is the
// outermost layer.
//
// The set is chosen against what is ALREADY covered, so it does not spend its
// credibility on redundancy. Claude Code already prompts for `rm -rf /` and
// `rm -rf ~` as a built-in circuit breaker even in bypass mode; those are
// deliberately absent below. What is uncovered is the ordinary accident: a
// recursive delete aimed at a project path, a force push to the wrong branch, a
// discard of uncommitted work, and a credential read into the transcript.
// ---------------------------------------------------------------------------

/**
 * Split a command line into segments, one per invocation.
 *
 * Shared with `pre-bash.mjs`'s commit detection rather than duplicated, so
 * "what counts as one command" has a single definition. Each segment is a token
 * array with any leading `VAR=value` assignments dropped, so
 * `GIT_AUTHOR=x git commit` and `cd x && rm -rf y` both resolve to the command
 * actually being run.
 */
export function commandSegments(line) {
  return line
    .split(/\|\||&&|[;\n|]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .map((tokens) => {
      let i = 0;
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
      return tokens.slice(i);
    })
    .filter((tokens) => tokens.length > 0);
}

/** Strip surrounding quotes from one token, so `"./.env"` and `./.env` compare alike. */
function unquote(token) {
  return token.replace(/^['"]|['"]$/g, "");
}

/** The command name, with any directory prefix removed: `/bin/rm` and `rm` both read as `rm`. */
function commandName(tokens) {
  return unquote(tokens[0] ?? "").split("/").pop();
}

/** True when a token is a short-option cluster containing `r` or `R` (`-r`, `-rf`, `-fr`). */
function isRecursiveFlag(token) {
  if (token === "--recursive") return true;
  if (!/^-[^-]/.test(token)) return false;
  return /[rR]/.test(token.slice(1));
}

/**
 * True when a token names this repo's real credential file.
 *
 * Matches the basename exactly (`.env`) or the gitignored test variants
 * (`.env_test`, `.env_test.local`) — NOT `.env.example`, which is tracked and
 * holds no secret, and NOT `.envrc` or `.environment`, which merely start with
 * the same letters. The check is command-agnostic on purpose: enumerating
 * readers (`cat`, `head`, `bat`, …) misses whichever reader is used next, which
 * is the flaw in the obvious version of this rule.
 *
 * Known false positive, accepted: `cp .env.example .env` names `.env` as a
 * write target and is refused. It is a one-time setup step and the refusal says
 * to run it directly.
 */
function namesCredentialFile(token) {
  const basename = unquote(token).split("/").pop();
  return basename === ".env" || basename.startsWith(".env_test");
}

/**
 * Decide whether a command line performs a declared irreversible operation.
 *
 * Pure: no I/O, no subprocess, and deliberately no `isBypassed()` call. Returns
 * the matched operation's description, or `null` when nothing matched. Kept pure
 * so `scripts/gates.forbidden.test.mjs` can enumerate the cases that must be
 * refused AND the near-misses that must not be — the ones the author did not
 * think of are the whole reason this is tested rather than read.
 */
export function checkForbiddenCommand(command) {
  if (typeof command !== "string" || !command.trim()) return null;

  for (const tokens of commandSegments(command)) {
    const name = commandName(tokens);
    const args = tokens.slice(1).map(unquote);

    if (name === "rm" && args.some(isRecursiveFlag)) {
      return "a recursive delete (`rm -r`)";
    }

    if (name === "git") {
      const subcommand = args.find((token) => !token.startsWith("-"));
      const flags = args.filter((token) => token.startsWith("-"));

      if (
        subcommand === "push" &&
        flags.some((flag) => flag === "-f" || flag === "--force" || flag.startsWith("--force-with-lease"))
      ) {
        return "a force push (`git push --force`)";
      }
      if (subcommand === "reset" && flags.includes("--hard")) {
        return "a hard reset (`git reset --hard`)";
      }
      if ((subcommand === "checkout" || subcommand === "restore") && args.includes(".")) {
        return `a discard of the whole working tree (\`git ${subcommand} .\`)`;
      }
    }

    if (tokens.some(namesCredentialFile)) {
      return "reading the credential file into the transcript (`.env`)";
    }
  }

  return null;
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
  // The file-size ratchet rides the lint gate for the same reason the dead-CSS
  // sweep does: it is a static read of the tree that needs no build.
  const fileSize = checkFileSizes({ repoRoot: REPO_ROOT });

  return {
    ok: oxlintOk && deadCss.ok && fileSize.ok,
    output: [combined(result), deadCss.output, fileSize.output].filter(Boolean).join("\n"),
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
// Behavioral suite
// ---------------------------------------------------------------------------

const TEST_TAG = "[test]";

/**
 * Run the behavioral suite.
 *
 * **The whole suite runs, not a subset selected from the changed files.** This is
 * load-bearing and is the single most likely thing here for a future reader to
 * "optimise" back, so the measurement that decided it is recorded rather than
 * summarised. Measured on this tree (claude-config-earns-its-place D3):
 *
 *   whole suite                                88 files   1378 tests   ~7.4s
 *   vitest related electron/run-dispatch.mjs    2 files     36 tests   ~0.4s
 *   vitest related electron/verbs.mjs          15 files   ZERO from `graph`
 *
 * `related` selects by static import graph. `electron-graph.supply.test.mjs`
 * discovers its subjects with `readdirSync(electronDir, { recursive: true })` and
 * therefore declares no dependency on any module it checks — by design, because
 * that is how it covers modules nobody remembered to add. So `related` can never
 * select it, and the case where that matters is exactly the case it exists for: a
 * new main-process module importing a name its sibling does not export. `related`
 * would run the tests that import the new module (there are none yet) and skip
 * the one test that would have caught it.
 *
 * Seven seconds against a structurally missing gate is not a close trade. Scoping
 * stays where the spec puts it — off the per-session ledger, deciding WHETHER the
 * suite runs, never which parts of it do.
 *
 * `npm test` is unchanged by this existing: same runner, same config, same
 * verdict. Binding a gate is not extending it.
 */
export function runTests() {
  if (isBypassed()) return { ok: true, output: `${TEST_TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set.` };

  let vitestBin;
  try {
    // Resolved through the installed package's own declared `bin` rather than a
    // hardcoded `node_modules/.bin` path, so neither hoisting nor a renamed
    // entry point can break it — the same reasoning runLint() uses for oxlint.
    const packagePath = require.resolve("vitest/package.json");
    const declared = require(packagePath).bin;
    const relative = typeof declared === "string" ? declared : declared?.vitest;
    if (!relative) throw new Error("vitest declares no bin entry");
    vitestBin = path.join(path.dirname(packagePath), relative);
  } catch {
    return failClosed(TEST_TAG, "vitest", "npm ci");
  }

  const result = spawnSync(process.execPath, [vitestBin, "run"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });

  if (result.error) return { ok: false, output: `${TEST_TAG} vitest could not be run: ${result.error.message}` };
  return { ok: result.status === 0, output: combined(result) };
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
