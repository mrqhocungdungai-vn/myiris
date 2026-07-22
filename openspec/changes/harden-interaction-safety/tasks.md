## 1. Commit 1 — Item 3: non-blocking confirmation modal (`App.tsx`)

- [x] 1.1 Add `confirm` state `{ message: string; resolve: (ok: boolean) => void } | null` and an `askConfirm(message): Promise<boolean>` helper that sets the state and resolves on the user's choice (design D1)
- [x] 1.2 Render a non-blocking confirm overlay when `confirm` is non-null: message + Confirm / Cancel buttons; each resolves and clears the state. Escape and backdrop click resolve `false`
- [x] 1.3 In the role-switch handler, replace `const ok = window.confirm(...)` (`App.tsx:503`) with `const ok = await askConfirm(...)`; keep `if (!ok) return;` and the exact gate message. Confirm proceeds, Cancel aborts — semantics unchanged
- [x] 1.4 Confirm no `window.confirm` / `window.alert` / `window.prompt` remains anywhere in `src/`
- [x] 1.5 Minimal CSS for the overlay (reuse existing overlay/reader styling where possible)

## 2. Commit 1 — verification (manual; renderer is out of the Vitest harness)

- [ ] 2.1 Trigger the DEV soft-gate (switch to a role whose predecessor handoff is missing): the confirm appears as an in-app modal, NOT a native dialog
- [ ] 2.2 While the modal is open, the orb keeps animating and audio keeps playing (event loop not blocked) — the core fix
- [ ] 2.3 Confirm → the role switch proceeds; Cancel / Escape / backdrop → the switch is aborted (same as old `!ok`)
- [x] 2.4 `npm run build` passes

## 3. Commit 2 — Item 4: dwell-exclude destructive controls

- [x] 3.1 In the dwell loop (`App.tsx:~813`), after computing `actionable`, if `actionable.closest('[data-no-dwell]')` is non-null, treat it as no target: clear `dwellRef`, `syncDwell(false, false)`, continue — no `.click()`, no dwell indicator (design D2)
- [x] 3.2 Add `data-no-dwell` to the "Remove token" button (`SetupPanel.tsx:333`) and any other destructive control in SetupPanel
- [x] 3.3 Add `data-no-dwell` to the "New session" control (`App.tsx` `onNewSession`/`createSession` render site) and the project-folder switch control (resets the session)
- [x] 3.4 Do NOT tag the gate-confirm buttons or other reversible controls (design D3) — dwell must still pass the gate

## 4. Commit 2 — verification (manual)

- [ ] 4.1 Dwell over "Remove token" and over "New session": no click fires and the "Hold · opening" indicator does not engage; a mouse click on each still works
- [ ] 4.2 Dwell over a normal target (task card, PO answer option, step-timeline toggle, close button) still fires exactly as before
- [ ] 4.3 Dwell over the gate-confirm modal's Confirm button still works (reversible action stays dwell-operable)
- [x] 4.4 `npm run build` passes

## 5. Spec and record

- [x] 5.1 `openspec validate harden-interaction-safety` passes
- [x] 5.2 Re-read the two deltas against the landed code: `main-thread-budget` "no blocking dialogs" (gate confirm is a non-blocking modal, no `window.confirm` left); `two-hand-gestures` "Universal point-and-hold click" (dwell skips `[data-no-dwell]`, normal targets unaffected, excluded controls mouse/voice-operable)
- [x] 5.3 Two commits on `develop`, one per item (commit 1 = non-blocking confirm, commit 2 = dwell exclusion). Do not squash. Co-Authored-By trailer
- [x] 5.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark the `window.confirm` and dwell-destructive rows done; note item 3 swaps native confirm for a non-blocking in-app modal (ADDED to `main-thread-budget`) and item 4 adds a `data-no-dwell` opt-out for destructive controls (MODIFIED `two-hand-gestures`). Note the still-open renderer rows (webcam opt-in, camera-error-stuck, barge-in flush race, output-context leak, stale-closure comment) before Wave 2 (BUG I.2–I.5)

## Manual QA still owed (not runnable in this environment — no GEMINI_API_KEY / no live webcam session)

- [ ] 2.1–2.3, 4.1–4.3 above: run the packaged/dev app, trigger the DEV gate, and dwell-test the excluded/normal controls per the checklist before archiving this change.
