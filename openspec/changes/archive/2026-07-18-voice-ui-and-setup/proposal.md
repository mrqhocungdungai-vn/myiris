# voice-ui-and-setup

## Why

With the Deep Space restructure and the gesture/orb layer in place, the remaining upstream UX gap is voice-native control of the interface itself: upstream lets Gemini see the UI state and drive it ("open the latest result", "hide the steps"), offers an onboarding/settings panel, wakes on "Hey Iris" hands-free, and goes to sleep by voice. Our fork can only be driven by mouse/keyboard/gesture, config is `.env`-only, and wake requires the keyboard. This change ports that layer, renamed from Hermes to Claude semantics, and coexisting with our PO question voice relay. Depends on `ui-deepspace-restructure` and (for full effect) `two-hand-gestures-and-orb` (step timeline targeted by show/hide-steps actions).

## What Changes

- **Voice-driven UI context**: renderer streams UI state to the Gemini session via a new `iris:ui-context` IPC channel (expanded/focused/latest task ids, pending disambiguation choices, history-open flag, task list summary), throttled as upstream does.
- **Voice UI actions**: main process exposes UI-control tools to Gemini and forwards them over a new `iris:ui-action` channel. Action vocabulary is the upstream set renamed to Claude: `open_task`, `open_task_by_query`, `open_current_claude_result`, `open_latest_claude_result`, `open_claude_history`, `close_reader`, `close_history`, `close_all_overlays`, `show_task_steps`, `hide_task_steps`.
- **TaskChooser disambiguation**: fuzzy `findTaskMatches` over the task list; when a voice reference is ambiguous, a `TaskChooser` modal lists candidates answerable by voice, click, or dwell-click. Coexists with the PO question banner: `answer_po_question` and its `po:answer-question` IPC remain untouched and take precedence when a PO question is pending.
- **SetupPanel for Claude**: adopt upstream's onboarding/settings panel, replacing Hermes endpoint testing with Claude checks — Gemini key entry + live test, Claude CLI availability (`claude --version` via main), `CLAUDE_CODE_OAUTH_TOKEN` presence/billing-path status (reusing `poBillingStatus`), voice preview, and toggles for wake word / interface sounds / demo test data. Backed by a new `config:*` IPC pair (read/save) persisting to the existing `.env` locations (repo `.env` in dev, `~/.iris/.env` packaged).
- **Wake word "Hey Iris"**: adopt `useWakeWord.ts` (openWakeWord mel→embedding→classifier via `onnxruntime-web`, models under `public/wakeword/`), active only while asleep, firing the same wake path as the keyboard shortcut. New pinned dependency + local model assets.
- **Voice sleep**: new Gemini tool `go_to_sleep` — Gemini says goodbye, main emits `iris:sleep` after a short delay; renderer sleeps exactly like the keyboard path. Boot handshake `iris:boot-done` adopted so Gemini doesn't speak over the boot animation.

## Capabilities

### New Capabilities
- `voice-ui-control`: UI-context streaming to Gemini, the Claude-named UI action vocabulary, and TaskChooser disambiguation, coexisting with the PO question relay.
- `setup-panel`: The Claude-oriented onboarding/settings panel and its `config:*` persistence.
- `wake-sleep-voice`: Hands-free wake word while asleep and voice-commanded sleep, plus the boot-done handshake.

### Modified Capabilities

<!-- none — voice-decision-relay behavior unchanged (coexistence is additive); session-announcements unchanged -->

## Impact

- **Renderer**: new `src/components/TaskChooser.tsx`, `src/components/SetupPanel.tsx`, `src/hooks/useWakeWord.ts`; `src/lib/tasks.ts` gains `findTaskMatches`; App.tsx wires ui-context send + ui-action handling + wake word + sleep.
- **Main process**: `electron/main.mjs` — new Gemini tool declarations (UI actions, `go_to_sleep`), `ipcMain.on("iris:ui-context")` feeding the live session prompt, `emitToRenderer("iris:ui-action")`, `config:*` handlers writing `.env`, Claude CLI/token status probes. `preload.cjs` — new channels: `iris:ui-context`, `iris:ui-action`, `iris:sleep`, `iris:wake` (if tray parity desired later, wake stays keyboard+wakeword for now), `iris:boot-done`, `config:*`.
- **Dependencies**: `onnxruntime-web` (pinned) + wake word model assets in `public/wakeword/` (first-run offline after bundling).
- **Docs/config**: `.env.example` documents any new `IRIS_*` toggles (e.g. wake word enable); README pinned-identifier table gains the onnxruntime/model pins.
- **Prerequisites**: `ui-deepspace-restructure` (layout), `two-hand-gestures-and-orb` (step timeline for show/hide steps actions; TaskChooser dwell-click).
