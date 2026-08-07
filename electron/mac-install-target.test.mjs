import { describe, it, expect } from "vitest";
import {
  BUNDLE_ID,
  DEFAULT_SHUTDOWN_DEADLINE_MS,
  INSTALLED_APP_PATH,
  INSTALLED_EXECUTABLE,
  LEGACY_INSTALLED_APP_PATH,
  PRODUCT_NAME,
  QUIT_GRACE_MS,
  classifyProbeResult,
  classifyQuitResult,
  decideInstallAction,
  quitWaitMs,
  releaseSubdirForArch,
  resolveSourceBundle,
  verifyBundleArch,
} from "./mac-install-target.mjs";
import { shutdownDeadlineMs } from "./user-config.mjs";

// These functions return discriminated unions, and `expect()` does not narrow
// one — so the typecheck gate rejects a bare `result.reason`. Each failing-case
// assertion narrows first, which also makes the test fail on the wrong branch
// rather than on an undefined property.
//
// The `ok` unions narrow with `in` rather than `if (result.ok)`: this project
// runs with `strict: false`, so `strictNullChecks` is off and a boolean
// discriminant does not narrow a union. The string-discriminated `action` union
// narrows normally.

describe("resolveSourceBundle", () => {
  const exists = (present) => (p) => present.includes(p);
  // Built from PRODUCT_NAME rather than spelled out: the paths under test are
  // derived from it, so a hard-coded bundle name here tests the literal in this
  // file instead of the resolution logic, and turns red on a rename for no reason.
  const bundle = (subdir) => `/r/${subdir}/${PRODUCT_NAME}.app`;

  it("picks the bundle matching the host architecture, not the first one present", () => {
    // Both builds on disk: the x64 machine must get release/mac, never
    // release/mac-arm64, which a first-match scan would hand it.
    const present = [bundle("mac"), bundle("mac-arm64")];
    expect(resolveSourceBundle({ releaseRoot: "/r", arch: "x64", exists: exists(present) })).toEqual({
      ok: true,
      path: bundle("mac"),
      subdir: "mac",
    });
    expect(resolveSourceBundle({ releaseRoot: "/r", arch: "arm64", exists: exists(present) })).toEqual({
      ok: true,
      path: bundle("mac-arm64"),
      subdir: "mac-arm64",
    });
  });

  it("refuses when only the foreign-arch build exists", () => {
    const result = resolveSourceBundle({
      releaseRoot: "/r",
      arch: "x64",
      exists: exists([bundle("mac-arm64")]),
    });
    if (!("reason" in result)) throw new Error("expected a refusal, got a resolved bundle");
    expect(result.reason).toContain(bundle("mac"));
  });

  it("refuses an architecture it has no mapping for", () => {
    const result = resolveSourceBundle({ releaseRoot: "/r", arch: "ia32", exists: () => true });
    if (!("reason" in result)) throw new Error("expected a refusal, got a resolved bundle");
    expect(result.reason).toContain("ia32");
  });

  it("maps only the two architectures the build config produces", () => {
    expect(releaseSubdirForArch("x64")).toBe("mac");
    expect(releaseSubdirForArch("arm64")).toBe("mac-arm64");
    expect(releaseSubdirForArch("armv7l")).toBeNull();
  });
});

describe("verifyBundleArch", () => {
  it("accepts a Mach-O arch that maps onto the host arch", () => {
    expect(verifyBundleArch({ arch: "x64", lipoOutput: "x86_64\n" })).toEqual({ ok: true, archs: ["x64"] });
    expect(verifyBundleArch({ arch: "arm64", lipoOutput: "arm64 " })).toEqual({ ok: true, archs: ["arm64"] });
  });

  it("accepts a fat binary that includes the host arch", () => {
    const result = verifyBundleArch({ arch: "x64", lipoOutput: "x86_64 arm64" });
    expect(result.ok).toBe(true);
  });

  it("refuses a bundle whose executable cannot run here", () => {
    const result = verifyBundleArch({ arch: "x64", lipoOutput: "arm64" });
    if (!("reason" in result)) throw new Error("expected a refusal, got an accepted bundle");
    expect(result.reason).toContain("cannot run on this x64 machine");
  });

  it("refuses when lipo produced nothing readable", () => {
    expect(verifyBundleArch({ arch: "x64", lipoOutput: "" }).ok).toBe(false);
    expect(verifyBundleArch({ arch: "x64", lipoOutput: null }).ok).toBe(false);
  });
});

