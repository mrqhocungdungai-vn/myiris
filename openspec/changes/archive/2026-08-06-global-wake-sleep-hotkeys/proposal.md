## Why

The keyboard wake and sleep shortcuts only work when the deck window already has
keyboard focus. They are renderer `keydown` handlers (`src/App.tsx:796-813`) listening
for bare `w` and `s`. That makes them useless in exactly the situation Iris is built
for: HUD mode with another application focused, where the user is working and wants to
wake Iris without hunting for its window.

Every other way of reaching Iris from outside is already global. The HUD toggle is a
registered `globalShortcut` (`IRIS_HUD_HOTKEY`, default `Alt+Space`), listen-only has
one (`IRIS_LISTEN_HOTKEY`, default `Alt+L`), and the tray offers wake and sleep. Wake
and sleep by keyboard are the exception.

There is a second, quieter problem: **the living spec never defines these shortcuts at
all.** `wake-sleep-voice` refers to "the keyboard wake shortcut" and "the keyboard
sleep path" in six places (lines 3, 9, 20, 62, 81, 184), and has a scenario asserting
"the keyboard wake path still works and is still presented to the user" — but no
requirement says what those keys are, where they are handled, or that they work when
the window is unfocused. The
behaviour is load-bearing for another requirement and specified nowhere.

Bare `w`/`s` are also a poor choice for a window-level binding: they are ordinary
typing keys. The current handler guards `INPUT` and `TEXTAREA`, which covers today's
renderer, but the guard is a list that has to keep pace with every future text
surface.

## What Changes

- Wake and sleep move to **modifier-qualified global shortcuts**, registered by the
  main process like the HUD and listen-only hotkeys, so they work with any application
  focused.
- They become **configurable through the same `IRIS_*` mechanism** as the existing
  hotkeys, with documented defaults in `.env.example`.
- Registration failure degrades gracefully — logged, app continues, wake still
  reachable by tray, wake word, and UI — matching how the HUD hotkey already behaves.
- The renderer's bare `w`/`s` `keydown` handler is removed, taking its
  `INPUT`/`TEXTAREA` guard with it.
- **BREAKING for muscle memory**: bare `w` and `s` stop waking and sleeping Iris. This
  is deliberate — a bare letter key is the wrong binding for something that should
  work while the user is typing in another app.
- The user-facing text that names these keys (the asleep prompt, captions, wizard,
  tooltips, README) is updated with them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wake-sleep-voice`: gains a requirement defining the keyboard wake and sleep
  shortcuts — that they exist, are modifier-qualified, are registered globally, are
  configurable, and degrade gracefully. This closes the gap where an existing scenario
  depends on a "keyboard wake path" that no requirement describes.

**Not** `hud-activation`, despite the shared mechanism. Its **Three activation
surfaces** requirement is about reaching HUD mode, and its **Tray presence** clause
"The global hotkey SHALL be unregistered on quit" is written about the HUD hotkey it
owns. Teardown is already `globalShortcut.unregisterAll()`, bound to `will-quit` at
`electron/main.mjs:230`, so the new shortcuts are covered in fact; the new requirement
states their own unregistration rather than editing another capability's sentence to be
plural.

## Impact

- **Code**: `electron/main.mjs` (registration, alongside the existing two at lines
  187-203), the hotkey accessors in **`electron/window.mjs:225-231`** — where
  `hudHotkey()` / `listenHotkey()` read `process.env` — threaded out through
  `electron/wiring-live.mjs:149-150,160-161` and `electron/wiring.mjs:421-422`,
  `src/App.tsx` (remove the `keydown` handler at 796-813), and every UI string naming
  the keys.
- **Two existing tests will fail** and must be updated in the same change:
  `electron/wiring-live.test.mjs` asserts the **exact sorted key set** of the live
  wiring's return, so two new accessors break it; and `src/lib/wake-caption.test.ts`
  asserts the literal strings "press W" / "Press W to wake Iris" in four places.
- **Displaying the configured chord is not a one-line change.** The hotkey values live
  in the main process and never cross IPC — `getFullConfig()` returns no hotkey field.
  Showing them means extending that snapshot, its renderer type, `wake-caption`'s
  input, and `SetupPanel`, plus a small helper to render an Electron accelerator
  string (`Alt+Shift+W`) as keycap glyphs.
- **Config**: two new `IRIS_*` keys documented in `.env.example`, which CLAUDE.md
  names the authoritative list.
- **macOS footgun to carry over from upstream**: match on `event.code`, not
  `event.key` — macOS mutates `event.key` when Option is held, so an Option chord
  matched on `event.key` silently fails. This applies to any remaining renderer-side
  key handling.
- **Dependencies**: none.
- **Risk**: a chosen default may collide with an existing system or app shortcut. The
  graceful-degradation path already exists for exactly this and is required here too.
