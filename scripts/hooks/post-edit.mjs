#!/usr/bin/env node
// PostToolUse hook — the per-file gate, bound to every Edit/Write.
//
// Only the secret scan runs here, and the reason is scope rather than cost.
//
// A per-file check reads exactly the file just written, so it is never wrong
// about an intermediate state: a credential is a credential regardless of what
// any other file currently says. A whole-tree check reads relationships BETWEEN
// files, so it is necessarily wrong partway through any multi-edit sequence —
// the moment after an import line changes but before its use does.
//
// Lint was briefly bound here, on the reasoning that 223ms is cheap enough to
// afford per edit. It is; that was the wrong axis. On its first live use it
// blocked a two-edit refactor over an import that the very next edit consumed.
// Worse than the noise, an agent handed "unused import" mid-refactor may delete
// the import the next edit was about to use — a false alarm that becomes a real
// defect. Lint moved to the Stop hook, alongside the typecheck it resembles.
//
// Also records the written path in the per-session ledger, which the Stop hook
// reads to decide which whole-tree checks need to run.
//
// See the `workflow-quality-gates` capability spec.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, isBypassed, scanFile } from "../gates.mjs";
import { block, ledgerPath, readHookInput } from "./lib.mjs";

const TAG = "[gate:edit]";

const input = readHookInput();
if (isBypassed()) {
  console.error(`${TAG} BYPASSED — IRIS_SKIP_HOOKS=1 is set. No gate ran.`);
  process.exit(0);
}

const filePath = input?.tool_input?.file_path;
if (!filePath) process.exit(0);

const absolute = path.resolve(REPO_ROOT, filePath);

// Edits outside the repo are none of this gate's business.
if (!absolute.startsWith(`${REPO_ROOT}${path.sep}`)) process.exit(0);

const relative = path.relative(REPO_ROOT, absolute);

try {
  appendFileSync(ledgerPath(input?.session_id), `${relative}\n`);
} catch {
  // A ledger write failure must not block an otherwise valid edit. The Stop hook
  // degrades to running no check, which the next turn's edit restores.
}

// Every written file is scanned, including Markdown and configuration: a
// credential pasted into a document is committed just as readily as one in source.
const secrets = scanFile(relative);
if (!secrets.ok) block([`${TAG} Secret scan failed for ${relative}:`, secrets.output]);

process.exit(0);
