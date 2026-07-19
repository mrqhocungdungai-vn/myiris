# Design — ui-deepspace-restructure

## Context

Our renderer is a flat `src/` forked from an early version of the upstream repo (`/Users/mrq-learn-ai/work_space/claude_cli/temp2/iris`). Upstream has since modularized (`components/hooks/lib/styles`, App.tsx as a 1068-line orchestrator) and reskinned to "Deep Space" (`tokens/base/deck/fx/overlays.css`). Ours diverged the other way: we replaced Hermes with the Claude PO→DEV pipeline and grew substantial custom renderer UI (pipeline bar, model popover, PO question banner, session/project bars) inlined into `App.tsx` (1293 lines), `deck.css`, `App.css`.

Verified drift facts (from repo comparison):
- Our `App.tsx`, `ReactorCore.tsx`, `useHandControl.ts`, `deck.css` share recognizable ancestry with upstream (identical helpers `eventTime`/`taskKeyFor`/`shortRunId`/`normalizeMarkdown`, identical `PALETTES`/`drawArc` top half of ReactorCore).
- Our custom UI with **no upstream counterpart**: `PIPELINE`/`AgentBadge`/`.pipeline-bar` + gate ✓ + DEV soft gate confirm; `MODEL_CHOICES`/`.agent-chip-model`/`.model-popover`/`setRoleModel`; `pendingPoQuestion`/`.po-question-banner`/`pickPoAnswer`; `.session-select` + `.claude-session-line` + ⛓ badges; `.project-bar`/`chooseProjectFolder`; `installAgents` button; `claudeStatus` telemetry row; `claude_*` sidecar events; `TaskCard.agent/model/claudeSessionId` fields.
- Upstream components that are Hermes-coupled and must be adapted or excluded: `SessionSwitcher` (Hermes threads IPC), `CenterStage` Telemetry (HERMES row), `WorkCard` (step timeline — deferred to change 2), `SetupPanel`/HUD/wake word (deferred to change 3 / later).

Two follow-up changes (`two-hand-gestures-and-orb`, `voice-ui-and-setup`) are planned as near file-for-file ports of upstream components; they depend on this layout existing.

## Goals / Non-Goals

**Goals:**
- `src/` mirrors upstream's layout so future ports are file drops, not hand-merges.
- Visual system = upstream Deep Space (tokens, layered nebula/glow/vignette background, split stylesheets).
- Zero behavior change: every existing feature (Claude-custom included) works identically after the refactor; `npm run build` clean.
- SessionSwitcher UI adopted but bound to our `sessions:*` IPC; zero Hermes IPC introduced.

**Non-Goals:**
- No gesture upgrades (two-hand, reticles) — change 2 (`useHandControl.ts` moves to `hooks/` unmodified).
- No orb micro-expressions, sounds, handoff FX, step timeline — change 2.
- No voice UI context/actions, TaskChooser, SetupPanel, wake word, sleep — change 3.
- No Glass HUD (`HudShell`, `hud.css`, tray, click-through IPC) — separate future change.
- No `electron/main.mjs` / `preload.cjs` functional changes; no new IPC channels; no new dependencies.
- Not porting: `hermesGate.mjs`, Hermes session/history IPC, `IRIS_HERMES_*` config, HERMES telemetry naming.

## Decisions

### D1 — Copy upstream files as the base, graft ours in (not the reverse)
For each component that exists upstream (`TopBar`, `CenterStage`, `CommsPanel`, `WorkStream`, `WorkCard`, `HistoryDrawer`, `ReaderOverlay`, `CameraDock`, `BootSequence`, `ReactorCore`, `SessionSwitcher`) start from the upstream file, strip/adapt Hermes references (`hermes_*` → `claude_*` semantics, HERMES → CLAUDE labels), then graft our Claude-custom props/markup. Rationale: upstream files already match the Deep Space CSS class names; grafting small, well-identified custom blocks (listed in Context) is cheaper and less error-prone than restyling our inlined versions to a foreign stylesheet. Alternative (extract our inline components, then reskin) rejected: it reproduces upstream by hand and guarantees CSS drift.

