## Context

See `proposal.md — Why` for motivation. The constraints that shape the approach:

- **The main process's event loop is shared** with the Gemini Live websocket and
  the 16/24 kHz audio IPC. `vault-graph.mjs` already documents this as the reason
  its scan is async with bounded concurrency rather than a `readFileSync` loop.
- **`run-inbox.mjs` already writes to the vault**, synchronously, from the
  run-finalize path, and is documented as never-throws-by-design: bookkeeping must
  not disturb a run that has already finished.
- **A verb is defined in exactly one place** (`electron/verbs.mjs`), and the
  registry's abstraction is specifically *work handed to Claude*.
- **`electron/atomic-file.mjs`** already provides the async temp+rename write the
  canvas store uses.
- **Only four modules may import Electron.** The write path must be
  Electron-free, like every other module under `electron/`.
- The vault graph is rebuilt by a recursive `fs.watch` with a 500 ms debounce, so
  **anything this change writes into the vault is read back by a live scan.**

## Goals / Non-Goals

**Goals:**

- One module owns writing to the vault, and both the new capture path and the
  existing run-record path go through it.
- Capture answers the voice layer with a real success/failure, derived from the
  filesystem rather than from a model's claim.
- No new `query()` option and no change to any run's configuration.

**Non-Goals (design-level, beyond the proposal's scope statement):**

- **Consuming or pruning the spool.** This change does not delete spool entries,
  mark them consumed, or change what the curator does with them beyond reading a
  wider directory. Spool lifecycle is a separate concern with its own failure
  modes (a crash between "read" and "marked") and does not need solving to make
  capture free.
- **Changing `appendRunRecord`'s synchronous signature.** Making the
  run-finalize path async would ripple through `captureRunOutcome` and its
  callers for no user-visible benefit.
- Any renderer→vault write channel. Nothing in the renderer needs one yet.

## Decisions

### D1 — A new `electron/vault-write.mjs`, and `run-inbox.mjs` delegates its append to it

The module owns *writing to the vault*; `run-inbox.mjs` keeps owning *what a run
record looks like* and calls in for the write.

**Alternative considered: extend `run-inbox.mjs`.** Rejected — its documented
responsibility is one record shape for finished runs, and a user capture has a
different shape, a different trigger, and a different consumer. Merging them
would give one file two responsibilities against the repo's 250–450-line,
one-responsibility convention.

**Alternative considered: leave `run-inbox.mjs` writing on its own.** Rejected —
two independent writers into the same directory is how the `inbox/` exclusion got
missed in the first place. One writer means one place to change when the spool's
location or naming moves.

### D2 — Two write shapes, deliberately, because the two callers differ in what they can await

`vault-write.mjs` exposes:

- `appendSpoolRecordSync(...)` — for the run-finalize path, preserving
  `appendRunRecord`'s existing synchronous, never-throws contract verbatim.
- `appendSpoolRecord(...)` — async, awaited by the capture tool handler, so the
  tool's reply to Gemini reflects what actually happened on disk.
- `createNotePage(...)` — async and **atomic** via `atomic-file.mjs`.

The asymmetry is the point, not an oversight: a fire-and-forget finalize hook and
a request/response tool handler have genuinely different needs, and forcing one
shape on both would either make the tool lie about success or make the finalize
path async for nothing.

`createNotePage` is atomic where the spool appends are not, because a page is
parsed by the live `fs.watch` rebuild — a half-written page would be scanned as a
malformed note. A half-written *append* to a spool file is invisible to the graph
by D5, so an append needs no temp+rename.

### D3 — A capture lands in the spool, not as a note page

A one-line spoken thought has no title, no tags, and no links. Writing it
straight out as a page would manufacture exactly the disconnected orphan node
this change is removing elsewhere — and it would make the galaxy worse in
proportion to how much the user talks.

So capture appends to `inbox/captures/<date>.md`, one file per day, matching the
run spool's existing shape. Promotion to a linked page is the curator's job,
which is the log-vs-synthesis split `run-inbox.mjs` already argues for.

**Consequence to honour:** the spec requires a captured note to be *findable in a
later turn*. It is — the spool is inside the vault the curator and retrieval verb
already have granted, so retrieval reads it. This is not automatic: the verb's
clause must name the spool, or `wiki-query` will search only the curated wiki and
answer "nothing found" about a note the user just captured. That is a task, not
an assumption.

**Alternative considered: capture creates a page immediately.** Rejected for the
orphan-debris reason above. `createNotePage` still exists for the curator and for
an explicit "write this up as a page" request.

### D4 — Capture is a declared tool, not a verb

It is declared directly by the second-brain capability and handled in the main
process; it does not enter the verb registry, and `run-dispatch`/`run-exec` never
see it. Its shape follows the existing non-run tools (a tool that answers
directly rather than returning a `run_id`).

**Alternative considered: add it to `verbs.mjs` with a "does not actually run
Claude" flag.** Rejected, and this is the load-bearing decision of the change. The
registry's whole value is that every record means the same thing — work handed to
Claude, with a model, a budget, skills, and a park label. A record for which all
five are meaningless would make the registry's abstraction a lie, and every
consumer that derives from it (`gemini-tools`, `run-dispatch`, `run-exec`) would
need a special case. Capture is not a verb, so it does not get a verb record.

### D5 — `inbox` joins `NOTES_PLUMBING_FOLDERS`, at the vault root only

A one-line change in `vault-graph-parse.mjs`. The exclusion keeps the predicate's
existing root-only semantics (`segments[0]`), so a user note that happens to sit
under a deeper folder named `inbox` is still a note — asserted as a scenario in
the delta spec rather than left implicit.

This must land in the same change as capture, not after it: capture increases how
fast the spool grows, so shipping the write path first would make the pollution
worse before fixing it.

### D6 — `capture_learning` keeps its name while its job narrows

Only its `description` and `clause` change (plus the `save` parameter's
description, to distinguish "write this up as a page" from a raw capture).

The name stays because `sessionKey: "capture_learning"` identifies its resumable
session and the session store keys the user's per-verb model override by verb
name. Renaming would silently orphan both — a stored override would stop applying
and the verb would resume nothing, with no error to notice.

### D7 — Capture creates the vault on demand, and is gated on nothing else

The handler calls the existing `ensureNotesVaultReady()` (which also pre-seeds
`wiki-config.md`/`wiki-schema.md`) before writing. This matches the already-specced
"the vault is created on demand" behavior and is what makes the galaxy toggle
appear after a first capture without a relaunch — a scenario
`second-brain-galaxy-view` already requires.

### D8 — A model-supplied title never chooses a path

`createNotePage` sanitizes a title into a safe basename and asserts the resolved
path is inside the vault before writing, the same discipline
`secondbrain:read-note` already applies on the read side. The title arrives from
a model that heard audio from a microphone; it is not a filename.

### D9 — No `query()` options change, and no new env var

Capture starts no run, so `electron/sdk-options.test.mjs` (which asserts each run
shape's complete options key set) is untouched. And nothing here needs an opt-in:
capture happens because the user asked for it, so there is no ambient-recording
surface to gate. `.env.example` is unchanged.

## Risks / Trade-offs

- **The spool grows unboundedly** → One file per day, plain markdown, inside a
  folder the user can open and delete from — the same bound `inbox/runs/` already
  lives with. And by D5 its growth no longer costs anything in the galaxy.
- **Free capture invites over-capture; Gemini may save more eagerly than the user
  wants** → The prompt fragment's existing rule stands (offer once, never
  auto-save, drop silently if ignored). The blast radius is bounded by D3: extra
  captures land in the spool, never as graph nodes.
- **Retrieval silently misses fresh captures** → This is the most likely way the
  change ships broken, because everything else about capture would appear to work.
  Mitigated by D3's consequence being an explicit task with its own test, not a
  prompt tweak.
- **A capture is written while the curator is mid-run over the spool** → Appends
  are additive and the curator re-reads on its next run, so the worst case is a
  capture waiting one cycle. No merge, no lock, no lost write.
- **The `never throws` contract weakens if the async path rejects** →
  `appendSpoolRecord` resolves `{ ok, error }` rather than rejecting, so a caller
  cannot accidentally turn a full disk into an unhandled rejection in the main
  process.
- **A user relies on the date nodes they had grown used to seeing** → Judged not
  a real dependency: they are Iris's own run bookkeeping, not authored content,
  and the files remain readable in any editor.

## Migration Plan

None required. No files move, nothing is deleted, and no format changes.
Previously-scanned spool files simply stop appearing as nodes on the next scan.

Rollback is reverting the change: the spool files are still on disk, the
predicate re-admits them, and the capture tool disappears from the declaration
set. No persisted state is written that an older build could not read.
