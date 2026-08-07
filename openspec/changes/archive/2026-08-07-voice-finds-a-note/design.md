## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The insertion point already exists.** `electron/capabilities/second-brain.mjs`
  contributes `toolDeclarations` through the capability contract, and
  `run-dispatch.mjs` already dispatches two of its tools (`capture_note`,
  `mutate_vault_notes`) on the non-pipeline side. Adding a third is a record and a
  case, not new machinery.
- **Main already owns the graph.** `createVaultGraph` keeps the cache and
  `getGraph()` rescans; `second-brain-galaxy-view` records "main owns the graph
  data" as a decision. The renderer holds only a path-stripped copy.
- **The capability can already reach the renderer**, on its own channel:
  `emitToRenderer("secondbrain:graph-updated", …)` is the existing precedent.
- **`capture_learning` already covers retrieval** — reading and synthesising
  across the vault, as a verb, on the worker, with the LLM-Wiki skills. The new
  function must sit beside it without being reachable by the same sentences.
- **The rail and its typed search are now in the living spec.**
  `galaxy-note-reachable-by-hand` archived as
  `2026-08-07-galaxy-note-reachable-by-hand`, so
  `openspec/specs/second-brain-gesture-nav/` carries "A note is reachable by
  stepping through its neighbours" — including, inside it, "A note SHALL be
  reachable by name" and "Matching SHALL ignore case and diacritics". This
  change no longer waits on anything; what it must do instead is not restate
  what that requirement already says (D7).
- **The capability module is already oversized.**
  `electron/capabilities/second-brain.mjs` is 1211 lines — the largest non-test
  module in the repo, against a 250–450 convention. Anything this change adds
  has to be weighed against that (D2).
- **There is no voice route to the galaxy itself.** `NoteReader` renders only
  under `secondBrainActive && openNote` (`src/App.tsx:2046`), and
  `run-dispatch.mjs`'s `UI_ACTIONS` vocabulary has no galaxy toggle. Opening a
  found note while the galaxy is shut therefore needs a route that does not
  exist yet (D5).

## Goals / Non-Goals

**Goals:**

- One definition of "this name matches that note", reachable from both the spoken
  and the typed route, so the two cannot drift.
- The lookup answers whether or not the galaxy is open — it is a question about
  the vault, not about the view.
- The distinction from retrieval is carried where Gemini reads it, not by hoping
  the prompt is weighed the same way twice.

**Non-Goals:**

- No change to how the vault is scanned, watched, or written — the lookup calls
  the `getGraph()` that exists, and adds no scan path and no watcher.
- No new gesture, and no spoken control of the camera beyond opening a note.
  Opening a note may bring the galaxy up around it (D5), but the galaxy does not
  become something Iris can be asked to open or close on its own.
- No growth of `voice-ui-control`'s action vocabulary (D4).
- No ranking cleverer than the existing fold-and-rank until the simple one has
  been judged in use.

## Decisions

### D1 — A capability tool, not a verb

The lookup is declared by the second-brain capability and dispatched beside
`capture_note` and `mutate_vault_notes`, outside `PIPELINE_ONLY_TOOLS`.

The verb registry is for work that runs on the worker. Comparing a string against
a list of titles is not that, and modelling it as a verb would hand it a run's
latency, cost, credential requirement and queue position — the identical argument
`personal-knowledge-notes` already records for capture, read in the other
direction. The registry's "a verb is defined in exactly one place" discipline is
not weakened by this: the tool is not a verb, and the capability is the one place
it is defined.

### D2 — Matching moves to main, into its own module, and the typed field reads it

`railSearch` and its folding leave `src/lib/galaxy-rail.ts:247` for a **new pure
module, `electron/note-name-match.mjs`**, with its own test file. The capability
imports it; the galaxy's find field asks main over IPC, debounced, instead of
filtering the graph copy it holds.

*Why a module and not a function inside the capability.*
`electron/capabilities/second-brain.mjs` is 1211 lines — the largest non-test
module in this repo and roughly three times the 250–450 convention. Deciding
whether a string matches a title is a pure comparison over `{ nodes, links }`:
it holds no state, touches no filesystem, knows nothing about spools, focus,
ambient capture or the run inbox, and is exactly the kind of thing
`electron/vault-graph.mjs` already demonstrates belongs on its own — Electron-free,
importable in a plain vitest file, testable without constructing a capability.
Folding it into the capability would put the one piece of this change that is
trivially testable inside the one module that is hardest to read.

*Alternative considered:* add it to the capability as the change originally
said, on the grounds that fewer files is simpler. Rejected: the simplicity is
in the wrong place. The capability gains an import either way; what differs is
whether the matcher can be read, tested and changed without loading 1200 lines
of unrelated context first.

