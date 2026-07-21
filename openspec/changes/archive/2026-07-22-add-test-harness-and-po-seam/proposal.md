## Why

Iris has no test runner. `tsc --noEmit` (via `npm run build`) is the only automated check, and it cannot see the defect class this codebase actually suffers from.

The architecture review recorded in `docs/BUGFIX_PLAN.md` found nine verified defects. The most severe — a PO turn whose promise is settled only on the `catch` path (`electron/po-session.mjs:128-141`), so a normally-ended SDK stream leaves the global execution slot held forever — **type-checks perfectly**. It lives in a 251-line module with clean boundaries that was already deliberately split out. Neither types nor good structure prevented it, because it is a *lifecycle* defect: an obligation that is never settled.

`electron/main.mjs:121-124` shows the project already learned this once. `PendingQuestion` funnels every settlement path through one `settle()` reachable from a bounded timer, and its comment records that *"an earlier bare-global version already caused exactly that bug."* That invariant was never generalized to the PO turn slot or the execution slot.

Eight lifecycle fixes are queued behind this change. Landing them without a net means each one is verified by a manual GUI ritual performed once and never repeated. This change builds the net first.

## What Changes

- Add **Vitest** as the repo's first test runner, with an `npm test` script. Configured for Node-side ESM so `electron/*.mjs` modules are testable directly, without booting Electron, spawning `claude`, or touching the network.
- Make the Claude Agent SDK `query` function an **injected parameter** of `getOrCreatePoSession` in `electron/po-session.mjs`, defaulting to the real imported `query`. Production behavior is byte-identical; the parameter exists so a fake async generator can drive the session in tests. This one-line seam is what makes the critical BUG A testable at all.
- Add the first test file, covering `electron/run-queue.mjs`. This module needs **zero refactor** — `createRunQueue({startRun, emit, onFinalized})` already takes every dependency by injection. The tests assert the invariants that `openspec/specs/run-execution-queue/spec.md` already states: at most one active run system-wide, a run finalizes exactly once, cancelled queued runs are skipped on dequeue, and the execution slot is released exactly once.

Not in scope, deliberately:

- Any behavior change. No bugfix from `docs/BUGFIX_PLAN.md` (A, A', B, C, D, E, I, J, K) lands here.
- Testing `electron/main.mjs` end to end, the Gemini Live socket, or Electron IPC. That is the scope trap; this change stays on modules that already accept injected dependencies.
- Renderer tests. `src/lib/tasks.ts` is pure and testable, but covering it belongs with the renderer work in Wave 1.

## Capabilities

### New Capabilities
- `test-harness`: the repo's automated test capability — that a runner exists and is invocable, what it is permitted to depend on (nothing that requires Electron, a real `claude` binary, a Gemini API key, or network access), and the requirement that modules under test expose their dependencies by injection rather than being rewritten for testability.

### Modified Capabilities
None. The `query` seam is a defaulted parameter with identical production behavior, so `po-live-session`'s requirements are unchanged. The run-queue tests assert `run-execution-queue`'s existing requirements without altering them.

## Impact

- `package.json` — new `devDependencies` entry for Vitest; new `test` script. `npm run build` is unchanged and remains the typecheck gate.
- `electron/po-session.mjs` — `getOrCreatePoSession` gains one optional parameter. All existing call sites (`electron/main.mjs:1580-1590`) keep working untouched.
- New: a Vitest config and a test directory.
- No runtime dependency added; Vitest is dev-only and is not bundled by electron-builder (`build.files` in `package.json` lists `dist/`, `electron/`, and named assets only).
- Follow-on: unblocks Wave 0.1 (`run-queue` idle watchdog) and 0.2 (BUG A), both of which are specified in `docs/BUGFIX_PLAN.md` and both of which need this net to be verifiable.
