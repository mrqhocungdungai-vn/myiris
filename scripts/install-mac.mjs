#!/usr/bin/env node
// Builds, packages, and installs this app into /Applications, then launches it.
//
// Why this exists: `package:mac` leaves an .app under `release/`, and nothing
// puts it where a macOS user expects to find and launch an application. The
// shortest honest instruction after `npm ci` was "build it, then find the .app
// and drag it somewhere" — a poor first five minutes, and a step where a user
// can silently end up running a stale copy.
//
// This script is deliberately thin. Every decision that leads to removing a
// directory in /Applications lives in electron/mac-install-target.mjs as pure
// functions with a colocated test, because vitest collects nothing from
// scripts/ and this is the most destructive tooling in the repository. What is
// left here is I/O: run the packager, read the filesystem, shell out, report.
//
// Scope: this makes an unsigned app installable on the machine that built it.
// It is not code signing, notarization, or distribution to third parties.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { userConfigFile } from "../electron/app-paths.mjs";
import {
  BUNDLE_ID,
  INSTALLED_APP_PATH,
  INSTALLED_EXECUTABLE,
  LEGACY_INSTALLED_APP_PATH,
  PRODUCT_NAME,
  classifyProbeResult,
  classifyQuitResult,
  decideInstallAction,
  quitWaitMs,
  resolveSourceBundle,
  verifyBundleArch,
} from "../electron/mac-install-target.mjs";

const TAG = "[install-mac]";
const repoRoot = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(repoRoot, "release");

function log(message) {
  console.log(`${TAG} ${message}`);
}

/** Every failure path goes through here: loud, on stderr, with a non-zero exit. */
function fail(message, hint) {
  console.error(`${TAG} ${message}`);
  if (hint) console.error(`${TAG} ${hint}`);
  process.exit(1);
}

// execFileSync with an argv array throughout — never execSync with an
// interpolated string. Paths here include /Applications and a user-controlled
// repository path, and a shell would reinterpret both.
function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: "utf8", ...options });
}

/** Runs a command for its exit status, capturing output instead of throwing. */
function tryRun(file, args) {
  return spawnSync(file, args, { encoding: "utf8" });
}

if (process.platform !== "darwin") {
  fail(`This installer is macOS-only (running on ${process.platform}).`);
}

/**
 * Inspect the destination and decide what may happen to it.
 *
 * Called twice: once before packaging so a refusal costs seconds rather than a
 * full build, and once immediately before the removal because the destination
 * can change while the build runs. The second call is the load-bearing one —
 * the first is only there to fail fast.
 */
function inspectDestination() {
  const exists = fs.existsSync(INSTALLED_APP_PATH);
  let bundleId = null;
  if (exists) {
    // plutil, not `defaults read` — the latter requires dropping the .plist
    // extension and silently reads a different file if you get it wrong.
    const read = tryRun("plutil", [
      "-extract",
      "CFBundleIdentifier",
      "raw",
      "-o",
      "-",
      path.join(INSTALLED_APP_PATH, "Contents", "Info.plist"),
    ]);
    if (read.status === 0) bundleId = read.stdout.trim();
  }
  return decideInstallAction({
    path: INSTALLED_APP_PATH,
    exists,
    isDirectory: exists && fs.statSync(INSTALLED_APP_PATH).isDirectory(),
    bundleId,
  });
}

const REFUSAL_HINT =
  `Nothing was removed. Move or rename that item yourself if you want ${PRODUCT_NAME} installed here.`;

const preflight = inspectDestination();
if (preflight.action === "refuse") fail(preflight.reason, REFUSAL_HINT);

// ---------------------------------------------------------------------------
// 1. Build and package for THIS machine's architecture.
// ---------------------------------------------------------------------------
// package:mac:host builds the host arch only, which is what `npm ci` installed
// a Claude binary for. Building both here would need the ~250 MB foreign
// binary fetched for a bundle this machine cannot run.
log(`packaging ${PRODUCT_NAME} for ${process.arch}…`);
try {
  run("npm", ["run", "package:mac:host"], { cwd: repoRoot, stdio: "inherit" });
} catch {
  fail("Packaging failed — not installing.", "Fix the build above and re-run `npm run install:mac`.");
}

