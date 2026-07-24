## Why

The `hud-drawing-canvas` change gave Iris a whiteboard and a main-cached scene seam (`canvas:get-scene`, canonical excalidraw JSON, updated eagerly). This change connects Claude to it: so when the user asks "what should I add to this diagram?" Claude reads the current canvas, and can draw on it — the brainstorming-with-AI-over-a-diagram goal. Reading/understanding is Claude's job (not Gemini); the drawing surface stays in the app.

## What Changes

- **Iris main hosts one local MCP server over Streamable HTTP**, bound to `127.0.0.1` on an ephemeral port, guarded by a single per-session bearer token. Security is right-sized for a server that only ever talks to local Claude — the token is the one guard (it blocks the sole realistic local vector, a browser page fetching localhost); no internet-grade DNS-rebinding/Origin hardening. It is wired only when the pipeline is available (Claude present) **and the canvas has been engaged this session** (panel opened ≥1 time, sticky), so a pure-voice session pays no token cost; stopped on quit. (Direct exact-pinned dependency: `@modelcontextprotocol/sdk`, already present transitively.)
- **Read tool** — Claude fetches the **current** canvas from main's in-RAM cache (fresh-on-tool-call, works while the panel is unmounted): the canonical excalidraw JSON (`elements` incl. arrow `startBinding`/`endBinding` connectivity, `files`), with an **optional rendered image** (PNG/SVG). Because excalidraw can't be imported in main, the image is exported by the renderer over a request/response IPC (with a timeout); JSON-only when the panel is unmounted.
- **Write tools** — Claude creates / updates / deletes canvas elements. Main expands Claude's skeleton into full excalidraw elements with a **pure main-side builder** (not `convertToExcalidrawElements`, which can't run in main), applies them to its authoritative cache by id, persists, and broadcasts `canvas:apply` so the live panel updates when open — with the `canvas:scene` echo **suppressed** for Claude-originated applies so the write loop can't clobber the cache.
- **Iris-scoped per-run wiring (no `~/.claude` mutation):** the PO Agent SDK session gets the server via `options.mcpServers` (and `query.setMcpServers()` on an already-live session); DEV/plain `claude` runs get it via `--mcp-config` (a `0600` temp file, not inline argv). Both carry the localhost URL + token and set **`alwaysLoad: true`** so the canvas tools are visible turn-1 without a tool-search. Wiring awaits a **server-ready** signal so the ephemeral URL is never `undefined`.
- **Gated on `pipelineAvailable` AND canvas-engaged** (Claude required + panel opened ≥1 time this session, sticky). The whiteboard from `hud-drawing-canvas` keeps working without Claude — only the MCP/AI read+draw is gated. A session that never opens the canvas never loads the tools (no token cost); "opened then closed" stays wired so read/write-while-closed still works. Canvas Q&A routes to **PO/plain** (DEV is gated on an open change, so it isn't the canvas consumer). Token efficiency is achieved by this **hard gating**, not a skill — "how to use" is a light persona line + tool descriptions (D7).

## Capabilities

### New Capabilities
- `canvas-claude-mcp`: An Iris-hosted local MCP server exposing read + write tools over the drawing canvas to Claude (PO SDK and DEV/plain CLI), Iris-scoped per run, gated on Claude availability.

### Modified Capabilities
<!-- None. Builds on hud-drawing-canvas's existing seam (canvas:get-scene / canvas:scene) and references pipeline-availability's gating flag and po-live-session's session options without changing their requirements. The new inbound renderer channels (canvas:apply, canvas:request-image/canvas:image-result) and the echo-suppression behavior are NOT changes to hud-drawing-canvas — they are captured as a first-class requirement of THIS capability ("The live canvas reflects external writes without echoing them back"), so the archived spec stays self-true and nothing lives silently in design. -->

## Impact

- **`package.json`** — add `@modelcontextprotocol/sdk` (exact-pinned); document in README's exact-identifier table.
- **`electron/main.mjs`** — host the Streamable HTTP MCP server (127.0.0.1 + ephemeral port + token + Origin/Host check before `handleRequest`); implement read/write tool handlers over the existing canvas cache, incl. a **pure main-side element builder** (no excalidraw import); broadcast writes via `canvas:apply`; request renderer image export via `canvas:request-image`/`canvas:image-result`; start on `pipelineAvailable`, stop on quit; expose a server-ready `{url,token}` to the run paths.
- **`electron/po-session.mjs`** — after server-ready, add the canvas MCP to `options.mcpServers` (`alwaysLoad: true`) at session create, and `query.setMcpServers()` when it becomes available on a live session.
- **DEV/plain spawn (`main.mjs`)** — pass `--mcp-config` (URL + token + `alwaysLoad`) on the `claude` spawn.
- **`electron/preload.cjs`** — expose `canvas:apply` (main→renderer) and the `canvas:request-image`/`canvas:image-result` request/response pair.
- **`src/App.tsx` / `src/components/DrawingCanvas.tsx`** — handle `canvas:apply` via excalidraw `updateScene` (renderer-side `convertToExcalidrawElements` ok), **suppressing the `canvas:scene` echo** for Claude-originated applies; handle `canvas:request-image` by exporting and replying. Auto-persist via the change-1 flow.
- References `hud-drawing-canvas` (seam), `pipeline-availability` (gating), `po-live-session`/`global-agent-runtime` (wiring) — none modified.
