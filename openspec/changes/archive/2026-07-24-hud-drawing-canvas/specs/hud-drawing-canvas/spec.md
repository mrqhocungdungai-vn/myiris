## ADDED Requirements

### Requirement: Toggleable excalidraw drawing panel in Glass HUD

The app SHALL render an excalidraw-based drawing **panel**, available **only in Glass HUD mode**, controlled by a visibility toggle. The toggle SHALL be an icon button in the **bottom-right orb control cluster** (the `.hud-controls` row alongside the mic/speaker/sleep/hand/exit controls), which is hover-revealed and hidden during normal use — so the drawing affordance never clutters the resting HUD. The panel SHALL be a **bounded region** (not a full-screen overlay) so glass outside it remains click-through. The panel SHALL be **hidden by default**. When hidden, the HUD's click-through behavior SHALL be unchanged. In deck mode the drawing panel SHALL NOT be present.

#### Scenario: Activate the drawing panel in HUD

- **WHEN** the user activates the drawing toggle while in Glass HUD mode
- **THEN** the excalidraw panel appears as an interactive drawing surface within its bounded region
- **AND** glass outside the panel remains click-through to the apps underneath

#### Scenario: Deactivate returns to a clean overlay

- **WHEN** the user deactivates the drawing toggle
- **THEN** the panel is hidden and the HUD returns to its normal click-through overlay behavior

#### Scenario: Not present in deck mode

- **WHEN** the app is in deck mode
- **THEN** no drawing panel or drawing toggle is shown

### Requirement: Drawing panel is pointer-interactive with latched interactivity

While the drawing panel is active, its region SHALL be pointer-interactive through the existing HUD click-through mechanism (`.hud-hit` / `hud:interactive` → `setIgnoreMouseEvents`), and the window SHALL remain interactive for the whole duration the panel is active rather than being re-decided per pointer move — so a drag, marquee-select, or wheel-zoom that crosses the panel edge does not flip the window click-through mid-gesture. Excalidraw popovers/menus SHALL be interactive (they SHALL NOT render into a click-through glass region).

#### Scenario: A drag that crosses the panel edge is not interrupted

- **WHEN** the user drags or marquee-selects on the active panel and the pointer crosses the panel boundary
- **THEN** the gesture continues to reach excalidraw and the window does not flip to click-through mid-gesture

#### Scenario: Popovers are clickable

- **WHEN** the user opens an excalidraw menu, dropdown, or color picker on the active panel
- **THEN** that popover is interactive and responds to clicks

#### Scenario: Glass stays click-through when hidden

- **WHEN** the drawing panel is hidden and the pointer is over a glass (non-`.hud-hit`) region
- **THEN** clicks reach the application underneath the overlay as before

### Requirement: Keyboard input reaches the canvas in the overlay

When the drawing panel activates, the HUD overlay window SHALL take keyboard focus so excalidraw receives keyboard events (text tool, Delete, and tool shortcuts), despite the window being transparent, frameless, and always-on-top.

#### Scenario: Typing and shortcuts edit the canvas

- **WHEN** the drawing panel is active and the user selects the text tool and types, or presses Delete / a tool shortcut
- **THEN** the keystrokes edit the canvas (text is entered, selection deleted, tool switched)

### Requirement: Scene persists across toggles, modes, and restart

The drawing scene SHALL be serialized with excalidraw's official serializer and persisted so its content survives hiding/showing the panel, switching between HUD and deck, and restarting the app. Reactivating the panel SHALL restore the last scene via excalidraw's official restore path rather than starting blank. Pending unsaved changes SHALL be flushed when the panel unmounts and when the app quits.

#### Scenario: Content survives a toggle cycle

- **WHEN** the user draws, hides the panel, and shows it again
- **THEN** the previously drawn content is still present

#### Scenario: Content survives a restart

- **WHEN** the user draws and then restarts the app
- **THEN** reopening the panel restores the previously drawn scene

#### Scenario: Exiting HUD while drawing flushes and preserves the scene

- **WHEN** the user exits HUD (or quits the app) while the panel is active with recent unsaved strokes
- **THEN** the pending scene is flushed to disk and is present when the panel is next opened

### Requirement: Local file open, save, and image export

Beyond the single auto-persisted working board, the drawing panel SHALL let the user open a local `.excalidraw` file into the canvas, save the canvas out to a named local file, and export the canvas as an image (PNG/SVG) — the same open/save/export affordances the excalidraw web app provides. These SHALL work while Iris runs from `file://` (offline, packaged). If the browser File System Access path is unavailable in that context, the app SHALL fall back to a native file dialog so open/save/export still function.

#### Scenario: Open a local drawing file

- **WHEN** the user opens a local `.excalidraw` file via the panel
- **THEN** its contents load into the canvas, replacing the current scene, and the loaded scene is auto-persisted like any other edit

#### Scenario: Save the canvas to a named local file

- **WHEN** the user saves the canvas to a local file
- **THEN** a `.excalidraw` file is written to the chosen location

#### Scenario: Export the canvas as an image

- **WHEN** the user exports the canvas as PNG or SVG
- **THEN** an image file of the canvas is produced

### Requirement: Main caches the scene and serves it over an IPC seam

The renderer SHALL push the current scene to the main process (`canvas:scene`) in the canonical excalidraw JSON format (`{ type:"excalidraw", version, elements[], appState, files }`); the main process SHALL update its in-memory cache immediately and serve that scene over `canvas:get-scene`, returning it safe to call whether or not the drawing panel is currently mounted (falling back to the persisted scene on first call). The served format SHALL be the same full-fidelity excalidraw JSON used for persistence and file save (no trimmed variant), so a later capability can read shape geometry, text, and arrow bindings. Persisting the cache to disk SHALL use an asynchronous atomic write, MAY be debounced independently of the in-memory cache update, and SHALL guard against unbounded size (embedded image growth).

#### Scenario: Served scene is fresh on call

- **WHEN** the scene changes and `canvas:get-scene` is then called
- **THEN** it returns the latest scene (the in-memory cache is not gated behind the disk-write debounce)

#### Scenario: Main serves the latest scene while the panel is unmounted

- **WHEN** `canvas:get-scene` is called while the drawing panel is hidden/unmounted
- **THEN** the main process returns the last pushed (or persisted) scene without error

#### Scenario: Persist is atomic and non-blocking

- **WHEN** the debounced scene is persisted
- **THEN** it is written via an asynchronous atomic (temp + rename) write that does not block the main-process event loop
