## MODIFIED Requirements

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
