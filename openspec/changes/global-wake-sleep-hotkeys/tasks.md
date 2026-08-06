## 1. Choose and document the bindings

- [x] 1.1 Pick the wake and sleep chords. Check each against macOS system shortcuts and
      against Iris's own `Alt+Space` (HUD) and `Alt+L` (listen-only) before committing —
      a default that collides out of the box is a bad default even though registration
      degrades gracefully
- [x] 1.2 Add `IRIS_WAKE_HOTKEY` and `IRIS_SLEEP_HOTKEY` to `.env.example` following the
      existing two-block pattern at lines 61-71; CLAUDE.md names that file the
      authoritative list

## 2. Register them globally

- [x] 2.1 Add the two accessors to **`electron/window.mjs`**, next to `hudHotkey()` and
      `listenHotkey()` at lines 225-231, which is where the `process.env.IRIS_*_HOTKEY`
      reads actually live. (`electron/live-config.mjs` is the Gemini Live session config
      and has nothing to do with hotkeys.) `window.mjs` is one of the four
      Electron-permitted modules, so this is consistent with `main-process-structure`
- [x] 2.2 Thread them out through `electron/wiring-live.mjs` (deps at ~149-150, return
      at ~160-161) and `electron/wiring.mjs:421-422`
- [x] 2.3 **Update the exact-key-set assertion in `electron/wiring-live.test.mjs`** — it
      asserts the sorted key list of the live wiring's return, so two new accessors fail
      it until listed
- [x] 2.4 Register both in `electron/main.mjs` next to the existing registrations
      (187-203), routing to the same `iris:wake` / `iris:sleep` paths the tray uses.
      Verified: the tray path and the current keyboard path already converge on the same
      renderer `start()` / `stop()`, so this is not a new code path
- [x] 2.5 Handle the no-window case for wake: `emitToRenderer` returns silently when
      there is no window, and on macOS closing the deck does not quit the app. Mirror
      what `toggleHud()` already does (`if (!mainWindow) createWindow()`), or the
      shortcut is a silent no-op with the deck closed
- [x] 2.6 Wrap `globalShortcut.register` in try/catch — a malformed accelerator can
      throw rather than return false, and an unhandled throw in the `whenReady()`
      callback would skip the registration that follows it. Fix the two existing
      registrations in the same pass; they have the same hole
- [x] 2.7 Confirm teardown releases them — `globalShortcut.unregisterAll()` is bound to
      `will-quit` at `electron/main.mjs:230` (line 197 is only a comment about it), so
      this should already be covered; verify rather than assume

## 3. Expose the configured chords to the renderer

- [x] 3.1 Add the two hotkey values to `getFullConfig()`'s return in
      `electron/user-config.mjs`. They are display values, not credentials, so unlike
      the API keys they can be returned as-is
- [x] 3.2 Add them to the `IrisConfig` type in `src/vite-env.d.ts`
- [x] 3.3 Extend `wakeCaption()`'s input type in `src/lib/wake-caption.ts` and thread the
      value through App.tsx's call, so the caption follows configuration instead of a
      hardcoded literal
- [x] 3.4 Add `src/lib/accelerator-label.ts` + test: parse an Electron accelerator
      (`Alt+Shift+W`) into display glyphs (`⌥`, `⇧`, `W`). This is what task 4.2 needs
      and it belongs as a pure helper next to `wake-caption.ts`, not inline in a
      component
- [x] 3.5 Update `src/components/SetupPanel.tsx`, which hardcodes "Press W any time to
      wake, S to sleep."

## 4. Update every place the keys are named

- [x] 4.1 Update the asleep prompt, captions, tooltips, and setup guidance to the new
      chords, driven by the configured value from task 3
- [x] 4.2 Render the chord as separate keycaps using the helper from 3.4
- [x] 4.3 **Update `src/lib/wake-caption.test.ts`** — four assertions hardcode "press W"
      / "Press W to wake Iris" and all four break
- [x] 4.4 Update the README section that documents the two existing hotkeys by name, so
      all four are listed together
- [x] 4.5 Grep for the old bare-key wording to catch copies missed above

## 5. Remove the renderer handler

- [x] 5.1 Delete the `keydown` handler at `src/App.tsx:796-813` — the whole `useEffect`
      including its closing `}, [sidecarRunning, hasBridge]);`, not just the body — along
      with its `INPUT`/`TEXTAREA` guard, which exists only to defend that binding
- [x] 5.2 Do this **after** task 4, not before: in between, the UI would tell the user to
      press W while W does nothing, which the spec's displayed-keys-match-registered-keys
      scenario forbids. Irrelevant in a single commit, load-bearing if staged
- [x] 5.3 Checked and expected to find nothing: no remaining renderer key handler matches
      an Option chord on `event.key` (all match `Escape` or digits). Keep the `event.code`
      convention noted for future handlers

## 6. Verify

- [x] 6.1 Run the five gates: `npm run build`, `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check`
- [ ] 6.2 Manual: focus another application, press wake — Iris wakes
- [ ] 6.3 Manual: focus another application while awake, press sleep — Iris sleeps
- [ ] 6.4 Manual: in HUD mode with another app focused, both work — the motivating case
- [ ] 6.5 Manual: **close the deck window**, then press wake — Iris wakes and a window
      appears. This is the new failure mode a window-level handler could not have
- [ ] 6.6 Manual: type text containing the shortcut letters without the modifier, in Iris
      and in another app, and confirm nothing happens
- [ ] 6.7 Manual: set a conflicting value in `.env`, restart, confirm the app runs and
      Iris is still wakeable by tray and wake word
- [ ] 6.8 Manual: set a **malformed** value (e.g. `Altt+W`), restart, and confirm startup
      completes and Iris is still wakeable
- [ ] 6.9 Manual: override a hotkey in `.env` and confirm the UI displays the overridden
      chord, not the default
