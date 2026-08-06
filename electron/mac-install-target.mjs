// Target resolution and safety checks for `npm run install:mac`.
//
// This lives in electron/ rather than scripts/ for one reason: vitest collects
// only `electron/**/*.test.mjs` and `src/**/*.test.ts`, so anything left in
// scripts/ gets zero automated coverage — and the installer is the most
// destructive tooling in this repository. It removes and replaces a directory
// in /Applications. Every decision that leads up to that removal is made here,
// as pure functions over injected inputs, and scripts/install-mac.mjs is left
// as thin I/O around them.
//
// Electron-free and dependency-free, like every module under electron/ that is
// not one of the four permitted to import Electron.

/** The bundle this installer is allowed to touch, and nothing else. */
export const PRODUCT_NAME = "Iris";
export const BUNDLE_ID = "app.iris.voice";

// Deliberately a hard-coded constant, NOT an argument or an environment
// variable. An override cannot satisfy the "is this Iris at the expected path"
// check by definition — the check IS that the path is this one — so there is no
// safe form of a configurable destination for a step that ends in `rm -rf`.
export const INSTALL_DIR = "/Applications";
export const INSTALLED_APP_PATH = `${INSTALL_DIR}/${PRODUCT_NAME}.app`;

/** The executable inside the installed bundle — used to scope the running-instance probe. */
export const INSTALLED_EXECUTABLE = `${INSTALLED_APP_PATH}/Contents/MacOS/${PRODUCT_NAME}`;

// electron-builder's output directory naming for the `dir` target: the host
// arch on an Intel build lands in `mac/`, every other arch gets an `-<arch>`
// suffix. Kept as an explicit map rather than a template so an unknown arch
// fails loudly instead of resolving to a plausible-looking path that does not
// exist.
const RELEASE_SUBDIR_BY_ARCH = Object.freeze({
  x64: "mac",
  arm64: "mac-arm64",
});

/**
 * Which `release/` subdirectory holds the build for a given Node `process.arch`.
 *
 * @param {string} arch
 * @returns {string | null} the subdirectory name, or null if this installer has
 *   no mapping for that architecture
 */
export function releaseSubdirForArch(arch) {
  return RELEASE_SUBDIR_BY_ARCH[arch] ?? null;
}

/**
 * Pick the source bundle by ARCHITECTURE, never by first match.
 *
 * All three packaging scripts can emit both `release/mac/Iris.app` (x64) and
 * `release/mac-arm64/Iris.app` (arm64). A scan that takes whichever it finds
 * first will happily install the arm64 build on an Intel Mac, where it cannot
 * execute at all — and the symptom is a bundle that silently refuses to launch,
 * not an error naming the cause.
 *
 * @param {{ releaseRoot: string, arch: string, exists: (p: string) => boolean }} deps
 * @returns {{ ok: true, path: string, subdir: string } | { ok: false, reason: string }}
 */
export function resolveSourceBundle({ releaseRoot, arch, exists }) {
  const subdir = releaseSubdirForArch(arch);
  if (!subdir) {
    return {
      ok: false,
      reason:
        `No packaged output is defined for architecture "${arch}". ` +
        `This installer knows ${Object.keys(RELEASE_SUBDIR_BY_ARCH).join(" and ")} only.`,
    };
  }

  const path = `${releaseRoot}/${subdir}/${PRODUCT_NAME}.app`;
  if (!exists(path)) {
    return {
      ok: false,
      reason: `No ${arch} build at ${path} — packaging did not produce a bundle for this machine's architecture.`,
    };
  }
  return { ok: true, path, subdir };
}

// `lipo -archs` reports Mach-O architecture names, which are not Node's
// `process.arch` names: x86_64 vs x64. Mapping in this direction (Mach-O ->
// Node) keeps the comparison in the caller's vocabulary.
const NODE_ARCH_BY_MACHO = Object.freeze({
  x86_64: "x64",
  arm64: "arm64",
  arm64e: "arm64",
});

/**
 * Confirm the bundle's own executable can actually run on this machine.
 *
 * Directory naming is a claim; the Mach-O header is the fact. They diverge when
 * a build is interrupted, when a stale bundle survives in an output directory,
 * or when `prune-foreign-arch` leaves a half-built tree behind.
 *
 * A fat binary that INCLUDES the host arch is fine — that is what a universal
 * build is, and it runs here.
 *
 * @param {{ arch: string, lipoOutput: string }} input
 * @returns {{ ok: true, archs: string[] } | { ok: false, reason: string }}
 */
export function verifyBundleArch({ arch, lipoOutput }) {
  const machoArchs = String(lipoOutput ?? "").trim().split(/\s+/).filter(Boolean);
  const nodeArchs = machoArchs.map((name) => NODE_ARCH_BY_MACHO[name] ?? name);

  if (nodeArchs.length === 0) {
    return { ok: false, reason: "Could not read any architecture from the bundle's executable." };
  }
  if (!nodeArchs.includes(arch)) {
    return {
      ok: false,
      reason:
        `The packaged executable is ${machoArchs.join("/")}, which cannot run on this ${arch} machine. ` +
        "Refusing to install a bundle that will not launch.",
    };
  }
  return { ok: true, archs: nodeArchs };
}

/**
 * Decide whether the destination may be removed — the gate in front of the one
 * genuinely destructive step.
 *
 * Refusing is always safe; removing the wrong directory is not. So every branch
 * that cannot positively identify Iris's own bundle refuses, including the ones
 * that "should not happen": a non-directory at the path, a missing or
 * unreadable Info.plist, a bundle identifier belonging to some other
 * application. The caller passes the identifier it read; a null means it could
 * not be read at all, which is treated as unidentified rather than as absent.
 *
 * @param {{
 *   path: string,
 *   exists: boolean,
 *   isDirectory?: boolean,
 *   bundleId?: string | null,
 * }} target
 * @returns {{ action: "install" } | { action: "replace" } | { action: "refuse", reason: string }}
 */
