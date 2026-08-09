## Purpose

An Iris-hosted local MCP server that connects Claude to the `hud-drawing-canvas` whiteboard: Claude reads the current canvas fresh on call and draws on it (create/update/delete elements), Iris-scoped per run and wired only to the verb that declares it, gated on Claude availability and on the canvas having been engaged this session so a pure-voice session pays no token cost.
## Requirements
### Requirement: Iris hosts a local canvas MCP server, gated on Claude availability
Iris SHALL host a single MCP server over Streamable HTTP bound to `127.0.0.1` on an ephemeral port, exposing read and write tools over the drawing canvas. Because the server only ever serves local Claude, its security is right-sized: it SHALL be guarded by a single per-session bearer token (which blocks the one realistic local vector — a browser page fetching localhost) and SHALL NOT require internet-grade DNS-rebinding/Origin hardening. The server and its wiring to Claude SHALL be gated on **both** the pipeline being available (Claude present) **and** the drawing canvas having been engaged in the session (the panel opened at least once — a sticky per-session condition that survives the panel being toggled shut), so a session that never uses the canvas pays no token cost for the capability. It SHALL be stopped when the app quits. When either condition is unmet the server SHALL NOT be wired, and the drawing whiteboard (the `hud-drawing-canvas` capability) SHALL keep working without it.

#### Scenario: Server runs only with Claude present and the canvas engaged

- **WHEN** the pipeline is available (Claude binary resolves) and the drawing panel has been opened at least once this session
- **THEN** the canvas MCP server is listening on `127.0.0.1` with a token and wired to Claude, and is torn down on quit

#### Scenario: No wiring in chat-only mode

- **WHEN** the pipeline is not available
- **THEN** no canvas MCP server is wired, and the whiteboard still opens and draws normally

#### Scenario: No wiring for a session that never opens the canvas

- **WHEN** Claude is present but the drawing panel has never been opened this session
- **THEN** the canvas MCP is not wired to Claude (no per-turn token cost), and it becomes wired once the panel is first opened

#### Scenario: Wiring persists after the panel is closed

- **WHEN** the canvas was engaged (opened) and is then toggled shut within the same session
- **THEN** the canvas MCP stays wired, so Claude can still read/write the canvas while the panel is closed

#### Scenario: Token-guarded

- **WHEN** a request arrives without the current session's bearer token
- **THEN** it is rejected

### Requirement: Claude reads the current canvas fresh on call
The MCP server SHALL expose a read tool returning the **current** canvas from Iris's in-memory scene cache (not a stale or debounce-delayed copy), safe to call whether or not the drawing panel is mounted. The result SHALL be the canonical excalidraw JSON (elements — including arrow `startBinding`/`endBinding` connectivity — and embedded `files`), and MAY optionally include a rendered image (PNG or SVG) of the canvas for visual layout.

#### Scenario: Read reflects the latest edits

- **WHEN** the user (or a prior tool call) has changed the canvas and Claude then calls the read tool
- **THEN** the returned scene reflects those latest changes

#### Scenario: Read works while the panel is closed

- **WHEN** the read tool is called while the drawing panel is hidden/unmounted
- **THEN** the last known scene is returned without error

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

### Requirement: The canvas server is wired Iris-scoped, per run, to the verb that declares it
The canvas tool server SHALL be provided Iris-scoped and per run, without writing to `~/.claude`, to the runs of the **verb that declares it** and to no others. The declaring verb's runs SHALL receive it via the SDK `mcpServers` option — and, on a resident session opened by a sibling verb that did not declare it, via the live-session equivalent applied at most once. It SHALL carry the localhost server URL and the session token, and SHALL make the canvas tools available in the run's first turn without requiring a tool-search step.

Wiring it into **every** run, as this requirement previously mandated, gave the canvas tools to runs with no connection to drawing and made the server a per-run special case rather than a declared capability. Which runs may reach it is now a property of the verb, read from the registry.

#### Scenario: The canvas verb's run can use the canvas tools

- **WHEN** a canvas run starts while the canvas tool server is available
- **THEN** that run has the canvas read/write tools without any change to `~/.claude`

#### Scenario: A verb that does not declare the server never receives it

- **WHEN** a run of any other verb starts while the canvas tool server is available
- **THEN** no canvas tool server is wired into it, and the server is not even consulted

#### Scenario: A shared session gets it on the turn that needs it

- **WHEN** a resident session was opened by a verb that does not declare the server, and a later turn into that same session is made by the verb that does
- **THEN** the server is wired into the live session for that turn, without closing or resuming it

### Requirement: The canvas is a verb Iris can call, not prose routed around a gate
Working on the canvas together SHALL be reachable through a named verb with its own parameter schema, wired to the canvas tool server from the verb registry.

It SHALL NOT be offered only as prose in the voice layer's system instruction directing it toward a general-purpose task tool. In particular, the canvas capability SHALL NOT carry instructions warning the voice layer away from a worker that would refuse the request for reasons unrelated to drawing. A capability that must describe a pipeline gate it has nothing to do with is being routed around rather than served.

#### Scenario: Canvas work has its own function

- **WHEN** the voice layer's tool declarations are built and the worker is available
- **THEN** a declaration exists for canvas work, with its own parameters

#### Scenario: No workaround for an unrelated gate

- **WHEN** the canvas capability's contribution to the voice layer is built
- **THEN** it contains no instruction steering away from a worker on grounds unrelated to the canvas

#### Scenario: The tool server is wired from the registry

- **WHEN** a canvas run starts
- **THEN** the canvas tool server is wired from that verb's registry entry, not from a per-run special case

### Requirement: Moving to the canvas continues the conversation
The canvas verb SHALL share its live session with the verb that shapes requirements by voice, so moving to the canvas continues the same conversation rather than starting a second one.

Switching to drawing happens when talking has stopped being enough — which is exactly when the accumulated context matters most. A canvas run that cannot see what was already discussed would ask the user to repeat themselves at the worst moment.

#### Scenario: The canvas sees what was already discussed

- **WHEN** a conversation that began by voice moves to the canvas
- **THEN** the canvas run has the context of that conversation without it being restated

#### Scenario: Either verb may open the shared conversation

- **WHEN** the canvas verb is called with no conversation open
- **THEN** it opens the shared session, and a later voice turn continues that same conversation

