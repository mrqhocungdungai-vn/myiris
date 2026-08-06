# Design

Recorded decisions. Two of these (D1, D5) are tasks that explicitly ask for a
decision to be *recorded* rather than implemented, so this file is where they
land rather than being lost in a commit message.

## D1 — `package:mac:host` is fixed by dropping `arch` from the config, not by passing a flag

`mac.target` declared `arch: ["x64","arm64"]`. electron-builder lets the CLI
override the config's arch list, but when the CLI is **silent** the config wins —
so `electron-builder --mac` built both architectures, and `package:mac:host`
had never once done what its name says.

Two ways to fix it:

- pass an explicit host-arch flag from the npm script, or
- drop `arch` from `mac.target` so the CLI default (the host) applies.

Dropping it wins. An npm script cannot name the host architecture without a
shell detour, and the two scripts that genuinely want both arches
(`package:mac`, `dist:mac`) already pass `--x64 --arm64` explicitly. So the
config declaring nothing leaves every script saying exactly what it builds, at
its own call site, with no second place to keep in sync.

This also fixes a real failure rather than a mislabelling: on a clean checkout
`npm ci` installs only the host-matching Claude native binary, so the old
`:host` path packed an arm64 bundle without one and `prune-foreign-arch.mjs`
correctly refused. It only appeared to work on a machine where an earlier
`package:mac` had left both binaries behind.

## D2 — Destination is a constant, and the guard is a pure function with a test

The destination is hard-coded (`/Applications/Iris.app`) and accepted from
neither an argument nor an environment variable. An override cannot satisfy the
"is this Iris at the expected path" check by definition — the check *is* that
the path is the expected one — so there is no safe configurable form of it.

Everything leading to `rm -rf` lives in `electron/mac-install-target.mjs` as
pure, dependency-injected functions, with `scripts/install-mac.mjs` reduced to
I/O around them. The reason is mechanical: `vitest` collects only
`electron/**/*.test.mjs` and `src/**/*.test.ts`, so logic left under `scripts/`
gets **zero** automated coverage — an unacceptable place for the most
destructive tooling in the repository.

The guard refuses unless the target is a directory, at the expected path, whose
`CFBundleIdentifier` reads `app.iris.voice`. An unreadable identifier is treated
as *unidentified*, not as absent: refusing is always safe, removing the wrong
directory is not.

## D3 — Quit by Apple Event, and abort rather than escalate

A running instance is asked to quit with `osascript`, which reaches `app.quit()`
and runs the real teardown. There is deliberately **no `kill` fallback**:
`SIGTERM`/`SIGKILL` skip `before-quit`, which orphans Claude and its descendant
tool subprocesses — the process-group termination in the `app-shutdown`
capability exists precisely to prevent that — and drops the canvas store's
debounced write window.

If the app does not quit within its budget, the install **aborts**. A copy over
a live teardown produces a half-replaced bundle, which is worse than not
installing.

The wait is `IRIS_SHUTDOWN_DEADLINE_MS` (the app's own variable, default 8000 ms)
plus a 2000 ms delivery margin. The installer does not import
`user-config.mjs` — that module pulls in `@google/genai` and the session store,
which a build script has no business loading — so the parity between the two
readers is held by a test that asserts they agree, including on the surprising
case where an empty value means zero rather than the default.

The running-instance probe is scoped to
`/Applications/Iris.app/Contents/MacOS/Iris`. There is no single-instance lock
in this app, so a `npm run dev` session and the installed copy can run at once,
and an unscoped probe would quit the developer's session.

## D4 — Architecture is verified from the Mach-O header, not the directory name

The source bundle is selected by architecture (`release/mac` for x64,
`release/mac-arm64` for arm64), never by first match — a first-match scan
installs an arm64 build on an Intel Mac, where it cannot execute, and the
symptom is a bundle that silently refuses to launch rather than an error naming
the cause.

The directory name is then treated as a *claim* and checked against `lipo
-archs` on the bundle's own executable, because a stale or interrupted build can
leave the two disagreeing. A fat binary that includes the host arch passes.

## D5 — `release/` is kept and excluded from Spotlight, not deleted

Upstream's follow-up fix (`7eba14b`) removed a packaging staging directory
because duplicate Iris entries were showing up in Finder. The same symptom
applies here, but the cause is different: `release/mac*/Iris.app` are the build
**products**, not a staging directory.

Deleting them after install would make any standalone "install the last build"
mode impossible and would throw away the artifact the user just spent minutes
building. So they stay, and `release/.metadata_never_index` is written instead —
Spotlight skips the directory, exactly one Iris appears in search, and the build
output remains inspectable. `release/` is already gitignored.

## D6 — `dist:mac` keeps existing as a duplicate of `package:mac`

Task 1.4 asks for a decision, not an implementation. The two scripts are
character-for-character identical, and with `mac.target` set to `dir` neither
produces a dmg or a zip, so "full macOS distributable" was simply wrong.

`dist:mac` is **kept as-is**, with CLAUDE.md and README corrected to say it is a
duplicate. Giving it a real dmg/zip target now would ship a distributable
artifact for an app that is unsigned and un-notarized — a download that
Gatekeeper blocks and that this change explicitly does not put in scope.
The name is worth reserving for the moment signing is added; until then, an
honest duplicate beats a misleading capability.

## D7 — The running-instance probe fails closed

Added after implementation, from a real observation during manual verification.

`pgrep` exits 0 with matches and 1 with none. The first implementation read
"status is not 0" as *not running* — which meant a **spawn failure or any other
exit status was silently treated as "nothing is running"**, and the installer
went straight on to delete the bundle. That is fail-open on the one genuinely
destructive step, and it is invisible when it happens.

An unanswered probe is now its own outcome (`classifyProbeResult` →
`"unknown"`), and the installer aborts on it. Same rule the secret-scanning gate
already follows: a check that cannot run is a failure, not a pass. The same
classifier is used for the post-quit poll, so a probe that stops answering
mid-wait aborts rather than reading as a successful quit.

## Verification status

Verified on **Intel x64** (`uname -m` = `x86_64`, not under Rosetta), macOS 24.6.

| Scenario | Result |
| --- | --- |
| 6.4 clean install, nothing in /Applications | pass |
| 6.5 reinstall over an existing, non-running copy | pass |
| 6.6 reinstall while the installed Iris is running | pass — quit path fires, then replaces |
| 6.7 reinstall while `npm run dev` also runs | **not verified** — see below |
| 6.8 installed app launches | pass (confirmed visually by the maintainer) |
| 6.9 exactly one Iris in Finder/Spotlight | pass — `mdfind` returns only `/Applications/Iris.app`; `release/` is unindexed |
| 6.10 decoy `.app` at the destination | pass — refuses on a foreign `CFBundleIdentifier` and on an unreadable one, and leaves the decoy intact |

**6.7 is unverified, not passed.** The run was confounded: the dev session's
processes were quit by hand while the installer was mid-run, so the "did the dev
session survive" comparison had no clean before/after to make. The scoping it
tests is asserted at the unit level (the probe pattern is the installed
executable path, and a dev run launches from `node_modules/.bin/electron`), but
that is an argument, not an observation. Re-run it before relying on it.

**The arm64 path is unverified**: arm64 requires a valid Mach-O signature to
execute and this bundle has none, so an unsigned arm64 build may not launch at
all. The maintainer intends to test it on an Apple Silicon machine separately.
Nothing here should be read as a claim that it works today.
