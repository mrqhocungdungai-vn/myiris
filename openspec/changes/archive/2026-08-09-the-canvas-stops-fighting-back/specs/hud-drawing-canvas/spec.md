## MODIFIED Requirements

### Requirement: Toggleable excalidraw drawing panel in Glass HUD

The app SHALL render an excalidraw-based drawing surface, available **only in Glass HUD mode**, controlled by a visibility toggle in the bottom-right orb control cluster. The surface SHALL be **hidden by default**, and when hidden the HUD's click-through behavior SHALL be unchanged. In deck mode the drawing surface SHALL NOT be present.

The surface SHALL be **fullscreen** rather than a bounded region — it was bounded, and the bound bought nothing: the window underneath it is display-sized either way, so glass outside a bounded panel was never actually click-through while the panel held the pointer. A fullscreen layer states what is true, and pays for it with the escape routes required above.

The drawing surface and the second-brain galaxy are **mutually-exclusive HUD layers**: activating either SHALL deactivate the other, persisting its scene as on any deactivation.

#### Scenario: Activate the drawing panel in HUD

- **WHEN** the user activates the drawing toggle while in Glass HUD mode
- **THEN** the excalidraw surface fills the display as an interactive drawing surface

#### Scenario: Deactivate returns to a clean overlay

- **WHEN** the user deactivates the drawing toggle
- **THEN** the surface is hidden and the HUD returns to its normal click-through overlay behavior

#### Scenario: Not present in deck mode

- **WHEN** the app is in deck mode
- **THEN** no drawing surface or drawing toggle is shown

#### Scenario: Opening the galaxy closes the drawing panel

- **WHEN** the drawing surface is active and the user activates the second-brain galaxy view
- **THEN** the drawing surface is deactivated (its scene persisted) and the galaxy becomes the single active HUD layer

### Requirement: Scene persists across toggles, modes, and restart

The drawing scene SHALL be serialized with excalidraw's official serializer and persisted so its content survives hiding/showing the panel, switching between HUD and deck, and restarting the app. Reactivating the panel SHALL restore the last scene via excalidraw's official restore path rather than starting blank.

Restoring a scene SHALL also restore a viewport from which the scene's content is visible — either the persisted scroll and zoom, or a view scrolled to the content. A restored scene SHALL never present an empty-looking canvas while holding content.

Pending unsaved changes SHALL be flushed when the panel unmounts, when the document is being torn down (page hide, reload, or window close), and when the app quits — so that leaving by any route costs no strokes.

#### Scenario: Content survives a toggle cycle

- **WHEN** the user draws, hides the panel, and shows it again
- **THEN** the previously drawn content is still present

#### Scenario: Content survives a restart

- **WHEN** the user draws and then restarts the app
- **THEN** reopening the panel restores the previously drawn scene

#### Scenario: Reopening shows the drawing rather than empty space

- **WHEN** the user pans away from the origin, draws there, closes the panel, and reopens it
- **THEN** the drawn content is visible in the viewport, not scrolled out of sight

#### Scenario: Exiting HUD while drawing flushes and preserves the scene

- **WHEN** the user exits HUD, quits, or reloads while the panel is active with recent unsaved strokes
- **THEN** the pending scene is flushed and is present when the panel is next opened

### Requirement: Main caches the scene and serves it over an IPC seam

The renderer SHALL push the current scene to the main process (`canvas:scene`) in the canonical excalidraw JSON format; the main process SHALL update its in-memory cache immediately and serve that scene over `canvas:get-scene`, safe to call whether or not the panel is mounted.

Every accepted write to the cache SHALL carry a **monotonic revision**, and a push SHALL declare the revision it was derived from. A push derived from a revision older than the cache's SHALL NOT replace the cache wholesale; it SHALL be reconciled per element, so that a write accepted between the push's serialization and its arrival is not deleted by it.

Persisting the cache to disk SHALL use an asynchronous atomic write, MAY be debounced independently of the in-memory cache update, and SHALL guard against unbounded size. When a scene is **not** persisted because it exceeds that guard, the outcome SHALL be reported to its writer rather than reported as success.

#### Scenario: Served scene is fresh on call

- **WHEN** the scene changes and `canvas:get-scene` is then called
- **THEN** it returns the latest scene

#### Scenario: A stale push does not delete a newer write

- **WHEN** a renderer push derived from revision N arrives after the cache has advanced past N
- **THEN** the elements written since N survive the push

#### Scenario: Main serves the latest scene while the panel is unmounted

