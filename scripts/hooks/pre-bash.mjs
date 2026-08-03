#!/usr/bin/env node
// PreToolUse hook — gates `git commit` with a scan of the staged content.
//
// `gitleaks git --staged` measures 0.07s and reads exactly what is about to be
// committed. A full-history scan was rejected: 10x slower, and it re-reads
// commits already known clean while never looking at what is staged.
//
// KNOWN GAP, not an oversight: this observes Bash invocations made through
// Claude Code. A `git commit` typed directly in a terminal bypasses it entirely.
// Closing that requires a real git hook (and therefore husky or lefthook), which
// is deliberately out of scope. The PostToolUse per-file scan narrows the
// exposure but does not close it.
//
// See the `workflow-quality-gates` capability spec.
import { isBypassed, scanStaged } from "../gates.mjs";
import { block, readHookInput } from "./lib.mjs";

const TAG = "[gate:commit]";

const input = readHookInput();
if (input?.tool_name !== "Bash") process.exit(0);

const command = input?.tool_input?.command;
if (typeof command !== "string" || !command) process.exit(0);

/**
 * True when any segment of the command line invokes `git ... commit`.
 *
 * Segment-splitting keeps `git log` in a chain from being mistaken for a commit,
 * while still catching `cd x && git commit`. Where the split is ambiguous this
 * deliberately errs toward scanning: a false positive costs 0.07s, a false
 * negative costs a leaked credential.
 */
function invokesGitCommit(line) {
  return line
    .split(/\|\||&&|[;\n|]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .some((tokens) => {
      // Skip leading VAR=value assignments so `GIT_AUTHOR=x git commit` is caught.
      let i = 0;
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
      if (tokens[i] !== "git") return false;
      return tokens.slice(i + 1).includes("commit");
    });
}

if (!invokesGitCommit(command)) process.exit(0);

if (isBypassed()) {
  console.error(`${TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set. No secret scan ran before this commit.`);
  process.exit(0);
}

const result = scanStaged();
if (!result.ok) {
  block([`${TAG} Commit blocked — the staged changes did not pass the secret scan.`, result.output]);
}

process.exit(0);
