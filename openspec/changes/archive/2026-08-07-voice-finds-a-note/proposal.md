## Why

`galaxy-note-reachable-by-hand` established that stepping through the galaxy is
only as good as the reachability of a starting point, and that link topology
cannot supply one — a user looking for a note is thinking about its *subject*,
not about what it happens to link to. It answered that with a find-by-name field
in the step rail.

That field is **typed**, and the hand cannot type. The universal point-and-hold
fires `.click()` on buttons and links; clicking a text field does not put words
in it. So the hand can step the *results* of a search it has no way to *start*,
and the one instrument that made the galaxy navigable is the one part of it that
is not hands-free. Voice is the input that closes it — and the same lookup is
useful with the galaxy shut, where a user simply wants the note open.

There is a second reason to do this now rather than later. The vault is Iris's
own memory: she writes captures and run records into it unprompted, and can
already curate and read it through the `capture_learning` verb. But she cannot
answer "which note is that?" without spending a Claude run on a question that is
a string comparison. A name lookup is the cheapest thing this capability does and
currently the most expensive way to do it.

## What Changes

**Iris can find a note by name when asked aloud.** A new direct function —
**not** a verb — takes what the user said and returns the notes whose titles
match. Like `capture_note`, it is a local read: no Claude run, no tokens, no
execution slot, and it works with no Claude credential at all.

**The boundary against the existing curation verb is drawn explicitly**, because
this is the change's real hazard. `capture_learning` already covers "what do my
notes say about X" — retrieval, which is reading and synthesising across a vault,
and is judgement work the LLM-Wiki skills exist for. The new function covers
"which note is called X" — navigation, which is a string comparison. Both are
reachable by a spoken sentence and the two sentences look alike, so the
distinction has to be enforced where Gemini reads it, not left to prose.

**The galaxy's step rail can be populated by voice.** When the galaxy is open, a
spoken search fills the rail with the matches, steppable by dwell on exactly the
terms every other rail entry already is. Finding a note therefore becomes
hands-free end to end: ask, then point and hold. When the galaxy is shut the
lookup still answers — Iris just says what she found, and opening one from there
brings the galaxy up around it.

**Iris can open a found note by voice**, which leaves the camera anchored on it —
behaviour `second-brain-galaxy-view` already requires of *any* note-open, so the
voice route inherits it rather than introducing it. Asked with the galaxy shut,
opening **brings the galaxy up with it**: the note reader is part of that layer
and does not exist without it, so the alternative was to answer a request that
named a note by telling the user to go open something first.

**One matcher, in the main process — in its own module.** The renderer's
`railSearch` moves to a new `electron/note-name-match.mjs`, pure and
Electron-free like `vault-graph.mjs` beside it, and the typed field reads it over
IPC. Two implementations of "does this title match" that must agree is the defect
class this repo already names in its conventions, and the lookup has to work with
the galaxy closed — where there is no renderer state to match against — so main
is where it has to live regardless. Its own module rather than the capability's,
because `second-brain.mjs` is already 1211 lines against a 250–450 convention and
a pure string comparison is the last thing that needs to live inside it.

Explicitly **not** in this change:

- *Content search.* Matching is on the note's **name**. Searching what notes
  *say* is retrieval, it is what `capture_learning` is for, and duplicating it
  here as a cheap grep would produce a worse answer under a name that promises
  the same thing.
- *Creating, editing or deleting notes by this route.* `capture_note` and
  `mutate_vault_notes` already own writing; this reads.
- *A voice-driven camera drive, or a spoken galaxy switch.* The user's own
  conclusion from the galaxy's manual pass was that hands suit
  zoom/open/close/scroll and not finding. This change takes the finding; it adds
  no spoken control of the camera beyond opening a note, which the anchor rules
  already handle. Opening a found note while the galaxy is shut does activate
  it — but as an implied part of opening that note, not as a layer the user can
  ask Iris to toggle on its own.
- *Fuzzy or phonetic matching beyond case- and diacritic-folding.* A spoken title
  arrives already transcribed by Gemini, so the hard part of hearing it is done;
  what remains is worth judging on the simple rule before a cleverer one is added
  to compensate for a problem that may not exist.

## Capabilities

### New Capabilities

None. Finding a note in the vault is what `personal-knowledge-notes` already
covers; giving a name lookup its own capability would split the vault's story
across two specs for the sake of one function.

### Modified Capabilities

- `personal-knowledge-notes`: gains finding a note **by name** as a direct
  function on the same terms capture already holds (no run, no tokens, no
  execution slot, available without a Claude credential), plus the explicit
  boundary between that lookup and the curation verb's retrieval.
- `second-brain-gesture-nav`: the step rail's matches may be produced by voice as
  well as by typing, so reaching a note by hand no longer requires a keyboard to
  begin. Added as its own requirement rather than folded into the rail's stepping
  requirement — that one is about what the rail *is*, this is about where its
  words come from.

`second-brain-galaxy-view` needs no delta: its "Opening a note anchors the camera
on it" scenario is already unqualified as to *how* the note was opened, which the
voice route satisfies rather than changes — verified still present in the living
spec after `galaxy-note-reachable-by-hand` archived.

## Impact

- `electron/note-name-match.mjs` + `electron/note-name-match.test.mjs` — **new.**
  The matcher and its folding, pure and Electron-free, holding the assertions
  ported from `galaxy-rail.test.ts`.
- `electron/capabilities/second-brain.mjs` — the tool declaration, the call into
  the matcher over the graph it already reads, the prompt fragment's account of
  when to use which, the IPC handler the renderer reads, and the emit that
  carries matches and the open instruction to the galaxy.
- `electron/run-dispatch.mjs` — one dispatch case, on the non-pipeline side
  alongside `capture_note` and `mutate_vault_notes`. `UI_ACTIONS` is deliberately
  **not** touched.
- `electron/vault-graph.mjs` — read only, via the existing `getGraph()`; no new
  scan path, no new watcher, no signature change.
- `src/lib/galaxy-rail.ts` — `railSearch` (line 247) and `foldForSearch` move out
  to main; what remains is the rail's own shaping (`railRoots`,
  `railNeighbours`, `connectedRegions`, the island class).
- `src/lib/galaxy-rail.test.ts` — its `railSearch` block moves with the code.
- `src/components/VaultGalaxy.tsx`, `GalaxyStepRail.tsx` — matches arriving from
  main, whether the user typed them or said them.
- `src/App.tsx` — activating the galaxy when an open arrives with it shut (D5).
  The dwell rule is not touched.
- `electron/preload.cjs` + `src/vite-env.d.ts` — the new channels.
- `docs/GESTURES.md` — the "this half is typed, not hands-free" paragraph.
- No new dependency. No change to the vault's on-disk shape, the verb registry,
  the run queue, or `voice-ui-control`'s action vocabulary.