describe("decideInstallAction — the guard in front of the destructive step", () => {
  it("installs fresh when nothing is there", () => {
    expect(decideInstallAction({ path: INSTALLED_APP_PATH, exists: false })).toEqual({ action: "install" });
  });

  it("replaces the app's own bundle", () => {
    expect(
      decideInstallAction({ path: INSTALLED_APP_PATH, exists: true, isDirectory: true, bundleId: BUNDLE_ID }),
    ).toEqual({ action: "replace" });
  });

  it("refuses a bundle belonging to another application", () => {
    const result = decideInstallAction({
      path: INSTALLED_APP_PATH,
      exists: true,
      isDirectory: true,
      bundleId: "com.apple.Safari",
    });
    if (result.action !== "refuse") throw new Error(`expected a refusal, got ${result.action}`);
    expect(result.reason).toContain("com.apple.Safari");
  });

  it("refuses when the identifier could not be read at all", () => {
    for (const bundleId of [null, undefined, ""]) {
      const result = decideInstallAction({ path: INSTALLED_APP_PATH, exists: true, isDirectory: true, bundleId });
      if (result.action !== "refuse") throw new Error(`expected a refusal, got ${result.action}`);
      expect(result.reason).toContain("could not be read");
    }
  });

  it("refuses a non-directory sitting at the path", () => {
    const result = decideInstallAction({
      path: INSTALLED_APP_PATH,
      exists: true,
      isDirectory: false,
      bundleId: BUNDLE_ID,
    });
    if (result.action !== "refuse") throw new Error(`expected a refusal, got ${result.action}`);
    expect(result.reason).toContain("not a directory");
  });

  it("refuses any path other than the hard-coded destination", () => {
    const result = decideInstallAction({
      path: "/Applications/NotIris.app",
      exists: true,
      isDirectory: true,
      bundleId: BUNDLE_ID,
    });
    if (result.action !== "refuse") throw new Error(`expected a refusal, got ${result.action}`);
    expect(result.reason).toContain(INSTALLED_APP_PATH);
  });

  it("scopes the running-instance probe to the installed executable", () => {
    // A dev run launches from node_modules/.bin/electron, so an unscoped probe
    // would match it and the installer would quit the developer's session.
    expect(INSTALLED_EXECUTABLE.startsWith(INSTALLED_APP_PATH)).toBe(true);
    // Deliberately a literal, not built from PRODUCT_NAME. This assertion's whole
    // job is to pin the concrete path `pgrep` is scoped to and `rm -rf` is aimed
    // at; derived from the same constant the code uses, it would pass no matter
    // what that constant said, which is the one thing it must not do.
    expect(INSTALLED_EXECUTABLE).toBe("/Applications/MyIris.app/Contents/MacOS/MyIris");
  });

  // The branch this whole capability exists for. While the fork and upstream
  // declared the same identifier, this case was unreachable: the guard read
  // upstream's Iris.app as "our own bundle, safe to replace" and the installer
  // deleted it without a warning. Now that BUNDLE_ID differs, it is a live branch,
  // and this is the test that proves it refuses.
  it("refuses an upstream bundle sitting at the install path", () => {
    const result = decideInstallAction({
      path: INSTALLED_APP_PATH,
      exists: true,
      isDirectory: true,
      bundleId: "app.iris.voice",
    });
    if (result.action !== "refuse") throw new Error(`expected a refusal, got ${result.action}`);
    expect(result.reason).toContain("app.iris.voice");
    expect(result.reason).toContain(BUNDLE_ID);
  });

  it("does not carry upstream's identifier itself", () => {
    // The precondition the refusal above depends on. If these ever converge again,
    // that test starts asserting that the app refuses its OWN bundle, and passes
    // while meaning the opposite of what it says.
    expect(BUNDLE_ID).not.toBe("app.iris.voice");
    expect(INSTALLED_APP_PATH).not.toBe("/Applications/Iris.app");
  });

  it("keeps the pre-rename install path distinct from the current one", () => {
    // The installer reports this path so the user knows why a second app is sitting
    // in /Applications. If it ever equalled INSTALLED_APP_PATH, that note would fire
    // on every successful install and tell the user to delete what was just built.
    expect(LEGACY_INSTALLED_APP_PATH).toBe("/Applications/Iris.app");
    expect(LEGACY_INSTALLED_APP_PATH).not.toBe(INSTALLED_APP_PATH);
  });
});

