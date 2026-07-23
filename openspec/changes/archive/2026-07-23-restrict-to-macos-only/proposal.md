## Why

Iris is a POC that was built and verified only on macOS. A teammate attempting to run it on Windows hit a long tail of platform issues (CLI spawn/`PATH`, mic/audio/camera permissions, boot/reconnect, start scripts). Rather than invest in a second platform for a proof of concept, we are narrowing the supported surface to **macOS only** so the app fails fast and legibly everywhere else instead of half-running and generating confusing bug reports.

## What Changes

- **BREAKING** Iris refuses to launch on any platform other than macOS. On `process.platform !== "darwin"` it shows a native message ("Iris only supports macOS") and quits **before** creating a window, a tray, or registering global shortcuts. A documented escape hatch `IRIS_ALLOW_ANY_PLATFORM=1` bypasses the guard for developers who deliberately want to run elsewhere (e.g. Linux).
- Remove the now-unreachable `win32`/`taskkill` branch in `killChild()` (`electron/main.mjs`), leaving only the POSIX process-group kill. macOS behavior is unchanged.
- Remove the Windows build tooling: the `package:win` and `dist:win` npm scripts and the dead `build.win` electron-builder target in `package.json`. `build.mac` stays.
- Docs declare macOS-only: cut the Windows section and `%USERPROFILE%` references from `README.md`; note the macOS-only requirement (and the escape hatch) in `README.md`, `CLAUDE.md`, and `.env.example`.
- **Intentionally left untouched** (harmless / not worth the churn): `os.homedir()` and array-form `spawn` args (already portable); the `isWindows` branch in `scripts/run-electron.mjs` and the `!== "darwin"` early-return in `installAppMenu()` (unreachable under the guard but harmless).

## Capabilities

### New Capabilities

- `platform-support`: Iris's launch-admission policy — the single requirement that the app only runs on macOS, refusing to start on other platforms (with a documented developer escape hatch), before any window/tray/shortcut is created.

### Modified Capabilities

<!-- None. Removing the win32 branch of killChild is a pure implementation detail:
     run-execution-queue and app-shutdown specs speak only of "process group" /
     "injected kill hook" and never name Windows or taskkill, so both remain true
     on macOS with no delta. -->

## Impact

- **Code**: new `electron/platform.mjs` (pure `shouldRefuseLaunch(platform, env)` predicate) + `electron/platform.test.mjs`; `electron/main.mjs` — imports the predicate and adds the guard (dialog + quit) at the top of the `app.whenReady()` callback; removal of the `win32` branch in `killChild()` and its stale JSDoc in `electron/run-queue.mjs`.
- **Build/tooling**: `package.json` — remove `package:win`, `dist:win`, and the `build.win` target.
- **Docs**: `README.md`, `CLAUDE.md`, `.env.example`.
- **New config**: `IRIS_ALLOW_ANY_PLATFORM` (unset/`0` = enforce guard; `1` = bypass). No effect on CI: `npm run build` is `tsc --noEmit && vite build` and never boots Electron.
- **Living spec**: adds `openspec/specs/platform-support/`. No existing spec is modified.
