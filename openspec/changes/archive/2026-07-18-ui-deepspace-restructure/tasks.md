# Tasks — ui-deepspace-restructure

## 1. Baseline & scaffold

- [x] 1.1 Capture "before" reference: run the app, walk the smoke checklist (design D6) once, screenshot the deck for visual comparison — done by user, confirmed OK
- [x] 1.2 Create `src/components/`, `src/hooks/`, `src/lib/`, `src/styles/`; add `src/types.ts` with TaskCard (incl. our `agent`/`model`/`claudeSessionId` fields) and shared types
- [x] 1.3 Copy upstream stylesheets verbatim into `src/styles/`: `tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, `index.css` (skip `hud.css`); point the Vite entry at `styles/index.css`

## 2. Mechanical moves (checkpoint: build green, behavior unchanged)

- [x] 2.1 Move `useHandControl.ts`, `useAudioPipeline.ts`, `useHoldToScroll.ts` into `src/hooks/` unmodified; fix imports
- [x] 2.2 Extract task helpers (`taskKeyFor`, `shortRunId`, `normalizeMarkdown`, `eventTime`, `readString`, `readStatusObject`, terminal sets) from App.tsx into `src/lib/tasks.ts`
- [x] 2.3 Move `ReactorCore.tsx` and `BootSequence.tsx` into `src/components/` (per design D1 exception: keep our current ReactorCore prop surface `state`/`levelRef`)
- [x] 2.4 `npm run build` — green checkpoint before any component adoption

## 3. Adopt upstream components (Hermes → Claude adaptation)

- [x] 3.1 Port `TopBar.tsx` (status dots) and `CommsPanel.tsx`; rename any HERMES label/status prop to CLAUDE, wire to `claudeStatus`
- [x] 3.2 Port `CenterStage.tsx` with Telemetry showing the CLAUDE row (drop `hermes_status` plumbing)
- [x] 3.3 Port `WorkStream.tsx` + `WorkCard.tsx` **without** the step-timeline/`TaskStep` parts (change 2 owns those); keep our card fields: agent badge, model, ⛓ chain badge, `claudeSessionId`
- [x] 3.4 Port `HistoryDrawer.tsx` and `ReaderOverlay.tsx` (label "Claude", no Hermes step labels; keep current reader behavior — two-palm resize arrives in change 2)
- [x] 3.5 Port `CameraDock.tsx` (current single-hand rendering is fine; skeleton/multi-hand arrives in change 2)

## 4. Re-graft Claude-custom UI as components

- [x] 4.1 Create `PipelineBar.tsx`: PO/DEV agent chips, gate ✓ marks, DEV soft-gate confirm, model segment + `ModelPopover` (MODEL_CHOICES, `setRoleModel`, `agent_model_update` handling)
- [x] 4.2 Create `PoQuestionBanner.tsx`: `pendingPoQuestion` render, per-question option buttons, batched submit via `pickPoAnswer` → `window.iris.answerPoQuestion`
- [x] 4.3 Create `ProjectBar.tsx`: project-folder display + `chooseProjectFolder`, agent install button (`installAgents`)
- [x] 4.4 Create `src/styles/claude.css` restating all custom classes on `tokens.css` variables (`.pipeline-bar`, `.agent-chip*`, `.model-popover`, `.po-question*`, `.claude-session-line`, chain badges, `.project-bar`, `.agent-install`); import from `styles/index.css`

## 5. SessionSwitcher

- [x] 5.1 Port `SessionSwitcher.tsx`; delete Hermes data layer, rebind to `getSessions`/`selectSession`/`newSession` (design D3); rows show workstream name + cwd basename
- [x] 5.2 Surface per-role Claude session identity (`agent_sessions`, `who ▸ id`) on the active row; keep `sessions:choose-cwd` reachable from the new UI
- [x] 5.3 Remove the old `<select class="session-select">` markup and its CSS

## 6. App.tsx orchestrator + cleanup

- [x] 6.1 Rewrite `App.tsx` as orchestrator: state, `handleSidecarEvent` (event vocabulary frozen per design D5 — no `hermes_*` branches), composition of all components; delete all inlined presentational components
- [x] 6.2 Update `useHoldToScroll` scroll-target selectors to the adopted class names (`.comms-scroll`, `.work-scroll`, `.history-grid`); keep dwell-open on `[data-task-id]` working — selectors already matched the adopted names, no change needed
- [x] 6.3 Delete `src/App.css` and old flat `src/deck.css`; verify no orphaned imports or dead files remain in `src/` root
- [x] 6.4 `npm run build` green

## 7. Verification (spec scenarios)

- [x] 7.1 Grep gates: no `hermes` reference in `src/`; `window.iris` preload surface unchanged; no diff in `electron/`
- [x] 7.2 Confirm adopted upstream stylesheets are byte-identical to upstream (deepspace-skin "stays diffable" scenario) — all except `index.css`, which necessarily differs (see Deviations note below)
- [x] 7.3 Run full smoke checklist: wake → speak → submit PO task → answer PO question by click → role switch through gate (incl. soft-gate confirm) → change role model → switch workstream → new workstream → choose project folder → open reader + history → dwell-open card → palm-scroll both panels — done by user, confirmed OK
- [x] 7.4 Visual pass against 1.1 baseline: Deep Space layers render (nebula/glow/vignette), all Claude-custom elements legible and positioned correctly — done by user, confirmed OK

## Deviations from plan (flagged, not silently absorbed)

- `index.css`: upstream's copy `@import`s `@fontsource-variable/inter`, `@fontsource-variable/space-grotesk`, and `@fontsource/jetbrains-mono/*` — none of which are project dependencies. Adding them would violate the design's explicit "no new dependencies" non-goal. Our `index.css` drops those font imports (falls back to `tokens.css`'s `system-ui`/monospace stack) and swaps `hud.css` for `claude.css`. Every other adopted stylesheet is byte-identical to upstream.
- Shared agent-role constants/helpers (`PIPELINE`, `AGENT_LABELS`, `AGENT_COLORS`, `MODEL_CHOICES`, `modelLabel`, `isAgentRole`) were factored into a new `src/lib/agents.ts`, not called out explicitly in tasks.md but needed by both `WorkCard`/`ReaderOverlay` (agent badge) and `PipelineBar` (chips + model popover).
