## 1. Dependency + offline assets

- [x] 1.1 Add `@excalidraw/excalidraw` (MIT) to `package.json` **exact-pinned** (no `^`); `npm ci`. Add the version to README's exact-identifier table.
- [x] 1.2 Vendor excalidraw's fonts/split assets into `public/` and set `window.EXCALIDRAW_ASSET_PATH` to the app-relative local path so they resolve under `file://` (mirror the mic-worklet file:// precedent). Confirm the exact asset subpath for the pinned version.

## 2. DrawingCanvas component

- [x] 2.1 Create `src/components/DrawingCanvas.tsx`: lazy-import `<Excalidraw>` + its `index.css`; render inside a **bounded** panel container with class `.hud-hit`.
- [x] 2.2 Verify the pinned excalidraw's portal API: if a portal-container prop contains all menus/pickers inside the `.hud-hit` root, use it; otherwise add the excalidraw portal root to the `App.tsx` `.hud-hit` selector list (~392–394).
- [x] 2.3 Load `initialData` via `canvas:get-scene` (through excalidraw `restore`/`loadFromBlob`) on mount; on `onChange`, serialize with official `serializeAsJSON(elements, appState, files, "local")` and push to main via `canvas:scene`, coarse-debounced.
- [x] 2.4 Keep excalidraw's built-in Open / Save-to-file / Export-image menu (do NOT strip them via `UIOptions`). Verify under `file://`; if the File System Access path is unavailable, wire a native Electron `dialog.showOpenDialog`/`showSaveDialog` fallback (main-side IPC) feeding `loadFromBlob` / `serializeAsJSON` / `exportToBlob`. Opening a file replaces the scene and is then auto-persisted.

## 3. HUD wiring (App.tsx / HudShell)

- [x] 3.1 Add `drawingActive` state (default `false`) in `App.tsx`; pass it + a toggle handler into `HudShell`; unmount `DrawingCanvas` when `!drawingActive`; define exit-HUD semantics (drawing panel hides on HUD exit).
- [x] 3.2 In `HudShell.tsx`, add the drawing toggle as one more `hud-btn` icon (lucide `PenTool`, with `active` styling when on) in the existing bottom-right `.hud-controls` row (~322–358, next to hand-control/exit) so it inherits the hover-reveal behavior; render the bounded `<DrawingCanvas>` when active; style the panel in `hud.css` (opaque/semi-opaque surface, bounded size/position).
- [x] 3.3 **Latch interactivity**: on activate, report `hud:interactive(true)` and keep it while `drawingActive` (do not re-decide per pointermove); on deactivate, restore the normal per-pointermove hit-test. Flush the pending `canvas:scene` push on unmount.

## 4. Keyboard focus (main)

- [x] 4.1 On drawing activation, have main bring the HUD window to keyboard focus (`mainWindow.focus()` / ensure focusable) so text tool / Delete / shortcuts reach excalidraw.

## 5. Main: cache, async atomic persist, seam, flush-on-quit

- [x] 5.1 Add an **async** atomic write to `electron/atomic-file.mjs` (temp file + `fs.promises.rename`).
- [x] 5.2 In `main.mjs`, add a scene cache; `ipcMain.on("canvas:scene", …)` updates the in-memory cache **immediately** (so the seam stays fresh) and persists to `~/.iris/canvas.json` **coarse-debounced, async atomic**, with a size/image guard; `ipcMain.handle("canvas:get-scene", …)` returns the cache (loading from disk on first call if empty). Cache stores the full excalidraw JSON as received.
- [x] 5.3 Flush the pending persist in the `app-shutdown` teardown path so a quit-while-drawing doesn't lose recent strokes.
- [x] 5.4 In `electron/preload.cjs`, expose `saveCanvasScene(scene)` (`ipcRenderer.send("canvas:scene", …)`) and `getCanvasScene()` (`ipcRenderer.invoke("canvas:get-scene")`).

## 6. Tests

- [x] 6.1 Vitest unit tests (node harness, per `test-harness`) for the main-side seam: `get-scene` returns the last pushed scene while unmounted; loads from disk on first call; the size guard rejects/trims oversized scenes; the async atomic write replaces the file. Keep assertions on the pure cache/persist logic (no Web Audio / renderer).

## 7. Verify

- [x] 7.1 `npm run build` (tsc --noEmit + vite build) and `npm test` pass.
- [x] 7.2 Manual (dev): enter HUD → toggle drawing → bounded panel draws; menus/color picker clickable; text tool + Delete + shortcuts work; glass outside the panel stays click-through; fast drag / marquee crossing the edge and wheel-zoom don't drop mid-gesture; toggle off → click-through restored; draw/toggle/restart → persists; deck shows no canvas.
- [x] 7.3 Manual (**packaged/offline**, `start:prod` or `package:mac`): fonts/assets load with no network; verify `EXCALIDRAW_ASSET_PATH` resolution and lazy chunk + CSS under `file://`; verify Open `.excalidraw` / Save-to-file / Export PNG/SVG work (built-in or native fallback).
- [x] 7.4 Confirm `~/.iris/canvas.json` is written atomically/async and reloaded; `canvas:get-scene` returns the current scene while the panel is hidden; quit-while-drawing preserves the scene.
- [x] 7.5 `openspec validate hud-drawing-canvas` passes (includes the `glass-hud-mode` MODIFIED delta).
