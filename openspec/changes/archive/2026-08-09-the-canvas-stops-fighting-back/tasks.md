## 1. The surface becomes fullscreen, and always has a way out

- [x] 1.0 `src/styles/hud.css` — `.hud-drawing-panel` is `inset: 0`, z-index 1 (under `.hud-chrome`), on the galaxy's terms; excalidraw's footer controls inset clear of the chrome islands
- [x] 1.0a `src/components/DrawingCanvas.tsx` — a visible Close control via excalidraw's `renderTopRightUI`: the way out that needs neither the keyboard nor knowledge that hover reveals the orb cluster
- [x] 1.0b `src/App.tsx` — Esc observed in the CAPTURE phase so the canvas cannot swallow it; an open excalidraw dialog still gets Esc first
- [x] 1.0c `src/lib/hud-interactivity.ts` — reduced to the two real regimes (exclusive fullscreen layer vs per-position); the gesture latch removed rather than left as a no-op, since a fullscreen surface has no edge to cross
- [x] 1.0d `src/App.tsx` — closing the layer restores click-through immediately instead of waiting for the next pointermove

## 1bis. (superseded) The bounded panel stops taking the screen hostage

- [x] 1.1 `src/App.tsx` — replace the "latched while active" branch with gesture latching: resolve interactivity per pointer move as when closed, latch on `pointerdown` inside the panel, release on `pointerup`/`pointercancel`
- [x] 1.2 `src/App.tsx` — keep `.excalidraw-modal-container` in the hit-test list and make it reachable in both branches
- [x] 1.3 `src/styles/hud.css` — add `.excalidraw-modal-container` and the eye-dropper backdrop to the `pointer-events: auto` list
- [x] 1.4 `src/styles/hud.css` — give `.hud-drawing-panel` a stacking context above `.hud-chrome`
- [x] 1.5 Tests: interactivity resolution as a pure function over (pointer position, gesture state, panel rect)

## 2. Two writers stop overwriting each other

- [x] 2.1 `electron/canvas-store.mjs` — monotonic `revision` stamped on every `setScene`; `getScene` exposes it; `setScene` reports whether the scene was persisted or dropped by the size guard
- [x] 2.2 `electron/capabilities/canvas.mjs` — `canvas:scene` accepts a base revision and reconciles per element when stale instead of replacing
- [x] 2.3 `electron/canvas-mcp.mjs` — surface the persist outcome in the tool result; stop reporting `applied` for a scene that was never written
- [x] 2.4 `src/components/DrawingCanvas.tsx` — apply by element-id reconciliation, not whole-scene replace; queue an apply that arrives before the API is ready; record the apply as its own undo step
- [x] 2.5 `src/components/DrawingCanvas.tsx` — clear the echo signature once a non-matching change is seen
- [x] 2.6 Tests: `electron/canvas-store.test.mjs` — the reported failure end to end against a real store and a real file ("Iris draws, I close the panel, her work is gone"): the panel closing without having seen the write, having seen it, and knowing no revision at all; the work read back on the next launch; and the user still able to delete something Iris drew (protection must not become resurrection). Plus stale-push reconciliation, size-guard reporting, mount-race apply and echo-guard release in `canvas-store` / `canvas-mcp` / `DrawingCanvas.merge` tests

## 3. The canvas stops looking empty, and Iris's writes are visible

- [x] 3.1 `src/components/DrawingCanvas.tsx` — restore the viewport with the scene (persist scroll/zoom, or `scrollToContent` on restore)
- [x] 3.2 `src/components/DrawingCanvas.tsx` — scroll an off-screen apply into view and surface an "Iris drew" indication
- [x] 3.3 `src/components/DrawingCanvas.tsx` — flush on `pagehide` as well as unmount
- [x] 3.4 Error boundary + Esc force-close for the panel, mirroring the galaxy layer
- [x] 3.5 Tests for the viewport restore (`DrawingCanvas.merge.test.ts`: `viewportSceneRect` / `boundsVisible` / `elementsBounds`). NOT the pagehide flush: it lives in a component effect, and `DrawingCanvas` cannot mount under vitest (lazy excalidraw bundle + `window.iris`). Testing it means extracting the flush into its own hook — recorded as a follow-up rather than pretended

## 4. The relay stops saying the wrong thing

- [x] 4.1 `electron/run-stream.mjs` + `src/App.tsx` — settlement carries an `outcome` naming the branch that ran (`defaulted` / `unanswered` / `answered`); the renderer announces that branch instead of assuming the ALLOW wording
- [~] 4.2 MOVED OUT of this change. A Live reconnect being invisible is real (`live-session.mjs:339-405` swallows the mic for ~30s while the caption still reads "Listening", and an exhausted reconnect budget reaches the user only through a log that production filters), but it is the voice transport's problem, not the canvas's — it shares no file, no seam and no requirement with anything here. Belongs in its own change with the rest of `.audit/realtime-audit.md`'s section B
- [x] 4.3 `get_canvas` degraded image reports its reason; realign the image budget against the request lifetime
- [x] 4.4 `electron/run-stream.test.mjs` — both expiry policies assert their own `outcome`, and an answered question is not reported as a timeout branch

## 6. The surface stops feeling like a seized machine

- [x] 6.1 `src/components/DrawingCanvas.tsx` — serialize the scene ONCE per debounce window instead of on every `onChange`; excalidraw fires `onChange` per pointermove, and whole-scene serialization there measured 8.7 ms (1 MB) / 35 ms (4 MB) / 63 ms (8 MB) per call on an M4, roughly 3x on Intel — the dominant cause of "drawing feels frozen"
- [x] 6.2 `src/components/DrawingCanvas.tsx` — compute the echo signature only while an apply is outstanding (it is O(n log n) over the scene and was run on every change)
- [x] 6.3 `electron/window.mjs` + test — a renderer that stops responding no longer holds the whole desktop's mouse hostage; main releases click-through on `unresponsive`
- [x] 6.4 `src/App.tsx` — correct the claim that the tray is a renderer-free escape hatch (this window paints over the menu bar and eats clicks aimed at it); the OS hotkey is the one true renderer-free route
- [ ] 6.5 NOT DONE, deliberately: pausing the hand-dwell loop while drawing. Dwell over chrome while a fullscreen layer is open is required behaviour (`hud-panels-stay-hand-reachable-under-galaxy`); disabling it would trade a specified capability for a few percent of CPU
- [ ] 6.6 OPEN QUESTION for the user: whether losing window focus (⌘Tab) while the surface is open should release the pointer. Today it does not — the keyboard follows the other app, so Esc stops working while the overlay still eats every click, leaving only the OS hotkey. Releasing on blur makes the machine usable but makes clicking back into the canvas impossible without the hotkey
- [~] 6.7 FOLLOW-UP, not done here: a failed HUD-hotkey registration is only logged (`electron/main.mjs:256-272`), and this change is what made that hotkey load-bearing (it is the one escape route that survives a hung renderer, now that the tray is provably unreachable under a fullscreen layer). Surfacing it properly needs a renderer notice surface and an `emitToRenderer` seam main does not currently receive — renderer plumbing that has nothing to do with the canvas. The tray correction (6.4) is the part that belonged here

## 5. Gates

- [x] 5.1 `npm run build` — green
- [x] 5.2 `npm test` — green, 97 files / 1621 tests (baseline was 1568)
- [x] 5.3 `npm run lint` — green, 0 warnings
- [x] 5.4 `npm run scan:secrets` — green
- [x] 5.5 `npm run spec:check` — green
