## Why

`src/App.tsx` is 1391 code lines against the repo's 250–450 convention. It is now the **only** file in the repo more than 1.3× over that bound — the other four over it are 462–585, and one of those (`canvas-mcp.mjs`) is a recorded pre-existing exception.

It did not get there through bad code, and it is not a presentational problem. The archived `2026-07-18-ui-deepspace-restructure` change already moved every presentational piece out, and `renderer-structure`'s spec text records the result: `App.tsx` acts "solely as the orchestrator (state, IPC wiring, and composition — no inlined presentational components)". That is still true. **The orchestrator itself is what grew.**

What it holds today:

- **55 state bindings** (48 `useState`, 7 persisted-preference hooks)
- **30 `useEffect`s**, 15 `useRef`s, 11 `useMemo`s, and **zero** `useCallback`
- **45 `window.iris.*` call sites** inlined at the point of use

The consequence is not aesthetic. A component this shape has two measurable properties:

1. **Nothing can be extracted from its render surface.** The deck branch of the return statement is ~140 lines of JSX; extracting it as a `DeckShell` component — the obvious mirror of the existing `HudShell` — would require **67 props**. That is not a hypothetical: `HudShell` already takes 65 props and forwards 23 of them verbatim to `CenterStage`, and the renderer research recorded that as a defect. Extracting `DeckShell` would duplicate it, shedding lines from `App.tsx` while making the codebase worse.

2. **Every state change re-renders the whole tree.** There are **8** `React.memo`/`useCallback` occurrences in all of `src/`, and `App.tsx` contributes none of them, while `dwellActive` is written from a `requestAnimationFrame` loop. Handlers are reallocated on every render and passed down through those 65-prop boundaries.

The favorable finding, and the reason this is worth proposing now: **the state is not tangled.** All 55 bindings partition into 11 disjoint domains with no binding belonging to two:

| Domain | Bindings |
|---|---|
| tasks & review | 10 |
| preferences | 8 |
| session & status | 7 |
| sessions, verbs & config | 6 |
| listen-only mode | 5 |
| UI mode & HUD | 5 |
| orb & effects | 5 |
| second brain | 3 |
| claude question | 2 |
| transcript & log | 2 |
| wake | 2 |

These are 11 hooks that were never given filenames. Three already exist in embryo — `usePersistedPreference` covers the preferences domain, and `useAudioPipeline`/`useWakeWord`/`useHandControl` show the shape.

## What Changes

- Extract the state, effects and IPC wiring of each domain above into a **hook under `src/hooks/`** returning a **domain object**, not a loose tuple: `useTaskStream()`, `useListenOnlyMode()`, `useClaudeQuestion()`, `useVoiceSession()`, and so on. `App.tsx` becomes composition — it calls the hooks and passes their objects down.
- **Prop counts fall out of this, and that is the point.** A component takes `tasks={taskStream}` rather than ten separate bindings, so `HudShell`'s 65 props and the `DeckShell` that cannot currently exist both become tractable. This change does **not** itself split `HudShell` or create `DeckShell`; it removes the reason they are impossible.
- **Explicitly not a shared app-state context or a store.** Grouping 55 bindings behind one provider would satisfy the line count while making every consumer re-render on every change — the same trap `split-main-process-modules` called out when it refused a shared mutable app-state module. Each hook owns its own domain and is consumed only where that domain is used.
- Each extracted hook lands with **its own pure helpers in `src/lib/` and a `.test.ts` over them**, following the pattern this repo already proves: `galaxy-nav`, `eye-hud`, `webgl-quality`, `wake-gate`, and the modules added alongside this proposal (`caption`, `claude-answers`, `listen-only-notice`, `orb-thinking`, `pointer-dwell`, `preferences`, `tasks`). Hooks themselves remain untested — there is no `renderHook`, and adding one is out of scope here (see Open Question).
- Work is ordered by **coupling, lowest first**: the domains with no cross-domain reads (wake, transcript/log, claude question, listen-only) before the ones that feed the render surface most widely (tasks & review, session & status).
- The `renderer-structure` capability gains a bound on what "orchestrator" means, so the condition that produced this is detectable next time rather than only visible at 1391 lines.

**Zero behavior change.** No IPC channel is added, removed or renamed; `window.iris` is untouched; no dependency is added. Every existing capability spec must still be true afterwards, unmodified. If a spec needs rewording to stay true, that is a signal the extraction altered behavior and must be corrected, not documented.

## Capabilities

### Modified Capabilities

- `renderer-structure`: the existing requirement says `App.tsx` acts "solely as the orchestrator". That is satisfied today at 1391 lines, which shows the requirement is unbounded in the one dimension that mattered. It gains a requirement that orchestration state is owned by domain hooks under `src/hooks/`, with `App.tsx` composing them — the same discipline `main-process-structure` established for the main process, applied to the renderer's own composition root.

### New Capabilities

(none — this is a restructure of code that already exists, exactly as `split-main-process-modules` was.)

## Impact

- **Modified**: `src/App.tsx` (1391 → target ≤450 code lines).
- **New**: ~8–11 hooks under `src/hooks/`, plus pure helpers and tests under `src/lib/` where a domain has extractable logic.
- **Unmodified**: `electron/**` entirely, `src/components/**` (their props change shape, not their behavior), `package.json` dependencies.
- **Enforcement**: `scripts/check-file-size.mjs` already ratchets this file and counts code lines, so progress is banked commit by commit and cannot silently reverse. `src/App.tsx` is its largest entry; this change is the one that retires it.

## Open Question — to settle in design, not here

`App.tsx` has **no test of any kind**, and cannot easily get one: `vitest.config.mjs` collects `src/**/*.test.ts`, which does not match `.tsx`, and no `renderHook` is available (`jsdom` is a declared devDependency but no project uses it, and no testing-library is installed). `scripts/harness-globs.test.mjs` now fails the suite if a `.tsx` test file is added without widening the glob, so the gap is at least *audible*.

This change is therefore verified by `tsc`, `oxlint`, the `src/lib/` tests it adds, and manual smoke. Whether to add a jsdom project and a render harness is a real decision with its own cost, and it should be made on its own merits rather than smuggled in here. It is noted because a reviewer should know what is and is not covering this work.
