## Purpose

Modular renderer source layout for the Orbital Deck app, mirroring the upstream iris repo's `components/`, `hooks/`, `lib/`, `styles/` structure while preserving all Claude-specific behavior and the existing main-process/IPC surface unchanged.

## Requirements

### Requirement: Modular renderer layout mirrors upstream

The renderer source SHALL be organized as `src/components/`, `src/hooks/`, `src/lib/`, `src/styles/`, and `src/types.ts`, matching the upstream iris repo layout, with `src/App.tsx` acting solely as the orchestrator (state, IPC wiring, and composition — no inlined presentational components).

#### Scenario: Presentational pieces live in components/

- **WHEN** the refactor is complete
- **THEN** TopBar (status dots), CenterStage/Telemetry, CommsPanel, WorkStream, WorkCard, HistoryDrawer, ReaderOverlay, CameraDock, BootSequence, ReactorCore, and SessionSwitcher each exist as their own file under `src/components/`
- **AND** `App.tsx` contains no locally-defined presentational components (StatusDot, Telemetry, WorkCard, HistoryDrawer, ExpandedReader are gone from it)

#### Scenario: Hooks and lib extracted

- **WHEN** the refactor is complete
- **THEN** `useHandControl`, `useAudioPipeline`, and `useHoldToScroll` live under `src/hooks/`, shared task helpers (`taskKeyFor`, `shortRunId`, `normalizeMarkdown`, terminal-state sets) live under `src/lib/`, and shared types (TaskCard et al.) live in `src/types.ts`

#### Scenario: Build stays green

- **WHEN** `npm run build` runs after the refactor
- **THEN** tsc + vite complete with no errors

### Requirement: Zero behavior change for Claude-specific UI

All Claude-specific renderer features SHALL survive the restructure with identical behavior: pipeline bar with PO/DEV agent chips, gate ✓ marks and the DEV soft-gate confirm; per-role model popover; PO question banner with clickable options; Claude session line and ⛓ chain badges; project-folder bar; agent install button; CLAUDE telemetry row; and handling of the existing `claude_*`, `agent_*`, and `po_question` sidecar events.

#### Scenario: Custom features re-hosted as components

- **WHEN** the refactor is complete
- **THEN** the pipeline bar + model popover, the PO question banner, and the project bar exist as dedicated components under `src/components/` and are composed by `App.tsx`

#### Scenario: Smoke checklist passes

- **WHEN** the manual smoke checklist runs (wake, submit PO task, answer a PO question by click, switch role through the gate, change a role's model, switch/create workstream, choose project folder, open reader and history, dwell-open a card, palm-scroll)
- **THEN** every step behaves exactly as it did before the refactor

### Requirement: No main-process or IPC surface changes

The restructure SHALL NOT modify `electron/main.mjs` or `electron/preload.cjs` behavior, add IPC channels, add dependencies, or introduce any Hermes-derived IPC (`hermes:*`), and SHALL keep the sidecar event vocabulary exactly as it exists today.

#### Scenario: Preload surface unchanged

- **WHEN** the change is complete
- **THEN** `window.iris` exposes exactly the same methods and events as before, and no `hermes_*` event branch exists in the renderer
