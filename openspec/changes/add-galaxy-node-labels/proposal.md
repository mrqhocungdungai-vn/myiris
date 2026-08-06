## Why

The galaxy renders the vault as a field of coloured dots with **no names on it**.
The only title affordance in the whole view is 3d-force-graph's built-in hover
tooltip (`nodeLabel`, `VaultGalaxy.tsx:391`), and a tooltip has three problems
here:

- It shows **one** title, and only while a pointer is held over that exact node.
  Finding a particular note means probing dots one at a time.
- Under hand control there is no pointer and no tooltip at all. The dwell gesture
  recolours a node for 300 ms and then **opens** it — so the only way to learn
  what a node is, is to open it and read.
- It is a hover affordance layered over a view whose whole premise is navigation:
  the galaxy exists to be flown through, and flying through it currently tells
  you nothing about where you are.

So the view the user actually has is a star map with no place names. The vault's
value is in the notes, and the galaxy is the surface for finding them; a map you
cannot read is a map you fly around in until you give up and open Obsidian.

Obsidian's own graph solves exactly this by tying titles to zoom: pulled back,
the graph is a clean cloud of dots; zoomed in, titles appear and you can read
your way to the note you want. That is the behaviour this change brings to the
galaxy, adapted to a 3D camera.

## What Changes

- **Note titles render in the scene, revealed by proximity.** A node's title
  appears as text beside it only while the camera is within a distance threshold
  of that node, and disappears beyond it. Pulled back, the galaxy stays the
  unlabelled deep-space cloud it is today; fly into a region and the notes in
  that region name themselves.
- **Proximity, not a global zoom step.** In 3D a single "past this zoom, show
  everything" threshold would reveal the far side of the graph at the same
  moment as the cluster in front of the camera — hundreds of tiny overlapping
  strings, worst exactly where the vault is largest. Distance-per-node gives the
  same "zoom out → clean, zoom in → readable" feel while only ever naming what
  the user is actually near.
- **The number of titles on screen at once is bounded** by a fixed budget filled
  nearest-camera-first, so labelling costs the same in a 50-note vault and a
  5000-note one — the view does not get slower the more the app is used.
- **Titles obey the existing focus declutter.** While a focus is active, only
  nodes inside its one-hop neighbourhood (the ones not dimmed to near-invisible)
  are eligible for a title, so the two decluttering mechanisms agree instead of
  the labels re-cluttering what the dimming just cleared.
- **Titles are inert by construction.** The label is text drawn into a canvas
  texture, not markup handed to an HTML surface — a stronger containment than
  the escaping the tooltip needs, on a view whose notes may have come from the
  web.
- The hover tooltip is left exactly as it is. This adds an affordance; it removes
  none.
- **No new dependency.** The label sprites are built from `three` primitives the
  same way the galaxy already hand-rolls its own starfield, rather than pulling
  in `three-spritetext` — which would add a second package with its own `three`
  requirement to a repo that runs `scripts/check-three-dedupe.mjs` specifically
  to guarantee one copy.

Out of scope, deliberately: a title search box that flies the camera to a match.
It is the obvious follow-on and it would need its own HUD surface; naming what is
already on screen is the smaller, self-contained fix and it is what makes the
existing navigation usable.

## Capabilities

### New Capabilities

<!-- none: this is a new requirement inside an existing capability, not a new one -->

### Modified Capabilities

- `second-brain-galaxy-view`: gains a requirement that note titles are revealed
  in-scene by camera proximity, under a bounded on-screen budget, pausing with
  the rest of the galaxy's rendering when Iris sleeps. Its existing "Untrusted
  note content is contained" requirement is extended to cover the new label
  surface — a title reaches the scene as canvas text, never as markup.

## Impact

- `src/lib/galaxy-labels.ts` (new) — the pure selection policy: given nodes, a
  camera position, a distance threshold, an eligibility set and a budget, which
  titles should be shown, nearest first. Unit-tested like `galaxy-nav.ts`.
- `src/lib/galaxy-label-sprites.ts` (new) — the label pool: a fixed set of
  canvas-texture sprites, repainted on reassignment, positioned each frame, and
  disposed on teardown. Not unit-tested, and for a stated reason: it needs a 2D
  canvas context, and `src/**/*.test.ts` runs in vitest's `node` environment
  (`vitest.config.mjs`) where `document` does not exist — the same reason
  `addStarfield` has no test.
- `src/components/VaultGalaxy.tsx` — mounts and disposes the pool, and drives it
  from a small rAF loop gated on `running` (the sleep signal), separate from the
  gesture loop, which is additionally gated on `handControl`. Kept to wiring:
  the file is already well over the 250–450 line convention, so the mechanism
  lands in the two new modules rather than in it.
- `docs/GESTURES.md` — the galaxy section documents `zoomToFit`-on-first-settle
  and the focus declutter; proximity labels belong beside them.
- `docs/TESTING.md` — its over-convention file list records
  `VaultGalaxy.tsx (561)`, stale by ~240 lines before this change touches the
  file at all; corrected while adding to it.
- No dependency, IPC, main-process, CSS, or `.env.example` change: this is
  in-scene rendering driven entirely by data the renderer already holds.