- **WHEN** `canvas:get-scene` is called while the drawing panel is hidden/unmounted
- **THEN** the main process returns the last pushed (or persisted) scene without error

#### Scenario: Persist is atomic and non-blocking

- **WHEN** the debounced scene is persisted
- **THEN** it is written via an asynchronous atomic (temp + rename) write that does not block the main-process event loop

#### Scenario: An unpersisted oversized scene is not reported as persisted

- **WHEN** a write leaves the scene larger than the persistence guard allows
- **THEN** the writer is told the scene was not persisted

## ADDED Requirements

### Requirement: The drawing surface is a fullscreen HUD layer

The drawing surface SHALL cover the display, on the same terms as the second-brain galaxy: the two are the mutually-exclusive fullscreen HUD layers, and at most one is open at a time. It SHALL paint **beneath** HUD chrome, so every chrome island — including the orb cluster that carries its own toggle — stays visible, clickable, and hand-reachable over it.

While such a layer is open the window SHALL hold pointer interactivity for the layer's whole lifetime. This is stated as a cost, not a convenience: the HUD window is display-sized and above the menu bar, so while the layer is open **nothing else on the machine can be clicked**. That is what makes the next requirement load-bearing rather than decorative.

Excalidraw UI that is portalled outside the surface's DOM subtree — modals, dropdowns, colour pickers, the eye-dropper backdrop, the command palette — SHALL be pointer-interactive. Excalidraw's own controls SHALL NOT be left underneath a chrome island; the surface's UI is inset clear of chrome rather than raised above it, so both remain usable.

#### Scenario: The surface covers the display

- **WHEN** the user activates the drawing toggle in Glass HUD mode
- **THEN** the drawing surface fills the screen and the HUD chrome islands remain visible and clickable over it

#### Scenario: A gesture is never interrupted

- **WHEN** the user drags, marquee-selects, or wheel-zooms anywhere on the surface
- **THEN** the gesture reaches excalidraw uninterrupted for its whole duration

#### Scenario: Popovers are clickable

- **WHEN** the user opens an excalidraw menu, dropdown, colour picker, or export dialog
- **THEN** that popover is interactive and responds to clicks and typing, wherever in the document it is rendered

#### Scenario: Excalidraw's own controls are not buried under chrome

- **WHEN** the surface is open and excalidraw renders its footer controls in the screen's bottom corners, where HUD islands sit
- **THEN** both those controls and the HUD islands are clickable

#### Scenario: Closing the surface returns the desktop

- **WHEN** the drawing surface is closed, or HUD is exited while it is open
- **THEN** click-through is restored without waiting for further pointer movement

### Requirement: A fullscreen layer always carries a way out

A HUD layer that covers the display and holds the pointer SHALL offer a way to close it that does not depend on the keyboard, and a way that does not depend on the renderer being healthy.

The drawing surface SHALL therefore present a **visible close control** within its own UI, in addition to Esc and its toggle. Esc SHALL be observed ahead of the canvas's own key handling, so that the canvas cannot consume the escape route; while an excalidraw dialog is open, Esc belongs to that dialog first. A crashed canvas SHALL force the layer closed rather than leave an unclosable surface owning the screen.

#### Scenario: The surface can be closed with the mouse alone

- **WHEN** the drawing surface is open and the user never touches the keyboard
- **THEN** a visible control closes it

#### Scenario: Esc is not swallowed by the canvas

- **WHEN** the user presses Esc with no excalidraw dialog open
- **THEN** the surface closes, regardless of what the canvas does with the key

#### Scenario: Esc belongs to an open dialog first

- **WHEN** an excalidraw dialog or the command palette is open and the user presses Esc
- **THEN** that dialog closes and the surface stays open; a second Esc closes the surface

#### Scenario: A crashed canvas does not hold the screen

- **WHEN** the canvas fails to load or throws while rendering
- **THEN** the layer force-closes and click-through is restored

## REMOVED Requirements

### Requirement: Drawing panel is pointer-interactive with latched interactivity

**Reason**: Replaced by "The drawing surface is a fullscreen HUD layer". The requirement was written for a bounded 84vw x 84vh panel and promised two things that cannot both hold on a display-sized window: that glass outside the panel stays click-through, and that the window stays interactive for the panel's whole lifetime. The surface is fullscreen now, so there is no "outside the panel" left to keep click-through, and the scenario "Glass stays click-through when hidden" — true only of the bounded panel while open — has no meaning here. What replaces it states the cost plainly and pairs it with a required way out.
