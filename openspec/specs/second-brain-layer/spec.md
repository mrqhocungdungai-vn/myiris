## Purpose

The HUD layer that shows the `~/iris-second-brain` vault, and what it takes to put one up: the "show second brain" toggle and its exclusivity with the drawing canvas, the main-process graph owner (scan + parse + RAM cache + `fs.watch` live refresh), the note reader opened from a node, containment of untrusted note content, and gating on the vault existing rather than on the Claude pipeline. **How** that graph is drawn and flown is a separate capability, `galaxy-view` — this one decides what is drawn and when the layer exists; the vault itself and its write path belong to `personal-knowledge-notes`, the shared selection to `second-brain-focus`, the hands to `second-brain-gesture-nav`, and the reader's session lifetime to `open-note-session`.

## Requirements

### Requirement: The second-brain vault is shown as an exclusive HUD layer

Iris SHALL provide a "show second brain" toggle in the Glass HUD that, when enabled, renders the `~/iris-second-brain` vault as an interactive 3D force-directed galaxy (see `galaxy-view`): one node per markdown note, one edge per `[[wikilink]]` between notes. The toggle SHALL sit alongside the drawing-panel control and SHALL be **mutually exclusive** with the drawing canvas — enabling the second brain disables the drawing panel and vice versa — so two heavy interactive WebGL layers are never active at once. While the layer is active it SHALL be pointer-interactive (`.hud-hit`), and exiting it SHALL restore the transparent, click-through HUD. The layer is **HUD-only**: in deck mode it SHALL NOT be present, and **every** exit from the HUD — the HUD button, the global hotkey, and the tray item alike — SHALL clear it, exactly as the drawing panel is cleared, so returning to the HUD does not snap straight back into it and nothing the layer owns is left mounted over the deck.

#### Scenario: Toggling the second brain on shows the vault graph

- **WHEN** the user enables "show second brain" in the Glass HUD and the vault contains notes
- **THEN** the vault is rendered as a 3D galaxy of note-nodes connected by their `[[wikilink]]` edges, and the layer becomes pointer-interactive

#### Scenario: The second brain and the drawing panel are mutually exclusive

- **WHEN** the drawing panel is open and the user enables the second brain (or the second brain is open and the user enables the drawing panel)
- **THEN** the previously-open layer is closed so only one is active at a time

#### Scenario: Exiting the layer restores the transparent HUD

- **WHEN** the user disables "show second brain"
- **THEN** the layer is removed and the HUD returns to its transparent, click-through state (interactive only over `.hud-hit` islands)

#### Scenario: Leaving the HUD by hotkey or tray clears the layer

- **WHEN** the layer is active and the user leaves HUD mode by the global hotkey or the tray item (not the HUD button)
- **THEN** the layer is cleared just as the drawing panel is — re-entering the HUD starts without it, and nothing it owns remains mounted over the deck

### Requirement: The second-brain control identifies the feature, not the view

The Glass HUD control that opens and closes the second brain SHALL identify **the feature** — the user's vault of notes — rather than the rendering the feature currently uses. Its icon and its label SHALL therefore describe the same thing; a glyph depicting the graph rendering alongside a label naming the second brain SHALL NOT be used.

This is not a matter of taste. The rendering is generic and reusable (see `galaxy-view`), so a second feature drawn the same way is possible; at that point two controls would open visually similar views and the only thing distinguishing them is which feature they open. An icon that pictures the shared rendering identifies neither. The control SHALL therefore encode what differs between controls, which is always the feature.

The rule constrains what the control depicts, not which specific glyph is chosen: a later change may pick a different feature-naming icon without contradicting this requirement.

#### Scenario: The icon and the label name the same thing

- **WHEN** the user looks at the second-brain control in the Glass HUD
- **THEN** its icon depicts the feature the control opens, and its tooltip names that same feature — the two do not describe different things

#### Scenario: The icon does not depict the rendering

- **WHEN** the second-brain control is rendered
- **THEN** its glyph is not a depiction of the graph rendering (a node-and-edge diagram), because that rendering is not what distinguishes this control from another that used it

### Requirement: The vault graph is owned and kept fresh by the main process