describe("quitWaitMs", () => {
  it("adds a delivery margin to the app's own shutdown budget", () => {
    expect(quitWaitMs({})).toBe(DEFAULT_SHUTDOWN_DEADLINE_MS + QUIT_GRACE_MS);
    expect(quitWaitMs({ IRIS_SHUTDOWN_DEADLINE_MS: "20000" })).toBe(20000 + QUIT_GRACE_MS);
  });

  it("falls back to the default on a value the app would also reject", () => {
    for (const raw of ["nope", "-1"]) {
      expect(quitWaitMs({ IRIS_SHUTDOWN_DEADLINE_MS: raw })).toBe(DEFAULT_SHUTDOWN_DEADLINE_MS + QUIT_GRACE_MS);
    }
  });

  it("treats an empty value as zero, exactly as the app does", () => {
    // Number("") is 0, which passes the app's own `>= 0` check — so an empty
    // IRIS_SHUTDOWN_DEADLINE_MS means "no teardown budget" rather than "use the
    // default". Asserted rather than corrected: the installer's job is to match
    // the app's wait, including where that reading is surprising.
    expect(quitWaitMs({ IRIS_SHUTDOWN_DEADLINE_MS: "" })).toBe(QUIT_GRACE_MS);
  });

  it("reads the same budget the app itself uses", () => {
    // The installer deliberately does not import user-config.mjs (it would drag
    // @google/genai into a build script), so the two readers are separate code.
    // This is the guard that keeps them from drifting: a change to the app's
    // default or parsing rule that is not mirrored here fails right now.
    const original = process.env.IRIS_SHUTDOWN_DEADLINE_MS;
    try {
      for (const raw of [undefined, "20000", "0", "", "nope", "-1"]) {
        if (raw === undefined) delete process.env.IRIS_SHUTDOWN_DEADLINE_MS;
        else process.env.IRIS_SHUTDOWN_DEADLINE_MS = raw;
        expect(quitWaitMs(process.env) - QUIT_GRACE_MS).toBe(shutdownDeadlineMs());
      }
    } finally {
      if (original === undefined) delete process.env.IRIS_SHUTDOWN_DEADLINE_MS;
      else process.env.IRIS_SHUTDOWN_DEADLINE_MS = original;
    }
  });
});

describe("classifyProbeResult — the probe fails closed", () => {
  it("reads pgrep's two normal exits", () => {
    expect(classifyProbeResult({ status: 0, stdout: "7442\n" })).toEqual({ outcome: "running" });
    expect(classifyProbeResult({ status: 1, stdout: "" })).toEqual({ outcome: "not-running" });
  });

  it("does NOT report 'not running' when the probe could not be run", () => {
    // The defect this guards: a spawn failure previously produced status null,
    // which read as "nothing is running" — and the installer went on to delete
    // the bundle out from under a live process, skipping its teardown.
    const spawnFailed = classifyProbeResult({ status: null, error: new Error("spawn pgrep ENOENT") });
    expect(spawnFailed.outcome).toBe("unknown");
    expect(spawnFailed.reason).toContain("ENOENT");
  });

  it("treats any other exit status as unanswered rather than absent", () => {
    expect(classifyProbeResult({ status: 2, stdout: "" }).outcome).toBe("unknown");
    expect(classifyProbeResult({ status: null, stdout: "" }).outcome).toBe("unknown");
  });

  it("treats a match with no named process as unanswered", () => {
    expect(classifyProbeResult({ status: 0, stdout: "  \n" }).outcome).toBe("unknown");
  });
});

describe("classifyQuitResult", () => {
  it("tells 'nothing was running' apart from 'the request was refused'", () => {
    expect(classifyQuitResult({ wasRunning: false, status: 1 })).toEqual({ outcome: "not-running" });
    expect(classifyQuitResult({ wasRunning: true, status: 0 })).toEqual({ outcome: "quit-requested" });
  });

  it("names the Automation permission failure, which is otherwise invisible", () => {
    const result = classifyQuitResult({
      wasRunning: true,
      status: 1,
      stderr: `execution error: Not authorized to send Apple events to ${PRODUCT_NAME}. (-1743)`,
    });
    expect(result.outcome).toBe("refused");
    expect(result.reason).toContain("Automation");
    // The message has to name the app the user must grant Automation access TO,
    // because they are looking for one specific row in System Settings and a stale
    // name points them at a different application's row.
    expect(result.reason).toContain(PRODUCT_NAME);
  });

  it("reports any other refusal with its detail rather than swallowing it", () => {
    const result = classifyQuitResult({ wasRunning: true, status: 2, stderr: "some other failure" });
    expect(result.outcome).toBe("refused");
    expect(result.reason).toContain("some other failure");
  });
});
