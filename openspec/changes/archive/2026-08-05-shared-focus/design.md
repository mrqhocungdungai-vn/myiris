## Context

See `proposal.md — Why`. The state this builds on, all of it already shipped:

- **`vault-write-path` landed**, so `electron/vault-write.mjs` already exposes
  `appendSpoolRecord`, `appendSpoolRecordSync`, and `createNotePage`, and the
  precedent that a vault write is a write rather than a run is established in the
  living spec.
- **The graph is main-owned and live.** `vault-graph.mjs` holds a path-bearing
  cache, strips paths before IPC, resolves a node id to a path via
  `resolveNotePath`, and a recursive `fs.watch` with a 500 ms debounce rebuilds it
  while the galaxy is open. The renderer reconciles each graph against its own node
  objects, preserving positions.
- **`run-context.mjs` is the single composition point** for what a run's prompt
  carries, driven by the verb's own schema with no per-verb formatting code, and it
  already bounds and fences the recent transcript via `untrusted-text.mjs`.
- **`galaxy-nav.ts` owns the drive partition** as a pure function
  (`driveFor(hand, poseState) → { drive, state }`, drive ∈ dwell | orbit | zoom),
  and `nearestNodeAt` already does projection-based hit-testing with a depth
  filter. Both are unit-tested without a browser.
- **The HUD control island stays dwell-reachable under a fullscreen layer** — a
  requirement `two-hand-gestures` already carries, so a control placed there is
  hands-free by construction.

## Goals / Non-Goals

**Goals:**

- One focus, one owner, one composition point — no parallel notion of selection.
- The tap/zoom split lands in the existing pure partition so it is testable without
  a camera or a browser.
- The first renderer→vault write channel is narrower than the read channel it
  mirrors.

**Non-Goals (design-level):**

- **A general note-editing surface.** Only enumerated structural operations. Free
  text editing of a note stays with the worker or the user's editor.
- **Deleting notes.** Destructive and irreversible; it belongs behind an explicit
  confirmation design, and `two-hand-gestures` already reserves `[data-no-dwell]`
  for exactly that class of control. Out of scope here.
- **Search, filter, or layout changes.** The focus makes a subgraph addressable;
  rendering only the focused subgraph is a follow-on.
- **Multi-hand selection.** One hand taps. Two-palm gestures already mean resize.

## Decisions

### D1 — `electron/focus.mjs`: main-owned, Electron-free, no I/O

State is `{ ids: string[], at: number }` plus a bound. Resolution takes the graph
cache as an argument rather than importing `vault-graph.mjs`, so the module is a
pure function of (focus, graph) and testable with a literal graph object.

**Alternative considered: keep the focus in the renderer and pass it on each tool
call.** Rejected. The voice layer's *system context* needs it every turn so a
deictic request resolves without a round-trip, and the main process is what builds
that context. A renderer-held focus would also die with the galaxy's mount, which
the spec forbids.

**Alternative considered: store it in the session store alongside other
preferences.** Rejected — a focus is not a preference. It is scoped to the life of
the galaxy layer and must be cleared when the layer closes; persisting it across
restarts would resurrect a referent for a view that is not open.

### D2 — Ids stored, metadata resolved late

The focus holds only node ids. Titles and tags are resolved at each point of use
against `vault-graph.mjs`'s cache, and an id that no longer resolves is dropped.

This is what makes the rename and delete scenarios hold without any invalidation
machinery: there is no cached copy to invalidate. It also keeps the IPC payload a
list of short strings.

### D3 — Tap vs hold is a state machine inside `driveFor`, not a new call site

`driveFor` gains one more outcome, and its `PoseDriveState` gains the pinch's
engage timestamp. A pinch that releases before `TAP_MAX_MS` yields a `tap` drive
for one frame; a pinch still engaged past that window yields `zoom` exactly as
today.

Three consequences the spec pins and the implementation must honour:

- **No camera motion during the window.** `zoom` is not emitted until the window
  elapses, so the graph cannot move between the user's intent and its effect.
- **The zoom reference seeds when the window elapses**, not at engage, or the
  discrimination window would contribute an accumulated pinch delta and the camera
  would jump the moment zoom took over.
- **A slow release after a zoom is not a tap.** The machine must record that this
  pinch already became a zoom, so its release ends the zoom rather than completing
  a tap. This is the failure mode most likely to survive a naive implementation:
  measure-on-release alone cannot tell a 200 ms tap from the last 200 ms of a
  two-second zoom.

Keeping this in `galaxy-nav.ts` matters because it is the module the existing
partition tests exercise. A tap discriminated in `VaultGalaxy.tsx`'s rAF loop
instead would be untestable without a browser and a camera.

### D4 — A tap over nothing does nothing; clearing is a control, not a gesture

An accidental pinch over empty space is common; discarding a deliberately-built
selection on one is not recoverable by any undo Iris has. So clear is a button in
the HUD control island — which `two-hand-gestures` already requires to stay
dwell-reachable under a fullscreen layer, making it hands-free for free.

