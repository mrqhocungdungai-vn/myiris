## 1. Stop the graph pollution (first, per design D5)

- [x] 1.1 Add a failing test in `electron/vault-graph-parse.test.mjs` asserting `isUserNote("inbox/runs/2026-08-04.md")` and `isUserNote("inbox/captures/2026-08-04.md")` are both `false`, and that `parseVaultFiles` over a spool file plus a real note yields only the real note as a node.
- [x] 1.2 Add a test asserting the exclusion is root-only: a note at `Projects/inbox/Idea.md` IS still a user note.
- [x] 1.3 Add `inbox` to `NOTES_PLUMBING_FOLDERS` in `electron/vault-graph-parse.mjs`, with a comment naming the spool it excludes and why (Iris appends there unasked).
- [x] 1.4 Confirm the two tests pass and no existing `vault-graph`/`vault-graph-parse` test regressed.

## 2. The vault write module

- [x] 2.1 Write `electron/vault-write.test.mjs` first, covering: an async spool append creating the file and its parent directory; a second append adding to the same file rather than replacing it; a rejected write resolving `{ ok: false, error }` rather than throwing; the sync variant honouring the same never-throws contract; `createNotePage` writing frontmatter + body; and a `createNotePage` title containing `../`, a path separator, or a null byte being sanitized to a safe basename inside the vault (design D8).
- [x] 2.2 Create `electron/vault-write.mjs` — Electron-free, `fs` injected, never throws — exposing `appendSpoolRecord` (async), `appendSpoolRecordSync`, and `createNotePage` (async, atomic via `electron/atomic-file.mjs`), plus the spool path helpers (`inbox/captures/<date>.md`, `inbox/runs/<date>.md`).
- [x] 2.3 Export the date-derived spool filename helper so `run-inbox.mjs`'s existing `inboxFileFor` behavior is preserved by the shared module rather than duplicated.
- [x] 2.4 Verify the module stays inside the 250–450-line convention and imports nothing from Electron.

## 3. Route the existing run-record writer through it

- [x] 3.1 Change `electron/run-inbox.mjs` so `appendRunRecord` delegates its write to `appendSpoolRecordSync`, keeping `renderInboxRecord` (the record's shape) and `appendRunRecord`'s existing synchronous, never-throws, `{ ok, file }` signature exactly as they are (design D2/D6).
- [x] 3.2 Confirm `electron/run-inbox.test.mjs` passes unchanged — if a test needs editing, the signature was not preserved.
- [x] 3.3 Confirm `inboxBacklog` still counts records across the run spool, and extend it to also count the capture spool so the curator's offer threshold reflects everything waiting.

## 4. The capture tool

- [x] 4.1 Add tests in `electron/capabilities/second-brain.test.mjs`: the capability contributes a capture tool declaration; its handler calls `ensureNotesVaultReady()` before writing (design D7); a successful write returns a saved result naming the file; a failed write returns a failure and does NOT report saved (spec: "A capture whose write fails is reported as failed, not confirmed"); and the handler starts no run and touches no execution slot.
- [x] 4.2 Implement the capture tool in `electron/capabilities/second-brain.mjs`: declaration (params `text` required, optional `title`/`tags`) plus an async handler that ensures the vault, appends to the capture spool, and returns the filesystem outcome.
- [x] 4.3 Wire the declaration in `electron/gemini-tools.mjs` so it is declared independent of `pipelineAvailable`, alongside the interface-only tools rather than inside the verb-derived set (spec: `pipeline-availability`).
- [x] 4.4 Add a test in `electron/gemini-tools.test.mjs` asserting the capture tool IS declared in chat-only mode while no verb is, and that the verb set withheld in chat-only mode is still exactly what the registry defines.
- [x] 4.5 Update the second-brain `promptFragment` so its capture guidance is no longer gated on `getPipelineAvailable()`/notes-skills — capture is always offerable — while the curation/retrieval guidance and the backlog nudge stay gated. Add a test for both halves.

## 5. Narrow `capture_learning` to curation

- [x] 5.1 Update `capture_learning`'s `description` in `electron/verbs.mjs` so the voice layer stops routing raw "write that down" requests to it and reaches for the capture tool instead; keep the verb name, `sessionKey`, model, and budget untouched (design D6).
- [x] 5.2 Update its `clause` so the run reads **both** spool directories (captures and run records), not just `inbox/runs` — per design D3, without this a just-captured note is unfindable and retrieval answers "nothing found".
- [x] 5.3 Update the `save` parameter's description to mean "write this up as a curated page", distinct from a raw capture.
- [x] 5.4 Add a test asserting the resolved verb's clause names the capture spool, so D3's consequence cannot silently regress.
- [x] 5.5 Confirm `electron/verbs.test.mjs` and `electron/sdk-options.test.mjs` still pass — no run-shape option changed (design D9).

## 6. Docs and gates

- [x] 6.1 Add `electron/vault-write.mjs` to the module map in `docs/ARCHITECTURE.md`.
- [x] 6.2 Update the run-inbox section of `docs/PIPELINE_INTERNALS.md` to describe one vault write path with two spools, and state that capture is not gated on the pipeline.
- [x] 6.3 Confirm no `.env.example` entry is needed (design D9) and that `CLAUDE.md` needs no new router line (no new deep-detail doc was added).
- [x] 6.4 Run all four gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`.
- [x] 6.5 Manual verification with a real vault: capture by voice with no Claude credential configured and confirm the note lands and Iris confirms it; open the galaxy and confirm no date-named nodes appear; then ask what the notes say about the captured thing with a credential configured and confirm retrieval finds it. Confirmed by the user.