The main process SHALL own the vault graph: it SHALL scan `~/iris-second-brain` recursively, parse each user note's YAML frontmatter and `[[wikilinks]]`, and build a **position-free** `{ nodes, links }` graph cached in RAM, served to the renderer over IPC. The definition of what is a *user note* SHALL be owned by the notes capability (`personal-knowledge-notes`), not re-declared here: the scan SHALL exclude the LLM-Wiki system files (`index.md`, `log.md`, `wiki-config.md`, `wiki-schema.md`), the plumbing folders (`templates/`/`raw/`/`archive/`/`ingested/`), and **the machine-written spool the notes capability appends to on its own initiative** (`inbox/` — captures awaiting curation and per-run outcome records), plus dotfiles and editor temp files, so only *user* notes become nodes. Only markdown (`.md`) files SHALL be considered notes (a non-markdown file at the vault root SHALL NOT become a node). A note's node identity SHALL derive from its vault-relative path; wikilink forms `[[Note]]`, `[[Note|alias]]`, and `[[Note#heading]]` SHALL all resolve to the target note, resolution SHALL be **case-insensitive** (Obsidian semantics), and `[[...]]` occurrences inside fenced/inline code and `![[embed]]` transclusions SHALL be ignored; a wikilink to a note that does not exist SHALL still produce a "ghost" node (rendered faded) so unresolved links are visible; and a note's frontmatter tags SHALL drive node color grouping. A note whose frontmatter is malformed SHALL still yield a node (untagged) — a single bad note SHALL NOT fail the whole graph. The graph SHALL refresh live: a change under the vault (via a recursive `fs.watch`, scoped to while the layer is displayed) SHALL trigger a debounced rebuild-from-scan; both the initial fetch and the live update SHALL carry the **full current position-free graph** (not a wire delta), so the two channels are order-independent and idempotent. Because node positions are produced by the renderer's force simulation, the renderer (not the main process) SHALL reconcile each received graph against its own node set — preserving the positions of unchanged nodes and applying only what changed — so an update never restarts the whole physics layout.

The spool exclusion is not cosmetic. Without it the scan admits one date-named node per day Iris is used — content the user never wrote, growing without bound, and (because a spool file carries no `[[wikilinks]]` to anything) accumulating as disconnected debris around the graph the user actually built. A view whose noise grows with use is a view that gets worse the more the app is used.

#### Scenario: The graph is built from the vault's notes and links

- **WHEN** the renderer requests the vault graph
- **THEN** the main process returns position-free nodes (one per user note, keyed by a stable id derived from the vault-relative path) and links (one per resolved `[[wikilink]]`), parsed from the on-disk markdown

#### Scenario: Wiki plumbing files are not nodes

- **WHEN** the vault contains the LLM-Wiki system files (`index.md`, `log.md`, `wiki-config.md`, `wiki-schema.md`) and the `templates/`/`raw/`/`archive/`/`ingested/` folders alongside user notes
- **THEN** those system files and folders are excluded from the graph and only user notes appear as nodes (in particular the `index.md` catalogue does not become a hub node that distorts the layout)

#### Scenario: The machine-written spool is not nodes

- **WHEN** the vault contains spooled captures and per-run outcome records under `inbox/` alongside user notes
- **THEN** no spool file appears as a node — in particular no date-named node appears for a day Iris was used — and only the user's own notes are rendered

#### Scenario: A user note nested below a spool-named folder is still a note

- **WHEN** a user note exists at a path whose *non-leading* segment happens to be named like a plumbing or spool folder
- **THEN** it is still a node, because the exclusion applies at the vault root rather than to any segment anywhere in the path

#### Scenario: An unresolved wikilink becomes a ghost node

- **WHEN** a note links to `[[NonExistent]]` and no `NonExistent.md` exists in the vault
- **THEN** the graph includes a faded ghost node for the missing target so the dangling link is visible

#### Scenario: A note added or edited while the layer is open appears without reload

- **WHEN** a new note is written under `~/iris-second-brain` (by the user in Obsidian or by Claude mid-session) while the layer is displayed
- **THEN** after a short debounce the view shows the new node and its edges, with existing nodes keeping their positions — the layout is not re-randomized or jarringly restarted

#### Scenario: A capture written while the layer is open does not disturb the layout

- **WHEN** the user captures a note by voice while the layer is displayed, and the capture lands in the spool
- **THEN** no node appears for it and the settled layout is unchanged, because the spool is not part of the graph

#### Scenario: A malformed note does not blank the view

- **WHEN** one note in a populated vault has invalid YAML frontmatter
- **THEN** that note still appears as an (untagged) node and the rest of the graph renders normally — the graph build does not fail

#### Scenario: A removed note disappears from the view

- **WHEN** a note file is deleted from the vault while the layer is displayed
- **THEN** after the debounce its node is removed and the surrounding nodes keep their positions

### Requirement: Opening a node shows the note's content

