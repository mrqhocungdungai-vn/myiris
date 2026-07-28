#!/usr/bin/env node
// End-to-end wake check (fix-vendored-runtime-path-resolution design D8).
//
// Boots the production build against a synthesized "Hey Iris" clip via
// Chromium's fake-audio-capture flags and asserts a wake fired. This is the
// only artifact in that change that actually exercises the production
// file:// resolution path — npm test cannot, since a test may not boot
// Electron (test-harness spec). Deliberately NOT wired into `npm test`.
//
// Run by hand: node scripts/check-wake-e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const CACHE_DIR = path.join(repoRoot, "scripts", ".wake-e2e-cache");
const FIXTURE_WAV = path.join(CACHE_DIR, "hey-iris.wav");

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // 16-bit
// Leading pad covers two independent needs (design D8): the 2s ring buffer
// must fill before the phrase arrives, and App.tsx's async getConfig() must
// land first, since the [wakeword] fired debug line is gated on
// settings.debug, which arrives with that config.
const LEAD_SILENCE_SECONDS = 4;
// --use-file-for-fake-audio-capture loops its input by default; the trailing
// pad is what keeps the looped clip from reading as "Hey IrisHey Iris".
const TRAIL_SILENCE_SECONDS = 3;
const TIMEOUT_MS = 45_000;

function log(message) {
  console.log(`[check-wake-e2e] ${message}`);
}

function fail(message) {
  console.error(`[check-wake-e2e] FAIL: ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")} exited with status ${result.status}`);
}

function newestMtimeUnder(dirPath) {
  let newest = 0;
  for (const rel of readdirSync(dirPath, { recursive: true })) {
    const full = path.join(dirPath, String(rel));
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && st.mtimeMs > newest) newest = st.mtimeMs;
  }
  return newest;
}

// electron/window.mjs loads whatever dist/index.html is on disk — a script
// that launches without rebuilding would pass green against a pre-fix
// bundle, the exact silent-pass failure mode this check exists to prevent.
function ensureFreshBuild() {
  const distIndex = path.join(repoRoot, "dist", "index.html");
  const stale = !existsSync(distIndex) || statSync(distIndex).mtimeMs < newestMtimeUnder(path.join(repoRoot, "src"));
  if (!stale) {
    log("dist/index.html is fresh");
    return;
  }
  log("dist/index.html missing or older than src/ — running npm run build");
  run("npm", ["run", "build"]);
}

// Canonical 44-byte WAV header kept verbatim; silence is prepended/appended
// as zero samples and the two length fields rewritten. Neither say(1) nor
// afconvert(1) can generate silence or concatenate audio, and sox isn't on
// stock macOS (design D8).
function padWavWithSilence(srcPath, destPath, leadSeconds, trailSeconds) {
  const HEADER_BYTES = 44;
  const src = readFileSync(srcPath);
  const header = Buffer.from(src.subarray(0, HEADER_BYTES));
  const data = src.subarray(HEADER_BYTES);

  const lead = Buffer.alloc(Math.round(leadSeconds * SAMPLE_RATE) * BYTES_PER_SAMPLE);
  const trail = Buffer.alloc(Math.round(trailSeconds * SAMPLE_RATE) * BYTES_PER_SAMPLE);
  const newData = Buffer.concat([lead, data, trail]);

  header.writeUInt32LE(36 + newData.length, 4); // ChunkSize = 36 + Subchunk2Size
  header.writeUInt32LE(newData.length, 40); // Subchunk2Size
  writeFileSync(destPath, Buffer.concat([header, newData]));
}

