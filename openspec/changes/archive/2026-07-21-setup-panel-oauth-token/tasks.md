## 1. Main-process config plumbing

- [x] 1.1 Add `CLAUDE_CODE_OAUTH_TOKEN` to `ALLOWED_CONFIG_KEYS` in `electron/main.mjs`
- [x] 1.2 In `writeUserConfig()`, skip the token key when the incoming value is empty or whitespace-only, so a global save cannot erase a stored token (design D3)
- [x] 1.3 Add `poTokenSet: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim())` to `getFullConfig()` and confirm the token value itself is never included in its return (design D2)

## 2. Token change invalidates the resident PO session

- [x] 2.1 Add a helper in `electron/main.mjs` that reports whether a PO turn is running, via `runQueue.list().some(run => run.agent === "po" && run.status === RUN_STATUS.RUNNING)` (design D6)
- [x] 2.2 Add a main-process token-save path that refuses with an explanatory message while a PO turn is running, otherwise writes the token through `writeUserConfig()` and calls `closeAllPoSessions()` (design D5/D6)
- [x] 2.3 Add the matching remove path: clear the key in `.env`, delete it from `process.env`, close resident PO sessions, subject to the same running-turn guard
- [x] 2.4 Register the IPC handler(s) for these two paths and confirm no branch logs the token value

## 3. Preload bridge

- [x] 3.1 Expose the token save and remove calls on `window.iris` in `electron/preload.cjs`, returning the refreshed config (including `poTokenSet`) so the renderer can update without a separate read

## 4. SetupPanel UI

- [x] 4.1 Add `poTokenSet` to the `IrisConfig` type used by the renderer
- [x] 4.2 Inside `claudeSection`'s `pipelinePrereqs.reachable` block in `src/components/SetupPanel.tsx`, add a password-type token input that always renders empty, with placeholder text reflecting whether a token is stored and naming `claude setup-token` (design D2/D7)
- [x] 4.3 Add the local "Save token" button: disabled while the input is empty or a save is in flight, calls the new bridge method, then re-runs `checkClaude()` (design D4)
- [x] 4.4 Add the "Remove" button, rendered only when `poTokenSet` is true, with the same post-action `checkClaude()` refresh
- [x] 4.5 Surface the refusal message from a save/remove blocked by a running PO turn in the section's existing note style, and keep the input contents on failure
- [x] 4.6 Verify the control appears in both Settings and the onboarding wizard's `claude` step, and is absent when the Claude binary does not resolve

## 5. Docs and verification

- [x] 5.1 Update `.env.example` and the README/setup docs to say the token can be pasted into Settings, not only hand-written into `.env`
- [x] 5.2 Update `CLAUDE.md`'s PO subscription auth section to mention the in-app token control and the session-invalidation rule
- [x] 5.3 Run `npm run build` (tsc + vite) and confirm it passes
- [x] 5.4 Manually verify each spec scenario: paste-and-save flips the billing line; global Save with an empty field preserves the token; remove clears it; save during a running PO turn is refused; the next PO turn after a change resumes prior context
