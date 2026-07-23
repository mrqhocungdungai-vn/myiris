## 1. Startup platform guard (commit 1)

- [x] 1.1 Create `electron/platform.mjs` exporting the pure predicate `shouldRefuseLaunch(platform, env)` → `platform !== "darwin" && env.IRIS_ALLOW_ANY_PLATFORM?.trim() !== "1"` (strict `"1"` contract, but trim the value first per the repo's env-parsing habit so a stray trailing space doesn't silently re-enable the guard).
- [x] 1.2 Add a vitest test (e.g. `electron/platform.test.mjs`) covering: `("darwin", {})` → false; `("linux", {})` → true; `("win32", {})` → true; `("linux", { IRIS_ALLOW_ANY_PLATFORM: "1" })` → false; `("darwin", { IRIS_ALLOW_ANY_PLATFORM: "1" })` → false; and — to lock the strict `=== "1"` contract — `("linux", { IRIS_ALLOW_ANY_PLATFORM: "0" })` → true and `("linux", { IRIS_ALLOW_ANY_PLATFORM: "true" })` → true (only exactly `"1"` bypasses); and `("linux", { IRIS_ALLOW_ANY_PLATFORM: " 1 " })` → false (trimmed value still bypasses).
- [x] 1.3 In `electron/main.mjs`, import `shouldRefuseLaunch` and add the guard as the **first statement** inside the `app.whenReady().then(() => { ... })` callback (~line 2978), above the dock-icon line: `if (shouldRefuseLaunch(process.platform, process.env)) { dialog.showMessageBoxSync({ type: "error", title: "Unsupported platform", message: "Iris only supports macOS." }); app.quit(); return; }`
- [x] 1.4 Confirm `dialog` is imported (main.mjs:26 — already is) and no new import beyond `shouldRefuseLaunch` is needed.
- [x] 1.5 Verify the `return` short-circuits the callback: nothing below (menu, pipeline probe, IPC handlers, `createWindow`/`createTray`/`globalShortcut`) runs on the rejected path.

## 2. Remove dead win32 kill branch (commit 2)

- [x] 2.1 In `electron/main.mjs` `killChild()` (~lines 251–256), delete the `if (process.platform === "win32") { ... taskkill ... return; }` branch, leaving the POSIX `process.kill(-child.pid, signal)` group-kill path and its `catch` fallback intact.
- [x] 2.2 In `electron/run-queue.mjs` (~line 104), update the `killChild` dep JSDoc to drop the "or Windows taskkill" example so the injected-hook comment matches macOS-only reality.
- [x] 2.3 Confirm no `run-execution-queue` / `app-shutdown` spec delta is needed (specs reference only "process group" / injected hook — verified in design D5).

## 3. Remove Windows build tooling (commit 3)

- [x] 3.1 In `package.json`, remove the `package:win` and `dist:win` scripts.
- [x] 3.2 In `package.json`, remove the `build.win` electron-builder target (~lines 92–96); keep `build.mac` (its own `icon`/`target`, shares nothing with `win`). Watch JSON hygiene — no trailing comma left dangling after the `mac` block.
- [x] 3.3 Confirm no remaining script or config references the removed win entries (grep `win` in package.json).

## 4. Docs (commit 4)

- [x] 4.1 `README.md`: remove the Windows section (~lines 212–235) and `%USERPROFILE%\.iris\.env` reference (~line 88); state that Iris supports macOS only. Also fix the other Windows references so the doc stays coherent: line 97 ("On Windows PowerShell:"), line 145 ("macOS, Windows, or Linux…"), line 307 ("Apple/Windows signing").
- [x] 4.2 `README.md` + `.env.example`: document `IRIS_ALLOW_ANY_PLATFORM` (unset/`0` = macOS-only enforced; `1` = developer bypass); in `.env.example` remove **both** the `# Windows example:` comment (line 40) **and** its `# IRIS_CLAUDE_BIN=C:\\Users\\...\\claude.exe` path line (line 41) together — leaving only the `# macOS/Linux example:` entry, so no orphaned Windows path remains under it.
- [x] 4.3 `CLAUDE.md`: update the runtime-prerequisites / config notes that mention `%USERPROFILE%\.iris\.env` (~line 31) to reflect macOS-only, and remove the `npm run package:win` command line (~line 24).
- [x] 4.4 Leave `docs/BUGFIX_PLAN.md` (~lines 562, 668, its `taskkill`/`package:win` references) untouched — it is a historical planning record of what was true at the time, not living docs. Intentional, not an omission.

## 5. Verify

- [x] 5.1 `npm run build` (`tsc --noEmit && vite build`) passes.
- [x] 5.2 `npm test` (Vitest) passes — the new `platform.test.mjs` is green, and no run-queue/po-session regressions from the `killChild` edit.
- [x] 5.3 Manual (macOS): launch normally → window, tray, shortcuts all come up (darwin path unchanged); a DEV run's stop still group-kills correctly.
- [x] 5.4 Manual (guard, if a non-macOS machine or a `process.platform` stub is available): confirm the dialog shows and the app quits with no window/tray; and that `IRIS_ALLOW_ANY_PLATFORM=1` lets it boot.
