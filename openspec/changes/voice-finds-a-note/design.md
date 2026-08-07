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
- **The rail and its typed search do not exist in the living spec yet.** They
  arrive with `galaxy-note-reachable-by-hand`, which is implemented but not
  archived. This change is therefore written to land after it.

## Goals / Non-Goals

**Goals:**

- One definition of "this name matches that note", reachable from both the spoken
  and the typed route, so the two cannot drift.
- The lookup answers whether or not the galaxy is open — it is a question about
  the vault, not about the view.
- The distinction from retrieval is carried where Gemini reads it, not by hoping
  the prompt is weighed the same way twice.

**Non-Goals:**

- No change to how the vault is scanned, watched, or written.
- No new gesture, and no spoken control of the camera beyond opening a note.
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

### D2 — Matching moves to main, and the typed field reads it

`railSearch` and its folding leave `src/lib/galaxy-rail.ts` for the capability.
The galaxy's find field then asks main over IPC, debounced, instead of filtering
the graph copy it holds.

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

### D5 — Opening a found note reuses the existing route

Opening goes through the same path a click or a dwell already takes, so
"opening a note anchors the camera on it" applies without being restated. The
spec delta for `second-brain-gesture-nav` says this as a scenario rather than a
new rule for exactly that reason.

A **ghost** match (an unresolved `[[wikilink]]` target) has no file. It is
offered, because flying to it is meaningful and the rail already marks such
entries as not openable — but a request to *open* one is refused with that
reason, not with a read error.

### D6 — The lookup rescans, like every other read of this vault

`getGraph()` performs a fresh scan on every call, which
`second-brain-galaxy-view` already chose deliberately ("always a fresh scan").
The lookup follows it rather than reading the cache, so a note captured moments
ago by voice is findable by voice in the same conversation — which is the
scenario `personal-knowledge-notes` already requires of capture and retrieval
("a note captured in one turn is findable in a later turn").

### D7 — This change lands after `galaxy-note-reachable-by-hand`

The rail, its typed field, and `railSearch` all arrive with that change, which is
implemented but not archived — so `openspec/specs/second-brain-gesture-nav/`
does not describe the rail yet.

The delta here therefore **ADDs** a requirement about the rail rather than
MODIFYing the rail's own requirement: copying a requirement that is not in the
living spec yet would produce a MODIFIED block matching nothing at archive time.
The two changes must be archived in order, and this one's tasks begin by checking
that.

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
- **Ordering dependency on an unarchived change** (D7). → Mitigation: stated in
  the tasks as a precondition rather than discovered at archive time.

## Open Questions

- Whether the rail, once populated by voice, should stay populated until the user
  clears it or fall back to the entry points after a step. Both are defensible and
  the answer wants using rather than reasoning about; it changes no requirement
  here, since the spec says only what the rail offers, not how long for.
