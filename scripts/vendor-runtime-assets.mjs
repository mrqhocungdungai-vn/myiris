#!/usr/bin/env node
// Vendors the WASM/JS runtime glue that src/hooks/useWakeWord.ts and
// src/hooks/useHandControl.ts load, so the renderer never fetches executable
// code from a third-party origin at runtime (renderer-content-security).
// Copies straight from node_modules (already on disk, already pinned by
// package.json) rather than committing ~25MB of binaries to git, so the
// shipped runtime can't drift from the installed package version. Run before
// `vite build`/`vite`/`electron` so both dev and packaged builds see the
// files under public/, which Vite copies verbatim into dist/.
//
// Picks exactly ONE variant per runtime, matching what the app's own import
// actually resolves at runtime (see design.md D6 / Open Questions):
// - onnxruntime-web: the bare `import * as ort from "onnxruntime-web"` in
//   useWakeWord.ts resolves (via the package's "import"."default" export
//   condition, which Vite uses since no custom resolve.conditions are set)
//   to dist/ort.bundle.min.mjs. That bundle hardcodes the JSEP-suffixed wasm
//   module filename regardless of executionProviders/numThreads, so
//   "ort-wasm-simd-threaded.jsep.{mjs,wasm}" is the pair actually fetched —
//   confirmed by grepping the resolved bundle for the literal filename.
// - @mediapipe/tasks-vision: FilesetResolver.forVisionTasks(url) (no second
//   "module" argument, so module=false) builds
//   `vision_wasm${simdSupported ? "" : "_nosimd"}_internal.{js,wasm}` — SIMD
//   is universal on the Chromium version Electron ships, so
//   "vision_wasm_internal" is the pair used.
import { existsSync, mkdirSync, copyFileSync, statSync, unlinkSync, createWriteStream } from "node:fs";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(repoRoot, "public", "runtime");

function requireFile(label, filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`${label}: expected file not found at ${filePath} — cannot resolve exactly one variant to vendor.`);
  }
  return filePath;
}

function copy(label, from, to) {
  requireFile(label, from);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  const { size } = statSync(to);
  return { file: path.relative(repoRoot, to), bytes: size };
}

function vendorOnnxRuntime() {
  const variant = "ort-wasm-simd-threaded.jsep";
  const srcDir = path.join(repoRoot, "node_modules", "onnxruntime-web", "dist");
  const destDir = path.join(publicDir, "ort");
  return [
    copy("onnxruntime-web glue", path.join(srcDir, `${variant}.mjs`), path.join(destDir, `${variant}.mjs`)),
    copy("onnxruntime-web wasm", path.join(srcDir, `${variant}.wasm`), path.join(destDir, `${variant}.wasm`)),
  ];
}

function vendorMediaPipe() {
  const variant = "vision_wasm_internal";
  const srcDir = path.join(repoRoot, "node_modules", "@mediapipe", "tasks-vision", "wasm");
  const destDir = path.join(publicDir, "mediapipe");
  return [
    copy("MediaPipe glue", path.join(srcDir, `${variant}.js`), path.join(destDir, `${variant}.js`)),
    copy("MediaPipe wasm", path.join(srcDir, `${variant}.wasm`), path.join(destDir, `${variant}.wasm`)),
  ];
}

// Not shipped in node_modules — a data asset (not code), fetched once and
// cached on disk so subsequent builds don't need the network. Kept in sync
// with the MODEL_URL this replaces in src/hooks/useHandControl.ts.
const GESTURE_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }
      const file = createWriteStream(destPath);
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function vendorGestureModel() {
  const destPath = path.join(publicDir, "mediapipe", "gesture_recognizer.task");
  if (existsSync(destPath)) {
    return { file: path.relative(repoRoot, destPath), bytes: statSync(destPath).size, skipped: true };
  }
  mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.download`;
  try {
    await downloadFile(GESTURE_MODEL_URL, tmpPath);
    copyFileSync(tmpPath, destPath);
    return { file: path.relative(repoRoot, destPath), bytes: statSync(destPath).size };
  } catch (error) {
    throw new Error(`Could not vendor the gesture recognizer model from ${GESTURE_MODEL_URL}: ${error.message}`);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

async function main() {
  const results = [...vendorOnnxRuntime(), ...vendorMediaPipe(), await vendorGestureModel()];
  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  for (const r of results) {
    const mb = (r.bytes / (1024 * 1024)).toFixed(1);
    console.log(`[vendor-runtime-assets] ${r.file} (${mb} MB)${r.skipped ? " — already present, skipped download" : ""}`);
  }
  console.log(`[vendor-runtime-assets] total vendored: ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error(`[vendor-runtime-assets] ${error.message}`);
  process.exit(1);
});
