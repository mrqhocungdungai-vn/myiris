## Context

Iris ships with no test runner. `npm run build` (`tsc --noEmit && vite build`) is the only automated check, and `CLAUDE.md` states this explicitly as a property of the project.

That was defensible while the app was mostly UI and a websocket. It stopped being defensible once `docs/BUGFIX_PLAN.md` established that the codebase's actual defect class is **unsettled obligations**: promises and slots that have a settle-at-most-once guard but no settle-at-least-once bound. Three such slots exist; only `PendingQuestion` (`electron/main.mjs:125-163`) bounds itself, with a comment recording that an earlier version of that very slot already hung forever in production.

The two unbounded slots are `state.currentTurn` (`electron/po-session.mjs:212`) and the global `active` execution slot (`electron/run-queue.mjs:85`). Both are the subject of the next two changes in the plan. Neither is reachable by `tsc`.

Constraints that shape this design:

- The repo is `"type": "module"`. `electron/*.mjs` are native ES modules with no build step.
- The main process imports `electron` at module load (`main.mjs:1-31`) and calls `app.setName` at import time, so `main.mjs` is not importable outside Electron. Any harness that tries to reach it will fail, and that failure would be misread as "tests don't work here."
- `electron/run-queue.mjs` and `electron/claude-stream.mjs` already have no I/O and take dependencies by injection. `electron/po-session.mjs` is one hardcoded import away from the same.
- `electron-builder`'s `build.files` lists `dist/`, `electron/`, and named assets. Anything added under `electron/` ships in the packaged app.

## Goals / Non-Goals

**Goals:**

- A runner that starts from zero config debt and runs in an environment with no `.env`, no `claude` binary, and no network.
- The one seam (`query` injection) that makes the PO session's turn lifecycle observable, at production-behavior parity.
- Executable assertions for the run queue's slot invariants, written against the interface the queue already exposes.
- A net that the next two changes (the idle watchdog, then BUG A) can be verified against, so their verification is repeatable rather than a one-time GUI ritual.

**Non-Goals:**

- Any behavior change. This change must be provably inert at runtime.
- Coverage targets, CI wiring, or a lint step. Those are separate decisions and bundling them here would make an inert change look risky.
- Renderer tests. `src/lib/tasks.ts` is pure and deserves them, but it belongs with the renderer work in Wave 1 and would drag in a DOM environment decision this change does not need to make.
- Testing `main.mjs`, the Gemini Live socket, or Electron IPC. See D5.

## Decisions

### D1 — Vitest, not `node:test` or Jest

**Chosen:** Vitest, as a dev dependency, with an `npm test` script.

Vite is already a direct dependency and already resolves this repo's module graph. Vitest reuses that resolution, so ESM `.mjs` imports work with no transform config — which is the entire integration cost here. It also ships fake timers, which the next change (`IRIS_RUN_IDLE_TIMEOUT_MS` watchdog) needs on day one, and it gives a path to a jsdom environment later for `src/` without a second runner.

*`node:test` considered:* zero dependencies and native ESM, which is genuinely attractive for a suite that only touches `electron/*.mjs`. Rejected because the timer control needed by the very next change is weaker, and because adding a second runner later for `src/` would leave the repo with two.

*Jest considered:* rejected. ESM support requires configuration this repo would otherwise never need, and it shares nothing with the existing Vite toolchain.

### D2 — The seam is a defaulted parameter on `getOrCreatePoSession`, not a module mock

**Chosen:** add an injected `query` to the existing options object of `getOrCreatePoSession` (`electron/po-session.mjs:147`), defaulting to the imported SDK `query` used today at line ~190.

This matches how the module's neighbours are already built. `createRunQueue({startRun, emit, onFinalized})` takes its dependencies this way; `computePoSessionEnv(baseEnv)`, `poBillingStatus(env)` and `poQuestionTimeoutMs(env)` (`po-session.mjs:19-34`) already take `env` as a parameter for exactly this reason. The seam is therefore consistent with a pattern the module's author already applied, not a new convention.

It also keeps the test honest about *what* is being faked. The thing under test is the module's handling of a stream that ends — the fake is an async generator, which is precisely the contract the real `query` provides.

*`vi.mock` of `@anthropic-ai/claude-agent-sdk` considered:* rejected. It requires no production change, which is its only advantage. Against it: module mocking couples the test to the import graph rather than to the interface, it silently breaks if the import specifier changes, and it hides the dependency instead of naming it. The spec requires injection over test-only mechanisms for this reason.

*A module-level `setQueryImpl()` setter considered:* rejected. It reintroduces mutable module state — which is the shape of the bugs this whole effort is chasing — and it would let one test leak into the next.