export function decideInstallAction({ path, exists, isDirectory, bundleId }) {
  if (path !== INSTALLED_APP_PATH) {
    // Unreachable through the shipped script, which passes the constant. Kept
    // because it is the invariant the whole guard rests on, and an invariant
    // that is only true by inspection is one refactor away from being false.
    return {
      action: "refuse",
      reason: `Refusing to touch ${path}: this installer only ever writes ${INSTALLED_APP_PATH}.`,
    };
  }

  if (!exists) return { action: "install" };

  if (!isDirectory) {
    return {
      action: "refuse",
      reason: `${path} exists but is not a directory. An .app bundle is a directory — refusing to remove it.`,
    };
  }

  if (!bundleId) {
    return {
      action: "refuse",
      reason:
        `${path} exists but its CFBundleIdentifier could not be read. ` +
        "Refusing to remove a bundle that cannot be identified.",
    };
  }

  if (bundleId !== BUNDLE_ID) {
    return {
      action: "refuse",
      reason:
        `${path} belongs to "${bundleId}", not "${BUNDLE_ID}". ` +
        "That is a different application — refusing to remove it.",
    };
  }

  return { action: "replace" };
}

// The app's own teardown budget, read from the same variable and with the same
// default as electron/user-config.mjs's shutdownDeadlineMs(). Duplicated rather
// than imported because that module pulls in @google/genai and the session
// store, which an install script has no business loading — the parity is held
// by a test instead of by a shared import.
export const DEFAULT_SHUTDOWN_DEADLINE_MS = 8000;

// Time for the Apple Event to be delivered and the process to actually leave
// the process table on top of the app's own teardown budget. Without a margin a
// correctly-behaving quit that uses its full budget reads as a timeout.
export const QUIT_GRACE_MS = 2000;

/**
 * How long to wait for a running Iris to quit.
 *
 * Read from the environment rather than hardcoded: a user who raised
 * IRIS_SHUTDOWN_DEADLINE_MS did so because their teardown needs longer, and an
 * installer that copies over a live teardown is exactly the corruption this
 * whole path exists to avoid.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function quitWaitMs(env = {}) {
  const parsed = Number(env.IRIS_SHUTDOWN_DEADLINE_MS);
  const deadline = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHUTDOWN_DEADLINE_MS;
  return deadline + QUIT_GRACE_MS;
}

/**
 * Classify the `pgrep` probe for a running installed Iris.
 *
 * The important case is the third one. `pgrep` exits 0 with matches and 1 with
 * none, so ANY other outcome — a spawn failure, an exit status of 2 — means the
 * probe did not answer the question. Treating that as "nothing is running"
 * fails OPEN on the one step that deletes a directory, and the failure is
 * silent: the installer would go on to remove the bundle out from under a live
 * process, skipping the teardown the Apple Event exists to run.
 *
 * So an unanswered probe is its own outcome, and the caller aborts on it. Same
 * rule the secret-scanning gate already follows: a check that cannot run is a
 * failure, not a pass.
 *
 * @param {{ status: number | null, stdout?: string, error?: Error | null }} probe
 * @returns {{ outcome: "running" | "not-running" | "unknown", reason?: string }}
 */
export function classifyProbeResult({ status, stdout, error }) {
  if (error) {
    return { outcome: "unknown", reason: `the running-instance check could not be run: ${error.message}` };
  }
  if (status === 0) {
    return String(stdout ?? "").trim().length > 0
      ? { outcome: "running" }
      : // pgrep does not exit 0 with empty output; if it somehow does, the
        // probe has not answered the question either.
        { outcome: "unknown", reason: "the running-instance check reported a match but named no process" };
  }
  if (status === 1) return { outcome: "not-running" };
  return { outcome: "unknown", reason: `the running-instance check exited ${status}` };
}

/**
 * Classify the outcome of the `osascript … to quit` request.
 *
 * "Nothing was running" and "the request was refused" both leave the app
 * running, and telling them apart is the whole point: osascript needs Automation
 * permission, and when that is denied it fails with an error the user has never
 * been shown a prompt for. Without this distinction the only symptom is the wait
 * timing out, which reads as a hung app rather than a permissions dialog nobody
 * answered.
 *
 * @param {{ wasRunning: boolean, status: number, stderr?: string }} result
 * @returns {{ outcome: "not-running" | "quit-requested" | "refused", reason?: string }}
 */
export function classifyQuitResult({ wasRunning, status, stderr }) {
  if (!wasRunning) return { outcome: "not-running" };
  if (status === 0) return { outcome: "quit-requested" };

  const detail = String(stderr ?? "").trim();
  // -1743 is errAEEventNotPermitted: the user has not granted this terminal
  // Automation access to Iris. Naming it turns an opaque failure into an
  // instruction, because the fix is a settings pane the user has to visit.
  const isPermission = detail.includes("-1743") || /not (been )?(allowed|permitted)/i.test(detail);
  return {
    outcome: "refused",
    reason: isPermission
      ? "macOS refused the quit request: this terminal does not have Automation permission for Iris. " +
        "Grant it in System Settings → Privacy & Security → Automation, or quit Iris yourself and re-run."
      : `The quit request failed${detail ? `: ${detail}` : "."}`,
  };
}
