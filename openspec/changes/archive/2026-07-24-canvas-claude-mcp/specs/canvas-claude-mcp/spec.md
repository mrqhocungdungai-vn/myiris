## ADDED Requirements

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

The MCP server SHALL expose write tools that create, update, and delete canvas elements (shapes, text, connectors). A write SHALL be applied to Iris's scene cache, persisted (durably — a write SHALL NOT be lost if it lands while the panel is closed), and — when the drawing panel is mounted — reflected in the live excalidraw canvas so the user sees the change. Created connectors SHALL be able to reference existing elements so Claude can express relationships between shapes. Each write SHALL return a **per-element result** distinguishing applied elements from those skipped for an unknown id or whose connector binding was dropped, so Claude can detect and correct a bad write. Concurrency between the user's editing and Claude's writes is resolved **last-writer-wins**; concurrent edits to the same element are not merged.

#### Scenario: Claude adds a shape

- **WHEN** Claude calls a write tool to add an element
- **THEN** the element is added to the scene, persisted, and appears on the live canvas if the panel is open

#### Scenario: Write while panel closed still persists

- **WHEN** a write tool is called while the drawing panel is hidden
- **THEN** the change is applied to the cache and persisted durably, and is visible when the panel is next opened

#### Scenario: Update and delete by element identity

- **WHEN** Claude updates or deletes elements by their ids
- **THEN** the referenced elements are modified or removed in the scene

#### Scenario: Invalid write is reported, not silently dropped

- **WHEN** Claude updates/deletes an unknown element id, or adds a connector bound to a nonexistent element
- **THEN** the tool result marks that element as skipped / its binding as dropped, rather than silently losing it

### Requirement: The live canvas reflects external writes without echoing them back

When the drawing panel is mounted, it SHALL apply externally-originated element changes (from the MCP write path) into the live scene, and SHALL export a rendered image of the current scene on request. Applying an external change SHALL NOT be echoed back as a fresh whole-scene write that could revert the just-applied change (the write loop is broken); the user's own edits SHALL continue to propagate normally. An image request SHALL degrade to no image (never an error) when the panel cannot export.

#### Scenario: External write appears live without a revert

- **WHEN** an MCP write is applied while the panel is mounted
- **THEN** the change shows on the live canvas and is not immediately reverted by an echoed whole-scene write

#### Scenario: Image export degrades gracefully

- **WHEN** a rendered image is requested but the panel is unmounted or cannot export in time
- **THEN** the read result omits the image and still returns the scene JSON without error

### Requirement: Both Claude paths are wired Iris-scoped per run

The canvas MCP SHALL be provided to Claude Iris-scoped and per run, without writing to `~/.claude`: the PO Agent SDK session SHALL receive it via the SDK `mcpServers` option (and via `setMcpServers` when it becomes available on an already-live session), and DEV/plain `claude` runs SHALL receive it via `--mcp-config` on spawn. Each SHALL carry the localhost server URL and the session token, and SHALL make the canvas tools available to Claude in its first turn without requiring a tool-search step.

#### Scenario: PO session can use the canvas tools

- **WHEN** a PO turn runs while the canvas MCP is available
- **THEN** the PO session has the canvas read/write tools without any change to `~/.claude`

#### Scenario: DEV/plain run can use the canvas tools

- **WHEN** a DEV or plain Claude run is spawned while the canvas MCP is available
- **THEN** it is launched with `--mcp-config` pointing at the localhost server and token

#### Scenario: Canvas tools visible without a tool-search

- **WHEN** Claude is asked about the diagram on its first turn while the canvas MCP is wired
- **THEN** the canvas read/write tools are already available (loaded eagerly, not deferred behind tool-search)
