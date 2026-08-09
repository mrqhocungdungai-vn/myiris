# AI-written canvas content disappears when the panel is closed — root cause

Date: audit run after `the-canvas-stops-fighting-back` was implemented + archived.
Repro scripts (temporary, /tmp only): `/tmp/iris-repro/e2e.mjs` (real capability + real store +
real MCP server over HTTP), `/tmp/iris-repro/restore.test.mjs` + `/tmp/iris-repro/vitest.repro.mjs`
(jsdom, real `@excalidraw/excalidraw@0.18.1`).
No product code was modified.

## Verdict

**Root cause (dominant, reproduced): the renderer pushes a scene snapshot that pre-dates Claude's
write, but stamps it with the revision the *apply* just taught it — so main sees a "fresh" push and
replaces the cache wholesale, deleting every element Claude wrote.**

`src/components/DrawingCanvas.tsx`
- `:281`  `applyIncoming` → `revisionRef.current = payload.revision` (adopts the AI write's revision)
- `:461`  `handleChange` → `pendingSnapshotRef.current = { elements, appState, files }` (a snapshot of
  the scene as it was *before* the apply; excalidraw hands a fresh array per change, so it is a frozen
  pre-AI state)
- `:455-456` the echo guard `return`s **before** `:461`, so the `onChange` that excalidraw fires for
  our own `updateScene` never refreshes the pending snapshot with the AI elements
- `:363`  `pushScene` → `baseRevision: revisionRef.current` — the *current* revision, not the revision
  the snapshot was derived from

`electron/capabilities/canvas.mjs:198-206` then computes
`stale = baseRevision < current` → `false` → `setScene(scene)` **replaces the cache wholesale**;
`commitWrite`/`teardown` flush it to `~/.myiris/canvas.json`. The AI elements are gone from cache and
disk while still painted on screen — closing the panel (or reopening it) is simply when the user finds
out.

This breaks the invariant the archived change wrote down:
`openspec/specs/hud-drawing-canvas/spec.md:63` — "a push SHALL declare the revision **it was derived
from**". Today it declares the newest revision it has *seen*.

### Reproduction (real handler + real store + real MCP, no mocks)

`node /tmp/iris-repro/e2e.mjs`:

```
=== A: user stroke -> AI add -> close (no pending push)
tool: {"results":[{"id":"ai1","status":"applied"}],"persisted":true,"revision":2}
cache: [ 'u1', 'ai1' ] disk: [ 'u1', 'ai1' ]            <-- survives

=== B: debounce race (pending snapshot pre-dates the apply)
  after AI -> revisionRef: 2 cache: [ 'u1', 'ai1' ]
  cache: [ 'u1', 'u2' ]
  disk : [ 'u1', 'u2' ]                                  <-- 'ai1' DESTROYED

=== B2: same race, but the push declares the revision the SNAPSHOT was derived from (proposed fix)
  cache: [ 'u1', 'u2', 'ai1' ]
  disk : [ 'u1', 'u2', 'ai1' ]                           <-- fixed
```

B is exactly the reported symptom: mouse work (`u1`,`u2`) survives — it *is* the stale snapshot —
and everything Claude added is wiped.

### Why the window is not as narrow as "500 ms of drawing"

Excalidraw calls `onChange` from `componentDidUpdate`
(`node_modules/@excalidraw/excalidraw/dist/dev/index.js`, `this.props.onChange?.(elements, this.state,
this.files)` inside `componentDidUpdate`), i.e. on *any* state change — hover, selection, cursor,
scroll, zoom — not only element edits. So merely having the pointer over the canvas while Iris draws
arms `pushTimerRef` and captures a pre-AI snapshot. And one such push replaces the whole scene, so a
single hit anywhere in the session erases *all* AI elements written so far, which is why the user sees
it as "AI content always disappears". Timer throttling on an unfocused/occluded HUD window widens the
window further.

## Hypotheses that were tested and FALSIFIED

- **H1 (builder misses fields excalidraw requires)** — false. `/tmp/iris-repro/restore.test.mjs` runs
  the real `restore()` and `serializeAsJSON()` from `@excalidraw/excalidraw@0.18.1` over a scene built
  by `applyAddElements` (rectangle, ellipse, text, bound arrow): all 4 ids survive `restore()`
  (`isDeleted=false`, `index` kept, `boundElements` back-linked) and `serializeAsJSON` keeps them.
  The golden test `electron/canvas-mcp.golden.test.mjs` is still accurate.
- **H2 (`restore()` in `loadInitialData` drops them)** — false, same evidence: nothing is dropped at
  `src/components/DrawingCanvas.tsx:413`.
- **H5 (quit path loses the flush)** — false: `createCanvasCapability(...).teardown()`
  (`electron/capabilities/canvas.mjs:288`) flushes, and every MCP write already awaits `flush()`
  (`electron/canvas-mcp.mjs` `commitWrite`). Scenario A above proves the write is on disk.

## Contributing causes, ranked

1. **(dominant, above)** push declares "newest revision seen" instead of "revision the snapshot was
   derived from" — `DrawingCanvas.tsx:281` + `:363`.
2. **The echo guard never refreshes the pending snapshot.** `DrawingCanvas.tsx:450-461`: the
   `onChange` produced by our own `updateScene` returns early, so `pendingSnapshotRef` keeps holding a
   state that has no AI elements in it. Even with a correct base revision this is fragile; with an
   incorrect one it is fatal. Second-order: nothing on the apply path invalidates a pending push.
3. **Test blind spot that let this ship.** `electron/capabilities/canvas.test.mjs:3-20` mocks the whole
   store (`changedIdsSince: () => []`, `getRevision: () => 0`), and `electron/canvas-store.test.mjs`
   re-implements the handler's staleness rule instead of calling the real handler. No test drives
   apply → `revisionRef` adoption → push, i.e. the actual sequence that loses data. The /tmp e2e script
   is the shape the missing test should take.
4. **Minor / not the symptom:** main reconciles a stale push but never re-broadcasts the reconciled
   scene, so the renderer's live scene can silently diverge from the cache (no `canvas:apply` echo of
   the merge). And `canvas-mcp.mjs`'s `commitWrite` writes with `setScene` unconditionally — it has no
   staleness path of its own; harmless today only because its read-modify-write is synchronous.

## Minimal fix

In `src/components/DrawingCanvas.tsx`, make the pending snapshot carry its own base revision:

- `:461` store it with the snapshot: `pendingSnapshotRef.current = { elements, appState, files,
  baseRevision: revisionRef.current }`.
- `:429-437` `serializeAndPush` passes `pending.baseRevision` through to `pushScene`, and `:363`
  `pushScene(scene, baseRevision)` sends that value instead of `revisionRef.current`.

That makes the push stale by construction whenever an AI write landed after the snapshot, so
`electron/capabilities/canvas.mjs:200-205` reconciles per element via `changedIdsSince` and the AI
elements are protected — verified as scenario B2 above.

Cheap hardening worth adding in the same change:
- on apply (`:281-296`), drop the now-obsolete pending snapshot (`pendingSnapshotRef.current = null`)
  rather than letting a pre-AI state be pushed at all;
- a regression test built the way `/tmp/iris-repro/e2e.mjs` is — real `createCanvasStore`, real
  `createCanvasCapability`, real MCP write — asserting the disk scene still contains the AI id after a
  push whose snapshot pre-dates the apply.
