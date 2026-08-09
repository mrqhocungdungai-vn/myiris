# Drawing-canvas audit (read-only) — hud-drawing-canvas

Scope: `src/components/DrawingCanvas.tsx`, `src/components/DrawingCanvas.echo.test.ts`,
`drawingActive` in `src/App.tsx`, `src/styles/hud.css`, `electron/canvas-store.mjs`,
`electron/capabilities/canvas.mjs`, `electron/ipc.mjs`, `electron/window.mjs`,
`electron/canvas-mcp.mjs`, `openspec/specs/hud-drawing-canvas/spec.md`.
No code was changed. Every finding cites file:line.

Legend — **BUG** = violates the spec or is a real defect; **UX-GAP** = spec is silent but it hurts.

---

## P0

### 1. BUG — Opening the panel makes the WHOLE desktop un-clickable, not just the panel
`src/App.tsx:780-785` latches `window.iris.setHudInteractive(true)` for the entire time the
panel is active; `electron/ipc.mjs:173-178` turns that into `win.setIgnoreMouseEvents(false)`
on a **fullscreen** window (`electron/window.mjs:233` sets the window to the full display
bounds). Once `ignoreMouseEvents` is false the OS delivers every click on the whole screen to
the Iris window; `.hud-mode body { pointer-events: none }` (`src/styles/hud.css:13-15`) only
means the click hits nothing in the page — it does **not** forward it to the app underneath.
Spec violation: "the panel SHALL be a bounded region … so glass outside it remains
click-through" and scenario "Activate the drawing panel in HUD → AND glass outside the panel
remains click-through to the apps underneath" (`spec.md:9,15-17`).
Note the spec contains an internal conflict: `spec.md:37` demands the window "remain
interactive for the whole duration the panel is active". A single window-wide boolean cannot
satisfy both.
**Fix where**: `src/App.tsx:780-813` + `electron/ipc.mjs:173-178`. Keep per-pointer-move
resolution but latch only while a pointer button is down / a gesture is in flight (pointerdown
→ latch, pointerup+leave → unlatch), or add hysteresis around the panel rect. Then reconcile
`spec.md:35-42` so the latch is scoped to "for the duration of a gesture", not "of the panel".

### 2. BUG — Every excalidraw dialog is dead: portalled outside `.hud-hit`, so `pointer-events: none`
Excalidraw's `Modal` portals into `document.body` with class `excalidraw-modal-container`
(`node_modules/@excalidraw/excalidraw/dist/dev/index.js:9238-9242` + `useCreatePortalContainer`,
container = `document.body`). In HUD mode `body` is `pointer-events: none`
(`src/styles/hud.css:13-15`) and the auto-list (`src/styles/hud.css:17-24`) does **not** contain
`.excalidraw-modal-container`. Result: the "Export image", "Save to…", Help, and command-palette
dialogs render but cannot be clicked or typed into. That kills the primary Open/Save/Export
route the spec requires (`spec.md:82-99`) and violates "Popovers are clickable" (`spec.md:44-47`).
The `elementFromPoint` list in `src/App.tsx:797` *does* name `.excalidraw-modal-container` — but
that branch only runs while the panel is **closed**, so it is dead code and its CSS twin is
missing. Strong evidence the failure mode was anticipated and only half-fixed.
**Fix where**: `src/styles/hud.css:17-24` — add `.excalidraw-modal-container` (and
`.excalidraw-eye-dropper-backdrop`) to the `pointer-events: auto` list; drop or keep the now-dead
selector in `src/App.tsx:797` accordingly.

---

## P1

### 3. BUG — Quitting the app loses up to 500 ms of strokes (spec says it must not)
`spec.md:65,77-80` requires pending changes to be flushed "when the app quits". The renderer's
flush is an unmount effect only (`DrawingCanvas.tsx:124-137`), and a quit destroys the renderer
without unmounting React — there is no `beforeunload`/`pagehide` handler and no main→renderer
"about to quit, flush now" signal. `electron/main.mjs:310-336` + `capabilities/canvas.mjs:220-227`
flush only what main **already received**, so the last ≤500 ms window
(`DrawingCanvas.tsx:30,161-167`) never arrives. Same loss on window close (⌘W) and on reload.
**Fix where**: `DrawingCanvas.tsx` — add a `pagehide`/`beforeunload` listener calling
`flushPending`, and/or emit a `canvas:flush-now` from `shutdownTeardown()` and await one
round-trip before `canvasStore.flush()`.

