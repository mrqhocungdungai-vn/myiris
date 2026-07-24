## Context

Iris's Glass HUD (`glass-hud-mode`) is a transparent, frameless, always-on-top, click-through fullscreen overlay: `main.mjs` sets `transparent`, `frame:false`, `setAlwaysOnTop(true,"screen-saver")` and `setIgnoreMouseEvents(true,{forward:true})` on HUD enter (~3061–3078); the renderer loads via `loadFile(dist/index.html)` (file://, ~3043). `App.tsx` (pointermove handler ~378–407) hit-tests `elementFromPoint` against a fixed `.hud-hit` selector list and reports presence via `hud:interactive`, and main toggles `setIgnoreMouseEvents` (~3247). `vite.config.ts` uses `base:"./"` for file:// asset resolution; `atomic-file.mjs` has a **sync-only** `writeFileAtomicSync`; `~/.iris` writers already use it (main.mjs ~451,1070). This change adds a bounded excalidraw drawing panel toggled inside the HUD, reusing that click-through path, and lays a main-cached scene seam for `canvas-claude-mcp`. AI/MCP is out of scope.

## Goals / Non-Goals

**Goals:** a usable bounded excalidraw whiteboard toggled inside HUD (hidden by default); correct pointer + keyboard behavior in the transparent overlay; offline asset loading under file://; scene persisted deterministically without janking audio; a main-cached scene seam for the next change.

**Goals (cont.):** keep excalidraw's built-in local **Open / Save-to-file / Export-image** so the board isn't a one-off (in addition to the auto-persisted working board).

**Non-Goals:** Claude/MCP/AI (→ `canvas-claude-mcp`); hand-gesture drawing (future); a global hotkey (deferred — not in this change); drawing in deck; collaboration/multi-page document management (only single-file open/save + image export, as the web app ships).

## Decisions

