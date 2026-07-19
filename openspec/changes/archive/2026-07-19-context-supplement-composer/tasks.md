## 1. Shared composer component

- [x] 1.1 Create `src/components/ContextSupplementInput.tsx`: a single-line controlled text input with Enter-to-send, a `disabled` prop, and an `onSubmit(text)` callback; clears itself after a successful submit.
- [x] 1.2 Add matching styles for the composer to `src/styles/deck.css` (and `src/styles/hud.css` for the HUD variant), consistent with the existing dark/rounded panel aesthetic.

## 2. Main-process event + IPC

- [x] 2.1 In `electron/main.mjs`, add a function that builds the `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` lines for the active workstream (event header + the supplied text + an `instructions_to_iris` block telling Gemini to immediately, decisively compose a research/reference brief from the recent conversation and the supplied text, and call `submit_claude_task` without asking for confirmation, omitting `agent` so routing uses the session's active role) and delivers them via `notifyIris(lines, { bufferIfOffline: false })`.
- [x] 2.2 Add an `ipcMain.handle` for a new channel (e.g. `context-supplement:send`) wired to that function.
- [x] 2.3 Expose the channel in `electron/preload.cjs` as a new `window.iris` method (e.g. `sendContextSupplement(text)`).

## 3. Deck integration

- [x] 3.1 Mount `ContextSupplementInput` inside `src/components/CommsPanel.tsx`, docked below `.comms-scroll`.
- [x] 3.2 In `src/App.tsx`, add the submit handler used by the deck composer: push a local "You" `TranscriptLine` (so it renders via the existing `self`-bubble path), then call `window.iris.sendContextSupplement(text)`. Pass the existing awake/`sidecarRunning` flag through as the composer's `disabled` prop.

## 4. HUD integration

- [x] 4.1 Mount the same `ContextSupplementInput` inside `src/components/HudShell.tsx`, below the bubble list in the existing collapsible `hud-comms` island, wrapped so it participates in `.hud-hit` click-through.
- [x] 4.2 Reuse the same submit handler and disabled state from `App.tsx` (passed as HudShell props) so deck and HUD behavior stay identical.

## 5. Verification

- [x] 5.1 Run `npm run build` (tsc --noEmit + vite build) and confirm it passes with no errors.
- [ ] 5.2 Manual smoke test in the deck: while awake, submit text in the composer; confirm it appears as a "You" bubble and that Iris reacts by submitting a Claude task built from the conversation + supplied text.
- [ ] 5.3 Manual smoke test in the HUD: expand the Comms island, submit text, and confirm the bubble and task-submission behavior match the deck exactly.
- [ ] 5.4 Confirm the composer is disabled (not merely inert) while Iris is asleep in both deck and HUD, and that no `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` delivery is attempted while the voice session is disconnected.