// ---------------------------------------------------------------------------
// 2. Resolve the source bundle by architecture, and confirm it can run here.
// ---------------------------------------------------------------------------
const source = resolveSourceBundle({
  releaseRoot,
  arch: process.arch,
  exists: (p) => fs.existsSync(p),
});
if (!source.ok) fail(source.reason);
log(`source bundle: ${path.relative(repoRoot, source.path)}`);

// The directory name is a claim about the architecture; the Mach-O header is
// the fact. A stale or interrupted build can leave them disagreeing.
const executable = path.join(source.path, "Contents", "MacOS", PRODUCT_NAME);
if (!fs.existsSync(executable)) {
  fail(`The packaged bundle has no executable at ${executable}.`);
}
let lipoOutput;
try {
  lipoOutput = run("lipo", ["-archs", executable]);
} catch (error) {
  fail(`Could not read the bundle's architecture: ${error.message}`);
}
const archCheck = verifyBundleArch({ arch: process.arch, lipoOutput });
if (!archCheck.ok) fail(archCheck.reason);
log(`architecture verified: ${archCheck.archs.join(", ")}`);

// ---------------------------------------------------------------------------
// 3. Quit a running installed instance — never kill it.
// ---------------------------------------------------------------------------
// The probe is scoped to the INSTALLED executable path. There is no
// single-instance lock in this app, so `npm run dev` and the installed copy can
// run at once, and an unscoped match would quit the developer's dev session.
function probeRunning() {
  const probe = tryRun("pgrep", ["-f", INSTALLED_EXECUTABLE]);
  const classified = classifyProbeResult(probe);
  if (classified.outcome === "unknown") {
    // Fail closed. Proceeding here would delete the bundle without knowing
    // whether a live process is using it.
    fail(
      `Aborting: ${classified.reason}.`,
      `Nothing was installed. Quit ${PRODUCT_NAME} yourself and re-run, or check that \`pgrep\` is available.`,
    );
  }
  return classified.outcome === "running";
}

const wasRunning = probeRunning();

if (wasRunning) {
  log(`an installed ${PRODUCT_NAME} is running — asking it to quit…`);
  // osascript, never kill. The Apple Event reaches app.quit() and runs the real
  // teardown; SIGTERM/SIGKILL skip `before-quit`, which orphans Claude and its
  // descendant tool subprocesses (the process-group termination in the
  // app-shutdown capability exists to prevent exactly that) and drops the
  // canvas store's debounced write window.
  const quit = tryRun("osascript", ["-e", `tell application "${PRODUCT_NAME}" to quit`]);
  const classified = classifyQuitResult({ wasRunning, status: quit.status ?? 1, stderr: quit.stderr });

  if (classified.outcome === "refused") {
    fail(classified.reason, "Nothing was installed — the running copy was left untouched.");
  }

  const deadline = Date.now() + quitWaitMs(process.env);
  let stillRunning = true;
  while (Date.now() < deadline) {
    if (!probeRunning()) {
      stillRunning = false;
      break;
    }
    // Busy-wait in short slices: a synchronous script has no event loop to
    // await on, and `sleep` keeps this to a handful of process spawns.
    tryRun("sleep", ["0.25"]);
  }

  if (stillRunning) {
    // Abort rather than escalate. A copy over a live teardown is a
    // half-replaced bundle, which is worse than not installing at all.
    fail(
      `${PRODUCT_NAME} did not quit within its shutdown budget — aborting instead of copying over a running app.`,
      `Quit ${PRODUCT_NAME} yourself and re-run, or raise IRIS_SHUTDOWN_DEADLINE_MS if teardown genuinely needs longer.`,
    );
  }
  log("the running instance has quit");
}

// ---------------------------------------------------------------------------
// 4. Verify what is being replaced, then replace it.
// ---------------------------------------------------------------------------
// Re-inspected rather than reusing the preflight result: the build takes
// minutes, and the destination may have changed during it.
const decision = inspectDestination();
if (decision.action === "refuse") fail(decision.reason, REFUSAL_HINT);

