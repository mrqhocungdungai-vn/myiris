#!/usr/bin/env node
// Vendors the WASM/JS runtime glue that src/hooks/useWakeWord.ts,
// src/hooks/useHandControl.ts and src/hooks/useEyeTracking.ts load, so the
// renderer never fetches executable code from a third-party origin at runtime
// (renderer-content-security). The two MediaPipe hooks share one fileset —
// GestureRecognizer and FaceLandmarker are sibling tasks in the same package,
// so only the .task model assets differ.
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

// Not shipped in node_modules — data assets (not code), fetched once and
// cached on disk so subsequent builds don't need the network. Kept in sync
// with the MODEL_URLs these replace in src/hooks/useHandControl.ts and
// src/hooks/useEyeTracking.ts.
const GESTURE_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
// The plain face_landmarker variant, deliberately not the _with_blendshapes
// one: the eye HUD needs iris position/size only (eye-tracking-hud design D1).
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// Silero VAD **v5**, the speech-confirmation half of the wake decision
// (speech-confirmed-wake-word). Pinned to the v5.1.2 tag, never `master`:
// v4 and v5 differ in input signature (v5: input[1,512] + state[2,1,128] + sr;
// v4: separate h/c [2,1,64]), so an unpinned URL could swap the signature out
// from under src/lib/silero-vad.ts on a rebuild. Downloaded rather than
// committed because it has a stable upstream URL — the phrase models under
// public/wakeword/ are committed only because they come from a private
// "Hey Iris" training run with no URL to fetch them from.
const SILERO_VAD_MODEL_URL =
  "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx";

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

// Download-once, skip-if-present. Shared by every vendored model so a second
// model can't quietly acquire different caching behaviour from the first.
// `destDir` is a parameter rather than a hardcoded "mediapipe" because the
// Silero VAD model is not a MediaPipe asset and belongs beside the wake-word
// runtime, not inside another runtime's fileset.
async function vendorModel(label, url, destDir, fileName) {
  const destPath = path.join(publicDir, destDir, fileName);
  if (existsSync(destPath)) {
    return { file: path.relative(repoRoot, destPath), bytes: statSync(destPath).size, skipped: true };
  }
  mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.download`;
  try {
    await downloadFile(url, tmpPath);
    copyFileSync(tmpPath, destPath);
    return { file: path.relative(repoRoot, destPath), bytes: statSync(destPath).size };
  } catch (error) {
    throw new Error(`Could not vendor the ${label} model from ${url}: ${error.message}`);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

function vendorGestureModel() {
  return vendorModel("gesture recognizer", GESTURE_MODEL_URL, "mediapipe", "gesture_recognizer.task");
}

function vendorFaceModel() {
  return vendorModel("face landmarker", FACE_MODEL_URL, "mediapipe", "face_landmarker.task");
}

function vendorSileroVadModel() {
  return vendorModel("Silero VAD", SILERO_VAD_MODEL_URL, "wakeword", "silero_vad.onnx");
}

async function main() {
  const results = [
    ...vendorOnnxRuntime(),
    ...vendorMediaPipe(),
    await vendorGestureModel(),
    await vendorFaceModel(),
    await vendorSileroVadModel(),
  ];
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
