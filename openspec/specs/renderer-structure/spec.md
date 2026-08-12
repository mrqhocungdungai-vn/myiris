## Purpose

Modular renderer source layout for the Orbital Deck app, mirroring the upstream iris repo's `components/`, `hooks/`, `lib/`, `styles/` structure while preserving all Claude-specific behavior and the existing main-process/IPC surface unchanged.

## Requirements

### Requirement: Modular renderer layout mirrors upstream

The renderer source SHALL be organized as `src/components/`, `src/hooks/`, `src/lib/`, `src/styles/`, and `src/types.ts`, matching the upstream iris repo layout, with `src/App.tsx` acting solely as the orchestrator (state, IPC wiring, and composition — no inlined presentational components).

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

### Requirement: Orchestration state is owned by domain hooks

`src/App.tsx` acts as the renderer's composition root. It SHALL compose hooks and components; it SHALL NOT be the owner of the app's orchestration state.

Each cohesive domain of renderer state — its `useState` bindings, the effects that maintain them, and the `window.iris` wiring that feeds them — SHALL live in one hook under `src/hooks/`, named for that domain, and SHALL return a **domain object** rather than loose bindings. `App.tsx` SHALL call those hooks and pass their objects to the components that need them.

`App.tsx` SHALL be a composition root and nothing else. Its size is enforced as a **ratchet** by `scripts/check-file-size.mjs` (code lines; comments and blanks excluded) rather than by a fixed ceiling, and it is a **recorded exception** to the 250–450 convention at 745 code lines.

The exception is recorded with its reason rather than left implicit: 286 of those lines are the JSX composition itself — the orchestrator's actual job — and the remaining 459 are hook composition plus the small effects that belong to no single domain. Reaching 450 would require splitting the render surface, and that was measured and rejected: a `DeckShell` would take 46 props (32 of them still loose bindings), reproducing the 65-prop `HudShell` shape that the renderer research identified as a defect. The ratchet means this number may fall and cannot rise.

The existing requirement that `App.tsx` holds no inlined presentational components is unchanged and still applies. This requirement adds the bound that requirement lacked: "solely the orchestrator" was satisfied at 1391 code lines with 55 state bindings, so it constrained *what kind* of code lives there without constraining *how much*.

**A shared app-state context or store SHALL NOT be used to satisfy this.** Grouping the bindings behind one provider would meet the line count while making every consumer re-render on every change. Each hook owns one domain and is consumed only where that domain is used.

#### Scenario: App.tsx composes rather than owns

- **WHEN** a reader opens `src/App.tsx`
- **THEN** it contains hook calls, derived values, and the composition of components
- **AND** it declares no `useState` binding that belongs to a domain hook

#### Scenario: A domain's state, effects and IPC travel together

- **WHEN** a domain hook under `src/hooks/` is opened
- **THEN** the state for that domain, the effects that maintain it, and the `window.iris` calls that feed it are all present in that one file

#### Scenario: The orchestrator may shrink but never grow

- **WHEN** `src/App.tsx` is measured by `scripts/check-file-size.mjs`
- **THEN** it is at or below the size recorded in `scripts/file-size-baseline.json`
- **AND** a commit that grows it fails the lint gate

#### Scenario: A hook's decisions are testable without a renderer

- **WHEN** a domain hook contains a decision — a precedence rule, a state machine, a threshold
- **THEN** that decision lives in a pure module under `src/lib/` with its own `.test.ts`, and the hook calls it

#### Scenario: Component props are domain objects, not scattered bindings

- **WHEN** a component receives state owned by a domain hook
- **THEN** it receives that domain's object, rather than one prop per binding

### Requirement: Zero behavior change for Claude-specific UI

All Claude-specific renderer features SHALL survive the restructure with identical behavior: pipeline bar with its verb roster; per-verb model popover; question banner with clickable options; Claude session line and ⛓ chain badges; project-folder bar; CLAUDE telemetry row; and handling of the existing `claude_*` (including `claude_question`) and `agent_*` sidecar events.

#### Scenario: Custom features re-hosted as components

- **WHEN** the refactor is complete
- **THEN** the pipeline bar + model popover, the question banner, and the project bar exist as dedicated components under `src/components/` and are composed by `App.tsx`

#### Scenario: Smoke checklist passes

- **WHEN** the manual smoke checklist runs (wake, submit a task, answer a question by click, change a verb's model, switch/create workstream, choose project folder, open reader and history, dwell-open a card, palm-scroll)
- **THEN** every step behaves exactly as it did before the refactor

### Requirement: No main-process or IPC surface changes

The restructure SHALL NOT modify `electron/main.mjs` or `electron/preload.cjs` behavior, add IPC channels, add dependencies, or introduce any Hermes-derived IPC (`hermes:*`), and SHALL keep the sidecar event vocabulary exactly as it exists today.

#### Scenario: Preload surface unchanged

- **WHEN** the change is complete
- **THEN** `window.iris` exposes exactly the same methods and events as before, and no `hermes_*` event branch exists in the renderer
