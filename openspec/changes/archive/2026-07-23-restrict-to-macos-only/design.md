## Context

Iris (`electron/main.mjs`) is an Electron POC verified only on macOS. Startup runs entirely inside `app.whenReady().then(...)` (main.mjs ~2978): it sets the dock icon, installs the app menu, fire-and-forget probes pipeline availability, registers ~30 `ipcMain` handlers, then calls `createWindow()` / `createTray()` / `globalShortcut.register()`. There is **no** `requestSingleInstanceLock`. `dialog` is already imported (main.mjs:26). The Software Architect reviewed this plan against the code before proposal.

The one remaining Windows-specific code path is `killChild()`'s `win32` branch (main.mjs:251–256), which shells out to `taskkill`; the POSIX branch does `process.kill(-pid, signal)` group-kill. `killChild` is injected into the run queue so `run-execution-queue.mjs` holds no platform knowledge.

## Goals / Non-Goals

**Goals:**
- Fail fast and legibly on any non-macOS platform, before any UI exists.
- Keep a low-cost developer escape hatch for deliberate non-macOS runs.
- Remove dead Windows tooling/code so the repo matches the supported surface.
- Zero observable change to macOS behavior.

**Non-Goals:**
- Making Windows (or Linux) actually work.
- Touching the Gemini key-test depth, reconnect terminal-error classification, or mic/audio/camera permission flows (they were Windows-motivated worries, now moot).
- Ripping out portable code (`os.homedir`, array `spawn` args) or already-guarded no-ops (`installAppMenu` darwin early-return, `scripts/run-electron.mjs` `isWindows`).

## Decisions

### D1 — Guard is the FIRST statement in the `app.whenReady()` callback, with an explicit `return`
Placement matters: everything from the dock icon down runs synchronously in that callback. `app.quit()` only *schedules* a quit; without an early `return` the rest of the callback still executes, creating a Tray and registering a global shortcut on the very platform being rejected. The guard therefore reads:

```js
if (shouldRefuseLaunch(process.platform, process.env)) {
  dialog.showMessageBoxSync({ type: "error", title: "Unsupported platform",
    message: "Iris only supports macOS." });
  app.quit();
  return;
}
```

**Alternative considered — a synchronous top-level check at module load:** rejected. A dialog cannot be shown before the app is ready, and `app.quit()` pre-ready is less predictable. Inside `whenReady` is the correct hook. (`requestSingleInstanceLock` does not exist here, so "before the lock" is a non-option.)

### D7 — Extract the decision as a pure `shouldRefuseLaunch(platform, env)` predicate (testable seam)
The admission policy is the one policy-defining line in this change, and `main.mjs` is permanently outside the vitest harness (boots Electron). So the boolean decision lives in a small pure module `electron/platform.mjs`:

```js
export function shouldRefuseLaunch(platform, env) {
  return platform !== "darwin" && env.IRIS_ALLOW_ANY_PLATFORM?.trim() !== "1";
}
```

`main.mjs` imports it and keeps only the effect (dialog + quit) in the callback. This mirrors the repo's existing seams (`runIdleTimeoutMs(env)` in `run-queue.mjs`, the injected deps of `createRunQueue`) and the `test-harness` capability's principle: pure env/platform logic is extracted and unit-tested; Electron-bound effects stay in `main.mjs` and are verified manually. **Alternative — inline the conditional:** defensible for a POC guard, but leaves the sole policy line uncovered while a cheap seam is available; rejected for consistency with repo conventions.

The contract stays strict — only exactly `1` bypasses — but the value is `.trim()`'d first, matching the repo's env-parsing habit (main.mjs:343) so an accidental trailing space in the hatch doesn't silently re-enable the guard on the very developer trying to bypass it.

### D2 — `app.quit()` (not `app.exit(0)`)
`app.quit()` fires `before-quit` → `shutdownTeardown()`. At guard time there is no Live socket, no queued run, no PO session, so teardown is entirely no-op; `will-quit`'s `unregisterAll()` on an empty registry is also fine. Using `app.quit()` keeps the app's single documented shutdown path rather than introducing a second exit route. The needless async hop is invisible to the user. **Alternative — `app.exit(0)`:** faster and bypasses teardown entirely, but adds a second exit contract for no real benefit at this lifecycle point.

### D3 — `dialog.showMessageBoxSync` with no parent window
The app is ready inside the callback, so the `dialog` module is live; a `showMessageBoxSync` with no `browserWindow` argument shows a standalone modal — correct, since no window exists yet. Synchronous so the message is guaranteed shown before the quit proceeds.

### D4 — Escape hatch `IRIS_ALLOW_ANY_PLATFORM=1`
A single env check ORed into the guard. Default (unset / any value other than `"1"`) enforces macOS-only; `"1"` bypasses. Cheap, reversible, documented in `.env.example`. Keeps the default strict while unblocking a developer who knowingly runs on Linux. No effect on CI, which never boots Electron.

### D5 — Remove the `win32` branch of `killChild()` — no spec delta
After the guard, only darwin reaches runtime, so the `taskkill` branch is unreachable. Removing it leaves `killChild` doing POSIX group-kill via the injected hook. Verified against the living spec: `run-execution-queue/spec.md` speaks only of an "injected transport-kill hook" and "process group" and never names Windows/taskkill; `app-shutdown/spec.md` says "reaching its whole process group." Both remain true on macOS unchanged — this is a **pure implementation detail, no MODIFIED delta**. Opening one would be wrong.

Honest caveat (Backend Architect review): after this removal, POSIX group-kill (`process.kill(-pid, …)`) is the **sole** reap path. It reaps the process group but does **not** follow a grandchild that `setsid()`s into its own session — the deleted Windows `taskkill /T` walked the parent-child tree and would have caught such an escaper. This is not a regression (Windows never actually ran), and the accepted posture for this POC is: group-kill covers the Claude CLI subprocess and its in-group descendants (bash, MCP servers), and setsid-escaping grandchildren are out of scope.

### D6 — Remove Windows build tooling for coherence
Drop `package:win` and `dist:win` scripts and the `build.win` electron-builder target (package.json). Leaving `build.win` while removing the scripts would strand a target no script can invoke. There are no nsis/appx/portable targets to chase. `build.mac` stays.

## Risks / Trade-offs

- [Guard placed too low, after side-effects run] → Mitigation: D1 mandates it as the first statement with an explicit `return`; tasks call this out and manual verification confirms no Tray/shortcut on rejection.
- [Escape hatch masks the guard in a way that confuses bug reports] → Mitigation: it requires an explicit opt-in env var documented as developer-only; default behavior is strict.
- [Cannot fully verify non-darwin behavior from this macOS machine] → Mitigation: the darwin path is exercised normally; the non-darwin branch is a small, reviewable conditional. Escape hatch provides a manual way to confirm the app still boots when the guard is bypassed.
- [Removing `build.win` breaks someone's Windows packaging] → Accepted: that is the explicit intent of this POC-scoping change; it is a **BREAKING** change as noted in the proposal.

## Migration Plan

Land as separate commits per the repo's one-change-per-concern discipline: (1) the startup guard + escape hatch, (2) `killChild` win32 removal, (3) build-tooling removal, (4) docs. Rollback is trivial — revert the commits; no data migration, no persisted state involved.

## Open Questions

None — all decisions resolved during grilling and the Software Architect review.
