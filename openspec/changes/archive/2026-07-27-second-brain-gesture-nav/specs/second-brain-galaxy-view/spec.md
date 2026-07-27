## MODIFIED Requirements

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
