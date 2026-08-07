## 1. Precondition

- [ ] 1.1 Confirm `galaxy-note-reachable-by-hand` is applied and archived before starting (D7) — the rail, its find field and `railSearch` all arrive with it, and this change's delta ADDs against a living spec that must already describe the rail

## 2. One matcher, in main

- [ ] 2.1 Move the title matcher and its case/diacritic folding out of `src/lib/galaxy-rail.ts` into the second-brain capability as pure `.mjs`, keeping the exact ranking (exact, then prefix, then substring; then by connectedness)
- [ ] 2.2 Port `galaxy-rail.test.ts`'s search cases to the moved module, including the Vietnamese folding case — the assertions are the contract, only their location changes
- [ ] 2.3 Delete `railSearch` from the renderer and leave `galaxy-rail.ts` owning only the rail's shaping (roots, neighbours, the island class)
- [ ] 2.4 Add a `secondbrain:find-notes` IPC handler over the matcher, with the preload binding and the `vite-env.d.ts` declaration
- [ ] 2.5 Point the galaxy's find field at that handler, debounced, and confirm typing still behaves as it did — a regression here is invisible in tests because the field has no DOM test environment

## 3. The tool

- [ ] 3.1 Declare the lookup in the capability's `toolDeclarations`, alongside `CAPTURE_NOTE_DECLARATION` — parameter named for a *name*, not a subject or a question (D3)
- [ ] 3.2 Write the description to state the negative case and name `capture_learning` as the alternative, copying the pattern `capture_note`'s declaration already uses against the same verb
- [ ] 3.3 Dispatch it in `run-dispatch.mjs` beside `capture_note`/`mutate_vault_notes`, deliberately NOT in `PIPELINE_ONLY_TOOLS` — the lookup must survive chat-only mode
- [ ] 3.4 Return the matched titles (and whether each is openable), capped, so Iris can name candidates rather than pick one silently
- [ ] 3.5 Extend the capability's `promptFragment()` with when-to-use-which, as the third and weakest of D3's three mechanisms
- [ ] 3.6 Assert the declaration exists and is present with no Claude credential, in the capability's own test file

## 4. Reaching the rail

- [ ] 4.1 Emit the matches to the renderer on the capability's own channel (D4), never through `iris:ui-action` — `voice-ui-control` enumerates a fixed vocabulary that is not about the second brain
- [ ] 4.2 Have `VaultGalaxy` show voice matches in the rail exactly as typed ones, steppable on the same terms, with no new gesture and no edit to `App.tsx`'s dwell rule
- [ ] 4.3 Confirm a spoken search changes no focus, opens no note, and leaves the voice layer's context untouched
- [ ] 4.4 Confirm the lookup still answers with the galaxy closed — the emit is how the rail learns, not a precondition for the question

## 5. Opening a found note

- [ ] 5.1 Route "open it" through the existing note-open path so the camera anchoring applies unchanged (D5)
- [ ] 5.2 Refuse to open a ghost match with that reason — an unresolved `[[wikilink]]` target has no file — rather than surfacing a read error
- [ ] 5.3 Confirm closing the reader leaves the camera anchored on the opened note, on the same terms as a click or a dwell

## 6. Docs, manual pass, gates

- [ ] 6.1 Update `docs/GESTURES.md` where it currently records that finding by name is typed-only and not hands-free, and `docs/PIPELINE_INTERNALS.md` where the capability's tools are listed; keep `CLAUDE.md` a router
- [ ] 6.2 Manual pass, spoken both ways deliberately: "find my note called X" must reach the lookup and "what do my notes say about X" must reach the curation verb (D3's hazard, and the one thing no unit test can check)
- [ ] 6.3 Manual pass on the seeded 300-note vault: ask for a note, dwell a match, step; then ask with the galaxy closed and open the note by voice
- [ ] 6.4 Measure and record the lookup's latency on that vault — the fresh scan per call (D6) is an assumption until there is a number
- [ ] 6.5 Resolve the design's open question (whether a voice-populated rail persists past a step) from the manual pass; the default until then is that it persists until cleared, matching the typed field
- [ ] 6.6 Run all five gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`
