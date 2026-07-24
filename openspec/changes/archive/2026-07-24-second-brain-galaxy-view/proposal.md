## Why

Iris already captures an interlinked second-brain vault at `~/iris-second-brain` (the `personal-knowledge-notes` capability), but there is **no way to see it** — the knowledge accumulates as markdown files the user can only browse in an external editor. A spatial, cinematic view of the vault's link graph, right inside the Glass HUD, turns the second brain from a write-only store into something the user can explore at a glance. Viewing is pure-local (reading markdown), so it should work whether or not the Claude pipeline is present.

## What Changes

- Add a **"show second brain" toggle** to the Glass HUD (a new control beside the drawing-panel button). When on, Iris renders the vault as an interactive **3D galaxy** of notes — nodes are notes, edges are `[[wikilinks]]`.
- The galaxy paints an **opaque deep-space backdrop** (near-black fill + vignette + faint starfield as a CSS layer) that covers the desktop while active, with node **glow via the graph lib's own post-processing composer**, for an immersive "fly through your vault" experience — unlike the transparent drawing panel. It is **mutually exclusive** with the drawing canvas (opening one closes the other).
- Introduce a **main-process vault-graph owner** that scans `~/iris-second-brain` (excluding the LLM-Wiki plumbing files/folders — `wiki-config.md`, `wiki-schema.md`, `templates/`, `raw/`, `archive/`, `ingested/`), parses YAML frontmatter + `[[wikilinks]]` into a **position-free** `{ nodes, links }` graph, caches it in RAM, and refreshes it live via `fs.watch` (recursive, debounced, rebuild-from-scan; the **full position-free graph** is pushed each time — no wire delta) so notes added or edited — by the user in Obsidian **or** by Claude mid-session — appear without a manual reload. The renderer owns node **positions**, reconciling each full graph in place so the layout is not re-randomized.
- Clicking a node **opens the note** in a `NoteReader` overlay that renders the note's markdown (title + body), replacing the task-specific chrome of the existing reader.
- Availability is gated only on the **vault existing** (`~/iris-second-brain`) — independent of `pipelineAvailable`; an empty vault shows a friendly empty-state.
- **Add two dependencies, pinned exact:** `3d-force-graph` (3D rendering, deduped against the `three` already in the stack via `resolve.dedupe` + `overrides`) and `gray-matter` (YAML frontmatter parsing — the repo has no frontmatter parser today).

Out of scope (deferred to the follow-up change `second-brain-gesture-nav`): opening a node by hand gesture (raycast dwell), fist/pinch galaxy camera control, and NoteReader gesture bindings. This change is mouse/click-first.

## Capabilities

### New Capabilities
- `second-brain-galaxy-view`: Iris renders the `~/iris-second-brain` vault as a live 3D link-graph galaxy inside the Glass HUD — a main-process graph owner (scan + parse + RAM cache + `fs.watch` live refresh), a toggleable immersive galaxy layer with a deep-space backdrop, and a note-reader overlay for opening a node's markdown; gated on the vault existing, independent of the Claude pipeline.

### Modified Capabilities
- `hud-drawing-canvas`: the drawing panel becomes one of a set of **mutually-exclusive HUD layers** — opening the galaxy deactivates the drawing panel and vice-versa. This gives the drawing panel a new close trigger its spec doesn't currently describe, so its "Toggleable drawing panel" requirement is modified to state the single-active-layer invariant. (The new toggle button, immersive backdrop, and galaxy click-through are first-class requirements of the new capability itself — mirroring how `hud-drawing-canvas` introduced its own toggle without modifying `glass-hud-mode` — so only the shared cross-layer invariant lands here.)

The reader single-instance invariant (task run-reader and note reader never stack) is stated as a requirement of the new `second-brain-galaxy-view` capability rather than as a modification, since it is introduced and enforced by this change.

## Impact

- **New dependencies:** `3d-force-graph` and `gray-matter`, pinned exact like the other load-bearing identifiers; `3d-force-graph` must share the single `three` already present (`^0.181.2`, used by `ReactorCore`/`HoloBackdrop`) — enforced by `resolve.dedupe: ['three']` + `overrides.three` + an `npm ls three` single-copy check in build.
- **New main modules:** a pure `electron/vault-graph-parse.mjs` (markdown/wikilink/frontmatter → position-free graph, unit-tested) and a `createVaultGraph({dir})` factory in `electron/vault-graph.mjs` (scan/cache/watch), wired in `electron/main.mjs`; new IPC `secondbrain:get-graph` (full position-free graph) + `secondbrain:read-note` (read-by-node-id, resolved from the single graph cache in main) + sidecar events `secondbrain:graph-updated` (full graph) and `secondbrain:availability` (emitted only on transition), exposed through `electron/preload.cjs`.
- **`personal-knowledge-notes` (main.mjs):** exposes a single authoritative `isUserNote(path)` predicate (covering LLM-Wiki system files incl. `index.md`/`log.md` and plumbing folders) that the vault-graph consumes — so the "what is a user note" contract is owned in one place, not forked.
- **Renderer:** new galaxy layer (`3d-force-graph`, renderer-owned positions, node bloom via the lib's own composer) + a CSS deep-space backdrop, a `NoteReader` built on a `ReaderCore` extracted from `ReaderOverlay` (task-reader behavior unchanged; shared `.reader-backdrop` kept in the click-through allowlist), a new toggle button and `secondBrainActive` state in `src/App.tsx`/`HudShell.tsx`, single active-layer invariant with `drawingActive`.
- **Reads only** the existing `~/iris-second-brain` vault — no change to how notes are written (`personal-knowledge-notes` is untouched).
- **No pipeline coupling:** does not touch `po-session.mjs`, the run queue, or the canvas MCP.
