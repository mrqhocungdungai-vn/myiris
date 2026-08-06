## 1. Fix the packaging commands first

- [ ] 1.1 Make `package:mac:host` actually build the host architecture — pass an
      explicit arch flag, or drop `arch` from `package.json`'s `mac.target` so the CLI's
      default (the host) applies. Today the config's `["x64","arm64"]` wins whenever the
      CLI is silent, so `--mac` alone builds both
- [ ] 1.2 Verify on a clean checkout: `npm ci` installs only the host-matching Claude
      binary, so the current `:host` path packs an arm64 bundle without one and
      `prune-foreign-arch.mjs` refuses. It must complete after 1.1
- [ ] 1.3 Correct CLAUDE.md's command table: `dist:mac` is identical to `package:mac`
      and, with `mac.target` set to `dir`, produces no dmg or zip — "full macOS
      distributable" is wrong. Fix the `package:mac:host` line to match 1.1
- [ ] 1.4 Decide whether `dist:mac` should keep existing as a duplicate of `package:mac`
      or gain a real distributable target. Out of scope to implement; record the decision

## 2. The install script

- [ ] 2.1 Add `scripts/install-mac.mjs` and an `npm run install:mac` entry that builds,
      packages for the host arch, installs, and launches
- [ ] 2.2 Select the source bundle by **architecture**, not first match. electron-builder
      writes `release/mac/Iris.app` (x64) and `release/mac-arm64/Iris.app` (arm64), and
      all package scripts currently emit both — a first-match scan installs arm64 on an
      Intel Mac, where it will not run
- [ ] 2.3 Verify the selected bundle's executable matches `process.arch` (`lipo -archs`
      or `file`) and refuse otherwise
- [ ] 2.4 Quit a running Iris with `osascript -e 'tell application "Iris" to quit'` —
      the Apple Event reaches `app.quit()` and runs the real teardown. **Never fall back
      to `kill`**: `SIGTERM`/`SIGKILL` skip `before-quit`, which orphans Claude and its
      descendant tool subprocesses (the process-group termination in `app-shutdown`
      exists to prevent exactly that) and drops the canvas store's debounced write
      window. On timeout, abort the install instead
- [ ] 2.5 Read the shutdown budget from the same source the app uses
      (`IRIS_SHUTDOWN_DEADLINE_MS`, default 8000 ms) rather than hardcoding a wait — a
      user who raises it would otherwise get a copy racing a live teardown
- [ ] 2.6 Distinguish "nothing was running" from "the quit request was refused".
      `osascript` needs Automation permission; denied, it fails silently and the only
      symptom is the wait timing out
- [ ] 2.7 Scope the running-instance probe to the installed path
      (`/Applications/Iris.app/Contents/MacOS/Iris`). There is no single-instance lock in
      this app, so a `npm run dev` session and the installed copy can run at once, and an
      unscoped quit can kill the developer's dev session
- [ ] 2.8 Copy with `ditto`, which preserves the bundle's symlink farm and permissions
- [ ] 2.9 Clear quarantine with `xattr -dr com.apple.quarantine`, **not** `xattr -cr`.
      Stripping all attributes would destroy `com.apple.cs.*` signature xattrs on any
      bundle that is ever signed
- [ ] 2.10 Delete `ELECTRON_RUN_AS_NODE` from the environment before launching — a shell
      exporting it starts Iris headless with no window. `scripts/run-electron.mjs`
      already does this; the same footgun applies here
- [ ] 2.11 Launch the installed app at the end

## 3. Guard the destructive step

- [ ] 3.1 The destination is a **hard-coded constant**. Do not accept it from an argument
      or environment variable at all — an override cannot satisfy the "is this Iris at
      the expected path" check by definition, so there is no safe form of it
- [ ] 3.2 Before removing anything, verify the target is Iris's own bundle: a directory
      ending in `.app` at the expected path whose `CFBundleIdentifier` is `app.iris.voice`.
      Read it with `plutil -extract CFBundleIdentifier raw -o - "<app>/Contents/Info.plist"`
      — `defaults read` requires dropping the `.plist` extension and is easy to get wrong
- [ ] 3.3 Refuse and exit with a clear message if the target is not what is expected,
      rather than removing it anyway
- [ ] 3.4 Fail loudly on any step that errors rather than continuing and leaving a
      half-replaced bundle
- [ ] 3.5 Extract target resolution and the identifier/arch verification into a pure,
      dependency-injected function in `electron/` with a colocated `*.test.mjs`, leaving
      `scripts/install-mac.mjs` as thin I/O. `vitest` collects only `electron/**/*.test.mjs`
      and `src/**/*.test.ts`, so logic left in `scripts/` gets **zero** automated
      coverage — and this is the most destructive tooling in the repo

## 4. Decide what happens to build output

- [ ] 4.1 `release/mac*/Iris.app` are the build products, not a staging directory.
      Decide explicitly: delete them after install (which makes any standalone
      "install the last build" mode impossible), or leave them and exclude `release/`
      from Spotlight with `.metadata_never_index`. Either is fine; picking by accident
      is not

## 5. Docs

- [ ] 5.1 Document `npm run install:mac` in README next to the existing build/run commands
- [ ] 5.2 Tell the user the installed app reads `~/.iris/.env`, not the repo's `.env`, and
      what to put there — otherwise the first launch fails on a missing `GEMINI_API_KEY`
- [ ] 5.3 State that the app is unsigned and what the script does about quarantine
- [ ] 5.4 Fix README's "right-click and choose Open" line — that path was removed in
      macOS Sequoia

## 6. Verify

- [ ] 6.1 Run the five gates. Note `spec:check` only scans `openspec/specs/`, so it is a
      no-op for this change and proves nothing about it
- [ ] 6.2 Confirm the new script is oxlint-clean — `scripts/` is in the lint targets at
      zero warnings
- [ ] 6.3 Follow the conventions in `scripts/`: a bracketed log tag on every line, a
      header comment explaining *why*, `execFileSync` with an argv array (never
      `execSync` with an interpolated string), explicit exit codes, failures on stderr
- [ ] 6.4 Manual: clean install with no prior Iris in `/Applications`
- [ ] 6.5 Manual: reinstall over an existing installed copy
- [ ] 6.6 Manual: reinstall while Iris is **running**
- [ ] 6.7 Manual: reinstall while a `npm run dev` session is also running, and confirm
      the dev session is not killed
- [ ] 6.8 Manual: launch the installed app from Finder and confirm it opens
- [ ] 6.9 Manual: confirm exactly one Iris appears in Finder and Spotlight
- [ ] 6.10 Manual: point the resolver at a decoy `.app` that is not Iris and confirm it
      refuses instead of deleting it
- [ ] 6.11 Record whether this was verified on Intel, Apple Silicon, or both. The arm64
      path is unverified and an unsigned arm64 bundle may not execute at all
