#!/usr/bin/env node
// Fails the build when the root `@types/node` no longer describes the Node
// build that Electron actually embeds.
//
// Modules under electron/ run on Electron's bundled Node, not the developer's
// system Node, and tsconfig.electron.json typechecks all of them against
// whatever `@types/node` resolves at the root. Types for a newer Node admit
// standard-library APIs that do not exist at runtime, so the gate reports
// success for code that throws on launch.
//
// The authority is `electron`'s own `@types/node` dependency range, NOT
// package.json's `engines.node`: the two agree today by coincidence, but only
// the former moves in lockstep with the embedded Node, and it is what
// electron.d.ts's `/// <reference types="node" />` is written against. Left
// unchecked, the next Electron upgrade silently reopens the gap — the divergence
// produces no error of its own, because `skipLibCheck` is enabled.
//
// See the `test-harness` capability spec, "The Electron typecheck project's
// Node types match the Node that Electron embeds".
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function read(spec, label) {
  try {
    return require(spec);
  } catch {
    console.error(`[check-types-node] Could not read ${label} (${spec}). Run npm install.`);
    process.exit(1);
  }
}

const electronPkg = read("electron/package.json", "electron's package.json");
const typesPkg = read("@types/node/package.json", "the installed @types/node");

const declared = electronPkg.dependencies?.["@types/node"];
if (!declared) {
  console.error("[check-types-node] electron no longer declares an @types/node dependency.");
  console.error("[check-types-node] This guard assumed it does; re-check how the embedded Node version should be derived.");
  process.exit(1);
}

// Compare majors rather than pulling in a semver dependency: `electron` has
// always declared a caret range on a single major, and a major mismatch is the
// failure that matters — a newer minor cannot add a Node major's APIs.
const declaredMajor = declared.match(/(\d+)/)?.[1];
const installedMajor = typesPkg.version.match(/(\d+)/)?.[1];

if (declaredMajor !== installedMajor) {
  console.error(`[check-types-node] @types/node major mismatch: installed ${typesPkg.version}, but electron ${electronPkg.version} declares "${declared}".`);
  console.error("[check-types-node] The types must describe the Node that Electron embeds, or the electron/ typecheck accepts APIs missing at runtime.");
  console.error(`[check-types-node] Fix: set @types/node to a ${declaredMajor}.x version in package.json.`);
  process.exit(1);
}

console.log(`[check-types-node] OK — @types/node ${typesPkg.version} matches electron ${electronPkg.version}'s declared "${declared}".`);
