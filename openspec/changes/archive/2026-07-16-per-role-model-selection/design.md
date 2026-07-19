# Design: per-role-model-selection

## Context

PO and DEV personas both declare `model: inherit`, so the model is decided entirely by the invocation. Today neither path passes a model: DEV's spawn args in `electron/main.mjs` (built around the `--agent` push, ~line 920) carry no `--model`, and the PO SDK options object in `electron/po-session.mjs` (~line 178) has no `model` key. Verified against the installed `@anthropic-ai/claude-agent-sdk`: `options.model` is forwarded to the CLI as `--model`, and the `Query` object exposes `setModel(model?: string)` for live sessions.

All per-workstream state already lives in `~/.iris/claude-sessions.json` (`agent_sessions` per role), the UI already has role chips with `agents:list`/`agents:select` IPC, and Gemini already has a tool suite that mutates workstream state (`start_new_claude_session`, etc.). This change extends each of those existing seams rather than adding a new subsystem.

Design was settled with the user in a grilling interview; every decision below records the chosen answer.

## Goals / Non-Goals

**Goals:**
- Per-workstream, per-role model choice for PO and DEV, persisted and restored.
- PO defaults to Fable 5, DEV to Sonnet 5; DEV can be raised to Fable 5 for debugging without losing any session context.
- Both UI (chip badge + popover) and voice (`set_agent_model` tool) can change it; both funnel through one handler.
- Per-run traceability of the model actually used.

**Non-Goals:**
- Model choice for plain (role-less) Claude — keeps CLI default.
- Global or two-tier (global + override) settings — per-workstream only.
- Automatic fallback on model failure — fail loudly instead.
- Free-form model entry — a curated 4-model constant only.

## Decisions

1. **Per-workstream storage, not global.** `agent_models: { po?, dev? }` beside `agent_sessions` in the persisted workstream. Matches the existing philosophy that all state (sessions, active role) belongs to the workstream; debugging project A on Fable must not affect project B. Alternatives rejected: global setting (leaks across projects), global-default-plus-override (two config layers for two roles × four models is over-engineering).

2. **Resolution order: workstream → env → hardcode.** `resolveAgentModel(workstream, role)` in `main.mjs` returns `agent_models[role] ?? process.env.IRIS_<ROLE>_MODEL ?? DEFAULT`. Env vars follow the repo's `IRIS_*` convention and are documented in `.env.example`. Defaults: PO `claude-fable-5`, DEV `claude-sonnet-5`.

3. **Curated `MODEL_CHOICES` constant of four** (Fable 5, Sonnet 5, Opus 4.8, Haiku 4.5) with `{ id, label }`. Shared source of truth for popover contents, tool-arg validation, and badge labels. Renderer gets it via `agentsSnapshot` rather than duplicating the list. Alternative rejected: env-configurable list (users must know exact IDs, no friendly labels).

4. **DEV: resolve at run start, apply via `--model`.** The arg is added where `--agent` is pushed, only when `run.agent` is a role. Resolving at spawn time (not submit time) means the latest setting always wins, including for queued tasks — the point of "switch to Fable to debug" — and run records don't need a model at enqueue time. Alternative rejected: snapshot at submit (predictable but defeats the debugging use case).

5. **PO: `options.model` at create + `setModel()` on live sessions.** `getOrCreatePoSession` accepts a `model` option; the set-model handler additionally calls `setModel()` on an existing live session so the next turn switches models with zero context loss. Alternatives rejected: close-and-resume with a new model (needless respawn; resume preserves context but costs a subprocess cycle), apply-only-on-new-session (forces context loss, contradicts the use case). Note `startPoRun` should still pass the resolved model each turn-delivery so a session created before a queued model change is consistent — cheap to call `setModel` idempotently before delivering a turn.

6. **No automatic fallback.** Neither `--fallback-model` (DEV) nor `fallbackModel` (PO) is set. A deliberately chosen debug model that silently downgrades to Sonnet would make the user believe they are debugging on Fable when they are not; a loud failure through the existing error path (Work Stream + voice announcement) is strictly safer. The user then switches models from the chip.

7. **UI: badge on each chip, two click zones.** Chip renders `PO · Fable 5`; the label zone keeps the exact existing `chooseAgent` behavior, the model zone opens a popover of `MODEL_CHOICES` and calls the new IPC without touching the active role (role switching has side effects — gate announcements, PO conversation opening — that a model change must not trigger). Plain-Claude chip unchanged. Alternatives rejected: dropdown only for the active role (can't change the other role's model without switching), settings panel (extra UI layer for two settings).

8. **One handler for UI and voice.** `ipcMain.handle("agents:set-model")` and the Gemini tool `set_agent_model` both call the same internal `setAgentModel(workstreamId, role, model)` which validates against `MODEL_CHOICES` + role ∈ {po, dev}, persists, calls PO `setModel` if applicable, and emits a sidecar event (renderer refresh) — so UI and voice can never diverge. The Gemini system instruction gains one line describing the capability.

9. **Traceability.** The run record gains a `model` field filled at spawn/deliver time; task events carry it to the renderer and the Work Stream row renders a small label next to `AgentBadge`. Cost is near zero since the task event pipeline already carries `agent`.

## Risks / Trade-offs

- [Subscription may not include Fable 5 (PO bills via `CLAUDE_CODE_OAUTH_TOKEN`)] → By design this fails loudly on the first turn; the user switches the model from the chip. No code mitigation needed beyond the existing error surface.
- [Pinned model IDs go stale as Anthropic ships new models] → IDs live in one constant; env vars (`IRIS_PO_MODEL`/`IRIS_DEV_MODEL`) provide an escape hatch without a code change (workstream choices still outrank env, but a fresh workstream follows env).
- [`setModel()` semantics mid-turn] → Applied between turns in practice (set-model handler + idempotent re-apply before turn delivery); a turn already in flight finishes on its old model, which is acceptable and matches the "resolve at run start" rule.
- [Two click zones on a small chip risk mis-taps] → Visually separate the model segment (divider + hover state) in `deck.css`; the popover is dismissible with no state change.
- [Queued-task model resolution surprises a user who expected the submit-time model] → Mitigated by traceability: the Work Stream row shows the model each run actually used.

## Migration Plan

- Backward compatible: `agent_models` is optional; existing `claude-sessions.json` files load unchanged and resolve through env/defaults. No data migration, no rollback switch needed — reverting the code restores prior behavior (no `--model` passed).

## Open Questions

- None — all decisions were settled in the grilling interview.
