## Why

Two gaps, one cause.

**There is no hover highlight at all.** No `onNodeHover` handler exists anywhere
in the galaxy; hovering a node produces only the built-in tooltip. What does make
a cluster stand out is the **focus**: Cmd/Ctrl-click a node
(`VaultGalaxy.tsx:402`) and everything outside its one-hop neighbourhood is dimmed
to near-invisible (`DIM_NODE_ALPHA = 0.08`, `DIM_LINK_ALPHA = 0.05`). That is a
deliberate, sticky *selection* — it changes the shared focus the voice layer and
Claude's runs read — and it is the only thing in the view that answers "what is
this note connected to". Answering that question should not require making a
selection.

**And by hand there is no way to ask the question at all.** The pose partition
(`driveFor`, `galaxy-nav.ts:200`) is: two open palms zoom, `Pointing_Up` dwells,
`Closed_Fist` orbits, everything else drives nothing. `Pointing_Up` at a node
opens it after 300 ms — so the one hand pose that targets a node consumes the
target by opening it. There is nothing between "not looking at it" and "reading
it".

The second gap was a **recorded decision with a stated expiry**, in
`second-brain-gesture-nav`, "Focus is reachable without hands":

> "**There is deliberately no gesture that selects a node.** … today the voice
> surface of the second brain is capture and curation, with no tool that opens or
> points at a note, so the focus's main consumer is not yet in play. **Adding a
> selection gesture is worth doing when it is** — and until then, a gesture that
> quietly toggles a selection the user cannot easily see is a way to change their
> vault by accident."

That condition is now met: `open-note-session` shipped a resident verb that opens
a note, reads it back verbatim, and edits it by conversation, and its own
requirement "Structural edits target the open note when there is one" makes the
referent load-bearing. The focus's main consumer is in play, so the gesture the
decision deferred is now the gesture the decision asks for. `second-brain-focus`
already wrote down the constraint it must satisfy: "a gesture producer added later
SHALL feed this same focus rather than introduce a second one."

## What Changes

- **A pointed-at node lights up its links.** The links incident to the node the
  user is pointing at are drawn bright instead of the faint base blue, and the
  node's one-hop neighbours are drawn at full strength — even when the focus
  declutter has dimmed them, so pointing at a dimmed node reveals what it
  connects to. Transient, and it changes nothing: no selection is made, no
  camera moves, no note opens.
- **"Pointing at" has two producers and one meaning.** The mouse hovering a node
  and the hand targeting a node are the same state, rendered the same way. The
  hand's target already existed (it is what the dwell highlight paints); this
  makes it light the cluster too, and gives the mouse the same power for the
  first time.
- **The highlight follows a hand that is doing nothing.** With hand control on,
  moving a hand near a node highlights it and its cluster whatever pose the hand
  is in, as long as no camera drive is engaged. Highlighting is feedback, not a
  drive: the pose partition still decides what *acts*, and a resting hand still
  acts on nothing. This is what makes inspection by hand possible at all —
  otherwise the only node-targeting pose is the one that opens the note.
- **A new pose selects: `Victory` (two fingers) held over a node toggles its
  focus.** Held, not tapped — it reuses the existing 300 ms dwell state machine,
  including its "must leave the node and re-acquire before it can fire again"
  rule, which a toggle needs even more than an open does. It feeds the one
  authoritative focus through the same call the mouse's Cmd/Ctrl-click uses.
  So: point to look, `Victory` to hold it, `Pointing_Up` to open it.
- Dwell stays 300 ms and opening stays as fast as it is. The two-open-palms zoom,
  the fist orbit, and the "a pinch means nothing in the galaxy" rule are all
  untouched.

## Capabilities

### New Capabilities

<!-- none: three existing capabilities change -->

### Modified Capabilities

- `second-brain-galaxy-view`: gains the pointed-at cluster highlight — what is
  drawn, that it is transient and changes no state, and that it renders
  identically whichever input produced it. The view owns this because it is what
  the view draws, for both producers.
- `second-brain-gesture-nav`: the pose partition gains `Victory` → select, so
  "any other pose drives nothing" is no longer the whole story; the recorded
  "there is deliberately no gesture that selects a node" decision is reversed on
  its own stated terms; and the pointed-at highlight is defined as feedback that
  is explicitly outside the partition.
- `second-brain-focus`: its producer paragraph — "the renderer's means of
  producing it is currently the mouse alone" — becomes mouse and gesture, both
  feeding the same single focus, exactly as that requirement already demanded of
  a later gesture producer.

## Impact

- `src/lib/galaxy-nav.ts` — `driveFor` gains a `"select"` drive for `Victory`, so
  its input type must widen from `pointing`/`fist`/`hands` to include the pose
  name. `focusNeighborhood` is reused unchanged for the one-hop highlight set —
  the same function the dimming already uses, so the two can never disagree about
  what "one hop" means.
- `src/lib/galaxy-nav.test.ts` — the partition's new case, and that no other pose
  gained a meaning.
- `src/components/VaultGalaxy.tsx` — an `onNodeHover` handler, a second dwell
  state for the select drive, `makeNodeColor`/`makeLinkColor` gaining the
  pointed-at set, and one repaint funnel shared by both producers.
- `docs/GESTURES.md` — the galaxy pose table gains `Victory`, and its table still
  documents the pinch bindings that `two-palm-galaxy-zoom` removed; the rows this
  change touches are corrected rather than left contradicting `driveFor`.
- No IPC, main-process, dependency, or CSS change: `secondbrain:set-focus` is
  already the toggle both producers call, and the highlight is a colour accessor.
