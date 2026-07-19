# Design — voice-ui-and-setup

## Context

Upstream implements this layer as: renderer `sendUiContext` (App.tsx ~725-748) → `ipcMain.on("iris:ui-context")` (main.mjs ~1451) feeding the Gemini prompt; Gemini UI tools → `emitToRenderer("iris:ui-action", {action, target_id, query})` (~636) → renderer `onUiAction` (~750-811); `lib/tasks.ts` `findTaskMatches` + `TaskChooser.tsx` for ambiguity; `SetupPanel.tsx` (704 lines, Hermes endpoint testing + `config:*`); `useWakeWord.ts` (227 lines, onnxruntime-web, models in `public/wakeword/`, listens only while asleep); `go_to_sleep` tool (main.mjs ~675-682, 3 s delay → `iris:sleep`); `iris:boot-done` handshake.

Ours today: no ui-context/ui-action channels; voice→UI exists only as the PO question relay (`SYSTEM_EVENT_PO_QUESTION`, `answer_po_question` tool, `po:answer-question` IPC, single global `pendingPoQuestion`); config is `.env`-only (repo `.env` dev, `~/.iris/.env` packaged); wake is keyboard; Gemini tool set is the seven Claude-delegation tools.

Constraints from CLAUDE.md that bind this design: Gemini function calls must never block (return immediately); `SYSTEM_EVENT_*` naming convention; config env-driven with `IRIS_*` prefixes documented in `.env.example`; pinned identifiers must not drift; never commit real keys.

## Goals / Non-Goals

**Goals:**
- Gemini can see and drive the UI with the Claude-renamed action vocabulary; ambiguous references resolve via TaskChooser by voice or pointer/gesture.
- Clean coexistence with the PO question relay (no regressions to voice-decision-relay spec).
- SetupPanel gives first-run onboarding + settings for Claude: Gemini key, Claude CLI/OAuth status, voice preview, wake word/sounds/test-data toggles.
- Hands-free wake ("Hey Iris") and voice sleep; boot handshake prevents talking over the boot animation.

**Non-Goals:**
- No Glass HUD, tray, or global hotkeys (future change; `iris:wake` channel is added only if the wake-word path needs it internally).
- No change to delegation tools, run queue, sessions, or PO relay semantics.
- No cloud wake word; on-device ONNX only.
- SetupPanel does not manage per-role models (that UI exists in the pipeline bar per per-role-model-selection spec).

## Decisions

### D1 — Adopt upstream's two-channel design verbatim, rename vocabulary
`iris:ui-context` (renderer→main, throttled state snapshots) and `iris:ui-action` (main→renderer, `{action, target_id, query}`) are ported as-is; only action names change (`open_latest_hermes_result` → `open_latest_claude_result`, `open_hermes_history` → `open_claude_history`). Gemini gets the UI tools as **new function declarations** alongside the existing seven; tool handlers return immediately (fire event, ack) per the synchronous-call rule. Alternative (routing UI actions through the existing sidecar event stream) rejected: sidecar is main→renderer telemetry for the Work Stream, not a command bus, and upstream's separation is what change-4+ ports will assume.

### D2 — PO question precedence, not merger
The PO relay stays exactly as specified in voice-decision-relay. Coexistence rule: while `pendingPoQuestion` is set, the main-side prompt context tells Gemini a PO question is awaiting an answer (already true today via `SYSTEM_EVENT_PO_QUESTION`), and TaskChooser is suppressed in the renderer (a pending PO question outranks a disambiguation modal — both are "answer by voice" surfaces and must not stack). UI actions like `close_reader` remain allowed during a pending question. Alternative (merge both into one generic "pending question" mechanism) rejected: the PO relay is a settled spec with timeout/fallback semantics; entangling them risks regressing it.

### D3 — SetupPanel re-target: replace Hermes tests with Claude probes
Keep upstream panel structure/CSS; swap the Hermes endpoint section for: (a) Gemini key field + live test (existing upstream mechanic), (b) Claude CLI check — main runs the same binary probe `main.mjs` already uses (`claude --version`, honoring `IRIS_CLAUDE_BIN`/PATH probing), (c) subscription auth status via existing `poBillingStatus()`/`logPoBillingPathOnce` logic surfaced read-only, (d) toggles: wake word, interface sounds (binds the change-2 mute flag), test data. Panel opens automatically on first run when no Gemini key is found (upstream behavior), else from a settings affordance.

### D4 — `config:*` persists to the existing `.env` files
`config:get` returns current effective config (redacting secrets to presence-booleans where displayed); `config:save` writes key/value pairs into the same `.env` the app already reads (repo `.env` in dev, `~/.iris/.env` packaged), creating it from `.env.example` structure if absent, then re-reads env. No new config store, no JSON settings file — keeps the "config is env-driven" convention intact. Restart-required keys (e.g. `GEMINI_API_KEY` mid-session) surface a "reconnect" prompt rather than pretending to hot-reload. Never log or echo written secret values.

### D5 — Wake word pinned like other model assets
`useWakeWord.ts` ported unchanged; `onnxruntime-web` added as an exact-pinned dependency; model files vendored under `public/wakeword/` (bundled, no CDN fetch at runtime). Toggle `IRIS_WAKE_WORD` (default on) + SetupPanel switch. Listens only while asleep; firing calls the exact wake handler the keyboard uses. README pinned-identifiers section gains onnxruntime-web version + model filenames.

### D6 — Sleep and boot handshake
`go_to_sleep` Gemini tool: main acks immediately, schedules `emitToRenderer("iris:sleep")` after the goodbye delay (upstream ~3 s, `IRIS_SLEEP_DELAY_MS` overridable). Renderer sleep path identical to keyboard sleep. `iris:boot-done`: renderer notifies when the boot animation finishes; main defers the session-start greeting until then (upstream mechanic), which also gates wake-word arming.

## Risks / Trade-offs

- [Gemini overuses UI tools / narrates actions] → port upstream's tuned tool descriptions and prompt guidance verbatim (they already solved this), adjusting only Hermes→Claude wording.
- [TaskChooser and PO banner collide visually or semantically] → D2 suppression rule + smoke case covering "PO question pending, user says 'open the latest result'".
- [Writing `.env` from the app corrupts user comments/ordering] → `config:save` does line-level upsert (preserve unknown lines/comments); covered by a task-level manual check.
- [onnxruntime-web bundle size / load cost] → lazy-load the wake pipeline only when asleep and toggle enabled (upstream already structures it this way).
- [Wake word false positives] → keep upstream thresholds; toggle exists; listens only while asleep so worst case is an unwanted wake, never an interruption.
- [Secret handling in SetupPanel] → display presence/masked values only; never round-trip full secrets to the renderer after save.

## Migration Plan

Land after changes 1–2. New channels/tools are additive; `.env` remains authoritative, so users who never open SetupPanel see no behavior change beyond wake word (default on — flip to `IRIS_WAKE_WORD=0` if it misbehaves) and voice sleep. Rollback = revert; delete `public/wakeword/` assets and the dependency pin.

## Open Questions

- Whether `open_current_claude_result` vs `open_latest_claude_result` both survive prompt tuning for our two-role card model (PO turn vs DEV run "current") — resolve while porting tool descriptions; default is to keep both with upstream semantics.