The forcing constraint is the spec: the lookup must answer with the galaxy
closed, where no renderer state exists to match against. So main needs a matcher
regardless. Given that, the only question is whether the renderer keeps its own —
and two implementations of one comparison that must agree is precisely the defect
class this repo's conventions name. It is also not hypothetical here: the folding
rule (case, then diacritics) is exactly the kind of detail one side gets updated
without the other.

*Alternative considered:* keep both and pin them together with a test that runs
the two over one fixture. Vitest's `unit` project would allow it — a
`src/**/*.test.ts` file can import an `electron/**/*.mjs` sibling. Rejected: a
test that two things agree is a weaker guarantee than there being one thing, and
it leaves a reader of either implementation unaware the other exists.

*Cost, accepted:* the find field now makes a local IPC round trip per debounced
keystroke instead of a synchronous array filter. That is a real regression in
directness for a feature that shipped days ago, bought with the guarantee that
what the user hears and what the user sees cannot disagree.

### D3 — The boundary against retrieval is declared, not described

This is the change's central hazard: "find my note about the deployment" and
"what do my notes say about the deployment" are one word apart, and they route to
completely different machinery — an instant local read versus a Claude run.
Choosing wrong is not symmetrical. Sending a contents question to the title
lookup produces a confident answer from a filename, which is worse than the slow
correct one; sending a name lookup to the verb merely costs money and time.

Three mechanisms, in decreasing order of how much they can be ignored:

1. **The tool's name and parameter name say what it takes** — a *name*, not a
   subject or a question. A schema is a contract the calling interface enforces;
   prose is advice. This is the same reasoning `verb-tool-surface` records for why
   the eight verbs are eight schemas rather than one tool plus instructions.