**Parity requirement:** every existing call site (`main.mjs:1580-1590`) omits the parameter and must behave identically. This is asserted, not assumed: the change is inert unless a caller opts in.

### D3 — Tests live beside the module under test, and are excluded from the package

**Chosen:** `electron/*.test.mjs`, colocated.

The suite covers `electron/` modules and nothing else right now; colocating keeps the file next to the invariants it protects, which is where someone changing `run-queue.mjs` will actually look.

The cost is that `electron-builder`'s `build.files` currently globs `electron/**`, so test files would ship inside the packaged app. That must be handled in this change — add an exclusion to `build.files` — otherwise the change quietly increases what the app distributes. This is the one place where an "inert" change touches packaging, and it should be verified by inspecting a packaged build's contents, not assumed.

*A top-level `tests/` directory considered:* avoids the packaging question entirely. Rejected because it separates the assertions from the module, and because the packaging exclusion is one line and worth doing correctly.

### D4 — Node environment by default

Vitest's `environment` stays `node`. Nothing in scope touches the DOM. When renderer tests arrive in Wave 1 they can opt into `jsdom` per file or via a second project entry, so this decision does not have to be revisited to add them — only extended.

### D5 — `main.mjs` stays out of scope, permanently for this change

`main.mjs` imports Electron and calls `app.setName` at import time. It cannot be loaded in a Node test process. More importantly, attempting it is the scope trap that turns "add a test runner" into an unbounded refactor.

The rule this change establishes: a module earns tests by taking its dependencies as parameters. `run-queue.mjs` and `claude-stream.mjs` already qualify; `po-session.mjs` qualifies after D2. `main.mjs` does not qualify today, and making it qualify is Wave 3's session-store work, not this change's.

### D6 — The run-queue tests assert existing behavior only

The tests are written against `openspec/specs/run-execution-queue/spec.md` as it stands. Where the spec and the code disagree, this change records the disagreement and changes neither.

One such disagreement is already known and is tracked as BUG K in `docs/BUGFIX_PLAN.md`: the spec (`run-execution-queue`, "Stopping a run") says a queued run stopped while waiting is finalized as `cancelled` immediately; `run-queue.mjs:142-151` deliberately does not call `finalize` and comments that this is intentional. The test suite must assert **the code's** behavior here and carry a comment pointing at BUG K, so that the reconciliation decision stays visible and is made deliberately in a later change rather than being silently settled by whichever behavior someone happened to write a test for first.

## Risks / Trade-offs

**Test files ship inside the packaged app** → `build.files` globs `electron/**`. Add an explicit exclusion in this change and verify against a real `npm run package:mac` output, not by reading the config.

**A "safety net" change that itself changes behavior** → the whole value of this change is that it is inert. The `query` parameter is defaulted and no call site passes it; `npm run build` must still pass unchanged, and no file outside `package.json`, `po-session.mjs`, the new config and the new test file may be touched.

**The seam becomes an invitation to fix BUG A in the same change** → resist. BUG A is Wave 0.2 and needs a settlement-reason tag whose semantics are still an open decision (see `docs/BUGFIX_PLAN.md`, BUG A). Landing it here would mean landing an undecided design under cover of a tooling change.

**Vitest version drift** → pin it like the repo's other exact-identifier dependencies rather than using `latest`, so a future `npm ci` cannot change the runner underneath the suite.

**Tests that pass for the wrong reason** → the injected `startRun` fake must be able to distinguish "was invoked" from "completed", otherwise a test asserting "at most one active run" would also pass against a queue that never started anything. Each fake should record invocation order, not just a count.

**False confidence** → three tested modules out of a 2,652-line main process is a net, not a safety guarantee. The plan's sequencing depends on this being understood: the net exists so the *next two* changes are verifiable, and its value is realized there, not here.

## Migration Plan

No data migration and no runtime migration — the change is inert by construction.

Rollback is deleting the config, the test file and the `devDependencies` entry, and dropping the `query` parameter's default. No stored state, no user-visible surface, and no other module depends on any of it.

## Open Questions

- Should `npm run build` eventually gain a test step, or should the two stay separate and be composed by CI? This change deliberately keeps them separate (the spec requires the typecheck to stay independently runnable), but the composition question is unanswered because there is no CI configuration in the repo yet.
- BUG K's reconciliation — spec says finalize-on-queued-cancel, code says don't — is deferred, but it must be resolved before Wave 0.1's watchdog, because the watchdog will be built on the assumption that `run.finalized` implies terminal, and that assumption is currently false for exactly this class of run.
