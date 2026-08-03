#!/usr/bin/env node
// CLI entry point for the secret-scanning gate. The definition lives in
// scripts/gates.mjs, which the Claude Code hooks import directly — see that file
// for why the gates are functions rather than scripts.
//
//   --staged        scan the content about to be committed
//   --file <path>   scan one file, skipping paths git ignores
import { scanFile, scanStaged } from "./gates.mjs";

const [mode, target] = process.argv.slice(2);

let result;
if (mode === "--staged") {
  result = scanStaged();
} else if (mode === "--file") {
  result = scanFile(target);
} else {
  console.error("[scan-secrets] usage: scan-secrets.mjs --staged | --file <path>");
  process.exit(1);
}

if (result.output) (result.ok ? process.stdout : process.stderr).write(`${result.output}\n`);
process.exit(result.ok ? 0 : 1);
