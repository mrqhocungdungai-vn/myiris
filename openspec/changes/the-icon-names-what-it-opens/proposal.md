## Why

The Glass HUD's second-brain button and its own tooltip describe different things.

`src/components/HudShell.tsx:400` renders lucide's `Network` — a node-and-edge diagram. `:398`, two lines above it, sets `title={secondBrainActive ? "Hide second brain" : "Show second brain"}`. So the glyph pictures **how the feature is currently drawn** (a graph) while the label names **the feature** (the second brain). A user reading the button alone learns "this shows a graph"; a user who waits for the tooltip learns something else.

Today that is only ambiguity. The reason to fix it now rather than later is that the ambiguity has a specific expiry date: the galaxy rendering is already generic — `src/lib/galaxy-nav.ts` exports 30 pure functions and not one knows what a note is — so a second feature drawn the same way is a realistic next step. At that point there are two HUD buttons opening visually similar views, and if both carry a graph glyph neither is identifiable. **An icon has to encode what differs between the buttons, and what differs is the feature, never the rendering.**

## What Changes

- `src/components/HudShell.tsx`: import `Brain` instead of `Network` (`:10`) and render `<Brain size={14} />` instead of `<Network size={14} />` (`:400`). The button's `title`, its `className`, its `onClick` and its availability gating are untouched.
- The rule the swap implements is added to the capability rather than left as a one-off edit: **the control identifies the feature, not the rendering it currently uses.**

`BrainCircuit` was considered and rejected. It suits the HUD's aesthetic better, but at `size={14}` its interior strokes crowd and the silhouette stops reading as a brain — which is the same "the icon does not say what this is" failure being fixed. `Brain` reads at that size.

Incidental, and recorded so it is not later mistaken for an unrelated edit: dropping `Network` from `HudShell` also clears a name collision with `src/components/HoloBackdrop.tsx:43`, which declares an internal component called `Network()`.

**Nothing else changes.** No IPC, no state, no prop, no behavior beyond the glyph drawn on one button.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `second-brain-galaxy-view`: gains a requirement that the "show second brain" control identifies the feature rather than the rendering, so the control and its label agree and two features drawn the same way stay distinguishable. Added as its own requirement rather than by modifying the existing toggle requirement, which is unchanged.

## Impact

- **Modified**: `src/components/HudShell.tsx` — two lines.
- **Unmodified**: everything else. No `src/lib/galaxy-*` module, no hook, no IPC channel, no test.
- **Verification**: `tsc` catches a bad import; the remaining gates confirm nothing else moved. There is no automated test of which glyph renders — this is verified by eye in a running app (`npm start`), and that is stated rather than papered over.

## Sequencing

First of three changes that separate the feature's name from its view's name. It is deliberately first because it is the only user-visible one, it is two lines, and it depends on neither of the others:

1. **this change** — the icon.
2. `the-brain-is-the-feature-the-galaxy-is-the-view` — renames the renderer identifiers that name the feature after the view, deleting the five lines that currently translate between the two vocabularies. Zero behavior change.
3. `a-hyphen-is-not-a-boundary` — splits the `second-brain-galaxy-view` capability into `second-brain-layer` and `galaxy-view`. The requirement this change adds moves to `second-brain-layer` there, unchanged.
