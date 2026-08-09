## MODIFIED Requirements

### Requirement: Claude draws on the canvas
The MCP server SHALL expose write tools that create, update, and delete canvas elements (shapes, text, connectors). A write SHALL be applied to Iris's scene cache, persisted (durably — a write SHALL NOT be lost if it lands while the panel is closed), and — when the drawing panel is mounted — reflected in the live excalidraw canvas so the user sees the change. Created connectors SHALL be able to reference existing elements so Claude can express relationships between shapes. Each write SHALL return a **per-element result** distinguishing applied elements from those skipped for an unknown id or whose connector binding was dropped, so Claude can detect and correct a bad write.

Concurrency between the user's editing and Claude's writes is resolved last-writer-wins **per element**. It SHALL NOT be resolved per scene: a whole-scene push derived from a revision older than the cache's SHALL NOT delete elements written since that revision, and a write from Claude SHALL NOT delete elements the user drew after Claude read the scene. Concurrent edits to the *same* element are still not merged.

A write SHALL be reported as persisted only if it was persisted. When a write leaves the scene beyond the persistence guard, the tool result SHALL say the write is in memory only, rather than reporting success.

#### Scenario: Claude adds a shape

- **WHEN** Claude calls a write tool to add an element
- **THEN** the element is added to the scene, persisted, and appears on the live canvas if the panel is open

#### Scenario: Write while panel closed still persists

- **WHEN** a write tool is called while the drawing panel is hidden
- **THEN** the change is applied to the cache and persisted durably, and is visible when the panel is next opened

#### Scenario: Closing the panel does not discard what Iris drew

- **WHEN** Claude writes to the canvas and the user then closes the drawing surface, whether or not the panel ever received the write
- **THEN** Claude's elements are still in the scene, and are still there after the app restarts

#### Scenario: A concurrent user stroke is not erased

- **WHEN** the user draws after Claude reads the scene, and Claude's write then arrives
- **THEN** both Claude's elements and the user's stroke are present

#### Scenario: The user can still delete what Iris drew

- **WHEN** the user deletes an element Claude added, from a canvas that has seen that element
- **THEN** it is deleted and does not reappear

#### Scenario: Update and delete by element identity

- **WHEN** Claude updates or deletes elements by their ids
- **THEN** the referenced elements are modified or removed in the scene

#### Scenario: Invalid write is reported, not silently dropped

- **WHEN** Claude updates/deletes an unknown element id, or adds a connector bound to a nonexistent element
- **THEN** the tool result marks that element as skipped / its binding as dropped, rather than silently losing it

#### Scenario: An unpersisted write is not reported as persisted

- **WHEN** a write cannot be persisted because the scene exceeds the size guard
- **THEN** the tool result says so instead of reporting the write as applied

### Requirement: The live canvas reflects external writes without echoing them back
When the drawing panel is mounted, it SHALL apply externally-originated element changes (from the MCP write path) into the live scene by reconciling the elements the write touched — never by replacing the whole scene — and SHALL export a rendered image of the current scene on request. Applying an external change SHALL NOT be echoed back as a fresh whole-scene write that could revert the just-applied change (the write loop is broken); the user's own edits SHALL continue to propagate normally.

An external write SHALL be recorded as a distinct undo step, so the user can undo what Iris drew without first undoing their own work. A write that arrives while the panel is mounting SHALL NOT be discarded: it SHALL be applied once the canvas is ready.

When such a write places elements outside the current viewport, the panel SHALL bring them into view and SHALL indicate that the change came from Iris — a successful write must never be indistinguishable from nothing having happened.

An image request SHALL degrade to no image (never an error) when the panel cannot export, and the result SHALL state why the image is absent rather than omitting it silently. The image budget SHALL be smaller than the surrounding request's lifetime, so a slow export degrades deliberately rather than by racing its own cleanup.

#### Scenario: External write appears live without a revert

- **WHEN** an MCP write is applied while the panel is mounted
- **THEN** the change shows on the live canvas and is not immediately reverted by an echoed whole-scene write

#### Scenario: The user can undo Iris's drawing

- **WHEN** Claude adds elements and the user undoes
- **THEN** Claude's elements are removed as one step, and the user's own prior work is untouched

#### Scenario: A write during mount is not lost

- **WHEN** a write arrives before the canvas API is ready
- **THEN** it is present on the canvas once the panel has finished mounting

#### Scenario: Off-screen write is brought into view

- **WHEN** Claude adds elements outside the visible viewport
- **THEN** the view moves so that they are visible, and the change is attributed to Iris on screen

#### Scenario: Image export degrades gracefully

- **WHEN** a rendered image is requested but the panel is unmounted or cannot export in time
- **THEN** the read result omits the image and still returns the scene JSON without error

#### Scenario: A missing image is explained, not omitted

- **WHEN** an image is requested and cannot be produced
- **THEN** the tool result says why the image is absent
