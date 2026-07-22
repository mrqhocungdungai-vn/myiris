## 1. Pure helper (`src/lib/tasks.ts`)

- [x] 1.1 Add `resolveMergedString(raw: unknown, existing: string | undefined): string` beside `readString`: return `raw` when `typeof raw === "string"` (even `""`), otherwise `existing ?? ""` (design D1). Comment it with the empty-vs-absent intent and the BUG D reference

## 2. Use it in the reducer (`src/App.tsx`)

- [x] 2.1 Replace `output: output || existing?.output` (`App.tsx:668`) with `output: resolveMergedString(event.output, existing?.output)`
- [x] 2.2 Replace `error: error || existing?.error` (`App.tsx:669`) with `error: resolveMergedString(event.error, existing?.error)` (design D3)
- [x] 2.3 Confirm the local `const output`/`const error` (`App.tsx:633-634`) are still used where a plain string is needed, or removed if now unused — no dead bindings left

## 3. Test harness reaches `src/` helpers

- [x] 3.1 `vitest.config.mjs`: add `"src/**/*.test.ts"` to `include` (keep `environment: "node"` — pure helper, no DOM) (design D2)
- [x] 3.2 `tsconfig.json`: add `"exclude": ["src/**/*.test.ts"]` so the app typecheck ignores test files (design D2)
- [x] 3.3 Confirm no `build.files` change is needed — Vite omits the unimported test file from `dist/` (design D2)

## 4. Test (`src/lib/tasks.test.ts`, new)

- [x] 4.1 `resolveMergedString("result", "old activity")` → `"result"` (non-empty replaces)
- [x] 4.2 `resolveMergedString("", "old activity")` → `""` (empty **replaces**, not falls back — the core of BUG D)
- [x] 4.3 `resolveMergedString(undefined, "old activity")` → `"old activity"` (absent keeps existing)
- [x] 4.4 `resolveMergedString(undefined, undefined)` → `""` (absent with no existing → empty)

## 5. Verification

- [x] 5.1 `npm test` passes (electron tests unaffected; new `src/lib` test green) with no `.env`, no `claude`, no network
- [x] 5.2 `npm run build` passes with no new type errors and test files excluded from the typecheck
- [x] 5.3 Manual (the plan's BUG D ritual): run a task where Claude returns an empty result → the card shows an empty/placeholder result, NOT the activity log, and the result overlay does not open onto tool chatter
- [x] 5.4 Manual: run a task with a normal non-empty result → the card shows the result as before (no regression); the step timeline still shows the tool calls during the run

## 6. Spec and record

- [x] 6.1 `openspec validate show-real-result-not-activity-log` passes
- [x] 6.2 Re-read the `task-step-timeline` delta: the three scenarios (empty→no activity log, non-empty shown, no-result-field leaves text intact) are true against the landed code
- [ ] 6.3 One commit on `develop` (single bug), Co-Authored-By trailer
- [x] 6.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG D done; note the pure `resolveMergedString` helper, that `error` was fixed with it too, that the Vitest harness now covers pure `src/lib` helpers, and that a `task-step-timeline` scenario was added (deviation from the drift-vs-gap "no spec" for D, justified by the Wave 3 reducer refactor putting the fix at future risk)
