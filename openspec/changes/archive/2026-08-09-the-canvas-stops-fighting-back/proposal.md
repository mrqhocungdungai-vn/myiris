## Why

Two audits over the drawing panel and the realtime channel found 43 defects.
They are not 43 independent mistakes. They are four:

**The panel takes the whole screen hostage.** Activating it latches
`setHudInteractive(true)` for its entire lifetime (`App.tsx:780-785`), which is
`setIgnoreMouseEvents(false)` on a window sized to the full display
(`ipc.mjs:173-178`, `window.mjs:233`). `pointer-events: none` on the page means
the click hits nothing — it does **not** hand the click to the app underneath.
So while the user is drawing, every click anywhere on their desktop goes into a
transparent window and dies. The living spec asks for both things at once:
glass outside the panel stays click-through (`spec.md:9,15-17`) *and* the window
stays interactive for the whole duration (`spec.md:37`). One window-wide boolean
cannot do both, so today the second wins silently and the first is simply false.

**Excalidraw's own dialogs are dead.** Its modals portal into `document.body`
(`.excalidraw-modal-container`), which is `pointer-events: none` in HUD mode
(`hud.css:13-24`). Export image, Save to…, the command palette — they render,
and nothing in them can be clicked. The very affordances the spec promises
(`spec.md:44-47,82-99`). `App.tsx:797` already names that class, in the branch
that only runs while the panel is closed: the failure was seen once and fixed on
the wrong side.

**Two writers overwrite each other's work.** The renderer pushes the *whole*
scene 500 ms after an edit; Claude's MCP tools read-modify-write the *whole*
scene from main's cache. Neither carries a revision. A stroke drawn inside the
debounce window is invisible to Claude's read and is erased from the live canvas
by the apply (`DrawingCanvas.tsx:87-98,146-168`, `canvas-mcp.mjs:389-426`) —
and because the apply is `captureUpdate: NEVER`, the user cannot undo the loss.
The reverse also holds: the late push deletes what Claude just drew. The spec
says last-writer-wins *per element* (`canvas-claude-mcp/spec.md:49`); what is
implemented is one stale push deleting an entire write.

**What happens is not what the user is told.** A run whose question timed out is
announced as "applied the recommended option" even on the DENY branch
(`App.tsx:1288-1290` vs `run-stream.mjs:118-136`) — a direct violation of
`voice-decision-relay/spec.md:57-60`. A Live reconnect swallows the microphone
for up to ~30 s while the caption still reads "Listening…"
(`live-session.mjs:339-405`). Claude draws off-screen and nothing scrolls, so a
successful write looks like nothing happened. An oversized scene is never
persisted and the tool still reports `applied`.

## What Changes

**Click-through becomes bounded by the panel, and latching becomes bounded by a
gesture.** Interactivity is resolved per pointer position against the panel rect
as before, but once a pointer goes down inside the panel it is *latched until
that gesture ends* — which is what the mid-drag requirement actually needed. The
desktop outside the panel stays clickable while the panel is open. The
conflicting sentence in the living spec is rewritten rather than left to be
resolved by accident.

**Portalled excalidraw UI is interactive.** `.excalidraw-modal-container` and
the eye-dropper backdrop join the pointer-events allow-list, and the panel gets
its own stacking context so HUD chrome stops floating over the canvas and eating
strokes.

**The scene carries a revision, and neither writer clobbers the other.** The
store stamps a monotonic revision on every write; the renderer sends the
revision its push was based on; main merges by element id instead of accepting a
stale whole-scene replace. Claude's writes land as a distinct undo step, so
"undo what Iris just drew" is a thing the user can do.

**The panel stops looking empty when it is not.** The viewport is restored with
the scene (or scrolled to content), so reopening never presents a blank canvas
holding a full drawing. A write from Claude scrolls its new elements into view
and says so.

**Silence becomes speech.** A degraded image export, an unpersisted oversized
scene, a Live reconnect, and an exhausted reconnect budget each produce a
user-visible state instead of a log line the user will never see. The timed-out
question relay reports the branch that actually ran.

**Nothing is lost on the way out.** Pending strokes flush on `pagehide`, not
only on React unmount, so quitting and reloading stop costing the last half
second of drawing.

## Impact

- Specs: `hud-drawing-canvas` (MODIFIED), `canvas-claude-mcp` (MODIFIED)
- Renderer: `src/components/DrawingCanvas.tsx`, `src/App.tsx`, `src/styles/hud.css`
- Main: `electron/canvas-store.mjs`, `electron/capabilities/canvas.mjs`, `electron/canvas-mcp.mjs`, `electron/ipc.mjs`
- Evidence: `.audit/drawing-audit.md` (19 findings), `.audit/realtime-audit.md` (24 findings)