Clicking a real note-node SHALL open that note in a note-reader overlay that renders the note's markdown (title plus body). The note's content SHALL be fetched by node id and resolved to a file in the main process (never by a renderer-supplied path); a ghost node (unresolved link with no backing file) SHALL NOT be openable. The overlay SHALL present the note's own content without the task-specific chrome of the run reader (no run/session id, agent, or status badges), and at most one reader (task or note) SHALL be open at a time. Closing the overlay SHALL return to the layer with it still active. The note reader SHALL exist only while the second-brain layer does: whenever the layer is not active the note reader SHALL NOT be shown **and** the stored open-note state SHALL be cleared — the first makes the invariant hold by construction even for a fetch that lands after the close, the second prevents a stale note from reappearing the next time the layer is opened — so that **no** close path — the toggle, opening the drawing panel, leaving the HUD by button/hotkey/tray, or a force-close after a render crash — and no in-flight note fetch that completes after the layer closed can leave a note reader stranded over the transparent HUD or the deck.

**The reader SHALL also be able to edit the note.** A control SHALL switch the body between the rendered markdown and the note's **raw text** in an editable field, and saving SHALL write that text to the note's file. Raw text, not a rendered editor: what the vault stores is markdown with frontmatter, and an editor that hid either would make the note's own structure unavailable to the person who owns it. Saving SHALL be an explicit action; there SHALL be no autosave, because a keystroke is not a decision. Discarding SHALL leave the file untouched.

**Unsaved edits SHALL NOT be lost by any route that closes the reader.** While edits are pending, every close route — the × control, `Esc`, and the fist-closes-reader gesture alike — SHALL stop closing the reader and SHALL ask what to do instead, and the asking SHALL NOT use a blocking modal dialog. While the editor is active, the reader's hand-gesture bindings SHALL be suspended entirely, so a gesture cannot scroll, resize, or close away work in progress.

**A save SHALL be refused rather than allowed to overwrite a concurrent change.** The content served when the note was opened SHALL carry a revision token, a save SHALL carry that token back, and the save SHALL be refused if the note's file no longer matches it — because Claude's note session, a voice capture, or another application may have written the file in between. A refused save SHALL preserve the user's unsaved text and SHALL report what happened; overwriting anyway SHALL be possible only as a further explicit action by the user. Iris SHALL NOT choose a winner on its own, in either direction.

**The reader SHALL offer opening the note in the system's default application** for its file type, resolved by note identity in the main process like every other vault path. This exists because the in-app field is deliberately a small editor and some edits want a real one; it is a route out, not a replacement for editing in place.

A successful save SHALL be reflected in the view without a reload, on the same terms as any other change to the vault, and SHALL NOT disturb the settled layout beyond what the change itself implies.

#### Scenario: Clicking a node opens its note

- **WHEN** the user clicks a real note-node
- **THEN** a note-reader overlay opens showing that note's title and rendered markdown content, fetched by node id

#### Scenario: A ghost node cannot be opened

- **WHEN** the user clicks a faded ghost node (an unresolved `[[wikilink]]` target with no backing file)
- **THEN** no note-reader opens and no file read is attempted

#### Scenario: The note reader shows note content, not task chrome

- **WHEN** the note-reader overlay is open
- **THEN** it displays the note's title and body only, with no run id, agent badge, or task status badge

#### Scenario: Closing the note returns to the layer

- **WHEN** the user closes the note-reader overlay
- **THEN** the overlay dismisses and the second-brain layer remains active

#### Scenario: At most one reader open at a time

- **WHEN** the task run-reader is open and the user opens a note (or vice versa)
- **THEN** only one reader is shown — the two never stack — so a single reader-open state is authoritative

#### Scenario: Closing the layer dismisses an open note

- **WHEN** a note is open and the layer closes by any route (the toggle, opening the drawing panel, leaving the HUD by button/hotkey/tray, or a force-close after a crash)
- **THEN** the note reader is dismissed with it — no reader is left over the transparent HUD or the deck

#### Scenario: Reopening the layer does not resurrect the previous note

- **WHEN** a note was open when the layer closed, and the user later opens the layer again
- **THEN** it opens showing the graph — the previously-open note reader does not reappear

#### Scenario: A note fetch that lands after the layer closed opens nothing

- **WHEN** the user opens a node and the layer closes before the note's content finishes loading
- **THEN** no note reader appears when the fetch completes

#### Scenario: Editing and saving a note by hand

- **WHEN** the user switches the open note into editing, changes its text, and saves
- **THEN** the note's file contains exactly the saved text, and the reader shows the updated note

#### Scenario: The editor shows raw markdown

- **WHEN** the user switches a note with frontmatter into editing
- **THEN** the field contains the note's raw text including its frontmatter, not a rendered or stripped version of it

#### Scenario: Nothing is written without an explicit save

- **WHEN** the user types in the editor and then discards instead of saving
- **THEN** the note's file is unchanged