### D1 — `@excalidraw/excalidraw` (MIT), exact-pinned, lazy-loaded, assets vendored for file://
Excalidraw is the only MIT + embeddable option. **Pin the exact version** (asset path and `appState` schema are version-coupled — CLAUDE.md/README treat load-bearing deps as exact pins) and add it to README's exact-identifier table. Load it via `React.lazy`/dynamic import (only on first activation) to keep HUD/deck startup light given the Vite chunk-size warning. **Offline assets:** excalidraw resolves fonts/split assets from a public path that defaults to a CDN in production; Iris is offline-first and runs from file://. So **vendor excalidraw's assets into `public/`** and set `window.EXCALIDRAW_ASSET_PATH` to the app-relative local path (the same class of file:// footgun the mic worklet documents at `useAudioPipeline.ts:105–113`). This MUST be verified in a packaged/offline build, not just dev.

### D2 — Bounded panel, rendered only in HUD, gated on `drawingActive`
`App.tsx` holds `drawingActive` (default `false`). `HudShell` renders `<DrawingCanvas>` only when `uiMode==="hud" && drawingActive`, as a **bounded panel** (not full-screen) so glass outside it stays click-through — this is load-bearing for the "keep using other apps" goal. The toggle is one more `hud-btn` icon (lucide `PenTool`) in the existing **bottom-right orb `.hud-controls` row** (HudShell ~322–358), next to the hand-control and exit buttons. That row is `opacity:0` at rest and only appears on orb hover / focus-within (`hud.css` ~122–135), so the drawing affordance is doubly out of the way: the control row is hover-revealed, and the panel itself is toggle-gated off by default — matching "drawing is only needed occasionally, for brainstorming with AI."

### D3 — Latched interactivity + verified popover containment
Per-pointermove flipping of `setIgnoreMouseEvents` (App.tsx ~386–400, rAF-throttled) races with excalidraw gestures: a fast drag / marquee / wheel-zoom crossing the panel edge, or the first mousedown during the one-frame IPC latency, can drop the pointer stream. So **latch the window interactive for the whole time `drawingActive` is true** (report `hud:interactive(true)` on activate, restore per-pointermove hit-testing on deactivate) rather than re-deciding each move. Popovers: excalidraw menus/pickers may portal to `document.body`, outside the `.hud-hit` panel → click-through. **Pin the version and verify the actual portal API**; if a portal-container prop covers all popovers, use it; otherwise the **primary** fix is adding the excalidraw portal root to the App.tsx `.hud-hit` selector list (~392–394). (With interactivity latched while active, popover containment is less fragile, but still required for the deactivated-edge cases.)

### D4 — Keyboard focus for the transparent overlay
The HUD window is transparent/frameless/always-on-top and click-through; on macOS such a panel commonly does not receive key events. On drawing activation the main process SHALL bring the window to keyboard focus (`mainWindow.focus()` / ensure `focusable`, and disable ignore-mouse over the panel via D3's latch). Verify text tool, Delete, and shortcut keys reach excalidraw.

### D5 — Scene flow: official serializer, main cache, async atomic persist
Excalidraw's `onChange(elements, appState, files)` is the source of truth. Serialize with excalidraw's **official `serializeAsJSON(elements, appState, files, "local")`** — the canonical `.excalidraw` schema `{ type:"excalidraw", version, source, elements[], appState(subset), files }` (raw `appState` holds non-serializable/transient fields — `collaborators` Map, viewport, active tool — so hand-rolling is unsafe); restore with `restore`/`loadFromBlob`. **This one format is what auto-persist, Save-to-file, and the MCP seam all use — no trimmed variant — so the next change reads full-fidelity `elements` (shape types, geometry, text, and arrow `startBinding`/`endBinding` connectivity) plus embedded `files`.** The renderer pushes the serialized scene to main (`canvas:scene`); main holds it as the authoritative cache and persists to `~/.iris/canvas.json`. On mount `DrawingCanvas` loads via `canvas:get-scene`. Main's cache **is** the seam the next change reads — no main→renderer round-trip, and it works while the panel is unmounted.
- **Eager cache, debounced disk:** main updates the in-memory cache **immediately** on each `canvas:scene` push, and only the `~/.iris/canvas.json` disk write is coarse-debounced. This keeps the MCP seam (`canvas:get-scene`) genuinely fresh-on-call (never 1–2 s behind a debounce) while keeping disk I/O off the hot path.
- **Async atomic write:** add an async atomic helper (temp + `fs.promises.rename`) to `atomic-file.mjs`; the sync `writeFileAtomicSync` would block the main event loop, and excalidraw `files` embed images as dataURLs so the JSON can be multi-MB — a sync write on every debounce would jank the 24 kHz audio IPC (`main-thread-budget`). Persist off the hot path, coarse debounce.
- **Size guard:** cap embedded-image bytes / element count (or drop/skip persisting oversized `files`) so the file and IPC payload stay bounded.
- **Flush:** flush the pending debounced push on panel unmount and hook the `app-shutdown` teardown ("Quit blocks until teardown completes") so a quit-while-drawing doesn't lose recent strokes.

### D5a — Two distinct persistence layers: auto-persist board + explicit file open/save/export
These are separate and both kept:
- **Auto-persist working board** (D5): implicit, single `~/.iris/canvas.json`, always restored — the answer to "don't make me redraw from scratch."
- **Explicit local files** (like the web app): keep excalidraw's **built-in menu** (Open `.excalidraw`, Save/Save-as to a named file, Export PNG/SVG) by NOT stripping those items via `UIOptions`. Excalidraw implements these through the Chromium File System Access API, which is available in Electron; but under `file://` some FS Access features can be gated, so **verify in a packaged/offline build** and, if the picker path is unavailable, wire a **native Electron `dialog.showOpenDialog`/`showSaveDialog`** fallback (main-side IPC) feeding excalidraw's `loadFromBlob` / `serializeAsJSON` / `exportToBlob`. Opening a file replaces the scene and is then auto-persisted like any edit.

### D6 — No Claude gating
The whiteboard renders regardless of `pipelineAvailable`; `pipeline-availability` untouched. Claude gating applies only to the MCP features in the next change.

### D7 — glass-hud-mode MODIFIED
Adding a persistent drawing toggle changes the enumerated HUD control cluster, so the `glass-hud-mode` "HUD layout and deck transitions" requirement gets a MODIFIED delta (full text + a scenario). The click-through mechanism requirement is unchanged.

## Risks / Trade-offs

- **Assets fail under file://** → vendor into `public/` + `EXCALIDRAW_ASSET_PATH`; verify packaged/offline (D1, L4).
- **Popovers portal to body → click-through** → version-verify portal API; fallback selector entry (D3).
- **Large scenes (embedded images) jank audio / bloat IPC & disk** → async atomic write + size guard + coarse debounce (D5).
- **Keyboard not delivered to overlay** → explicit focus on activate (D4).
- **File System Access API gated under file://** (built-in Open/Save/Export fails) → verify in packaged/offline build; native Electron dialog fallback (D5a).
- **CSP (future):** none exists today (no meta, no `onHeadersReceived`); if one is added it must allow `style-src 'unsafe-inline'`, `worker-src blob:`, `font-src` for the local asset path, and `img-src data:` — recorded so a future hardening doesn't silently break excalidraw.

## Migration Plan

Additive; no data migration. Rollback = remove the dependency, the panel, and the async atomic helper addition; HUD click-through and deck are unchanged. The `canvas:scene`/`canvas:get-scene` seam is inert until `canvas-claude-mcp` consumes it.
