## Purpose

Iris renders the `~/iris-second-brain` vault (the `personal-knowledge-notes` capability's write target) as a live 3D link-graph galaxy inside the Glass HUD — a main-process graph owner (scan + parse + RAM cache + `fs.watch` live refresh), a toggleable immersive galaxy layer with a deep-space backdrop, and a note-reader overlay for opening a node's markdown. Viewing is gated only on the vault existing, independent of the Claude pipeline, since it is pure-local reading of markdown.
## Requirements
### Requirement: The second-brain vault is rendered as a 3D galaxy in the Glass HUD

Iris SHALL provide a "show second brain" toggle in the Glass HUD that, when enabled, renders the `~/iris-second-brain` vault as an interactive 3D force-directed galaxy: one node per markdown note, one edge per `[[wikilink]]` between notes. The toggle SHALL sit alongside the drawing-panel control and SHALL be **mutually exclusive** with the drawing canvas — enabling the galaxy disables the drawing panel and vice versa — so two heavy interactive WebGL layers are never active at once. While the galaxy is active its layer SHALL be pointer-interactive (`.hud-hit`), and exiting the galaxy SHALL restore the transparent, click-through HUD. The galaxy is **HUD-only**: in deck mode it SHALL NOT be present, and **every** exit from the HUD — the HUD button, the global hotkey, and the tray item alike — SHALL clear the galaxy, exactly as the drawing panel is cleared, so returning to the HUD does not snap straight back into the galaxy and no galaxy-owned overlay is left mounted over the deck.

#### Scenario: Toggling the galaxy on shows the vault graph

- **WHEN** the user enables "show second brain" in the Glass HUD and the vault contains notes
- **THEN** the vault is rendered as a 3D galaxy of note-nodes connected by their `[[wikilink]]` edges, and the layer becomes pointer-interactive

#### Scenario: Galaxy and drawing panel are mutually exclusive

- **WHEN** the drawing panel is open and the user enables the galaxy (or the galaxy is open and the user enables the drawing panel)
- **THEN** the previously-open layer is closed so only one is active at a time

#### Scenario: Exiting the galaxy restores the transparent HUD

- **WHEN** the user disables "show second brain"
- **THEN** the galaxy layer is removed and the HUD returns to its transparent, click-through state (interactive only over `.hud-hit` islands)

#### Scenario: Leaving the HUD by hotkey or tray clears the galaxy

- **WHEN** the galaxy is active and the user leaves HUD mode by the global hotkey or the tray item (not the HUD button)
- **THEN** the galaxy is cleared just as the drawing panel is — re-entering the HUD starts without the galaxy, and nothing the galaxy owns remains mounted over the deck

### Requirement: The galaxy renders over an immersive opaque deep-space backdrop

While the galaxy is active, Iris SHALL paint an **opaque** deep-space backdrop (near-black fill, vignette, and a faint drifting starfield) that fully covers the desktop wallpaper, with the galaxy nodes rendered with a glow (bloom) so they read as stars, so the view reads as flying through space rather than a graph floating over the transparent desktop. The backdrop SHALL exist only while the galaxy layer is active and SHALL NOT leak into the transparent HUD when the galaxy is off. The rendering SHALL reuse the `three` instance already present in the app rather than introducing a second copy.

#### Scenario: The desktop wallpaper does not show through the galaxy

- **WHEN** the galaxy layer is active
- **THEN** the backdrop is opaque and the desktop behind the HUD is not visible through the galaxy

#### Scenario: The backdrop is gone when the galaxy is off

- **WHEN** the galaxy layer is disabled
- **THEN** no deep-space backdrop is painted and the HUD is transparent again

#### Scenario: The galaxy stops rendering when the HUD is idle

- **WHEN** the galaxy is active and Iris goes to sleep (the same signal that pauses the reactor orb — sleep only; like the orb, the galaxy keeps rendering while awake even if the OS window is unfocused)
- **THEN** the galaxy's force simulation and render loop pause so it consumes no GPU while idle, and resume without losing node positions when Iris is awake again

#### Scenario: A single three instance is used

- **WHEN** the app's bundled dependencies are inspected
- **THEN** exactly one copy of `three` is resolved (the galaxy renderer shares the `three` already used by the reactor/holo backdrop)

### Requirement: The vault graph is owned and kept fresh by the main process

The main process SHALL own the vault graph: it SHALL scan `~/iris-second-brain` recursively, parse each user note's YAML frontmatter and `[[wikilinks]]`, and build a **position-free** `{ nodes, links }` graph cached in RAM, served to the renderer over IPC. The definition of what is a *user note* SHALL be owned by the notes capability (`personal-knowledge-notes`), not re-declared here: the scan SHALL exclude the LLM-Wiki system files (`index.md`, `log.md`, `wiki-config.md`, `wiki-schema.md`) and plumbing folders (`templates/`/`raw/`/`archive/`/`ingested/`), plus dotfiles and editor temp files, so only *user* notes become nodes. Only markdown (`.md`) files SHALL be considered notes (a non-markdown file at the vault root SHALL NOT become a node). A note's node identity SHALL derive from its vault-relative path; wikilink forms `[[Note]]`, `[[Note|alias]]`, and `[[Note#heading]]` SHALL all resolve to the target note, resolution SHALL be **case-insensitive** (Obsidian semantics), and `[[...]]` occurrences inside fenced/inline code and `![[embed]]` transclusions SHALL be ignored; a wikilink to a note that does not exist SHALL still produce a "ghost" node (rendered faded) so unresolved links are visible; and a note's frontmatter tags SHALL drive node color grouping. A note whose frontmatter is malformed SHALL still yield a node (untagged) — a single bad note SHALL NOT fail the whole graph. The graph SHALL refresh live: a change under the vault (via a recursive `fs.watch`, scoped to while the galaxy is displayed) SHALL trigger a debounced rebuild-from-scan; both the initial fetch and the live update SHALL carry the **full current position-free graph** (not a wire delta), so the two channels are order-independent and idempotent. Because node positions are produced by the renderer's force simulation, the renderer (not the main process) SHALL reconcile each received graph against its own node set — preserving the positions of unchanged nodes and applying only what changed — so an update never restarts the whole physics layout.

#### Scenario: The graph is built from the vault's notes and links

- **WHEN** the renderer requests the vault graph
- **THEN** the main process returns position-free nodes (one per user note, keyed by a stable id derived from the vault-relative path) and links (one per resolved `[[wikilink]]`), parsed from the on-disk markdown

#### Scenario: Wiki plumbing files are not nodes

- **WHEN** the vault contains the LLM-Wiki system files (`index.md`, `log.md`, `wiki-config.md`, `wiki-schema.md`) and the `templates/`/`raw/`/`archive/`/`ingested/` folders alongside user notes
- **THEN** those system files and folders are excluded from the graph and only user notes appear as nodes (in particular the `index.md` catalogue does not become a hub node that distorts the layout)

#### Scenario: An unresolved wikilink becomes a ghost node

- **WHEN** a note links to `[[NonExistent]]` and no `NonExistent.md` exists in the vault
- **THEN** the graph includes a faded ghost node for the missing target so the dangling link is visible

#### Scenario: A note added or edited while the galaxy is open appears without reload

- **WHEN** a new note is written under `~/iris-second-brain` (by the user in Obsidian or by Claude mid-session) while the galaxy is displayed
- **THEN** after a short debounce the galaxy shows the new node and its edges, with existing nodes keeping their positions — the layout is not re-randomized or jarringly restarted

#### Scenario: A malformed note does not blank the galaxy

- **WHEN** one note in a populated vault has invalid YAML frontmatter
- **THEN** that note still appears as an (untagged) node and the rest of the galaxy renders normally — the graph build does not fail

#### Scenario: A removed note disappears from the galaxy

- **WHEN** a note file is deleted from the vault while the galaxy is displayed
- **THEN** after the debounce its node is removed from the galaxy and the surrounding nodes keep their positions

### Requirement: Opening a node shows the note's content

Clicking a real note-node in the galaxy SHALL open that note in a note-reader overlay that renders the note's markdown (title plus body). The note's content SHALL be fetched by node id and resolved to a file in the main process (never by a renderer-supplied path); a ghost node (unresolved link with no backing file) SHALL NOT be openable. The overlay SHALL present the note's own content without the task-specific chrome of the run reader (no run/session id, agent, or status badges), and at most one reader (task or note) SHALL be open at a time. Closing the overlay SHALL return to the galaxy with the layer still active. The note reader SHALL exist only while the galaxy layer does: whenever the galaxy is not active the note reader SHALL NOT be shown **and** the stored open-note state SHALL be cleared — the first makes the invariant hold by construction even for a fetch that lands after the close, the second prevents a stale note from reappearing the next time the galaxy is opened — so that **no** galaxy-close path — the toggle, opening the drawing panel, leaving the HUD by button/hotkey/tray, or a force-close after a render crash — and no in-flight note fetch that completes after the galaxy closed can leave a note reader stranded over the transparent HUD or the deck.

#### Scenario: Clicking a node opens its note

- **WHEN** the user clicks a real note-node in the galaxy
- **THEN** a note-reader overlay opens showing that note's title and rendered markdown content, fetched by node id

#### Scenario: A ghost node cannot be opened

- **WHEN** the user clicks a faded ghost node (an unresolved `[[wikilink]]` target with no backing file)
- **THEN** no note-reader opens and no file read is attempted

#### Scenario: The note reader shows note content, not task chrome

- **WHEN** the note-reader overlay is open
- **THEN** it displays the note's title and body only, with no run id, agent badge, or task status badge

#### Scenario: Closing the note returns to the galaxy

- **WHEN** the user closes the note-reader overlay
- **THEN** the overlay dismisses and the galaxy layer remains active

#### Scenario: At most one reader open at a time

- **WHEN** the task run-reader is open and the user opens a note from the galaxy (or vice versa)
- **THEN** only one reader is shown — the two never stack — so a single reader-open state is authoritative

#### Scenario: Closing the galaxy dismisses an open note

- **WHEN** a note is open and the galaxy closes by any route (the toggle, opening the drawing panel, leaving the HUD by button/hotkey/tray, or a force-close after a crash)
- **THEN** the note reader is dismissed with it — no reader is left over the transparent HUD or the deck

#### Scenario: Reopening the galaxy does not resurrect the previous note

- **WHEN** a note was open when the galaxy closed, and the user later opens the galaxy again
- **THEN** the galaxy opens showing the graph — the previously-open note reader does not reappear

#### Scenario: A note fetch that lands after the galaxy closed opens nothing

- **WHEN** the user opens a node and the galaxy closes before the note's content finishes loading
- **THEN** no note reader appears when the fetch completes

### Requirement: Untrusted note content is contained

Because notes may originate from the web (`wiki-ingest`), the galaxy SHALL treat note content as untrusted in the privileged renderer. Note titles/labels SHALL NOT be injected as HTML into the graph's tooltip (no script execution from a crafted title); note markdown SHALL be rendered with raw HTML escaped (no `rehype-raw`/`dangerouslySetInnerHTML`); an in-note hyperlink SHALL NOT be able to navigate the app window away from the app (external links are denied or opened out-of-app); and `secondbrain:read-note` SHALL refuse to read any path that, after symlink resolution, falls outside the vault directory.

#### Scenario: A crafted note title does not execute script

- **WHEN** a note's title/filename contains HTML like `<img src=x onerror=…>` and its node label is shown
- **THEN** the markup is escaped/inert and no script runs in the renderer

#### Scenario: An in-note link cannot replace the app

- **WHEN** the user activates an `https://` link inside an opened note
- **THEN** the app window is not navigated to the remote page (the link is denied or opened outside the app)

#### Scenario: A symlinked note escaping the vault is not readable

- **WHEN** a node resolves (after following symlinks) to a path outside `~/iris-second-brain` (e.g. a note symlinked to `~/.ssh/id_rsa`)
- **THEN** `secondbrain:read-note` refuses the read and returns no file contents

### Requirement: The galaxy view is gated on the vault existing, independent of the Claude pipeline

The "show second brain" capability SHALL be available exactly when the vault directory `~/iris-second-brain` exists, regardless of whether the Claude CLI resolves or the PO/DEV pipeline is available — because viewing only reads local markdown. When the vault exists but contains no notes, the galaxy SHALL show a friendly empty-state rather than an error or a blank layer. Iris SHALL NOT create the vault merely because the toggle was shown.

#### Scenario: Galaxy works without the Claude pipeline

- **WHEN** the Claude CLI does not resolve (chat-only mode) but `~/iris-second-brain` exists with notes
- **THEN** the "show second brain" toggle is available and the galaxy renders the vault normally

#### Scenario: A vault with only plumbing shows an empty-state

- **WHEN** `~/iris-second-brain` exists but contains no *user* notes (only the pre-seeded `wiki-config.md`/`wiki-schema.md` and empty plumbing folders)
- **THEN** enabling the galaxy shows a friendly empty-state (e.g. "no notes yet") instead of a blank or broken layer

#### Scenario: No vault means no toggle

- **WHEN** `~/iris-second-brain` does not exist
- **THEN** the "show second brain" toggle is not offered and Iris does not create the vault directory on its own

#### Scenario: The toggle appears when the vault is created

- **WHEN** the vault did not exist and the user captures their first note (which creates `~/iris-second-brain`)
- **THEN** the "show second brain" toggle becomes available without relaunching Iris

