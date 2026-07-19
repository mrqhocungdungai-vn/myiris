# Tasks — glass-hud-overlay

## 1. Main-process HUD plumbing

- [x] 1.1 Add overlay-capable BrowserWindow flags + fullscreen-overlay swap on toggle (port upstream window setup); app always boots into deck mode
- [x] 1.2 Add IPC: `ipcMain.handle("hud:toggle")`, `ipcMain.on("hud:interactive")` → `setIgnoreMouseEvents(!on, { forward: true })`, `emitToRenderer("hud:mode", { mode })` on every switch
- [x] 1.3 Add fenced Tray section: `createTray()` + `updateTrayMenu()` (toggle HUD / wake / sleep); wake emits new `iris:wake` channel wired to the existing wake path; sleep reuses `iris:sleep`
- [x] 1.4 Vendor `build/trayTemplate.png` + `@2x` and `scripts/render-icon.mjs` from upstream; add both images to the electron-builder `files` list
- [x] 1.5 Add `hudHotkey()` (`IRIS_HUD_HOTKEY`, default `Alt+Space`), `globalShortcut.register` on ready with failure logged as a sidecar log event, `globalShortcut.unregisterAll()` on `will-quit`
- [x] 1.6 Extend `preload.cjs`: `toggleHud`, `setHudInteractive`, `onHudMode`, `onWakeRequest`; decide `win:control` per design D6 (include only if a wired control needs it)

## 2. Renderer HUD mode

- [x] 2.1 Copy `hud.css` from upstream into `src/styles/` and import from `styles/index.css` (verify byte-identical to upstream for future diffability; Claude-specific HUD styling goes in `claude.css`)
- [x] 2.2 Port `HudShell.tsx`; relabel any Hermes wording to Claude; wire existing state/props (reactor refs + keys, tasks, transcript, hand control, mute, wake word flag)
- [x] 2.3 Add `uiMode`/`modeTransition` state to App.tsx with `onHudMode` handler and deck-leaving/hud-entering transition classes; render `HudShell` vs deck by mode
- [x] 2.4 Add the `hud:interactive` pointer wiring (pointermove/leave over `.hud-hit`) exactly as upstream
- [x] 2.5 Add HUD toggle affordance in deck TopBar and exit control in HUD (both call `toggleHud`)

## 3. Claude surfaces in the HUD

- [x] 3.1 Verify HUD WorkCards render agent badge, model, ⛓ badge, and StepTimeline identically to deck (shared WorkCard — confirm no HUD-variant prop drops them)
- [x] 3.2 Add `poQuestion` slot to HudShell rendering `PoQuestionBanner` in a `.hud-hit` container (design D2); pick placement (comms cluster vs orb) during implementation
- [x] 3.3 Confirm TaskChooser suppression while a PO question pends also holds in HUD mode; ui-context snapshots include `uiMode` so Gemini knows the HUD is up

## 4. Config & docs

- [x] 4.1 Document `IRIS_HUD_HOTKEY` in `.env.example`; README section for HUD mode (activation paths, click-through model, known macOS Spaces quirks if found)
- [x] 4.2 Update CLAUDE.md architecture bullets (HudShell component, `hud:*`/`iris:wake` channels) per the living-spec convention

## 5. Verification

- [x] 5.1 `npm run build` green; `hud.css` byte-identical to upstream; no Hermes strings introduced
- [x] 5.2 Click-through smoke: with HUD up, type and click into an app underneath through glass; then click every `.hud-hit` island (cards, steps toggle, mute, wake/sleep, exit, camera)
- [x] 5.3 Activation smoke: UI toggle, hotkey from another focused app, tray toggle; hotkey-conflict path logs and degrades; tray wake from sleep works; deck↔HUD transitions animate
- [x] 5.4 Relay smoke in HUD: PO asks mid-turn → banner island appears, answer by dwell-click AND by voice; timeout fallback unchanged; deck-mode regression pass (full deck smoke from prior changes)
- [x] 5.5 Packaged `.app` check: tray icon renders from bundled assets, hotkey registers, HUD works in the packaged build
