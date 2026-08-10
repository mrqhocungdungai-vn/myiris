## MODIFIED Requirements

### Requirement: Modular renderer layout mirrors upstream

The renderer source SHALL be organized as `src/components/`, `src/hooks/`,
`src/lib/`, `src/styles/`, and `src/types.ts`, matching the upstream iris repo
layout, with `src/App.tsx` acting solely as the orchestrator (state, IPC wiring,
and composition — no inlined presentational components).

This requirement governs **where shared renderer modules live**, not that every
interaction must be one. A binding that acts directly on the DOM node under the
hand — hold-to-scroll is the case that matters — is specified by the capability
that owns the gesture (`two-hand-gestures`), and naming a hook for it here only
asserted a module that does not exist.

#### Scenario: Presentational pieces live in components/

- **WHEN** the refactor is complete
- **THEN** TopBar (status dots), CenterStage/Telemetry, CommsPanel, WorkStream, WorkCard, HistoryDrawer, ReaderOverlay, CameraDock, BootSequence, ReactorCore, and SessionSwitcher each exist as their own file under `src/components/`
- **AND** `App.tsx` contains no locally-defined presentational components (StatusDot, Telemetry, WorkCard, HistoryDrawer, ExpandedReader are gone from it)

#### Scenario: Hooks and lib extracted

- **WHEN** the refactor is complete
- **THEN** `useHandControl` and `useAudioPipeline` live under `src/hooks/`, shared task helpers (`taskKeyFor`, `shortRunId`, `normalizeMarkdown`, terminal-state sets) live under `src/lib/`, and shared types (TaskCard et al.) live in `src/types.ts`

#### Scenario: Build stays green

- **WHEN** `npm run build` runs after the refactor
- **THEN** tsc + vite complete with no errors
