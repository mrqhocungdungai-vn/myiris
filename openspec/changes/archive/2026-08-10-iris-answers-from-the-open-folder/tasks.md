## 1. Reading the prepared folder

- [x] 1.1 Add `electron/prepared-material.mjs`: given a folder path, walk it for `.md` and `.txt` files, skipping `.git`, `node_modules`, `dist`, `build` and dotted directories, under a file-count cap and a total-size cap. Return each file's relative path and text, plus whether the caps truncated the walk. Pure over an injected `fs`, Electron-free, never throws (design D5)
- [x] 1.2 Add the overflow narrowing to the same module: when the material exceeds the bound, score files against the question's words (case- and accent-insensitive, on the same footing as `note-name-match.mjs`) and return the highest-scoring ones up to the bound, with a flag saying it narrowed. This path is the exception, not the primary matcher (design D2)
- [x] 1.3 Add `electron/prepared-material.test.mjs` over an injected fake `fs`: extensions filtered; skip-list honoured including nested; caps enforced; the truncation flag set only when something was actually dropped; narrowing picks the plausible file over an unrelated one; a missing or unreadable folder returns empty rather than throwing

## 2. The capability

- [x] 2.1 Add `electron/capabilities/prepared-answers.mjs` on the existing capability contract (`toolDeclarations`, `promptFragment`, `probe`), returning a `createPreparedAnswers({ ... })` factory. Electron-free; the open folder arrives as an injected getter, not read from the session store directly
- [x] 2.2 Declare `find_prepared_answer` with one `question` parameter. The description must route it correctly against its neighbours: it answers a question from material the user prepared in the folder they have open; it is not `find_note_by_name` (titles only, never contents) and not the `capture_learning` verb (the notes vault, and a run). State that it costs no run, no tokens and no credential — the same framing `find_note_by_name` uses (spec: "The title lookup plays no part in this")
- [x] 2.3 Implement the lookup: resolve the open folder from the active workstream's `cwd`; when none is selected, return a result saying so rather than searching `~/.myiris/workspace` (design D1). Read via `prepared-material.mjs`, fence the text with `fenceUntrustedText`, and return the material with its source file paths and the narrowing flag (design D6)
- [x] 2.4 Write `promptFragment()`: name the folder being searched so a wrong workstream is visible to the user; state that a found answer is announced in one short line and read out **only on the user's cue**; state that a miss offers the two costly routes and starts neither (design D3, spec: "A found answer is announced, not performed", "Finding nothing is reported…")
- [x] 2.5 Add `electron/capabilities/prepared-answers.test.mjs`: no folder selected → says so and reads nothing; a folder with a matching file → returns that file's text verbatim and names it; a folder with nothing relevant → returns a not-found result; oversized folder → narrowed with the flag set; returned text is fenced but unmodified inside the fence

## 3. Wiring and dispatch

- [x] 3.1 Register the capability in `electron/wiring-capabilities.mjs` alongside canvas, second-brain and hud-telemetry, injecting the open-folder getter from the session store
- [x] 3.2 Add the `find_prepared_answer` case to the tool switch in `electron/run-dispatch.mjs`, and **leave it out of `PIPELINE_ONLY_TOOLS`** — record the reason at the case as the three worker-free tools above it already do (design: worker-free class)
- [x] 3.3 Extend `electron/gemini-tools.test.mjs` / `electron/run-dispatch.test.mjs`: the declaration appears in the tool surface with no Claude credential configured, and the tool dispatches without touching the run queue or an execution slot

## 4. The settling step

- [x] 4.1 Rewrite `LISTEN_ONLY_DISENGAGE_REQUEST` in `electron/gemini-prompts.mjs`: it currently ends by telling Iris to wait until the user speaks. It should instead tell her to look in the open folder for an answer to what she just heard, straight away and before considering any verb; to say one short line if she finds something and then wait; and to say nothing at all if she does not (design D4, spec: "The end of listening leads straight to the prepared folder")
- [x] 4.2 Cover it in `electron/gemini-prompts.test.mjs` and `electron/live-session.test.mjs`: the disengage note is still sent on the same in-band path with no reply requested, and is still skipped under the system-audio escape hatch exactly as before
- [x] 4.3 Confirm no guard is needed against the lookup firing mid-engagement — `live-messages.mjs` already refuses every tool call while the mode is engaged, in main, before dispatch. Add a test asserting `find_prepared_answer` is refused while engaged, so the property is pinned rather than assumed (design D4)

## 5. Documentation

- [x] 5.1 Document the prepared-answer flow in `docs/ARCHITECTURE.md` beside the listen-only section: the three things Iris attends to (the speaker, the machine's audio, the open folder), and that none of them needs a verb
- [x] 5.2 Add a router row to `CLAUDE.md` pointing at `openspec/specs/prepared-answers/spec.md`
- [x] 5.3 Note the flow in `docs/PIPELINE_GUIDE.md` as a user-facing walkthrough: point the session's folder at your prep material before the talk

## 6. Gates

- [x] 6.1 `npm run build`
- [x] 6.2 `npm test`
- [x] 6.3 `npm run lint`
- [x] 6.4 `npm run scan:secrets`
- [x] 6.5 `npm run spec:check`

## 7. Verify in the running app

- [ ] 7.1 Point the session's folder at a prep folder holding a Q&A markdown file. Engage listen-only, ask a question out loud, disengage: Iris says one short line that she has an answer, and does not read it
- [ ] 7.2 Tell her to go ahead: she reads the prepared text **as written**, not a summary of it
- [ ] 7.3 Answer the question yourself instead: she stays quiet
- [ ] 7.4 Ask something the prep folder does not cover: she says nothing is prepared and offers the two routes, and starts neither until told
- [ ] 7.5 With no session folder selected, disengage after a question: she says there is no folder open rather than searching the default workspace
- [ ] 7.6 Point the folder at a code repository by mistake: the result is an unhelpful "nothing prepared", not an error and not a wall of source code
