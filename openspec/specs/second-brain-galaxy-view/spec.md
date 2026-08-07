## Purpose

Iris renders the `~/iris-second-brain` vault (the `personal-knowledge-notes` capability's write target) as a live 3D link-graph galaxy inside the Glass HUD — a main-process graph owner (scan + parse + RAM cache + `fs.watch` live refresh), a toggleable immersive galaxy layer with a deep-space backdrop, and a note-reader overlay for reading a node's markdown and editing it by hand. Viewing is gated only on the vault existing, independent of the Claude pipeline, since it is pure-local reading of markdown.
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

While the galaxy is active, Iris SHALL paint an **opaque** deep-space backdrop (near-black fill, vignette, and a faint drifting starfield) that fully covers the desktop wallpaper, so the view reads as flying through space rather than a graph floating over the transparent desktop. The backdrop SHALL exist only while the galaxy layer is active and SHALL NOT leak into the transparent HUD when the galaxy is off. The rendering SHALL reuse the `three` instance already present in the app rather than introducing a second copy.

Whether the galaxy's nodes carry a glow SHALL follow the WebGL quality preference (see `webgl-quality-mode`). On the high-fidelity path the nodes SHALL be rendered with a bloom pass so they read as stars. On the light path — the default — no bloom pass SHALL be added: the galaxy is the app's most expensive surface, running a full-viewport post-processing pyramid on top of a live force simulation. The opaque backdrop, vignette and starfield SHALL be unconditional and present on both paths, because they are painted inside the scene rather than produced by the post-processing pass; removing the glow SHALL therefore never leave the galaxy on a transparent or bare background.

#### Scenario: The desktop wallpaper does not show through the galaxy

- **WHEN** the galaxy layer is active
- **THEN** the backdrop is opaque and the desktop behind the HUD is not visible through the galaxy

#### Scenario: Nodes glow on the high-fidelity path

- **WHEN** the galaxy is active and the quality preference is on the high-fidelity path
- **THEN** the nodes are rendered with a bloom pass and read as stars, exactly as before the preference existed

#### Scenario: No bloom pass on the light path

- **WHEN** the galaxy is active and the quality preference is on the light path
- **THEN** no bloom pass is added to the galaxy's rendering

#### Scenario: The path is fixed when the galaxy opens

- **WHEN** the quality preference changes while the galaxy is already open
- **THEN** the open galaxy keeps the path it was opened with and its settled node positions are retained, and the new path takes effect the next time the galaxy is opened

#### Scenario: The backdrop survives the light path

- **WHEN** the galaxy is active on the light path
- **THEN** the opaque near-black fill, the vignette and the drifting starfield are all still painted, and the desktop wallpaper is still not visible through the galaxy

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

### Requirement: The node being pointed at reveals its link cluster

The galaxy SHALL render a **pointed-at** node distinctly and SHALL light up the links incident to it, so that what a note is connected to is answerable by pointing at it. The pointed-at node together with its one-hop neighbours SHALL be drawn at full strength.

**The lit links SHALL be unmistakably prominent** — the point of the requirement is that a cluster reads at a glance, so the difference between a lit link and a resting one SHALL NOT be a subtle shift in an already-faint line. Any graph-wide opacity or intensity ceiling the renderer applies SHALL be accounted for, so that raising a link's own intensity actually reaches the view rather than being scaled back down by a global factor. Making lit links prominent SHALL NOT brighten the resting links: at rest the graph SHALL look exactly as it did before this requirement existed.

**Everything outside the pointed-at cluster SHALL be dimmed for as long as it is pointed at.** Brightening the cluster is not enough on its own: in a dense galaxy a brighter cluster still sits inside a mesh of other links, so the answer to "what is this note connected to" has to be the only thing lit. The reveal is a spotlight, not an accent.

The dimming SHALL use the same treatment the focus declutter uses, so the galaxy has one visual language for "this is what matters right now" rather than two that have to be told apart.

The one-hop neighbourhood used here SHALL be the same one the focus declutter uses, so the highlight and the dimming can never disagree about what one hop means.

**Pointing SHALL take precedence over the focus's own dimming** rather than adding to it: while something is pointed at, what stays bright is that node's cluster, and when nothing is pointed at it is the focus's. One question is answered at a time, and a second bright island beside the first would answer neither clearly. It follows that pointing at a node the focus has dimmed reveals what that node connects to without the user having to change the focus first, and that releasing restores the focus's dimming exactly as it was.

A **focused** node SHALL remain visibly focused even while the spotlight is elsewhere: losing sight of a selection because the user pointed at something else is a worse loss than the spotlight is worth.

**The highlight SHALL be transient and SHALL change no state.** It SHALL NOT select anything, SHALL NOT alter the focus, SHALL NOT move the camera, and SHALL NOT open a note. Ceasing to point SHALL restore exactly the previous rendering, including whatever dimming a live focus was applying. Nothing SHALL accumulate: at most one node is pointed at at any moment, and moving on leaves nothing behind.

A node SHALL be pointed at only by an input that **means** to point at it, with no difference in what is drawn between them:

- the **mouse hovering** it;
- when hand control is on, the **inspect pose** held near it (see `second-brain-gesture-nav`, "A held two-finger pose reveals a node's link cluster");
- the node a **`Pointing_Up` dwell is charging against**, since that dwell is already deliberate and already gives the node visible feedback.

A hand that is merely present in frame in some other pose SHALL NOT point at anything. When more than one input could apply, the hand SHALL win, so the highlight follows whichever input the user is actually using rather than flickering between them.

A **ghost node** (an unresolved `[[wikilink]]` target) SHALL NOT be pointed at by any producer. They are held to the same eligibility deliberately: the hand's target resolution already excludes ghosts because a ghost is not openable, and a highlight that appeared under the mouse but never under the hand would make the same node behave differently depending on the input device.

Repainting for a highlight change SHALL be coalesced so that sweeping a pointer across a dense region cannot force one full-graph repaint per node crossed.

#### Scenario: Pointing at a node lights its links

- **WHEN** the user points at a real note-node — by mouse hover, or by the inspect pose with hand control on
- **THEN** the links incident to that node are drawn prominently, and that node and its one-hop neighbours are drawn at full strength

#### Scenario: A lit link is obviously lit

- **WHEN** a node's cluster is lit while the rest of the graph is at rest
- **THEN** the difference is immediately visible rather than a faint change to an already-faint line — no graph-wide opacity or intensity ceiling scales the lit links back down

#### Scenario: Resting links look exactly as they did before

- **WHEN** nothing is pointed at
- **THEN** the links are drawn exactly as they were before the highlight existed — making lit links prominent did not brighten the graph at rest

#### Scenario: Ceasing to point restores the view

- **WHEN** the user stops pointing at the node (moves the mouse off it, releases the inspect pose, or moves the hand away)
- **THEN** the links and nodes return to exactly how they were drawn before, including any dimming a live focus was applying

#### Scenario: The highlight selects nothing

- **WHEN** a node's cluster is highlighted by pointing
- **THEN** the focus is unchanged, no note opens, the camera does not move, and nothing the voice layer or a run reads has changed

#### Scenario: Nothing accumulates across nodes

- **WHEN** the user points at one node after another
- **THEN** exactly one cluster is lit at a time and each previous one returns to normal — no growing set of lit nodes builds up

#### Scenario: The rest of the galaxy dims around the pointed-at cluster

- **WHEN** the user points at a node while nothing is focused
- **THEN** everything outside that node's one-hop cluster is dimmed for as long as it is pointed at, so the cluster is the only lit thing in the view

#### Scenario: Pointing at a dimmed node reveals its cluster

- **WHEN** a focus is active, everything outside its one-hop neighbourhood is dimmed, and the user points at one of those dimmed nodes
- **THEN** that node and its own one-hop neighbours are drawn at full strength while it is pointed at, everything else — including what the focus was keeping bright — is dimmed, and the focus itself is not changed

#### Scenario: Releasing restores the focus's dimming

- **WHEN** the user stops pointing while a focus is still active
- **THEN** the dimming returns to exactly what the focus was applying before

#### Scenario: A selection stays visible under a spotlight elsewhere

- **WHEN** notes are focused and the user points at an unrelated node
- **THEN** the focused notes are still visibly focused, even though they are outside the lit cluster

#### Scenario: Every producer draws the same thing

- **WHEN** the same node is pointed at by mouse hover on one occasion and by the inspect pose on another
- **THEN** the rendering is identical in both cases

#### Scenario: The hand's target wins over the mouse

- **WHEN** hand control is on, the hand is pointing at one node, and the mouse pointer happens to rest over a different node
- **THEN** the hand's target is the node whose cluster is highlighted

#### Scenario: A ghost node is not pointed at

- **WHEN** the user hovers or points at a faded ghost node
- **THEN** no cluster highlight is drawn for it

#### Scenario: Sweeping across a dense region does not repaint per node

- **WHEN** the pointer moves rapidly across many nodes in a dense cluster
- **THEN** highlight repaints are coalesced rather than one full-graph repaint being performed for every node crossed

### Requirement: Opening a node shows the note's content

Clicking a real note-node in the galaxy SHALL open that note in a note-reader overlay that renders the note's markdown (title plus body). The note's content SHALL be fetched by node id and resolved to a file in the main process (never by a renderer-supplied path); a ghost node (unresolved link with no backing file) SHALL NOT be openable. The overlay SHALL present the note's own content without the task-specific chrome of the run reader (no run/session id, agent, or status badges), and at most one reader (task or note) SHALL be open at a time. Closing the overlay SHALL return to the galaxy with the layer still active. The note reader SHALL exist only while the galaxy layer does: whenever the galaxy is not active the note reader SHALL NOT be shown **and** the stored open-note state SHALL be cleared — the first makes the invariant hold by construction even for a fetch that lands after the close, the second prevents a stale note from reappearing the next time the galaxy is opened — so that **no** galaxy-close path — the toggle, opening the drawing panel, leaving the HUD by button/hotkey/tray, or a force-close after a render crash — and no in-flight note fetch that completes after the galaxy closed can leave a note reader stranded over the transparent HUD or the deck.

**The reader SHALL also be able to edit the note.** A control SHALL switch the body between the rendered markdown and the note's **raw text** in an editable field, and saving SHALL write that text to the note's file. Raw text, not a rendered editor: what the vault stores is markdown with frontmatter, and an editor that hid either would make the note's own structure unavailable to the person who owns it. Saving SHALL be an explicit action; there SHALL be no autosave, because a keystroke is not a decision. Discarding SHALL leave the file untouched.

**Unsaved edits SHALL NOT be lost by any route that closes the reader.** While edits are pending, every close route — the × control, `Esc`, and the fist-closes-reader gesture alike — SHALL stop closing the reader and SHALL ask what to do instead, and the asking SHALL NOT use a blocking modal dialog. While the editor is active, the reader's hand-gesture bindings SHALL be suspended entirely, so a gesture cannot scroll, resize, or close away work in progress.

**A save SHALL be refused rather than allowed to overwrite a concurrent change.** The content served when the note was opened SHALL carry a revision token, a save SHALL carry that token back, and the save SHALL be refused if the note's file no longer matches it — because Claude's note session, a voice capture, or another application may have written the file in between. A refused save SHALL preserve the user's unsaved text and SHALL report what happened; overwriting anyway SHALL be possible only as a further explicit action by the user. Iris SHALL NOT choose a winner on its own, in either direction.

**The reader SHALL offer opening the note in the system's default application** for its file type, resolved by note identity in the main process like every other vault path. This exists because the in-app field is deliberately a small editor and some edits want a real one; it is a route out, not a replacement for editing in place.

A successful save SHALL be reflected in the galaxy without a reload, on the same terms as any other change to the vault, and SHALL NOT disturb the settled layout beyond what the change itself implies.

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

#### Scenario: A saved note updates the galaxy live

- **WHEN** a hand edit that changes the note's title, tags, or links is saved while the galaxy is displayed
- **THEN** the galaxy reflects it after the usual debounce, with the surrounding nodes keeping their positions

### Requirement: Note titles are always drawn in the galaxy, legible by camera proximity

The galaxy SHALL render every eligible note's title as text in the scene beside its node, at all times — titles are not toggled on or off by camera distance. Legibility instead comes from the sprite's own perspective scaling (`sizeAttenuation`): a title far from wherever the camera is oriented shrinks on screen exactly as its node's dot already does, reading as visual noise near a small dot rather than as competing legible text, while a title the camera is close to grows large and readable. Viewed from far out — including the whole-vault framing a fresh galaxy opens with — titles SHALL therefore be too small to read and the view SHALL still read as an unlabelled field of dots in practice, without any title having actually stopped rendering; moving the camera in toward a region SHALL grow that region's titles into legibility.

Titles SHALL be readable from navigation alone — no pointer, hover, click, or gesture. This is the point of the requirement: the hover tooltip names one node and only while a pointer rests on it, and under hand control there is no pointer at all, so without in-scene titles a node can be identified only by opening it. The hover tooltip SHALL remain unchanged; this adds an affordance and removes none.

The number of title sprites SHALL be bounded by a pool sized once, when the galaxy opens, to the vault's own note count — every note gets a title — capped at a defensive ceiling so a pathologically large vault cannot allocate an unbounded number of textures. Only a vault whose note count exceeds that ceiling SHALL have any titles omitted, and only the farthest-from-camera notes past the ceiling, nearest-first; a vault within the ceiling SHALL have every note titled, at every zoom level, without any note's title ever being withheld for being "too far."

When the pool's ceiling IS exceeded, which notes are titled SHALL NOT depend on which angle the camera happens to be viewing from: two notes equally near wherever the camera is oriented SHALL be treated as equally eligible, regardless of which one the camera's exact line of sight passes through — a note "beside" another must not be truncated ahead of it purely because it sits off that line.

A shown title SHALL track its node's position while the force layout settles and while the graph updates, so a title is never left floating away from the node it names.

A title too long to draw legibly SHALL be elided rather than drawn as a banner across the view, so one long note name cannot obscure the nodes and titles around it.

A title SHALL NOT be shown for a node the focus declutter has dimmed — a node outside the focused notes' one-hop neighbourhood (see `second-brain-focus`) — so titles do not re-clutter what the dimming just cleared.

Titles SHALL stop being drawn and updated whenever the galaxy's rendering is paused (the same sleep signal that pauses the force simulation and render loop), and SHALL resume with it, so titles never cost anything while Iris is idle.

#### Scenario: A galaxy viewed from far out reads as unlabelled

- **WHEN** the galaxy is open at a camera distance that frames the whole vault
- **THEN** every title is still technically drawn, but each is shrunk by perspective to the point of being illegible next to its node's dot, so the view reads as an unlabelled field of nodes over the deep-space backdrop

#### Scenario: Moving in toward a region grows its titles into legibility

- **WHEN** the camera moves close enough to a group of nodes for perspective scaling to make their titles large enough to read
- **THEN** those nodes' titles read clearly, so the user can tell which notes they are without hovering, clicking, or opening any of them

#### Scenario: A note in a different cluster is titled too, not just the one the camera is near

- **WHEN** the vault has multiple clusters and the camera (moved by rotate and scroll-zoom alone, no panning) is currently oriented toward only one of them
- **THEN** notes in the other clusters still carry titles (shrunk by distance if far, but present) rather than staying permanently unlabelled because the camera has never been oriented toward them

#### Scenario: A note beside another is not truncated ahead of it just for being off-axis

- **WHEN** the vault exceeds the pool's ceiling and two notes sit at roughly the same distance from wherever the camera is oriented, one of them along the camera's exact line of sight and one beside it
- **THEN** both are equally eligible to be titled — the one directly ahead is not favoured over the one beside it, and rotating the camera further does not change which of the two gets truncated

#### Scenario: A vault under the ceiling has every note titled

- **WHEN** the vault's note count is at or under the pool's defensive ceiling
- **THEN** every note's title is drawn (subject to focus declutter and the sleep pause), regardless of how far any of them are from the camera

#### Scenario: A vault over the ceiling truncates the farthest notes first

- **WHEN** the vault's note count exceeds the pool's defensive ceiling
- **THEN** the ceiling's worth of nearest-to-camera notes are titled and the remainder are not, so the on-screen title count never exceeds the ceiling regardless of vault size

#### Scenario: A title follows its node while the layout settles

- **WHEN** a node whose title is shown is still moving (the force layout is settling, or a graph update reheated it)
- **THEN** its title moves with it and stays beside the node it names

#### Scenario: A very long note title is elided

- **WHEN** a node whose title is far longer than the view can draw legibly carries a title
- **THEN** its title is drawn elided rather than as a full-width banner, and the nodes and titles around it stay visible

#### Scenario: A dimmed node is not named

- **WHEN** a focus is active and a node outside the focus's one-hop neighbourhood would otherwise carry a title
- **THEN** no title is drawn for that node, matching the near-invisible dimming already applied to it

#### Scenario: A ghost node is named like any other node

- **WHEN** a ghost node (an unresolved `[[wikilink]]` target with no backing file) carries a title
- **THEN** its name is drawn like any other node's, so the dangling link is identifiable — while its faded rendering continues to mark it as not openable

#### Scenario: Titles stop while the galaxy is asleep

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the force simulation and render loop
- **THEN** titles stop being drawn and updated for as long as the galaxy is paused, and reappear correctly positioned when Iris is awake again

#### Scenario: The hover tooltip still works

- **WHEN** the user hovers a node with the pointer
- **THEN** the existing tooltip still shows that node's title, independent of the in-scene title's current on-screen size

### Requirement: Untrusted note content is contained

Because notes may originate from the web (`wiki-ingest`), the galaxy SHALL treat note content as untrusted in the privileged renderer. Note titles/labels SHALL NOT be injected as HTML into the graph's tooltip (no script execution from a crafted title); a title rendered in the scene SHALL reach the view as drawn text rather than through any surface that interprets markup, so a crafted title is inert there by construction and not merely by escaping; note markdown SHALL be rendered with raw HTML escaped (no `rehype-raw`/`dangerouslySetInnerHTML`); an in-note hyperlink SHALL NOT be able to navigate the app window away from the app (external links are denied or opened out-of-app); and `secondbrain:read-note` SHALL refuse to read any path that, after symlink resolution, falls outside the vault directory.

#### Scenario: A crafted note title does not execute script

- **WHEN** a note's title/filename contains HTML like `<img src=x onerror=…>` and its node label is shown
- **THEN** the markup is escaped/inert and no script runs in the renderer

#### Scenario: A crafted note title is inert as an in-scene title

- **WHEN** a note whose title contains HTML like `<img src=x onerror=…>` carries a title in the scene
- **THEN** the title's characters are drawn literally as text, nothing is parsed as markup, and no script runs

#### Scenario: An in-note link cannot replace the app

- **WHEN** the user activates an `https://` link inside an opened note
- **THEN** the app window is not navigated to the remote page (the link is denied or opened outside the app)

#### Scenario: A symlinked note escaping the vault is not readable

- **WHEN** a node resolves (after following symlinks) to a path outside `~/iris-second-brain` (e.g. a note symlinked to `~/.ssh/id_rsa`)
- **THEN** `secondbrain:read-note` refuses the read and returns no file contents

### Requirement: The galaxy view is gated on the vault existing, independent of the Claude pipeline

The "show second brain" capability SHALL be available exactly when the vault directory `~/iris-second-brain` exists, regardless of whether the Claude pipeline is available — because viewing only reads local markdown. When the vault exists but contains no notes, the galaxy SHALL show a friendly empty-state rather than an error or a blank layer. Iris SHALL NOT create the vault merely because the toggle was shown.

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

### Requirement: The camera turns and dollies around a movable anchor

The galaxy SHALL have a single **anchor** — the point the camera turns around and
dollies toward — and every camera drive, by hand or by mouse, SHALL use that one
anchor. It SHALL be the graph's centroid, one specific node, or a specific point
in space.

**A camera drive SHALL turn around whatever the sight is on, always.** When a node
is near the sight the anchor SHALL be that node, so dollying in arrives at a note.
When no node is near enough it SHALL be the point under the sight itself, at the
depth the camera is already working at — **not** the anchor left over from before.
An anchor that survives a grab aimed somewhere else is a pivot the user is not
pointing at and cannot see; most visibly it is the note they last opened, which
then follows them around invisibly. The mark on screen and the point the camera
turns around are the same thing, with no exception to remember.

A freshly-opened galaxy SHALL be anchored on the centroid, so the view a galaxy
opens with is unchanged by this requirement existing.

The anchor SHALL move to a node when:

- a camera drive engages and a node is near the **sight** — the mark showing where
  the user's hands are aimed (see below, and `second-brain-gesture-nav`, "A closed
  two open palms fly the galaxy camera to a note") — so the node they are pointing at becomes the
  thing they turn around;
- a note is opened, whether by click or by dwell — so closing the reader leaves the
  camera around that note's neighbourhood rather than the middle of the vault.
  This SHALL NOT survive the next camera drive: the drive re-resolves from the
  sight, so an opened note is where the camera is *left*, never a pivot that
  outlives the user aiming somewhere else;
- the user reaches a note through the step rail (see `second-brain-gesture-nav`);
- the mouse wheel is used while the pointer rests on a node — scrolling zooms into
  the dot under the pointer.

The anchor SHALL return to the centroid when the camera is dollied far enough out
that the whole graph is being framed, so backing away is the way back to the
overview and no separate control is needed to escape a node.

**Re-anchoring SHALL NOT move the camera.** The camera's position SHALL be held
exactly where it is and only its relationship to the new anchor recomputed, so
engaging a drive can never teleport the view. Where re-anchoring changes what the
camera is aimed at, that change of aim SHALL be eased rather than applied as a
jump: the anchor is chosen from what is *near* the centre of the screen, so it is
routinely a little off-centre, and a jump would read as the view flinching each
time the user grabs it.

**A camera the user positioned SHALL NOT be silently discarded.** Panning or
framing the view with the mouse SHALL set the anchor rather than be overwritten by
it. Previously a hand drive reset the camera's aim to the graph's centroid on
engage and again on release, so a fist thrown after the user had framed a region
by mouse threw that framing away; that SHALL NOT happen.

Nothing about the anchor SHALL change what is selected. Moving the anchor is a
navigation act: it SHALL NOT alter the focus (see `second-brain-focus`), SHALL NOT
open a note, and SHALL NOT change what the voice layer or a run reads.

#### Scenario: A fresh galaxy is anchored on the whole vault

- **WHEN** the user opens the galaxy
- **THEN** the camera frames the whole vault and turns around the graph's centroid, exactly as it did before the anchor existed

#### Scenario: Zooming reaches the note, not the middle of the ball

- **WHEN** a node is anchored and the user dollies the camera in as far as it will go
- **THEN** the camera arrives at that note, rather than at the centre of the graph

#### Scenario: Opening a note anchors the camera on it

- **WHEN** the user opens a note and then closes the reader
- **THEN** the camera turns around that note's position, so its neighbourhood is what the next camera drive explores

#### Scenario: Scrolling over a node zooms into it

- **WHEN** the pointer rests on a node and the user scrolls the mouse wheel
- **THEN** the camera moves toward that node

#### Scenario: Re-anchoring does not teleport the camera

- **WHEN** the anchor moves from one point to another
- **THEN** the camera stays exactly where it is and only what it turns around changes — nothing jumps to a new position

#### Scenario: A change of aim is eased, not snapped

- **WHEN** re-anchoring aims the camera at a node that was near but not exactly at the centre of the screen
- **THEN** the aim moves onto it smoothly rather than snapping in a single frame

#### Scenario: A mouse-framed view survives a hand drive

- **WHEN** the user frames a region of the galaxy with the mouse and then engages a hand camera drive
- **THEN** the camera stays exactly where the mouse left it and the drive does not reset its aim to the graph's centroid, on engage or on release. The pivot moves to whatever the user's sight is on, because that is what engaging a drive means — but nothing is discarded silently and nothing reverts to the middle of the vault.

#### Scenario: The last-opened note does not become an invisible pivot

- **WHEN** the user opens a note, closes the reader, and then engages a camera drive with the sight over empty space
- **THEN** the camera turns around the point under the sight, not around the note they opened

#### Scenario: Backing out returns to the whole vault

- **WHEN** a node is anchored and the user dollies the camera out far enough to frame the whole graph
- **THEN** the anchor returns to the centroid, so the view frames the vault as a whole again and further retargeting is suspended until the camera comes back in

#### Scenario: The anchor selects nothing

- **WHEN** the anchor moves to a node by any route
- **THEN** the focus is unchanged, no note opens, and nothing the voice layer or a run reads has changed

### Requirement: The camera is aimed by a sight that follows the hands

While hand control is enabled and the galaxy is active, Iris SHALL show a **sight**
— a mark of where the camera drives are aimed — and that sight SHALL follow the
user's hands rather than being fixed to the centre of the screen.

**A sight fixed at the centre of the screen cannot be aimed.** The only way to put
something under it is to fly the camera until that thing is in the middle, which is
the hardest part of navigating the galaxy demanded *before* the easy part is
allowed to begin. Zooming then moves toward whatever happened to be at the centre,
which from the user's side is arbitrary — the gesture has no relationship to the
region they were looking at. Reading the sight off the hands inverts it: the user
puts their hands over the region and acts, in one motion, with no camera work
first.

**The sight SHALL follow a SINGLE hand, and SHALL NOT exist while two palms are
up.** Aiming and zooming are carried by different numbers of hands rather than by
the same pair: the sight was previously the midpoint between two open palms, on
the reasoning that a symmetric spread leaves that midpoint still — true of the
geometry and false of hands, so every zoom was also a slight re-aim. While two
palms are up there SHALL be no aim point, and the sight mark SHALL be hidden,
since a mark shown then would claim the zoom is going somewhere it is not.

#### Scenario: The sight follows the hands rather than the centre of the screen

- **WHEN** hand control is on, the galaxy is active, and the user moves their hands across the frame
- **THEN** the sight moves with them, and a camera drive engaged there aims at what the sight is over — not at whatever sits at the centre of the screen

#### Scenario: The sight disappears while two palms zoom

- **WHEN** the user raises a second open palm to zoom
- **THEN** the sight mark is hidden and the hands' movement no longer changes what the camera is aimed at

#### Scenario: No hand in frame means nothing is being aimed at

- **WHEN** hand control is on and the galaxy is active but no hand is in frame
- **THEN** no sight is shown and no new target is chosen — the note already locked is kept

### Requirement: What a grab will take hold of is visible before the grab

While hand control is enabled and the galaxy is active, Iris SHALL show which node
a camera drive would anchor to if engaged now, and — while a drive is engaged —
that a drive is engaged at all. While a node is anchored, that node SHALL be marked
distinctly from the candidate.

This is not decoration. An anchor that moves is *harder* to use than a fixed one
unless the user can predict where it will land: without the marks, engaging a
drive is a guess about which node the system picked, and a guess that lands wrong
is indistinguishable from the camera misbehaving. The centre mark is what the user
aims with; the candidate mark is what tells them the aim has succeeded before they
commit to it.

The marks SHALL be present only while they can be acted on: they SHALL NOT be
drawn while hand control is off, while the galaxy is not active, or while a reader
holds the gesture surface, and they SHALL stop with the galaxy's rendering when
Iris sleeps.

Recomputing which node is the candidate SHALL be rate-limited rather than done
every frame, on the same grounds the existing title selection is: the search is
proportional to the node count and a candidate that changes at frame rate would
both cost more than it is worth and read as flicker.

The candidate and anchor marks SHALL be distinguishable from the pointed-at
highlight and from the focus indicator, so a user can tell "this is what I would
grab" from "this is what I asked about" and from "this is what I selected".

#### Scenario: The sight follows the hands

- **WHEN** the galaxy is active with hand control on and the user moves their hands across the view
- **THEN** the sight moves with them, so the user aims by moving their hands rather than by first flying the camera

#### Scenario: Spreading the palms goes where the sight is

- **WHEN** the user holds both palms over a region away from the centre of the screen and spreads them
- **THEN** the camera dollies toward that region, not toward whatever sits at the centre of the screen

#### Scenario: The aim keeps up during a two-palm zoom

- **WHEN** the user is dollying with two open palms and moves both hands together onto a different node
- **THEN** the camera re-aims onto that node without the view jumping, and continues dollying toward it

#### Scenario: The node a grab would take is marked

- **WHEN** a node is near the sight and no camera drive is engaged
- **THEN** that node is marked as the candidate, so the user knows what engaging a drive would anchor to

#### Scenario: An engaged drive is visibly engaged

- **WHEN** the user makes a camera-drive pose and the recognizer accepts it
- **THEN** the marks change to say so, so the wait for the pose to be recognized reads as waiting rather than as the gesture having failed

#### Scenario: The live anchor is marked distinctly

- **WHEN** a node is anchored
- **THEN** it is marked more strongly than the candidate, so the user can always tell what the camera is currently turning around

#### Scenario: No marks without hand control

- **WHEN** hand control is off and the galaxy is active
- **THEN** neither the sight nor the candidate mark is drawn

#### Scenario: Marks stop while Iris sleeps

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the render loop
- **THEN** the marks stop being drawn and updated, and return correctly when Iris is awake again

#### Scenario: The candidate is not recomputed every frame

- **WHEN** the sight moves continuously across a dense region
- **THEN** the candidate is re-selected at a rate-limited interval rather than once per rendered frame

#### Scenario: The marks are not confusable with the highlight or the focus

- **WHEN** a node is simultaneously the anchor candidate, pointed at, and focused
- **THEN** the three treatments remain distinguishable from one another

