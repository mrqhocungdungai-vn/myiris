#!/usr/bin/env node
// PreToolUse hook — two checks with two different reasons for existing.
//
// 1. The destructive-command GUARD, evaluated first and deliberately ABOVE the
//    bypass hatch. It refuses a declared set of irreversible operations. This is
//    protection against accident, not containment and not a sandbox.
//
// 2. The commit GATE, which scans the staged content before a `git commit`.
//    `gitleaks git --staged` measures 0.07s and reads exactly what is about to be
//    committed. A full-history scan was rejected: 10x slower, and it re-reads
//    commits already known clean while never looking at what is staged.
//
// The guard is above `isBypassed()` on purpose (claude-config-earns-its-place
// D2). `IRIS_SKIP_HOOKS=1` exists so a developer can skip a slow or temporarily
// broken quality check; there is no version of "skip it just this once" that
// helps with deleting uncommitted work. So the variable means "no scan ran", NOT
// "no hook ran", and the announcement below says so — a bypass that announces
// itself has to announce the truth.
//
// KNOWN GAP, not an oversight: both checks observe Bash invocations made through
// Claude Code. A `git commit` typed directly in a terminal bypasses the gate
// entirely, and so does an `rm -rf` — the guard cannot see what it is not handed.
// Closing that requires a real git hook (and therefore husky or lefthook), which
// is deliberately out of scope. The PostToolUse per-file scan narrows the
// exposure but does not close it.
//
// See the `workflow-quality-gates` capability spec.
import { checkForbiddenCommand, commandSegments, isBypassed, scanStaged } from "../gates.mjs";
import { block, readHookInput } from "./lib.mjs";

const GUARD_TAG = "[guard:bash]";
const TAG = "[gate:commit]";

const input = readHookInput();
if (input?.tool_name !== "Bash") process.exit(0);

const command = input?.tool_input?.command;
if (typeof command !== "string" || !command) process.exit(0);

// ---------------------------------------------------------------------------
// 1. The guard. Above the bypass, and above the commit check, because a command
//    that destroys work should not have to be a commit to be refused.
//
//    Permission deny rules cover part of this from a layer that is evaluated
//    earlier — including the file-reading commands Claude Code recognises inside
//    Bash (`cat`, `head`, `tail`, `sed`), which is a better mechanism for the
//    credential case than any regex. That live behavior was NOT confirmed on this
//    machine (settings load at session start, and verifying it by actually
//    reading .env would put the credential in a transcript, which is the thing
//    being prevented). So this check is treated as load-bearing rather than as
//    belt-and-braces, and the `.env` pattern below is not redundant until
//    someone confirms otherwise in a fresh session.
// ---------------------------------------------------------------------------
const forbidden = checkForbiddenCommand(command);
if (forbidden) {
  block([
    `${GUARD_TAG} Refused: ${forbidden}.`,
    `${GUARD_TAG} Command: ${command}`,
    `${GUARD_TAG} This guard is not bypassable by IRIS_SKIP_HOOKS.`,
    `${GUARD_TAG} If this was intended, run it yourself in a terminal.`,
  ]);
}

// ---------------------------------------------------------------------------
// 2. The commit gate.
// ---------------------------------------------------------------------------

/**
 * True when any segment of the command line invokes `git ... commit`.
 *
 * Segment-splitting keeps `git log` in a chain from being mistaken for a commit,
 * while still catching `cd x && git commit`. Where the split is ambiguous this
 * deliberately errs toward scanning: a false positive costs 0.07s, a false
 * negative costs a leaked credential.
 *
 * Uses the same `commandSegments` splitter the guard does, so "what counts as one
 * command" has one definition rather than two that can disagree.
 */
function invokesGitCommit(line) {
  return commandSegments(line).some(
    (tokens) => tokens[0] === "git" && tokens.slice(1).includes("commit"),
  );
}

if (!invokesGitCommit(command)) process.exit(0);

if (isBypassed()) {
  console.error(`${TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set. No secret scan ran before this commit.`);
  console.error(`${GUARD_TAG} The destructive-command guard still ran; it is not covered by this bypass.`);
  process.exit(0);
}

const result = scanStaged();
if (!result.ok) {
  block([`${TAG} Commit blocked — the staged changes did not pass the secret scan.`, result.output]);
}

process.exit(0);
