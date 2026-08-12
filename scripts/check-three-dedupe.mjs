#!/usr/bin/env node
// Fails the build if more than one `three` version is resolved in
// node_modules. 3d-force-graph bundles its own `three` dependency; without
// the `overrides.three` pin in package.json (+ `resolve.dedupe` in
// vite.config.ts) the graph rendering canvas and the reactor/holo backdrop
// could each get a different live `three` module instance, breaking
// `instanceof THREE.Object3D` checks across the boundary. See galaxy-view,
// "The galaxy renders over an immersive opaque deep-space backdrop", whose
// last clause requires reusing the `three` instance already present — this
// gate is added only after confirming the override collapses the pre-existing
// stats-gl@2.4.2 -> three@0.170.0 copy.
import { execSync } from "node:child_process";

const tree = JSON.parse(execSync("npm ls three --json --all", { encoding: "utf8" }));

const versions = new Set();
function walk(node) {
  if (!node || typeof node !== "object") return;
  for (const [name, dep] of Object.entries(node.dependencies || {})) {
    if (name === "three" && dep.version) versions.add(dep.version);
    walk(dep);
  }
}
walk(tree);

if (versions.size > 1) {
  console.error(`[check-three-dedupe] Found ${versions.size} distinct three versions resolved: ${[...versions].join(", ")}`);
  console.error("[check-three-dedupe] Expected exactly one. Check package.json overrides.three and vite.config.ts resolve.dedupe.");
  process.exit(1);
}

console.log(`[check-three-dedupe] OK — single three version resolved (${[...versions][0] ?? "none found"}).`);
