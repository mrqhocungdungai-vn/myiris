## Why

The Work Stream card merges each `claude_task_update` with `output: output || existing?.output` (`src/App.tsx:668`). During a run, `pushActivity` (`electron/main.mjs:1049-1055`) emits the joined activity buffer in the update's `output` field on every `RUNNING` tick; at completion, `finalize` emits the run's real result there. When the final result is **empty** (`""` — falsy), the `||` discards it and keeps `existing?.output` — i.e. the **activity log**. The card then shows, and `ReaderOverlay` presents, a wall of raw tool-call chatter as though it were Claude's answer.

`readString` (`src/lib/tasks.ts:103`) collapses both an absent field and an empty string to `""`, so the reducer cannot currently tell "the event carried an empty result" from "the event carried no output at all" — which is exactly the distinction this bug needs. This is `docs/BUGFIX_PLAN.md` BUG D. The line at `App.tsx:669` (`error: error || existing?.error`) has the identical latent defect.

This reducer is slated for a rewrite in the plan's Wave 3 (sidecar-event reducer refactor), so pinning the intended behavior as a spec scenario and a tested pure helper now protects the fix precisely when it is most at risk of silent regression.

## What Changes

One bug, **one commit**.

- Add a pure helper `resolveMergedString(raw, existing)` in `src/lib/tasks.ts`: use the event's value whenever the event actually carried a string (even `""`), otherwise keep the existing value. This distinguishes empty from absent, which `readString` alone cannot.
- Use it at `src/App.tsx:668-669` for both `output` and `error`, replacing the two `||` merges. An empty terminal result now **replaces** the activity log with an empty result (card shows a placeholder, not tool chatter); an update that carries no output still leaves the running card's text untouched.
- Extend the Vitest harness to cover pure `src/` library helpers (`src/**/*.test.ts`, node environment), and exclude test files from the app typecheck so `npm run build` stays clean. Add a unit test for `resolveMergedString`.

Not in scope:
- The `App.tsx:657` `&& steps` guard — investigated and found correct (BUG D note): `tool_start`/`tool_end` arrive from one ordered source (`claude-stream.mjs`), so `tool_end` cannot precede its `tool_start`; the guard is defensive, not a bug.
- Whether the activity log should be shown *at all* during a run (it still is, unchanged) — this change only stops it from masquerading as the final result.
- The broader reducer refactor (Wave 3).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-step-timeline`: adds a requirement that a completed card's displayed result is the run's actual final result — and when that result is empty, the card shows an empty/placeholder result rather than falling back to the in-progress activity log. The spec currently governs the card's step timeline and handoff comets but says nothing about the result text vs. the activity log, which is the gap BUG D lives in.

## Impact

- `src/lib/tasks.ts` — new pure `resolveMergedString` helper (alongside the existing `readString`).
- `src/App.tsx` — the two field merges at 668-669 route through it.
- `vitest.config.mjs` — `include` also matches `src/**/*.test.ts` (node env, for pure helpers only).
- `tsconfig.json` — exclude `src/**/*.test.ts` from the app typecheck (vitest owns those).
- `src/lib/tasks.test.ts` — new; unit tests for `resolveMergedString`.
- `task-step-timeline` living spec — one ADDED requirement.
- No new dependency, no data migration. Vite naturally omits the unimported test file from `dist/`, so no `build.files` change is needed.
