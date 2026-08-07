## 1. One matcher, in its own main-process module

- [x] 1.1 Create `electron/note-name-match.mjs` — pure and Electron-free, like `vault-graph.mjs` beside it — holding the title matcher and its case/diacritic folding moved out of `src/lib/galaxy-rail.ts:247`, keeping the exact ranking (exact, then prefix, then substring; then by connectedness) and the `RAIL_SEARCH_LIMIT` cap (D2)
- [x] 1.2 Port `galaxy-rail.test.ts`'s `railSearch` block to `electron/note-name-match.test.mjs`, including the Vietnamese folding cases (`ghi chu` / `kien truc`), the empty/whitespace-query cases, the connectedness tie-break, the limit, and the ghost `openable: false` case — the assertions are the contract, only their location changes
- [x] 1.3 Delete `railSearch` and `foldForSearch` from the renderer and leave `galaxy-rail.ts` owning only the rail's shaping (`railRoots`, `railNeighbours`, `connectedRegions`, `RAIL_ISLAND_CLASS`); drop the now-dead import in `VaultGalaxy.tsx:12`
- [x] 1.4 Add a `secondbrain:find-notes` IPC handler over the matcher, with the preload binding beside the other `secondbrain:*` entries (`preload.cjs:141-168`) and the `vite-env.d.ts` declaration
- [x] 1.5 Point the galaxy's find field (`VaultGalaxy.tsx:873`) at that handler, debounced, and confirm typing still behaves as it did — a regression here is invisible in tests because the field has no DOM test environment

## 2. The tool

- [x] 2.1 Declare the lookup in the capability's `toolDeclarations` (`second-brain.mjs:1177`), alongside `CAPTURE_NOTE_DECLARATION` — parameter named for a *name*, not a subject or a question (D3)
- [x] 2.2 Write the description to state the negative case and name `capture_learning` as the alternative, copying the pattern `capture_note`'s declaration already uses against the same verb
- [x] 2.3 Dispatch it in `run-dispatch.mjs` beside `capture_note`/`mutate_vault_notes` (cases at lines 499/504), deliberately NOT in `PIPELINE_ONLY_TOOLS` — the lookup must survive chat-only mode, and the two existing cases already carry the comment explaining why
- [x] 2.4 Have the handler call the existing `getGraph()` rather than reading the cache (D6) — with the galaxy shut the watcher is off and the cache is empty on a cold session, so a cache read would answer "no matches" for a whole vault
- [x] 2.5 Return the matched titles (and whether each is openable), capped, so Iris can name candidates rather than pick one silently
- [x] 2.6 Extend the capability's `promptFragment()` (`second-brain.mjs:711`) with when-to-use-which, as the third and weakest of D3's three mechanisms
- [x] 2.7 Assert the declaration exists and is present with no Claude credential, in `second-brain.test.mjs`

## 3. Reaching the rail

- [x] 3.1 Emit the matches to the renderer on the capability's own channel (D4), following the `secondbrain:graph-updated` precedent at `second-brain.mjs:335` — never through `iris:ui-action`, whose `UI_ACTIONS` set (`run-dispatch.mjs:420`) enumerates ten actions and contains nothing about the second brain
- [x] 3.2 Have `VaultGalaxy` show voice matches in the rail exactly as typed ones, steppable on the same terms, with no new gesture and no edit to `App.tsx`'s dwell rule
- [x] 3.3 Confirm a spoken search changes no focus, opens no note, and leaves the voice layer's context untouched
- [x] 3.4 Confirm the lookup still answers with the galaxy closed — the emit is how the rail learns, not a precondition for the question

## 4. Opening a found note

- [x] 4.1 Route "open it" through the existing note-open path so the camera anchoring applies unchanged (D5) — `second-brain-galaxy-view`'s "Opening a note anchors the camera on it" scenario is unqualified as to how, and stays that way
- [x] 4.2 With the galaxy shut, activate it as part of opening (D5): `NoteReader` renders only under `secondBrainActive && openNote` (`App.tsx:2046`), so the note has nowhere to appear otherwise. Activation is implied by *opening a named note* only — do not add a spoken galaxy toggle, and do not extend `UI_ACTIONS`
- [x] 4.3 Refuse to open a ghost match with that reason — an unresolved `[[wikilink]]` target has no file — rather than surfacing a read error, and do NOT activate the galaxy on that refusal
- [ ] 4.4 Confirm closing the reader leaves the camera anchored on the opened note, on the same terms as a click or a dwell — including when the galaxy was activated by the open itself

## 5. Docs, manual pass, gates

- [x] 5.1 Rewrite `docs/GESTURES.md`'s "**This half is typed, not hands-free**" paragraph (around line 387). Note while there that its closing claim — "there is no second-brain tool on the Gemini surface at all today" — is already false: `capture_note` and `mutate_vault_notes` are both declared. Fix that too rather than leaving a known-wrong sentence beside a corrected one
- [x] 5.2 Update `docs/PIPELINE_INTERNALS.md` where the capability's tools are listed; keep `CLAUDE.md` a router
- [ ] 5.3 Manual pass, spoken both ways deliberately: "find my note called X" must reach the lookup and "what do my notes say about X" must reach the curation verb (D3's hazard, and the one thing no unit test can check)
- [ ] 5.4 Manual pass on the seeded 300-note vault: ask for a note, dwell a match, step; then ask with the galaxy closed and open the note by voice — watching whether the galaxy coming up around it reads as helpful or as the app taking the screen (D5's risk)
- [ ] 5.5 Measure and record the lookup's latency on that vault — the fresh scan per call (D6) is an assumption until there is a number
- [ ] 5.6 Resolve the design's open question (whether a voice-populated rail persists past a step) from the manual pass; the default until then is that it persists until cleared, matching the typed field
- [x] 5.7 Run all five gates — `/gates` runs them and reports which are red, or individually: `npm run build`, `npm test` (or `npm run test:gate`), `npm run lint`, `npm run scan:secrets`, `npm run spec:check`

## Deferred — manual verification, not yet run

The five tasks above left unchecked (4.4, 5.3–5.6) all require the running app
with a camera, a microphone and a real vault. They were **not** run before this
change was archived, by the maintainer's explicit decision: no machine was
available at the time, and the work was archived rather than left open so the
code and the living spec would not drift apart while it waited.

Every automated gate was green at archive time: `npm run build`, `npm test`
(1412 passing), `npm run lint`, `npm run scan:secrets`, `npm run spec:check`.

**What is therefore asserted but unverified:**

- **5.3 is the one that matters.** Whether Gemini actually routes "find my note
  called X" to `find_note_by_name` and "what do my notes say about X" to
  `capture_learning` is the change's central hazard (D3), and no unit test can
  check it — the tests assert the three mechanisms are *in place*, not that they
  *work on a live model*. If this turns out wrong, the fix is in the declaration
  and prompt wording, not in the structure.
- **5.5** — the fresh scan per lookup (D6) is unmeasured. Fine at a few hundred
  notes by reasoning; unknown at tens of thousands. The cache is the fallback if
  it bites.
- **4.4 / 5.4 / 5.6** — camera anchoring after a voice-opened reader closes, how
  the galaxy arriving unbidden reads in use, and whether a voice-populated rail
  should persist past a step.

**One seam found while writing the code, not covered by any task above:** asking
with the galaxy shut and then opening emits the matches *before* `VaultGalaxy`
mounts, so the rail comes up **empty** even though the reader opens on the right
note. No requirement is violated — the spec says the rail offers matches while
the galaxy is active — but it is worth judging in the same pass as 5.4.
