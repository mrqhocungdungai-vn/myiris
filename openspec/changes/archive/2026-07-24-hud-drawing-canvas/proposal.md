## Why

Iris has no drawing surface. The user wants a canvas to sketch diagrams and — later — have Claude read and improve them (a separate change). This first change delivers the canvas itself: a toggleable whiteboard panel inside the Glass HUD, usable on its own, and it establishes the scene-access seam the Claude/MCP integration will consume next.

## What Changes

- Embed **`@excalidraw/excalidraw` (MIT, exact-pinned)** as a drawing **panel** in the renderer, rendered **only in Glass HUD mode**. The panel is **bounded** (not a full-screen takeover) so glass outside it stays click-through and the user can keep using other desktop apps.
- Add a **toggle** (a `.hud-hit` button in the HUD control cluster) that shows/hides the drawing panel. **Hidden by default**; shown → the panel becomes an interactive drawing surface.
- Integrate with the HUD click-through mechanism: while the panel is active its region is pointer-interactive via the existing `.hud-hit` / `hud:interactive` → `setIgnoreMouseEvents` path, and interactivity is **latched for the duration of `drawingActive`** (not re-decided per pointermove) so fast drags / marquee-select / wheel-zoom don't drop mid-gesture.
- Ensure the overlay window takes **keyboard focus** when the panel activates so excalidraw's text tool and shortcuts work in the transparent always-on-top window.
- Bundle excalidraw's fonts/assets locally and set `window.EXCALIDRAW_ASSET_PATH` so they resolve under `file://` in packaged builds (offline-first).
- **Persist the scene** (via excalidraw's official `serializeAsJSON`) to `~/.iris/canvas.json` with an **async atomic write** on the main side, debounced, with an image/size guard; restore via `restore`/`loadFromBlob` on mount — so the working board is never lost and never redrawn from scratch.
- Keep excalidraw's **built-in Open / Save-to-file / Export-image** menu so the user can load/save named `.excalidraw` files and export PNG/SVG like the web app; verify it works under `file://` and add a **native Electron dialog fallback** if the browser File System Access path is unavailable in that context.
- Expose a **scene-access seam**: renderer pushes the scene to main (`canvas:scene`), main caches it and serves it over `canvas:get-scene` — the hook the next change's canvas MCP reads. Flushed on unmount and on quit.
- The canvas works **without Claude** (a plain whiteboard). AI reading/drawing is out of scope here — it lands in `canvas-claude-mcp`.

## Capabilities

### New Capabilities
- `hud-drawing-canvas`: A toggleable excalidraw drawing panel inside Glass HUD mode — its visibility toggle, bounded region, latched pointer-interactivity, keyboard focus, offline asset loading, scene persistence, and the main-cached IPC scene-access seam.

### Modified Capabilities
- `glass-hud-mode`: The "HUD layout and deck transitions" requirement adds the drawing toggle to the HUD control cluster (the enumeration of HUD controls changes). No change to the click-through mechanism requirement itself.

## Impact

- **`package.json`** — add `@excalidraw/excalidraw` (MIT), **exact-pinned**; document in README's exact-identifier table.
- **`public/`** — vendor excalidraw's fonts/assets so `EXCALIDRAW_ASSET_PATH` resolves under `file://` (mirrors the mic-worklet `public/` file:// fallback).
- **`src/components/DrawingCanvas.tsx`** (new) — lazy-loaded `<Excalidraw>` wrapper; official serialize/restore; bounded panel; portal container inside the `.hud-hit` root.
- **`src/components/HudShell.tsx`** — `.hud-hit` toggle button + the panel (HUD only).
- **`src/App.tsx`** — `drawingActive` state; latch `hud:interactive` while active; request keyboard focus on activate; flush pending push on unmount.
- **`electron/preload.cjs`** — `saveCanvasScene` / `getCanvasScene` channels.
- **`electron/main.mjs`** — scene cache; `canvas:scene` (async atomic persist to `~/.iris/canvas.json`, debounced, size-guarded) and `canvas:get-scene`; focus the HUD window on drawing activation; flush on quit (via the `app-shutdown` teardown path).
- **`electron/atomic-file.mjs`** — add an async atomic write (temp + `fs.promises.rename`) since only a sync variant exists today.
- Living spec `glass-hud-mode` gets a MODIFIED delta. `pipeline-availability` is untouched (whiteboard is not Claude-gated). `main-thread-budget` and `app-shutdown` are respected (async persist, flush on quit) but not modified.
