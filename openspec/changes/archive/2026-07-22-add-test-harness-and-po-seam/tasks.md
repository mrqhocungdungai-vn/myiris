## 1. Runner setup

- [x] 1.1 Add Vitest to `devDependencies` in `package.json` at a pinned exact version (not `latest`, per design Risks), and run `npm install` so `package-lock.json` records it
- [x] 1.2 Add a `test` script to `package.json` running Vitest once (non-watch), so `npm test` exits with a code
- [x] 1.3 Add Vitest config with `environment: "node"` and an include pattern covering `electron/**/*.test.mjs`; do not add a jsdom environment or a coverage provider (design D4, Non-Goals)
- [x] 1.4 Verify `npm run build` still runs the typecheck and Vite build without invoking the test runner (spec: "Typecheck stays independent")
- [x] 1.5 Add an exclusion for `*.test.mjs` to `build.files` in `package.json` so test files are not packaged (design D3)

## 2. PO session `query` seam

- [x] 2.1 Add an injected `query` to the options object of `getOrCreatePoSession` in `electron/po-session.mjs`, defaulting to the SDK `query` currently imported and called at the session-creation site
- [x] 2.2 Confirm no existing call site passes it — `electron/main.mjs:1580-1590` must stay untouched — and that omitting it selects the real SDK `query` (spec: "Existing call site is unaffected")
- [x] 2.3 Do not change any other behavior in `po-session.mjs`. In particular do not touch `pump`'s `catch`/`finally` — that is BUG A, Wave 0.2 (design Risks)

## 3. Run-queue invariant tests

- [x] 3.1 Create `electron/run-queue.test.mjs` and construct the queue via `createRunQueue({startRun, emit, onFinalized})` with fakes; the `startRun` fake must record invocation order and distinguish "invoked" from "completed" (design Risks)
- [x] 3.2 Test: submitting while the slot is free starts the run immediately and invokes `startRun` exactly once
- [x] 3.3 Test: submitting while the slot is held queues the run FIFO and does not invoke `startRun` again (spec: "Single slot is enforced")
- [x] 3.4 Test: finalizing an already-terminal run emits no second terminal event and does not release the slot twice (spec: "Finalize is once-only")
- [x] 3.5 Test: on slot release, a queue entry whose run was cancelled while waiting is discarded without starting, and the next eligible queued run starts (spec: "Cancelled queued run is skipped")
- [x] 3.6 Test: the slot is released exactly once per run — after finalize, a subsequent submit starts immediately
- [x] 3.7 Assert the code's current behavior for stopping a queued run (no `finalize` call, per `run-queue.mjs:142-151`) and add a comment referencing BUG K in `docs/BUGFIX_PLAN.md`, since the spec states the opposite and the reconciliation is deliberately deferred (design D6)

## 4. Verification

- [x] 4.1 Run `npm test` on a shell with no `GEMINI_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN`, and no `claude` on `PATH`; all tests must pass (spec: "Clean environment")
- [x] 4.2 Confirm no `claude` subprocess and no Electron process is spawned during the run (spec: "No subprocess is spawned")
- [x] 4.3 Run `npm run build` and confirm it still passes with no new type errors
- [x] 4.4 Run `npm run package:mac` and confirm no `*.test.mjs` file is present inside the packaged app's `electron/` directory (design D3 — verify the artifact, not the config)
- [x] 4.5 Confirm the diff touches only `package.json`, `package-lock.json`, the Vitest config, `electron/po-session.mjs`, and the new test file — the change must be inert at runtime (design Risks)

## 5. Record

- [x] 5.1 Update the log table in `docs/BUGFIX_PLAN.md` noting Wave 0.0 is complete and which modules now have a net
