## Why

The galaxy is the one surface in Iris where the voice is blind. It renders the
user's knowledge in space, the hands can move the camera through it, and the voice
layer does not know it is open, cannot see the graph, and has no idea which node
the user is looking at. So every deictic sentence a person would naturally say
there is unavailable: *this*, *that*, *these two*, *what am I missing here*.

The consequence for the hands is worse. Every gesture binding the galaxy has
resolves to one of three drives — dwell-to-open, orbit, zoom. Not one of them
changes anything. The hand is an input device for a read-only viewer, so it is
competing with a mouse at the one job a mouse is better at, and losing. All the
care in `second-brain-gesture-nav` is spent making a camera control feel good.

The fix is a single shared referent: **voice supplies the verb, the hand supplies
the noun.** With the vault now writable (`vault-write-path`), pointing at two notes
and saying "connect these" can actually connect them — and the live `fs.watch`
rebuild that already preserves node positions turns that into an edge forming on
screen. That machinery is built and specified; what is missing is the referent.

## What Changes

- **A new shared Focus**: the set of notes the user currently has selected in the
  galaxy, owned by the main process, produced by the hand and the mouse, and read
  by both the voice layer and Claude's runs. Node ids only, resolved late against
  the live graph, bounded in size, cleared when the galaxy closes.
- **The hand gains a selection gesture.** A pinch *tap* over a node toggles its
  selection; a pinch *hold* still zooms, dwell still opens, a fist still orbits.
  Clearing the selection is a control in the HUD island (already dwell-reachable
  under a fullscreen layer) rather than a newly invented gesture.
- **The selection is visible** — selected nodes are ringed and a focus chip names
  them — so the user can see what "these" refers to before they speak.
- **The voice layer learns what is focused**, as a bounded, escaped line in its
  system context, so "connect these two" resolves without a tool round-trip.
- **Claude's runs receive the focus** the same way they already receive the
  transcript: one fenced block composed at the single composition point, not a new
  parameter per verb.
- **Structural vault edits become direct writes**: linking two notes in both
  directions, unlinking, and retagging are enumerated operations on the existing
  vault write path — no run, no tokens. Judgement-shaped work (merge, split,
  summarize, "what am I missing") stays with the existing `capture_learning` verb,
  whose `focus` parameter already means exactly this.
- **No new verb.** The registry does not grow; the existing curator gains a
  referent.

Non-goals: the galaxy↔canvas bridge (a later change); ambient session capture
(`ambient-memory`); search/filter/layout changes to the galaxy; and any generic
"apply this patch to a note" surface — operations are enumerated deliberately.

## Capabilities

### New Capabilities

- `second-brain-focus`: the shared selection of vault notes — how it is produced,
  bounded, resolved, published to the voice layer, delivered to runs, and cleared.

### Modified Capabilities

- `second-brain-gesture-nav`: the gesture partition gains a selection action; the
  pinch is split into tap (select) and hold (zoom), and the partition's existing
  guarantee that no two drives act at once must continue to hold across that split.
- `personal-knowledge-notes`: structural edits between existing notes are direct
  writes rather than worker work, on the same terms capture already is.

`second-brain-galaxy-view` is deliberately **not** modified. Nothing it requires
becomes false: selection rendering and the focus lifecycle are focus behavior and
belong to the new capability, and the write channels are implementation of a
`personal-knowledge-notes` requirement rather than a change to what the galaxy must
do. Restating them there would create a second owner for the same behavior.

## Impact

**New:** `electron/focus.mjs` (+ tests) — Electron-free, no I/O; owns the focus
state, its bound, and its resolution against the graph cache.

**Changed:** `electron/vault-write.mjs` (enumerated structural edits: add/remove a
wikilink in both directions, set tags); `electron/capabilities/second-brain.mjs`
(focus IPC, mutation IPC, the focus line in the prompt fragment);
`electron/run-context.mjs` (compose the fenced focus block, as it already does for
the transcript); `electron/verbs.mjs` (`capture_learning`'s `focus` parameter
description acknowledges a selection may already be present);
`src/lib/galaxy-nav.ts` (tap-vs-hold in the drive partition);
`src/components/VaultGalaxy.tsx` (selection rendering, tap handling, mouse
select); `src/components/HudShell.tsx` (focus chip, clear control);
`electron/preload.cjs` + `src/types.ts` (the new channels).

**Security surface:** this adds the first renderer→vault write channel. Operations
are enumerated (not a patch primitive), targets are resolved by node id against
the main process's graph cache, and the existing symlink/inside-the-vault
assertion that guards `secondbrain:read-note` is reused on the write side. Note
titles reaching the voice layer or a run prompt are treated as untrusted — the
galaxy spec already establishes that vault content may originate from the web.

**User-visible:** you can point at notes and talk about them; linking two notes is
instant and free; the graph updates on screen as it changes. With hand control off,
everything remains reachable by mouse and keyboard.
