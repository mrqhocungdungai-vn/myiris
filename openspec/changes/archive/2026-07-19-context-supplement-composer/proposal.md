## Why

Iris is voice-only: there is no way, mid-conversation, to hand Gemini precise text (a GitHub repo link, a URL, a snippet) that voice dictation can't reliably convey. This is most painful during PO's grilling phase, where a concrete reference (e.g. "look at this repo, is this feature applicable here?") would sharpen the questions PO asks and the change it proposes, but there is currently no channel to supply it.

## What Changes

- Add a single-line, freeform text composer docked to the bottom of the "Iris Conversation" panel (`CommsPanel` in the deck; the same box reused inside the existing collapsible Comms island in the Glass HUD).
- Enter-to-send. On submit, the text renders immediately as a "You" transcript bubble (reusing the existing bubble styling) in both deck and HUD.
- The submitted text is delivered to `main.mjs` via a new IPC channel and injected into the live Gemini session as a new `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` event (following the existing `SYSTEM_EVENT_*` convention), instructing Gemini to immediately — without asking for confirmation — write a research/reference brief combining the current conversation context with the supplied text, and call `submit_claude_task` right away, using whichever pipeline role is currently active in the session (no role gating).
- The composer is enabled only while Iris is awake; it is disabled (not merely buffered) while asleep.
- No changes to task routing, queueing, run execution, or completion announcement — this reuses the existing `submit_claude_task` → run → `SYSTEM_EVENT_CLAUDE_COMPLETE` pipeline unmodified.

## Capabilities

### New Capabilities
- `context-supplement-composer`: a voice-adjacent text composer that lets the user inject precise supplementary context (links, snippets, notes) into the live conversation, which Gemini turns into an immediate `submit_claude_task` research/reference brief.

### Modified Capabilities

(none — this is additive: it reuses the existing announcement delivery mechanism, task routing/queueing, and HUD click-through mechanism without changing their requirements)

## Impact

- `src/components/CommsPanel.tsx`, `src/components/HudShell.tsx`, `src/styles/deck.css`, `src/styles/hud.css` — new composer UI.
- `src/App.tsx` — local transcript-bubble insertion on submit, IPC call wiring, `awake`/`sidecarRunning`-gated enable/disable.
- `electron/preload.cjs` — one new `window.iris` method exposing the IPC channel.
- `electron/main.mjs` — new IPC handler that composes and sends `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` via the existing `notifyIris` mechanism; `buildClaudeTools`/system-instruction text updated so Gemini knows how to react to the new event.