### 4. BUG — Claude's MCP writes silently delete the user's last ≤500 ms of drawing
`canvas-mcp.mjs:389-392/406-409/423-426` does a read-modify-write over the **whole** scene from
main's cache and then broadcasts `canvas:apply`; `DrawingCanvas.tsx:87-98` applies it with
`updateScene({ elements })` — a whole-scene replace. Main's cache is only as fresh as the
renderer's 500 ms debounce (`DrawingCanvas.tsx:161-167`), so any stroke drawn inside that window
is absent from the scene Claude read and is **erased from the live canvas** by the apply. Worse,
`captureUpdate: NEVER` (`DrawingCanvas.tsx:96`) means the user cannot even undo the loss.
**Fix where**: `DrawingCanvas.tsx:87-98` — merge by element id instead of replacing (apply only
the elements the tool touched), or have main request a fresh scene from the panel before a write
when the panel is mounted.

### 5. BUG — Reopening the panel scrolls back to the origin, so the drawing looks *gone*
`DrawingCanvas.tsx:157` serializes with `serializeAsJSON(..., "local")`, which runs the **export**
storage profile: `scrollX`, `scrollY`, `zoom`, `theme`, and all `currentItem*` tool/colour prefs
are `export: false` (`dist/dev/chunk-4FTI6OG3.js`, `APP_STATE_STORAGE_CONF`). `loadInitialData`
(`DrawingCanvas.tsx:139-144`) therefore restores elements at their absolute coordinates but resets
the viewport to (0,0)/zoom 1, with no `scrollToContent`. A user who panned away and drew there
re-opens the panel to a **blank-looking canvas** — indistinguishable from data loss (this is the
"initialData null → canvas trắng" symptom, but it happens even when data exists). The last-used
tool/colour also reset every toggle.
**Fix where**: `DrawingCanvas.tsx:139-144` — return `{ ..., scrollToContent: true }`, or persist
`scrollX/scrollY/zoom` alongside the scene and re-inject them into `appState`.

### 6. BUG — HUD chrome floats *above* the panel and eats strokes
`.hud-drawing-panel` declares no `z-index` (`src/styles/hud.css:616-630`) while `.hud-chrome`
is `z-index: 2` (`src/styles/hud.css:83-84`). The panel occupies `top 8vh / left 8vw /
84vw × 84vh`; the chrome islands sit inside that rect: `.hud-left` at `left 22px; bottom 24px;
width 300px` (`hud.css:251+`, grows upward with comms + camera), `.hud-orb-cluster` at
`right 26px; bottom 24px` with a 190 px orb (`hud.css:88+`), `.hud-right` at `top 18px; right 18px`
(`hud.css:224+`). All are `.hud-hit` → `pointer-events: auto`, so they visually cover the canvas
and swallow pointer input over their area (bottom-left/bottom-right corners of the drawing
surface, exactly where excalidraw also puts its zoom/undo footer).
**Fix where**: `src/styles/hud.css:616` — give the panel its own stacking (`z-index: 3`) or inset
the panel away from the chrome islands; if chrome must stay reachable, shrink the panel instead
of overlapping it.

### 7. BUG — No error boundary around the lazy excalidraw chunk
`DrawingCanvas.tsx:23-28,199-210` wraps the lazy import in `Suspense` only. A chunk-load or
excalidraw init failure (missing `excalidraw-assets`, packaging slip) throws during render with no
boundary anywhere up to `HudShell.tsx:607` → React unmounts the whole tree = blank HUD, and the
user is stuck in a click-through-disabled fullscreen overlay. `VaultGalaxy` explicitly has its own
error boundary + Esc force-close (`src/App.tsx:815-825`, `HudShell.tsx:608-620` props
`onForceClose`) — the drawing panel has neither.
**Fix where**: `src/components/DrawingCanvas.tsx` / `HudShell.tsx:607` — wrap in an error boundary
that force-closes the panel, and add an Esc handler in `App.tsx` mirroring lines 819-825.

