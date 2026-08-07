## 1. Declare HUD chrome once

- [x] 1.1 Add `src/lib/hudChrome.ts` exporting the chrome class constant, `isHudChrome(el: Element | null)` and `hudChromeAtPoint(x, y)` (D1/D2), with a comment stating that the CSS stacking and the gesture rules both derive from this one class.
- [x] 1.2 Add the `hud-chrome` class to the four HUD islands in `src/components/HudShell.tsx`: the review/question stack, the tasks column (`.hud-right`), the left comms/camera column (`.hud-left`), and the orb cluster.
- [x] 1.3 Move the repeated `z-index: 2` off `.hud-right` / `.hud-left` / `.hud-orb-cluster` (`src/styles/hud.css`) and `.hud-review-stack` (`src/styles/claude.css`) onto a single `.hud-chrome` rule, and repoint the galaxy's z-order comment at it so the reason the islands sit above the layer is stated where the class is defined.
- [x] 1.4 Add `src/lib/hudChrome.test.ts` under `// @vitest-environment jsdom`: an element inside a chrome island is chrome (including a deeply nested button), an element inside `.hud-galaxy` is not, a point over chrome resolves as chrome, and `null` is not chrome.

## 2. Make the dwell positional

- [x] 2.1 In `src/App.tsx`'s dwell rAF loop, replace the `(drawingActive || secondBrainActive) && !closest(".hud-controls")` guard with the positional rule: while a layer is active, suppress unless `isHudChrome(actionable)` (D1).
- [x] 2.2 Gate the same loop on the shared reader-open value `App.tsx` already computes for `resolveGestureContext` and the galaxy (`expandedTaskId != null || openNote != null`) rather than `expandedTaskId` alone, so an open reader keeps holding every gesture once the blanket layer suppression is gone (D0/D6); update the effect's dependency array.
- [x] 2.3 Update the loop's comment block — it currently explains the exemption in terms of a fullscreen layer owning everything beneath it, which is the assumption being retired.

## 3. Restore panel scroll under a layer

- [x] 3.1 Add `.hud-work` and `.hud-comms` to `SCROLLABLES` in the open-palm scroll loop (D4).
- [x] 3.2 Replace that loop's `!drawingActive && !secondBrainActive` gate with the positional rule: while a layer is active, scroll only when the resolved element is HUD chrome.
- [x] 3.3 Suppress panel scroll whenever two or more tracked hands read as open palms (D5).
- [x] 3.4 Gate the loop on the full reader-open condition as in 2.2 (D6); update the dependency array.

## 4. Make the galaxy's pointing drives yield

- [x] 4.1 In `src/components/VaultGalaxy.tsx`'s gesture loop, resolve `targetPoint` to `null` when the pointing/inspect hand's point is over HUD chrome (D3), leaving the orbit and zoom drives untouched.
- [x] 4.2 Confirm by reading the loop that a yielded frame behaves as "nothing under the finger" — the dwell machine resets and the highlight clears — so no charge or lit cluster survives the hand moving onto chrome.

## 5. Living spec and docs

- [x] 5.1 Check `docs/GESTURES.md` for the old "a fullscreen layer owns the whole surface" phrasing and correct it to the positional rule, keeping the file a pointer to the specs rather than a second copy of them.
- [x] 5.2 Run the five gates — `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check` — and fix what they report.

## 6. Verify in the app

- [x] 6.1 With the galaxy open in the Glass HUD and hand control on: dwell a task card and confirm it opens, dwell a column toggle and confirm it collapses, and confirm the galaxy opens no note from those same hand positions.
- [x] 6.2 Confirm an open palm scrolls the tasks and comms columns with the galaxy open, that two open palms zoom the camera without scrolling either column, and that a fist orbit continues while the hand crosses a column.
- [x] 6.3 Repeat 6.1 with the drawing panel open in place of the galaxy, and confirm the excalidraw toolbar itself is still not dwell-clickable.
- [x] 6.4 The focus mode, both readers: open a vault note over the galaxy and confirm nothing outside it responds — no task card, no column toggle, no orb control, no node behind it; then open a task from the HUD and confirm the same. Close each and confirm the galaxy and the chrome both answer the hand again immediately, with no camera jump.
