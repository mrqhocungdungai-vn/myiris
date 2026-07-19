# Tasks — voice-ui-and-setup

## 1. Voice UI control plumbing

- [x] 1.1 Add `iris:ui-context` (renderer→main) and `iris:ui-action` (main→renderer) to `preload.cjs` (`sendUiContext`, `onUiAction`)
- [x] 1.2 Port `sendUiContext` throttled snapshot effect into App.tsx (expanded/focused/latest ids, pending choices, history-open, task summary)
- [x] 1.3 Main: `ipcMain.on("iris:ui-context")` storing latest snapshot and feeding it to the Gemini session context (port upstream wiring)
- [x] 1.4 Main: declare Gemini UI tools with Claude-renamed vocabulary (`open_task`, `open_task_by_query`, `open_current_claude_result`, `open_latest_claude_result`, `open_claude_history`, `close_reader`, `close_history`, `close_all_overlays`, `show_task_steps`, `hide_task_steps`); handlers ack immediately and emit `iris:ui-action`; port upstream tool descriptions with Hermes→Claude wording
- [x] 1.5 Port renderer `onUiAction` handler covering the full vocabulary (open/close reader & history, steps toggle by target)

## 2. TaskChooser + PO relay coexistence

- [x] 2.1 Add `findTaskMatches` (+ helpers) to `src/lib/tasks.ts`; port `TaskChooser.tsx`
- [x] 2.2 Wire ambiguity flow: unmatched/multi-match `open_task_by_query` → TaskChooser; selection performs the deferred action; pending choices included in ui-context
- [x] 2.3 Implement precedence rule (design D2): suppress TaskChooser while `pendingPoQuestion` is set; verify `answer_po_question` and `po:answer-question` untouched
- [x] 2.4 Smoke: PO question pending + ambiguous voice open → no chooser, PO answer still works by voice and click

## 3. SetupPanel + config IPC

- [x] 3.1 Add `config:get`/`config:save` to main + preload: effective config with masked secrets; line-preserving upsert into repo `.env` (dev) / `~/.iris/.env` (packaged); never log secret values
- [x] 3.2 Port `SetupPanel.tsx`; strip Hermes endpoint section; add Claude CLI probe (reuse main's binary resolution incl. `IRIS_CLAUDE_BIN`) and read-only subscription status from `poBillingStatus()`
- [x] 3.3 Gemini key field + live test + reconnect prompt on save; voice preview; toggles: wake word, interface sounds (bind change-2 mute flag), test data
- [x] 3.4 Auto-open on first run when no Gemini key; add settings affordance to open it manually
- [x] 3.5 Manual check: `.env` comments/ordering preserved after saves; masked redisplay of secrets

## 4. Wake word + voice sleep + boot handshake

- [x] 4.1 Add pinned `onnxruntime-web` dependency; vendor wake word models into `public/wakeword/`; document pins in README exact-identifiers section
- [x] 4.2 Port `useWakeWord.ts`; lazy-init only while asleep + toggle enabled (`IRIS_WAKE_WORD`, default on); fire the keyboard wake path
- [x] 4.3 Main: `go_to_sleep` Gemini tool → immediate ack, `iris:sleep` after `IRIS_SLEEP_DELAY_MS` (default 3000); renderer sleep identical to keyboard path; wake word re-arms after sleep
- [x] 4.4 Adopt `iris:boot-done`: renderer signals boot completion; main defers greeting; wake-word arming respects it
- [x] 4.5 Document new env keys in `.env.example` (`IRIS_WAKE_WORD`, `IRIS_SLEEP_DELAY_MS`)

## 5. Verification

- [x] 5.1 `npm run build` green; preload exposes exactly the new channels (`iris:ui-context`, `iris:ui-action`, `iris:sleep`, `iris:boot-done`, `config:*`) and nothing Hermes-named
- [x] 5.2 Voice smoke: "open the latest result" → reader opens; ambiguous request → TaskChooser, resolve by voice AND by dwell-click; "show the steps" → timeline expands; "go to sleep" → goodbye + sleep; "Hey Iris" → wake
- [x] 5.3 Regression: full PO question relay flow (voice answer, click answer, timeout fallback) behaves per voice-decision-relay spec
- [x] 5.4 Packaged-mode check: SetupPanel writes `~/.iris/.env`; wake word assets load offline