// Deterministic output, so the fixture is generated once and cached rather
// than regenerated per run.
function ensureFixture() {
  if (existsSync(FIXTURE_WAV)) {
    log(`using cached fixture at ${path.relative(repoRoot, FIXTURE_WAV)}`);
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "iris-wake-fixture-"));
  try {
    const aiffPath = path.join(tmpDir, "hey-iris.aiff");
    const rawWavPath = path.join(tmpDir, "hey-iris-raw.wav");

    log('synthesizing "Hey Iris" with say(1)');
    run("say", ["Hey Iris", "-o", aiffPath]);

    // -d LEI16@16000 -c 1 is load-bearing: Chromium's fake capture device
    // requires 16-bit little-endian PCM, mono — do not simplify to a
    // default afconvert invocation.
    log("converting to 16-bit LE PCM mono 16kHz with afconvert(1)");
    run("afconvert", [aiffPath, rawWavPath, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]);

    log(`padding with ${LEAD_SILENCE_SECONDS}s lead / ${TRAIL_SILENCE_SECONDS}s trail silence`);
    padWavWithSilence(rawWavPath, FIXTURE_WAV, LEAD_SILENCE_SECONDS, TRAIL_SILENCE_SECONDS);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Kills the whole process tree, not just the immediate child — Electron
// forks helper/renderer processes, and a bare child.kill() would leave them
// running. `detached: true` puts the child in its own process group whose
// id equals its pid, so `-pid` targets the group.
function killTree(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

async function runCheck() {
  const isWindows = process.platform === "win32";
  const electronBin = path.join(repoRoot, "node_modules", ".bin", isWindows ? "electron.cmd" : "electron");
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "iris-wake-e2e-userdata-"));

  // IRIS_WAKE_THRESHOLD/IRIS_WAKE_CONSECUTIVE are pinned, not tidiness:
  // user-config.mjs gives CLI-passed env precedence over .env, and
  // SetupPanel writes IRIS_WAKE_THRESHOLD into .env on every settings save —
  // an unpinned check fails red for anyone on the Strict preset, for a
  // reason that has nothing to do with the thing under test (design D8).
  const env = {
    ...process.env,
    IRIS_START_PROD: "1",
    IRIS_WAKE_WORD: "true",
    IRIS_WAKE_DEBUG: "1",
    IRIS_WAKE_THRESHOLD: "0.15",
    IRIS_WAKE_CONSECUTIVE: "2",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const args = [
    ".",
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${FIXTURE_WAV}`,
    `--user-data-dir=${userDataDir}`,
  ];

  log(`launching: IRIS_START_PROD=1 IRIS_WAKE_WORD=true IRIS_WAKE_DEBUG=1 electron ${args.join(" ")}`);
  const child = spawn(electronBin, args, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
  });

  let outcome = null; // "fired" | "init-failed" | "timeout"
  let buffered = "";

  const timer = setTimeout(() => {
    if (!outcome) {
      outcome = "timeout";
      killTree(child);
    }
  }, TIMEOUT_MS);

  function handleLine(line) {
    process.stdout.write(`${line}\n`);
    if (outcome) return;
    if (line.includes("[wakeword] fired")) {
      outcome = "fired";
      clearTimeout(timer);
      killTree(child);
    } else if (line.includes("[wakeword] init failed")) {
      outcome = "init-failed";
      clearTimeout(timer);
      killTree(child);
    }
  }

  function feed(chunk) {
    buffered += chunk.toString("utf8");
    let index;
    while ((index = buffered.indexOf("\n")) !== -1) {
      handleLine(buffered.slice(0, index));
      buffered = buffered.slice(index + 1);
    }
  }

  child.stdout.on("data", feed);
  child.stderr.on("data", feed);

  await new Promise((resolve) => child.on("exit", resolve));
  clearTimeout(timer);
  rmSync(userDataDir, { recursive: true, force: true });

  if (outcome === "fired") {
    log("PASS — [wakeword] fired observed");
    return;
  }
  if (outcome === "init-failed") {
    fail("[wakeword] init failed observed — the vendored runtime path did not resolve");
  }
  fail(`timed out after ${TIMEOUT_MS}ms with neither [wakeword] fired nor [wakeword] init failed`);
}

async function main() {
  ensureFreshBuild();
  ensureFixture();
  await runCheck();
}

main().catch((error) => {
  console.error(`[check-wake-e2e] ERROR: ${error.stack || error}`);
  process.exit(1);
});
