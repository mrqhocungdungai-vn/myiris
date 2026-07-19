# Tasks: per-role-model-selection

## 1. Model constants, resolution, and persistence (main.mjs)

- [x] 1.1 Add `MODEL_CHOICES` constant (`{ id, label }` × Fable 5 / Sonnet 5 / Opus 4.8 / Haiku 4.5) and role defaults (PO=`claude-fable-5`, DEV=`claude-sonnet-5`) in `electron/main.mjs`
- [x] 1.2 Add `resolveAgentModel(workstream, role)` implementing workstream `agent_models` → `IRIS_PO_MODEL`/`IRIS_DEV_MODEL` env → hardcoded default
- [x] 1.3 Extend workstream normalization/creation so `agent_models` is an optional object (legacy files without it load unchanged) and persists to `~/.iris/claude-sessions.json`
- [x] 1.4 Add internal `setAgentModel(workstreamId, role, model)`: validate role ∈ {po,dev} and model ∈ `MODEL_CHOICES`, persist, call PO live-session `setModel` when applicable, emit sidecar event for the renderer

## 2. Apply model to runs

- [x] 2.1 DEV path: push `--model <resolved>` into spawn args at run start (beside `--agent`, role runs only — plain Claude gets no flag); no `--fallback-model`
- [x] 2.2 PO path: accept `model` in `getOrCreatePoSession` options and pass SDK `options.model`; expose a `setPoSessionModel` (wraps `query.setModel()`) from `electron/po-session.mjs`
- [x] 2.3 In `startPoRun`, resolve the PO model and idempotently apply it (create-with-model or `setModel` before turn delivery) so queued model changes take effect at run start
- [x] 2.4 Store the resolved model on the run record at spawn/deliver time and include it in task events sent to the renderer

## 3. IPC and voice surface

- [x] 3.1 Add `ipcMain.handle("agents:set-model", ...)` calling the shared `setAgentModel`; expose the resolved model per role via `agentsSnapshot().roster[].model` (renderer keeps its own `MODEL_CHOICES` label constant, same duplication pattern as `AGENT_LABELS`)
- [x] 3.2 Expose `setAgentModel(workstreamId, role, model)` in `electron/preload.cjs` (`window.iris`)
- [x] 3.3 Declare Gemini tool `set_agent_model` (role + model params), dispatch to the shared handler, return confirmation/error; add one system-instruction line describing the capability
- [x] Emit `agent_model_update` sidecar event from `setAgentModel()` so any window (UI- or voice-triggered) refreshes its chip badge

## 4. Renderer UI (App.tsx + deck.css)

- [x] 4.1 Extend `window.iris` types (`src/vite-env.d.ts` or local types) for `setAgentModel` and the enriched agents snapshot (`AgentInfo.model`)
- [x] 4.2 Render model badge on PO/DEV chips (`PO · Fable 5`) with two click zones: label = existing `chooseAgent`, model segment = open popover (no role switch); Iris chip unchanged
- [x] 4.3 Implement the 4-model popover (current model checked, dismissible, calls `setAgentModel`) and refresh badges on the new sidecar event
- [x] 4.4 Style chip segments and popover in `src/deck.css` (visible divider/hover so the two zones don't mis-tap)
- [x] 4.5 Show the run's stored model next to `AgentBadge` on Work Stream task rows (no label for plain Claude runs)

## 5. Docs and verification

- [x] 5.1 Document `IRIS_PO_MODEL` / `IRIS_DEV_MODEL` in `.env.example` and update `CLAUDE.md` notes on per-role models
- [x] 5.2 Run `npm run build` (typecheck + build) and fix any errors
- [x] 5.3a Automated (non-interactive) verification: ran the real `electron/main.mjs` in an isolated harness (electron stubbed out, no window/mic/network) against a **copy** of the user's actual legacy `claude-sessions.json` (6 real workstreams, none with `agent_models`) — confirmed it loads without error, PO/DEV resolve to their hardcoded defaults, `agents:set-model` persists a workstream choice that outranks `IRIS_DEV_MODEL`/`IRIS_PO_MODEL` env overrides, and invalid role/model are rejected. The real `~/.iris/claude-sessions.json` was never touched (md5 unchanged before/after).
- [x] 5.3b Manual verification by the user: launched the app for real and confirmed voice-driven model switching (`set_agent_model` via Gemini) works correctly end-to-end.