2. **The declaration's description states the negative case explicitly** and names
   the alternative, exactly as `capture_note`'s already does for
   `capture_learning` ("Do NOT use this for … — that is the instant capture_note
   tool, not this verb"). That pairing works today and is the pattern to copy.
3. **The prompt fragment describes when to use which**, which is the weakest of
   the three and is why it is not the only one.

*Alternative considered:* one tool with a `mode` parameter. Rejected — it would
make the cheap local read and the billed worker run reachable by the same call
with a one-token difference, which is the opposite of the separation being
sought.

### D4 — Matches reach the rail on the capability's own channel

`emitToRenderer("secondbrain:…", …)`, not `iris:ui-action`.

`voice-ui-control` specifies a **fixed vocabulary** of UI actions and enumerates
it — tasks, readers, history, step timelines. Putting a note-search action into
that list would grow a spec that is not about the second brain, and would make
every future reader of that vocabulary wonder why one entry belongs to a
different capability. The capability contract exists so a capability can own its
own channels; this is what it is for.

The tool still returns its matches to Gemini directly rather than only emitting
them, because the answer has to exist when there is no galaxy to emit into.
Emitting is how the rail learns; returning is how Iris speaks.

The **open** instruction rides the same channel, for the same reason and one
more: `UI_ACTIONS` in `run-dispatch.mjs` enumerates ten actions and none of them
concerns the galaxy, so opening a found note through `iris:ui-action` would mean
adding the second brain to a vocabulary that has never contained it — the
outcome D4 exists to avoid.

### D5 — Opening a found note reuses the existing route, and brings the galaxy with it

Opening goes through the same path a click or a dwell already takes, so
"opening a note anchors the camera on it" (`second-brain-galaxy-view`, still
present in the living spec) applies without being restated. The spec delta for
`second-brain-gesture-nav` says this as a scenario rather than a new rule for
exactly that reason.

**With the galaxy shut, opening activates it first.** The reader is not
independent of the galaxy: `NoteReader` renders only under
`secondBrainActive && openNote` (`src/App.tsx:2046`), so there is no such thing
as opening a note without the galaxy layer. Given that, the choice is between
activating it and refusing. Activating is right, because the alternative makes
the shortest route to a note the longest — the user has already named the note
and asked for it, and answering "open the galaxy first" spends a turn telling
them to do the thing their request already implied. The anchoring rule then
applies unchanged, since by the time the note opens the galaxy is exactly as
active as it would have been had they opened it themselves.

*This is deliberately not a general spoken galaxy control.* Activation happens
**as part of opening a named note**, not as a thing the user can ask for on its
own. The proposal's exclusion of a voice-driven camera drive stands: this adds
one implied step to one action, not a spoken switch for the layer.

A **ghost** match (an unresolved `[[wikilink]]` target) has no file. It is
offered, because flying to it is meaningful and the rail already marks such
entries as not openable — but a request to *open* one is refused with that
reason, not with a read error, and refusing SHALL NOT activate the galaxy: there
is nothing to show.

### D6 — The lookup rescans, like every other read of this vault

`getGraph()` performs a fresh scan on every call — `electron/vault-graph.mjs:137`,
and its own comment says so: "Always performs a fresh scan … independent of
whether the watcher is running". The lookup calls it rather than reading the
cache, so a note captured moments ago by voice is findable by voice in the same
conversation — the scenario `personal-knowledge-notes` already requires of
capture and retrieval ("a note captured in one turn is findable in a later
turn").

**With the galaxy closed this is not a preference, it is the only correct read.**
The watcher is scoped to galaxy-active, so nothing is keeping the cache fresh
when the galaxy is shut — and `createVaultGraph` initialises it to
`{ nodes: [], links: [] }`, so on a cold session it is not merely stale but
empty. A lookup reading the cache would answer "no matches" for an entire vault.

This has a second consequence the change depends on. `resolveNotePath()` reads
that same cache, and it is what turns a node id into a file for the reader.
Because the lookup rescans, it **primes** the cache as a side effect — which is
exactly what makes D5's "open the one you just found" work with the galaxy
closed and the watcher off. Opening a found note is therefore never a read
against a cache the lookup did not populate.

*Correction to an earlier draft:* this decision previously credited
`second-brain-galaxy-view` with choosing "always a fresh scan". That phrase is
not in the living spec — it is in the code comment above and in the archived
`2026-07-24-second-brain-galaxy-view` change. The behaviour is real; the
citation was not.

### D7 — The delta ADDs a requirement rather than amending the stepping one

`galaxy-note-reachable-by-hand` has archived, so the rail *is* in the living
spec. The original reason for ADDing — that a MODIFIED block would match nothing
at archive time — no longer applies, and the decision has to be re-made on its
merits. It comes out the same way, for a better reason.

The living requirement "A note is reachable by stepping through its neighbours"
is about **what the rail is**: neighbours, entry points covering every region,
one deliberate act per step, no new gesture, stepping selects nothing. Inside it
sits "A note SHALL be reachable by name", which is about the rail having a
find at all. What this change adds is about **where the words come from** — that
the one input the hand cannot supply can be spoken, and that the question
survives the rail not being on screen. That is a different claim about a
different part of the system, and it is true whether or not the rail exists;
folding it into a requirement titled for stepping would bury it.

What ADDing costs is that two requirements now touch the same feature, so the
delta must not restate what the living one already settles. Specifically it
**SHALL NOT** re-specify case- and diacritic-folding (the stepping requirement
already requires it, and `personal-knowledge-notes` states the rule for the
lookup itself), and it **SHALL NOT** restate that rail entries are steppable
without a new gesture. It refers to those and asserts only what is new: the
spoken route, its equivalence with the typed one, that it selects nothing, and
that it answers with the galaxy closed.

*Alternative considered:* MODIFY the stepping requirement, extending its
by-name paragraph to say the query may be spoken. Rejected — it would grow a
requirement that is already the longest in the capability, and would make a
reader looking for "can I find a note by voice" read a requirement about walking
links to discover that they can.

## Risks / Trade-offs

- **Gemini routes a contents question to the title lookup** and answers from a
  filename. → Mitigation: D3's three mechanisms, and the lookup returns *titles*
  rather than content, so the worst case is Iris naming notes rather than
  inventing what they say. Worth a deliberate check in the manual pass, phrased
  both ways.
- **A fresh scan per lookup** is a filesystem walk per spoken question. Fine at
  the hundreds of notes a personal vault holds; not obviously fine at tens of
  thousands. → Mitigation: measure on the seeded test vault, and record the
  number rather than assuming. The cache is there to fall back on if it bites.
- **The typed field regresses from a local filter to an IPC round trip** (D2).
  → Mitigation: debounce, and the call is same-machine; if it reads as laggy the
  answer is a shorter debounce, not a second matcher.
- **A spoken title is whatever the transcription heard.** Folding case and
  diacritics handles the common failure; a genuinely misheard word will simply not
  match. → Mitigation: report no-match honestly (the spec requires it), so the
  user rephrases rather than being handed a wrong note. Deliberately not
  compensated for with fuzzy matching before it is known to be needed.
- **Two requirements now describe one feature** (D7): the living stepping
  requirement owns the rail's find, this change's added requirement owns the
  spoken route into it. → Mitigation: the added requirement refers rather than
  restates, per D7's explicit SHALL NOTs; `spec:check` is the gate that would
  catch the two drifting apart in code, but nothing checks two specs against
  each other, so this one is on the reader.
- **Opening now activates a layer the user did not ask for** (D5). A user who
  says "open it" with the galaxy shut gets a full-screen galaxy as well as a
  note. → Mitigation: it is the layer the reader lives in, so there was never a
  version of this that showed only the note; and closing the reader leaves them
  in the galaxy they can close on the same terms as any other time they opened
  it. Worth watching in the manual pass for whether it reads as helpful or as
  the app taking over the screen.

## Open Questions

- Whether the rail, once populated by voice, should stay populated until the user
  clears it or fall back to the entry points after a step. Both are defensible and
  the answer wants using rather than reasoning about; it changes no requirement
  here, since the spec says only what the rail offers, not how long for.
