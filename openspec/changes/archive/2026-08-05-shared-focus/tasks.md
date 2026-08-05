## 1. The focus module

- [x] 1.1 Write `electron/focus.test.mjs` first: setting a selection; toggling an id off; the bound dropping the oldest when exceeded; resolution against a literal graph returning ids/titles/tags; an id absent from the graph dropping out of the resolved result; a ghost node not being selectable; and clearing emptying it.
- [x] 1.2 Create `electron/focus.mjs` — Electron-free, no I/O, no import of `vault-graph.mjs` (the graph is passed in, per design D1) — holding `{ ids, at }`, the bound, `toggle`/`set`/`clear`, and `resolve(focus, graph)`.
- [x] 1.3 Add a separate, tighter bound for what reaches a prompt/context, mirroring how `run-context.mjs` bounds the transcript at the point of use rather than at the point of retention.

## 2. Focus over IPC, and the galaxy's selection state

- [x] 2.1 Add `secondbrain:set-focus` / `secondbrain:get-focus` / `secondbrain:clear-focus` handlers in `electron/capabilities/second-brain.mjs`, holding one focus instance; type/bound-check incoming ids exactly as `secondbrain:read-note` does. Add tests.
- [x] 2.2 Expose them through `electron/preload.cjs` and `src/types.ts`.
- [x] 2.3 Clear the focus wherever the galaxy is deactivated — the toggle, another exclusive HUD layer opening, leaving the HUD by button/hotkey/tray, and the error-boundary force-close — reusing whatever path already clears the open note reader so the two lifecycles cannot drift. Add a test per route.
- [x] 2.4 Assert with a test that opening the note reader does NOT clear the focus.

## 3. Tap-vs-hold in the pure drive partition

- [x] 3.1 Extend `src/lib/galaxy-nav.test.ts` first, covering design D3's three consequences: a pinch released inside the window yields `tap` for exactly one frame; a pinch held past the window yields `zoom` and never `tap`; a pinch that already became a zoom yields no `tap` on release, however slow; no `zoom` is emitted during the discrimination window; and a pinch drifting while `Pointing_Up` yields neither.
- [x] 3.2 Add the tap outcome and the engage-timestamp/became-zoom fields to `driveFor` and `PoseDriveState` in `src/lib/galaxy-nav.ts`, with `TAP_MAX_MS` beside the existing tuning constants.
- [x] 3.3 Seed the zoom reference when the hold window elapses rather than at pinch engage (design D3), and add a test that the camera radius does not jump when zoom takes over.

## 4. Selection in the galaxy

- [x] 4.1 Handle the `tap` drive in `VaultGalaxy.tsx`'s rAF loop: resolve the target with the existing `nearestNodeAt` (same depth filter as the dwell), toggle the focus through IPC, and do nothing when it resolves to no node or to a ghost node.
- [x] 4.2 Render focused nodes distinctly, reusing the existing re-assign-`nodeColor` mechanism the dwell highlight already uses (mutating a closed-over ref does not force a repaint).
- [x] 4.3 Add mouse selection so the focus is reachable with hand control off — a modifier-click or equivalent that does not break the existing plain-click-opens-the-note behavior.
- [x] 4.4 Confirm no per-frame gesture work is scheduled when hand control is off, including for tap discrimination.

## 5. Visible referents

- [x] 5.1 Add a focus chip to the HUD naming the focused notes, shown only while the galaxy is active and the focus is non-empty. Escape titles — do not inject them as HTML (the galaxy spec's untrusted-title rule applies here identically).
- [x] 5.2 Add the clear-focus control to the HUD control island (`.hud-controls`) so it is dwell-reachable under the fullscreen layer per `two-hand-gestures`; do NOT mark it `[data-no-dwell]` — clearing a selection is not destructive.
- [x] 5.3 Add a test that the chip is absent with an empty focus and absent when the galaxy is closed.

## 6. Structural vault edits

- [x] 6.1 Extend `electron/vault-write.test.mjs` first: `linkNotes` inserting `[[B]]` into A and `[[A]]` into B; being idempotent when the link already exists (no duplicate, still reports success); `unlinkNotes` removing both directions; `setNoteTags` rewriting frontmatter without disturbing the body; and a note with malformed frontmatter being reported rather than corrupted.
- [x] 6.2 Implement `linkNotes`, `unlinkNotes`, `setNoteTags` in `electron/vault-write.mjs` as enumerated named operations (design D7) — no general content-write primitive.
- [x] 6.3 Add a `secondbrain:mutate` handler taking a named operation plus note **ids**, resolving each through `resolveNotePath` and re-asserting the realpath-inside-the-vault check; refuse a supplied path, an unknown id, and a ghost node. Add a test per refusal.
- [x] 6.4 Confirm the file stays inside the 250–450-line convention; split the operations into their own module if it does not.

## 7. Reaching the voice layer and the runs

- [x] 7.1 Add the focus line to the second-brain `promptFragment`: present only while the galaxy is active and the focus is non-empty, bounded, titles escaped/treated as untrusted. Add tests for the present, empty, and galaxy-closed cases.
- [x] 7.2 Compose the fenced focus block in `electron/run-context.mjs` beside the transcript, using `untrusted-text.mjs`, carrying ids/titles/tags and **not** bodies (design D5). Add tests including the no-focus case emitting no block.
- [x] 7.3 Add a test asserting no verb in `electron/verbs.mjs` declares a focus parameter — the focus arrives by composition, so a future verb cannot start re-declaring it.
- [x] 7.4 Update `capture_learning`'s `focus` parameter description to acknowledge a selection may already be present, without changing its model, budget, skills, park, or session key (design D6).
- [x] 7.5 Confirm `electron/sdk-options.test.mjs` still passes — no run-shape option changed.

## 8. Docs and gates

- [x] 8.1 Add `electron/focus.mjs` to the module map in `docs/ARCHITECTURE.md`, and describe the focus in the delegation/context flow.
- [x] 8.2 Document the new gesture in `docs/GESTURES.md`: pinch-tap selects, pinch-hold zooms, clear is a control.
- [x] 8.3 Add the focus block to the prompt/context section of `docs/PIPELINE_INTERNALS.md`, beside the transcript it sits next to.
- [x] 8.4 Run all four gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`.
- [x] 8.5 Manual verification with a real vault: tap two nodes, confirm both ring and the chip names them; say "connect these two" and confirm the edge appears without reload and positions are preserved; confirm a quick tap never zooms and a held pinch never selects; confirm clearing works by dwell and by mouse; confirm the whole flow with hand control off using the mouse.
