# Proposal: per-role-model-selection

## Why

The PO and DEV pipeline roles currently run on whatever model the Claude CLI/SDK defaults to — there is no way to pick a model per role. The user wants the PO (product thinking, high-stakes decisions) on Fable 5 and DEV on the cheaper/faster Sonnet 5 for routine implementation, with the ability to switch DEV up to Fable 5 when debugging hard problems — without losing session context and without touching config files.

## What Changes

- Each workstream stores a chosen model per pipeline role (`agent_models: { po, dev }` beside the existing `agent_sessions` in `~/.iris/claude-sessions.json`). Plain Claude (no role) keeps the CLI default and gets no model choice.
- Model resolution order per role: workstream `agent_models` → env `IRIS_PO_MODEL` / `IRIS_DEV_MODEL` → hardcoded defaults (PO = `claude-fable-5`, DEV = `claude-sonnet-5`).
- Four selectable models (curated constant): Fable 5, Sonnet 5, Opus 4.8, Haiku 4.5.
- DEV runs pass `--model <id>` on the spawned `claude -p` command, resolved when the run **starts** (not when submitted) — changing the model while a task is queued affects that task.
- PO applies the model via SDK `options.model` at session creation and `query.setModel()` on an already-live session — the resident session and its context are preserved across a model switch.
- No automatic fallback: an unavailable model fails the run loudly through the existing error path (Work Stream + voice announcement); never a silent downgrade.
- UI: PO/DEV chips in the session bar gain a model badge with two click zones — the label selects the role (unchanged behavior), the model segment opens a 4-model popover without switching roles.
- Run records store the resolved model; Work Stream task rows show it next to the agent badge for traceability.
- New IPC surface in `preload.cjs`: `setAgentModel(workstreamId, role, model)`; `agentsSnapshot` includes `agent_models`.
- New Gemini tool `set_agent_model` (voice path) sharing the same handler as the UI, plus a system-instruction line and a sidecar event so the badge updates live.
- `.env.example` documents `IRIS_PO_MODEL` / `IRIS_DEV_MODEL`.

## Capabilities

### New Capabilities

- `per-role-model-selection`: choosing, persisting, resolving, and applying a Claude model per pipeline role (PO/DEV) per workstream — via UI and voice — including run-time application to both the stateless DEV subprocess and the stateful PO live session, failure behavior, and per-run model traceability.

### Modified Capabilities

<!-- none — existing specs (po-live-session, voice-decision-relay, agent-subscription-auth) keep their requirements unchanged; the PO live session gains a model parameter but its lifecycle/relay/auth requirements are untouched -->

## Impact

- `electron/main.mjs`: model resolution helper + `MODEL_CHOICES` constant, `--model` in DEV spawn args, run-record model field, `agents:set-model` IPC handler, `set_agent_model` Gemini tool declaration/dispatch, system-instruction line, sidecar event.
- `electron/po-session.mjs`: accept `model` in session options; expose a `setModel` path for a live session.
- `electron/preload.cjs`: expose `setAgentModel`.
- `src/App.tsx` (+ `src/deck.css`): chip model badge, two click zones, model popover, model label on task rows, handling of the new sidecar event.
- `.env.example`, `README.md`/`CLAUDE.md` docs.
- Persistence file `~/.iris/claude-sessions.json` gains an optional `agent_models` field (backward compatible — absent field falls through to env/defaults).
