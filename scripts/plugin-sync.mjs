#!/usr/bin/env node
// CLI entry point for the duplicated-config / provenance check. The definition
// lives in scripts/check-plugin-sync.mjs, matching the shape of scripts/lint.mjs
// and scripts/spec-check.mjs.
//
// Build-attached, not one of the five gates — see the definition's header.
import { checkPluginSync } from "./check-plugin-sync.mjs";

const { ok, output } = checkPluginSync();
if (output) (ok ? process.stdout : process.stderr).write(`${output}\n`);
process.exit(ok ? 0 : 1);