**Exceptions**: `ReactorCore.tsx` and features arriving in change 2 — take upstream's file but **keep our current prop surface** (`state`, `levelRef`) by pinning the pre-micro-expression behavior; do not add `thinking`/`wakeKey`/`rippleKey` props yet (change 2 owns those). If upstream's current file can't cleanly regress, keep our ReactorCore.tsx moved as-is; it's visually compatible.

### D2 — Claude-custom UI lands in dedicated components, not back into App.tsx
Custom features become components in `src/components/`: `PipelineBar.tsx` (agent chips + model popover + gate logic), `PoQuestionBanner.tsx`, `ProjectBar.tsx` (project folder + install agents). `SessionSwitcher.tsx` absorbs the session dropdown's job. App.tsx keeps only state and handlers. Rationale: preserves the "App.tsx = orchestrator" invariant that makes future upstream merges tractable.

### D3 — SessionSwitcher rebinding contract
Upstream `SessionSwitcher` calls `window.iris.listHermesSessions`/`createHermesSession` with `HermesSessionInfo`. We keep the component's markup/CSS and swap its data layer to our existing preload surface: `getSessions()`, `selectSession(id)`, `newSession()`, `chooseProjectFolder()` (i.e. `sessions:get/select/new/choose-cwd`). Row model: workstream name, cwd basename, active role badge, per-role session ids (`agent_sessions`). No preload changes required — the surface already exists.

### D4 — Stylesheet strategy: adopt upstream files verbatim + one ours-only sheet
Copy `tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, `index.css` from upstream verbatim (drop `hud.css` — HUD out of scope). Port our custom classes (`.pipeline-bar`, `.agent-chip*`, `.model-popover`, `.po-question*`, `.claude-session-line`, `.project-bar`, `.agent-install`, chain badges) into a new `src/styles/claude.css`, restated on Deep Space tokens (colors/spacing via `var(--…)` from `tokens.css`). Rationale: keeping upstream sheets byte-identical makes future diffs against upstream trivial; one clearly-owned file holds everything that is ours. `App.css` and old `deck.css` are deleted.

### D5 — Sidecar event vocabulary is frozen
The `handleSidecarEvent` skeleton moves into App.tsx's new shape but the event set stays exactly ours: `claude_status`, `claude_task_update`, `claude_completion`, `claude_session`, `agent_model_update`, `po_question`, etc. Upstream-only branches (`hermes_task_event` step ingestion) are **not** ported (change 2 re-plumbs the timeline onto our events).

### D6 — Big-bang refactor in one change, verified by build + manual smoke
No incremental dual-layout period. `npm run build` (tsc) is the only automated gate; a manual smoke checklist (wake, speak, submit PO task, answer PO question by click, switch role with gate, change model, switch/new workstream, choose folder, open reader/history, gesture dwell-open and palm-scroll) is codified in tasks.md. Rationale: the repo has no test runner; a checklist beats pretending otherwise.

## Risks / Trade-offs

- [Custom feature silently lost in the re-graft] → Context section carries the exhaustive inventory (7 feature groups + TaskCard fields); tasks.md turns it into a per-feature checklist; the smoke test exercises each.
- [Upstream deck.css assumes markup we changed for Claude chips] → ours-only `claude.css` owns those elements entirely; upstream sheets stay untouched so conflicts surface as visual issues in smoke, not silent overrides.
- [ReactorCore upstream file already depends on change-2 props] → D1 exception: regress props or keep our file; decide at implementation, both acceptable for this change.
- [Renderer/typecheck breakage from mass import moves] → do the mechanical moves first, build, then graft; two clean checkpoints.
- [Gesture hooks (`useHoldToScroll` scroll-target class names) break under new class names] → upstream classes (`.comms-scroll`, `.work-scroll`, `.history-grid`) are adopted with the components; update the hook's selector list as part of the move and verify palm-scroll in smoke.

## Migration Plan

1. Land as one commit series on a branch; `npm run build` green at the mechanical-move checkpoint and at the end.
2. Rollback = revert the series; no data, config, or IPC migration involved.

## Open Questions

- None blocking. (ReactorCore prop-regression detail resolved at implementation per D1.)
