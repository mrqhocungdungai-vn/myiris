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

### Requirement: A renderer identifier is named for the feature or for the view, never for the other one

A renderer identifier — a type, a union member, a hook's returned field, a prop, a module — SHALL be named for **what it is**, decided by one test:

> If the view it belongs to were handed a different data source tomorrow, would this name still be true?

Still true ⇒ it is named for the **view** (`galaxy`, `deck`, `orb`). Its meaning depends on notes, a vault, `[[wikilinks]]` or tags ⇒ it is named for the **feature** (`secondBrain`, `drawing`). This applies in both directions: naming a rendering module after the feature it currently serves is the same error as naming a feature after the rendering it currently uses.

**No boundary in the renderer SHALL restate one fact in two vocabularies.** A line whose only work is assigning one name's value to the other name (`secondBrainActive: hud.galaxyActive`) is the observable symptom of this requirement being violated, and its presence is what makes the violation checkable rather than a matter of taste.

The consequence this protects is specific. A resolver that takes feature state in and returns a view name out (`if (secondBrainActive) return "galaxy"`) is correct only while exactly one feature uses that view. The moment a second one does, the resolver must answer the same view name for two features whose bindings differ, and the fix is no longer a rename — it is a change of logic with a live user-facing defect in front of it. Naming per this test keeps that fix a rename indefinitely.

`src/lib/webgl-quality.ts` is the worked example on the view side — its `galaxy` key sits beside `orb` and `deck` as a peer WebGL surface and is about render quality, so `galaxy` is correct there and SHALL NOT be renamed toward the feature.

**This requirement governs code identifiers only.** It does not govern prose — in a spec, a comment, or a user-facing string — and it does not govern capability folder names. The distinction is deliberate rather than an omission: an identifier is a name a compiler and every call site must agree on, so an ambiguous one becomes a defect the moment two things answer to it, whereas prose describing what a user currently sees stays true for as long as that is what they see. A requirement written wide enough to cover prose would be violated by the living spec on the day it landed — `second-brain-gesture-nav` alone contains 36 sentences of the form "the galaxy is active" — and a rule the tree does not satisfy is worse than no rule, because it stops being read.

#### Scenario: The name survives a change of data source

- **WHEN** a renderer identifier belonging to a view is read
- **THEN** its name is still true if that view were given a different data source, or else it names the feature whose data it depends on

#### Scenario: No boundary translates between two names for one thing

- **WHEN** a value crosses between a hook, a router and a component
- **THEN** it keeps one name, and no call site exists whose only work is renaming it

#### Scenario: A context resolver's input and output share one vocabulary

- **WHEN** a resolver derives an interaction context from feature state
- **THEN** the context values it returns are interaction contexts named on the same axis as its inputs, not the name of a rendering technique

#### Scenario: A rendering module keeps its view name

- **WHEN** a module speaks only in nodes, links, camera, geometry or render quality
- **THEN** it keeps its view name and is not renamed after whichever feature currently supplies its data
