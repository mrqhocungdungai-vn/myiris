## MODIFIED Requirements

### Requirement: The vault graph is owned and kept fresh by the main process

The main process SHALL own the vault graph: it SHALL scan `~/iris-second-brain` recursively, parse each user note's YAML frontmatter and `[[wikilinks]]`, and build a **position-free** `{ nodes, links }` graph cached in RAM, served to the renderer over IPC. The definition of what is a *user note* SHALL be owned by the notes capability (`personal-knowledge-notes`), not re-declared here: the scan SHALL exclude the LLM-Wiki system files (`index.md`, `log.md`, `wiki-config.md`, `wiki-schema.md`), the plumbing folders (`templates/`/`raw/`/`archive/`/`ingested/`), and **the machine-written spool the notes capability appends to on its own initiative** (`inbox/` — captures awaiting curation and per-run outcome records), plus dotfiles and editor temp files, so only *user* notes become nodes. Only markdown (`.md`) files SHALL be considered notes (a non-markdown file at the vault root SHALL NOT become a node). A note's node identity SHALL derive from its vault-relative path; wikilink forms `[[Note]]`, `[[Note|alias]]`, and `[[Note#heading]]` SHALL all resolve to the target note, resolution SHALL be **case-insensitive** (Obsidian semantics), and `[[...]]` occurrences inside fenced/inline code and `![[embed]]` transclusions SHALL be ignored; a wikilink to a note that does not exist SHALL still produce a "ghost" node (rendered faded) so unresolved links are visible; and a note's frontmatter tags SHALL drive node color grouping. A note whose frontmatter is malformed SHALL still yield a node (untagged) — a single bad note SHALL NOT fail the whole graph. The graph SHALL refresh live: a change under the vault (via a recursive `fs.watch`, scoped to while the galaxy is displayed) SHALL trigger a debounced rebuild-from-scan; both the initial fetch and the live update SHALL carry the **full current position-free graph** (not a wire delta), so the two channels are order-independent and idempotent. Because node positions are produced by the renderer's force simulation, the renderer (not the main process) SHALL reconcile each received graph against its own node set — preserving the positions of unchanged nodes and applying only what changed — so an update never restarts the whole physics layout.

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

#### Scenario: A note added or edited while the galaxy is open appears without reload

- **WHEN** a new note is written under `~/iris-second-brain` (by the user in Obsidian or by Claude mid-session) while the galaxy is displayed
- **THEN** after a short debounce the galaxy shows the new node and its edges, with existing nodes keeping their positions — the layout is not re-randomized or jarringly restarted

#### Scenario: A capture written while the galaxy is open does not disturb the layout

- **WHEN** the user captures a note by voice while the galaxy is displayed, and the capture lands in the spool
- **THEN** no node appears for it and the settled layout is unchanged, because the spool is not part of the graph

#### Scenario: A malformed note does not blank the galaxy

- **WHEN** one note in a populated vault has invalid YAML frontmatter
- **THEN** that note still appears as an (untagged) node and the rest of the galaxy renders normally — the graph build does not fail

#### Scenario: A removed note disappears from the galaxy

- **WHEN** a note file is deleted from the vault while the galaxy is displayed
- **THEN** after the debounce its node is removed from the galaxy and the surrounding nodes keep their positions
