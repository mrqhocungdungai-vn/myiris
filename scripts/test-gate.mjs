#!/usr/bin/env node
// CLI entry point for the behavioral gate. The definition lives in
// scripts/gates.mjs, which the Claude Code hooks import directly — see that file
// for why the gates are functions rather than scripts.
//
// This is NOT a replacement for `npm test`, and `npm test` is deliberately left
// exactly as it was. This exists so the gate has the same one-definition,
// two-callers shape every other gate here has: the hand-run path and the
// end-of-turn binding execute the same function, so they cannot drift into
// running the suite under different flags.
import { runTests } from "./gates.mjs";

const { ok, output } = runTests();
if (output) (ok ? process.stdout : process.stderr).write(`${output}\n`);
process.exit(ok ? 0 : 1);
