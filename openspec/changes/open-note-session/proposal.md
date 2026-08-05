## Why

Iris and the user cannot currently work on the *same thing*. A note opens in the reader as renderer-only React state (`App.tsx:187`) that never reaches the main process — so no tool, no prompt, and no run knows which note is on screen. "Read this back to me, then drop the second paragraph" has nowhere to land.

The gap is not a missing parameter. It is a missing **shared work object**: while a note is open, both sides should be attending to that one note; when it closes, attention returns to the vault as a whole. That is the same context-ownership idea the gesture surface already runs on (`resolveGestureContext` ranks reader > galaxy > deck), extended from hands to voice.

Editing a note by conversation is judgement work, which `personal-knowledge-notes` already routes to a worker rather than to Iris's own enumerated write surface. What it needs that no existing verb provides is a **resident session**: "drop the second paragraph" only resolves if the thing that numbered the paragraphs is the same thing that deletes one, and it must still know that a turn later.

## What Changes

- **The open note becomes main-process state.** The renderer reports open/close over IPC; main owns which note is open, exactly as it already owns the focus.
- **The open note replaces the focus as the voice referent while it is open.** With a note open, what reaches the voice layer describes that note and says nothing about the focus. The focus is not cleared — it is retained in main and becomes the referent again when the note closes. Two referents are never described at once, so a deictic request never has to be guessed at.
- **A new stateful verb holds the working session over one note.** It reads the note back aloud (through the voice layer, verbatim), then applies what the user asks — remove, add, rewrite — across turns of one continuous conversation. `capture_learning` is untouched: it stays stateless, cheapest-model, light-budget bookkeeping.
- **One conversation per note.** The session key is derived from the note's identity, so returning to a note resumes what was already said about it rather than starting over. One session is resident at a time; switching notes yields the resident slot and stores the outgoing session's id for later resumption. Closing the note ends nothing.
- **The note's body never enters the voice layer's per-turn context.** The session that will edit the note is the one that reads it; the voice layer speaks that rendering aloud rather than producing its own. This keeps `second-brain-focus`'s "identities, titles, and tags — not note bodies" reasoning intact instead of carving an exception into it.
- **A verbatim announcement path.** The existing completion announcement instructs the voice layer to summarize in 1–3 sentences (`announcements.mjs:188`), which would destroy a note reading. This verb needs a path that is read out as written.
- **`mutate_vault_notes` targets the open note when there is one**, falling back to the focus as it does today.
- **BREAKING (documentation):** Iris gains an eighth verb. `CLAUDE.md` and `docs/PIPELINE_INTERNALS.md` say "seven named verbs" in four places.

## Capabilities

### New Capabilities

- `open-note-session`: the open note as a shared work object — main-process ownership of which note is open, its precedence over the focus as the voice referent, and the resident per-note working session that reads it aloud and edits it by conversation.

### Modified Capabilities

- `personal-knowledge-notes`: the "No second notes verb is introduced" rule is narrowed to what it was written to prevent — a duplicate verb for the *same kind* of work — so that a verb differing in **lifetime** (a resident session with the user in the loop, versus one-shot bookkeeping) is permitted and its boundary against `capture_learning` is stated.

Deliberately **not** modified: `second-brain-focus`. Change `two-palm-galaxy-zoom` already holds a delta on its "One authoritative focus…" requirement, and a second concurrent delta on the same requirement would have to be written against a main spec that has not absorbed the first yet. The referent-precedence rule lives in the new capability instead — which is also where it belongs, since it is about the work object, not about the focus.

## Impact

**Code**

- `electron/capabilities/second-brain.mjs` — open-note state, its IPC handlers, the referent precedence in `promptFragment()`, a `SYSTEM_EVENT` push mirroring `announceFocusUpdate()`, and `mutateVaultNotes`'s target resolution.
- `electron/preload.cjs` — the open/close channels.
- `electron/verbs.mjs` — the new verb record.
- `electron/run-context.mjs` — the open note joins the single composition point, alongside the focus and the transcript.
- `electron/announcements.mjs` — the verbatim read-back path.
- `electron/run-exec.mjs` / session keying — a per-note session key and the resident-slot handoff.
- `src/App.tsx` — report open/close over IPC from the existing `openNote` lifecycle.
- `CLAUDE.md`, `docs/PIPELINE_INTERNALS.md` — the verb count.

**Ordering**

Independent of `two-palm-galaxy-zoom` at the code level (they share only `App.tsx`, in different regions). Archive `two-palm-galaxy-zoom` first regardless, so the living spec is settled before this one's delta is validated against it.

**Risk**

A resident session per note means the resident slot changes hands whenever the user switches notes, which costs latency on the switch. `live-session.mjs` holds exactly one resident session today (`let liveSession = null`, not a map) — this change preserves that invariant rather than relaxing it, and pays for it in switch cost.