### 8. BUG/UX-GAP — Keyboard focus is grabbed once at mount and never restored or re-taken
`DrawingCanvas.tsx:78-80` → `canvas:activate` → `getMainWindow()?.focus()`
(`capabilities/canvas.mjs:135-145`). There is (a) no re-focus when the user clicks back into the
panel after switching apps — a transparent always-on-top window often takes the click without
taking key focus, after which the text tool/Delete/shortcuts are silently dead (spec.md:54-61
promises they work), and (b) no focus restoration to the previously focused app when the panel
closes — `window.mjs:244-257` only refocuses on full HUD exit, not on panel toggle-off.
**Fix where**: `DrawingCanvas.tsx` — call `activateDrawingCanvas()` on `pointerdown` in the panel
too; `capabilities/canvas.mjs:135-145` — remember/blur back (e.g. `win.blur()` on a new
`canvas:deactivate`) so the underlying app regains keys.

### 9. BUG (probable) — The native Open/Save/PNG/SVG strip is unreachable dead code
`DrawingCanvas.tsx:69` feature-detects with `"showOpenFilePicker" in window` **once**, presence-only.
`file://` is a secure context in Chromium and Electron implements the File System Access API, so the
property exists in both dev (`http://127.0.0.1:5173`) and prod (`window.mjs:128` `loadFile` →
`file://`) — the strip (`DrawingCanvas.tsx:211-226`) then never renders, even if excalidraw's own
save/export path throws at call time. So the D5a fallback the spec mandates ("If the browser File
System Access path is unavailable … the app SHALL fall back to a native file dialog", `spec.md:84`)
is never exercised, and combined with finding #2 (dialogs unclickable) the user has **no** working
save/export route in the packaged app.
**Fix where**: `DrawingCanvas.tsx:69,211-226` — either always render the strip (it is 4 small
buttons), or drive it from a real failure (catch excalidraw's save/export rejection and fall back),
not from a capability sniff.

---

## P2

### 10. BUG — `sceneSignature` echo guard never resets and can swallow a real edit
`DrawingCanvas.tsx:72,146-155`: `lastAppliedSignatureRef` is set on every `canvas:apply` and is
**never cleared**. Any later scene whose non-deleted `(id:version:versionNonce)` set matches it is
dropped forever — most plausibly after the user edits and then Cmd+Z's back to the applied state
(undo restores versions/nonces from history), leaving main's cache permanently behind the canvas.
The signature also ignores `appState` and `files`, so a pure image-embed (`files`) change that
doesn't touch element versions is not distinguishable. `DrawingCanvas.echo.test.ts:21-52` covers
only the "immediately after apply" cases, not the undo-return case.
**Fix where**: `DrawingCanvas.tsx:146-155` — clear `lastAppliedSignatureRef.current = null` right
after the first non-matching onChange (one-echo lifetime), and add the undo-return case to
`DrawingCanvas.echo.test.ts`.

### 11. BUG — An apply that arrives during the lazy-load window is silently dropped from the canvas
`DrawingCanvas.tsx:88-89` returns early when `excalidrawModule`/`apiRef` are not ready. Main's
cache still gets the write (`canvas-mcp.mjs:390`), so the canvas and the cache diverge until the
next toggle. No log, no retry.
**Fix where**: `DrawingCanvas.tsx:87-99` — queue the pending payload and apply it once
`excalidrawAPI` lands, or re-read `canvas:get-scene` after mount completes.

### 12. BUG — Native Open/Save/Export have no error handling and block the main process
`DrawingCanvas.tsx:170-177`: `JSON.parse(result.content)` on an arbitrary file → unhandled promise
rejection and no user-visible message on a malformed `.excalidraw`. `handleNativeOpen` also calls
`updateScene` + `addFiles` without pushing the scene explicitly (relies on onChange).
`capabilities/canvas.mjs:183,197,213-214` use `fs.readFileSync` / `fs.writeFileSync` on the main
process — synchronous disk I/O on the event loop, inconsistent with the async-atomic rule the same
feature applies to persistence (`spec.md:115-118`, `canvas-store.mjs:65-75`).
**Fix where**: `DrawingCanvas.tsx:170-197` — try/catch with a toast; `capabilities/canvas.mjs:174-217`
— `fs.promises` (+ `writeFileAtomicAsync` for save).

### 13. BUG — Oversize scenes stop persisting silently, and a failed write is swallowed
`canvas-store.mjs:47-54`: past 8 MB the disk write is skipped with no log/emit, so a user embedding
images keeps drawing and loses everything on restart with no warning. `canvas-store.mjs:57-62,65-75`:
`pendingJson` is nulled before the await and `flush()`'s rejection is discarded, so a failed write
drops that revision entirely. `setScene` also `JSON.stringify`s the whole scene on the main thread
every ~500 ms while drawing.
**Fix where**: `electron/canvas-store.mjs:47-63` — emit a warning through the capability's `log`
when the cap trips, restore `pendingJson` on write failure, and consider stringifying only at
flush time.

### 14. UX-GAP — The panel cannot be moved, resized, or dismissed with the keyboard
Fixed `8vh/8vw/84vw/84vh` (`src/styles/hud.css:616-621`), `overflow: hidden` (`hud.css:623`) which
clips any excalidraw popover reaching past the panel edge, no drag handle, no resize grip, no close
button on the panel itself, and no Esc-to-close (the galaxy has one, `src/App.tsx:819-825`). The only
way out is the hover-revealed orb-cluster toggle (`hud.css:158-168`, `HudShell.tsx:567-573`) — an
invisible control the user must know about, sitting on top of the canvas (finding #6).
**Fix where**: `src/styles/hud.css:616-630` + `HudShell.tsx:607` — add an Esc handler and a visible
close/drag affordance on the panel header; make the size a state (or at minimum stop clipping
popovers).

### 15. UX-GAP — Claude's writes are outside the undo stack
`DrawingCanvas.tsx:92-97` uses `CaptureUpdateAction.NEVER` deliberately, so a Claude drawing cannot
be undone with Cmd+Z, and a Cmd+Z after it undoes the user's *previous* action instead — which,
combined with #4, can compound the data loss. Spec is silent.
**Fix where**: `DrawingCanvas.tsx:92-97` — consider `IMMEDIATELY` for tool writes (they are the
user's intent, expressed by voice), or offer an explicit "undo Iris's change".

### 16. UX-GAP — "Loading canvas…" flash and no progress on first activation
`DrawingCanvas.tsx:201` shows an uppercase mono placeholder while a 500 KB+ chunk plus fonts load
(`hud.css:637-647`). It appears only on the first activation per app run (the module is cached), but
that first one is the impression-forming one and there is no spinner/skeleton of the panel chrome.
`initialData` resolves separately afterwards, so there is a second brief empty-canvas frame.
**Fix where**: `DrawingCanvas.tsx:199-210` — prefetch the chunk when the HUD is entered, or render a
canvas-shaped skeleton instead of a text line.

### 17. UX-GAP — Fallback strip overlaps excalidraw's own top-right UI
`DrawingCanvas.tsx:211-226` + `hud.css:649-656` pin the strip at `top: 10px; right: 10px; z-index: 1`
— exactly where excalidraw puts its Library/top-right controls. Also un-labelled ("PNG"/"SVG"), not
`[data-no-dwell]`, and unreachable by hand-dwell since the dwell loop suppresses non-chrome points
while the panel is active (`src/App.tsx:1460`).
**Fix where**: `src/styles/hud.css:649-656` — move it to a panel header row of its own.

### 18. UX-GAP — `theme="dark"` is hard-coded and overrides the restored appState
`DrawingCanvas.tsx:208` passes a controlled `theme`, so the user's theme choice inside excalidraw
cannot stick and is re-forced on every mount.
**Fix where**: `DrawingCanvas.tsx:208` — persist theme in the scene's appState and pass it through.

### 19. UX-GAP / test gap — toggle-off→toggle-on ordering is unverified
Unmount pushes over `ipcRenderer.send` (`preload.cjs` `saveCanvasScene`) while remount reads over
`ipcRenderer.invoke` (`getCanvasScene`) — different IPC paths. If the read ever wins the race the
panel reloads a stale scene and its first onChange writes that stale scene back over main's cache
(`DrawingCanvas.tsx:139-144,156-167`). The only renderer-side test is `DrawingCanvas.echo.test.ts`
(pure `sceneSignature`); nothing exercises mount/unmount, flush, or the toggle cycle.
**Fix where**: make the unmount flush an `invoke` (awaitable) and add a store-level test in
`electron/canvas-store.test.mjs` for "push then immediately read".

---

## Cross-cutting note on the spec

`spec.md:9` (bounded region, glass outside stays click-through) and `spec.md:37` (window stays
interactive for the whole panel lifetime) cannot both hold with one window-level
`setIgnoreMouseEvents` flag. Whatever fix is chosen for finding #1, the spec needs an OpenSpec change
so the two requirements stop contradicting each other.
