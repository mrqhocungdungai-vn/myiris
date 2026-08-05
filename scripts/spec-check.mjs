#!/usr/bin/env node
// CLI entry point for the spec-drift gate. The definition lives in
// scripts/gates.mjs, which the Claude Code hooks import directly — see that file
// for why the gates are functions rather than scripts.
import { runSpecDrift } from "./gates.mjs";

const { ok, output } = runSpecDrift();
if (output) (ok ? process.stdout : process.stderr).write(`${output}\n`);
process.exit(ok ? 0 : 1);