#### Scenario: A close route with unsaved edits asks first

- **WHEN** edits are pending and the user presses `Esc`, activates the × control, or makes the fist-closes-reader gesture
- **THEN** the reader does not close, the unsaved text is intact, and the user is asked what to do without a blocking dialog

#### Scenario: Gestures cannot destroy work in progress

- **WHEN** the editor is active and hand control is on
- **THEN** the reader's scroll, resize and close gesture bindings are suspended for as long as the editor is active

#### Scenario: A save is refused when the note changed underneath

- **WHEN** the note's file has been written by something else since it was opened, and the user saves
- **THEN** the save is refused, the file is not modified, the user's unsaved text is preserved, and the reader reports that the note changed

#### Scenario: Overwriting a changed note is a separate explicit act

- **WHEN** a save has been refused because the note changed, and the user chooses to overwrite anyway
- **THEN** the note's file is written with the user's text, and nothing else about the flow was implicit

#### Scenario: Opening the note in another application

- **WHEN** the user activates the open-externally control on an open note
- **THEN** that note's file is opened in the system's default application for it, resolved from the note's identity rather than from any path the renderer supplied

#### Scenario: A saved note updates the view live

- **WHEN** a hand edit that changes the note's title, tags, or links is saved while the layer is displayed
- **THEN** the view reflects it after the usual debounce, with the surrounding nodes keeping their positions

### Requirement: Untrusted note content is contained

Because notes may originate from the web (`wiki-ingest`), the second-brain layer SHALL treat note content as untrusted in the privileged renderer. Note titles/labels SHALL NOT be injected as HTML into the graph's tooltip (no script execution from a crafted title); a title rendered in the scene SHALL reach the view as drawn text rather than through any surface that interprets markup, so a crafted title is inert there by construction and not merely by escaping (the view's side of this is stated in `galaxy-view`, "Node labels are always drawn, legible by camera proximity"); note markdown SHALL be rendered with raw HTML escaped (no `rehype-raw`/`dangerouslySetInnerHTML`); an in-note hyperlink SHALL NOT be able to navigate the app window away from the app (external links are denied or opened out-of-app); and `secondbrain:read-note` SHALL refuse to read any path that, after symlink resolution, falls outside the vault directory.

#### Scenario: A crafted note title does not execute script

- **WHEN** a note's title/filename contains HTML like `<img src=x onerror=…>` and its node label is shown
- **THEN** the markup is escaped/inert and no script runs in the renderer

#### Scenario: A crafted note title is inert as an in-scene label

- **WHEN** a note whose title contains HTML like `<img src=x onerror=…>` carries a label in the scene
- **THEN** the label's characters are drawn literally as text, nothing is parsed as markup, and no script runs

#### Scenario: An in-note link cannot replace the app

- **WHEN** the user activates an `https://` link inside an opened note
- **THEN** the app window is not navigated to the remote page (the link is denied or opened outside the app)

#### Scenario: A symlinked note escaping the vault is not readable

- **WHEN** a node resolves (after following symlinks) to a path outside `~/iris-second-brain` (e.g. a note symlinked to `~/.ssh/id_rsa`)
- **THEN** `secondbrain:read-note` refuses the read and returns no file contents

### Requirement: The second-brain layer is gated on the vault existing, independent of the Claude pipeline

The "show second brain" capability SHALL be available exactly when the vault directory `~/iris-second-brain` exists, regardless of whether the Claude pipeline is available — because viewing only reads local markdown. When the vault exists but contains no notes, the layer SHALL show a friendly empty-state rather than an error or a blank layer. Iris SHALL NOT create the vault merely because the toggle was shown.

#### Scenario: The layer works without the Claude pipeline

- **WHEN** the Claude CLI does not resolve (chat-only mode) but `~/iris-second-brain` exists with notes
- **THEN** the "show second brain" toggle is available and the layer renders the vault normally

#### Scenario: A vault with only plumbing shows an empty-state

- **WHEN** `~/iris-second-brain` exists but contains no *user* notes (only the pre-seeded `wiki-config.md`/`wiki-schema.md` and empty plumbing folders)
- **THEN** enabling the layer shows a friendly empty-state (e.g. "no notes yet") instead of a blank or broken layer

#### Scenario: No vault means no toggle

- **WHEN** `~/iris-second-brain` does not exist
- **THEN** the "show second brain" toggle is not offered and Iris does not create the vault directory on its own

#### Scenario: The toggle appears when the vault is created

- **WHEN** the vault did not exist and the user captures their first note (which creates `~/iris-second-brain`)
- **THEN** the "show second brain" toggle becomes available without relaunching Iris