if (decision.action === "replace") {
  log(`replacing the existing ${BUNDLE_ID} bundle at ${INSTALLED_APP_PATH}`);
  try {
    fs.rmSync(INSTALLED_APP_PATH, { recursive: true, force: true });
  } catch (error) {
    fail(`Could not remove the existing bundle: ${error.message}`, "Check permissions on /Applications.");
  }
} else {
  log(`installing to ${INSTALLED_APP_PATH}`);
}

// ditto, not cp -R: an .app is a symlink farm (Contents/Frameworks especially),
// and ditto preserves the links, permissions, and extended attributes that make
// the bundle loadable.
try {
  run("ditto", [source.path, INSTALLED_APP_PATH], { stdio: "inherit" });
} catch (error) {
  fail(
    `The copy failed: ${error.message}`,
    `${INSTALLED_APP_PATH} may now be incomplete — re-run \`npm run install:mac\` before launching it.`,
  );
}

// -dr, never -cr. `xattr -cr` strips ALL extended attributes, which would
// destroy the com.apple.cs.* signature attributes on any bundle that is ever
// signed. This is defensive rather than load-bearing: a locally built bundle
// carries no com.apple.quarantine in the first place — that attribute is
// written by whatever DOWNLOADS a file — and Gatekeeper's assessment is
// quarantine-triggered, which is why an unsigned local build launches at all.
tryRun("xattr", ["-dr", "com.apple.quarantine", INSTALLED_APP_PATH]);

// ---------------------------------------------------------------------------
// 5. Keep the build output from showing up as a second copy of the app.
// ---------------------------------------------------------------------------
// release/ is kept, not deleted: it is the build product, and removing it would
// make "install the last build" impossible. Excluded from Spotlight instead, so
// exactly one copy appears in Finder and Spotlight search.
try {
  fs.writeFileSync(path.join(releaseRoot, ".metadata_never_index"), "");
} catch {
  log(`WARNING: could not mark release/ as unindexed — a second ${PRODUCT_NAME} may appear in Spotlight.`);
}

// ---------------------------------------------------------------------------
// 6. Launch.
// ---------------------------------------------------------------------------
// ELECTRON_RUN_AS_NODE is deleted for the same reason scripts/run-electron.mjs
// deletes it: a shell that exports it starts the app headless, with no window and
// no obvious cause.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

log(`installed. Launching ${INSTALLED_APP_PATH}…`);
try {
  run("open", ["-a", INSTALLED_APP_PATH], { env });
} catch (error) {
  fail(`Installed, but could not launch it: ${error.message}`, `Open ${INSTALLED_APP_PATH} from Finder.`);
}

log("done.");
log(`The installed app reads ${userConfigFile()} — NOT this repository's .env.`);
log("If it reports a missing GEMINI_API_KEY, put your key there and relaunch.");

// ---------------------------------------------------------------------------
// 7. Name the one thing this installer deliberately will not clean up.
// ---------------------------------------------------------------------------
// A bundle installed before this app was given an identity of its own carries
// upstream's identifier, which makes it indistinguishable from an actual upstream
// install — so decideInstallAction() refuses it, correctly, even when it happens to
// be the user's own stale build. Refusing silently would leave two apps in
// /Applications with no explanation of why, so the refusal is stated here instead.
//
// Not offered as an automated step on purpose: the whole reason this change exists
// is that the installer used to delete a bundle carrying that identifier.
if (fs.existsSync(LEGACY_INSTALLED_APP_PATH)) {
  log("");
  log(`NOTE: ${LEGACY_INSTALLED_APP_PATH} is still installed and was deliberately left alone.`);
  log(
    "  It carries the bundle identifier this app used before it was renamed, which is also the " +
      "upstream project's — so this installer cannot tell your old build apart from an upstream install, " +
      "and refuses to remove either.",
  );
  log(`  If it is your own old build: quit it, then delete ${LEGACY_INSTALLED_APP_PATH} by hand.`);
  log("  If you actually use the upstream app, leave it — both now install side by side.");
}