**Alternative considered: an open-palm sweep to clear.** Rejected — an open palm
already means scroll/resize elsewhere, a "sweep" needs a velocity threshold that
would fire on a hand leaving the frame, and it would be a new fragile detector
where a proven one already exists.

### D5 — The focus reaches runs through `run-context.mjs`, fenced, titles only

One more block beside the transcript, bounded independently, fenced with
`untrusted-text.mjs`.

Fencing is not optional: `wiki-ingest` pulls web content into the vault, and the
galaxy spec already treats note titles as untrusted enough to escape them before
they reach a tooltip. A title that reaches a model's prompt unfenced is a
prompt-injection vector with a shorter path than the note body has.

Bodies are excluded: the run has vault access and can read what it needs. Shipping
bodies would grow every prompt of a resumed session and widen the injection
surface for content the run could fetch itself.

### D6 — No new verb; `capture_learning` gains a referent

Its `focus` parameter already means "what to concentrate on", and with D5's block
present it has the identities too. A `curate_notes` verb would be the same
statefulness, the same skills, the same budget, and the same vault grant as the
verb that already exists — a second name for one agent, which is precisely what
the registry's per-verb capability scoping exists to prevent.

Its model stays `CHEAPEST`. Most curation is bookkeeping over text that already
exists, and a user who wants more for a hard synthesis already has the per-verb
model override. Silently promoting a verb's model because one new use case is
harder would change the cost of every existing call.

### D7 — Enumerated structural operations, resolved by id in main

`vault-write.mjs` gains `linkNotes`, `unlinkNotes`, and `setNoteTags` — named
operations over markdown text, each pure enough to test against a string. The IPC
handler resolves ids through `resolveNotePath` and re-asserts the
realpath-inside-the-vault check that `secondbrain:read-note` already performs.

**Alternative considered: one `mutateNote({ relativePath, content })`.** Rejected
— that is an arbitrary-write primitive reachable from the renderer, and it cannot
be audited by reading its call sites. The write side must be narrower than the read
side, not wider.

Linking is idempotent: if the target link is already present the file is left
alone and the operation still reports success, so a repeated voice command is not
an error and does not duplicate text.

### D8 — Live feedback is the existing watcher; no new mechanism

A structural edit writes files; `fs.watch` and the debounced rebuild already turn
that into a graph update that preserves settled positions. Nothing pushes a
synthetic update to the renderer, so there is one path by which the graph changes
and no way for an optimistic local update to disagree with disk.

The 500 ms debounce means the edge appears about half a second after the user
finishes speaking, which reads as responsive in a voice interaction. Not worth a
second, faster path.

## Risks / Trade-offs

- **The tap/zoom split makes zoom feel worse** — a zoom now cannot begin until the
  tap window elapses, adding a small deliberate delay to every zoom. Accepted:
  zoom is the less valuable of the two, and the alternative (a separate pose for
  selection) has no unclaimed pose left.
- **The first renderer→vault write channel** → Enumerated operations (D7), ids not
  paths, the read side's symlink assertion reused, and no free-text content in any
  structural op. Narrower than the read channel it mirrors.
- **An adversarial note title reaching the model** → Fenced on the run side (D5)
  and treated as untrusted in the voice context. This is the risk that grows
  silently: `wiki-ingest` makes the vault a place web content lands, and a title is
  the shortest path from there to a prompt.
- **The user believes something is selected that is not** → The visible-referent
  requirement exists for this and is specified as behavior, not polish. The failure
  is only discovered after the vault changed, so it has to be prevented at read
  time.
- **A mutation lands while the curator is mid-run over the same notes** →
  Last-writer-wins, the resolution `canvas-claude-mcp` already specifies. Both
  write whole files atomically where a page is created; a link insertion is a
  read-modify-write that could lose a concurrent edit to the same note. Accepted:
  the window is milliseconds and the loser is recoverable from the note's text.
- **Bound choices (tap window, focus size) are guesses until used by hand** → Both
  are single constants in modules that already hold their tuning constants
  together, tunable without touching structure.

## Migration Plan

None. Nothing is persisted, so there is no stored state to migrate or roll back.
Reverting removes the channels and the drive outcome; the vault is left with
whatever links were written, which are ordinary `[[wikilinks]]` in plain markdown
that Obsidian and the existing graph both already understand.

## Open Questions

- ~~Whether the focus should also drive **what the galaxy renders** (focus-only
  subgraph) as the answer to layout degradation past a few hundred nodes.~~
  **Resolved as a follow-on, implemented directly (not through a separate
  OpenSpec change):** the focus's one-hop link neighborhood
  (`focusNeighborhood`, `src/lib/galaxy-nav.ts`) dims everything outside it
  near-invisible via the node/link color accessors, rather than changing what
  is fetched, simulated, or positioned — see the "Second-brain galaxy
  gestures" section of `docs/GESTURES.md`.
