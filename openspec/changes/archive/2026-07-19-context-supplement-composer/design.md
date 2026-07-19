## Context

Iris is voice/gesture-only today: `src/App.tsx` has zero `<input>`/`<textarea>` elements. Precise text (a repo URL, a snippet) can only reach the app via unreliable voice dictation. The existing dual-surface UI (`CommsPanel` in the deck, the collapsible Comms island in `HudShell` for the Glass HUD) already renders a transcript of spoken turns as `.bubble` elements, and the main process already has one shared mechanism for pushing state into the live Gemini session — `notifyIris` / the `SYSTEM_EVENT_*` convention (`SESSION_START`, `WORKSPACE_UPDATE`, `AGENT_SELECT`, `PO_QUESTION`) — documented in `openspec/specs/session-announcements/spec.md`. Task routing (`submit_claude_task` → `runQueue` → completion announcement) is untouched by this change; the composer only ever adds one more thing for Gemini to react to, through the same door everything else already uses.

## Goals / Non-Goals

**Goals:**
- Let the user inject precise supplementary text (a link, a snippet, a note) mid-conversation, from both the deck and the Glass HUD, without relying on voice dictation.
- Have Gemini treat a submitted supplement as an immediate, decisive signal: synthesize a research/reference brief from the current conversation + the supplement, and call `submit_claude_task` right away — no confirmation question, no new user action required.
- Reuse the existing pipeline (routing, queueing, run execution, completion announcement) entirely unchanged.

**Non-Goals:**
- No URL validation, link preview, or fetching inside Iris itself — Claude's own tools (already granted `bypassPermissions` + full toolset) do the actual fetching/research once the task is dispatched.
- No pipeline-role gating — the composer works identically regardless of whether PO, DEV, or no role is active.
- No buffering of a submission made while Iris is asleep — the input is disabled outright, not queued.
- No multi-line composition, send button, attachment history, or persistence beyond the live transcript.
- No changes to `submit_claude_task`, `runQueue`, or the completion/announcement pipeline.

## Decisions

**1. Delivery via a new `SYSTEM_EVENT_CONTEXT_SUPPLEMENT`, not deterministic server-side stitching.**
The submitted text is injected into the live Gemini session through `notifyIris`, exactly like every other `SYSTEM_EVENT_*`, with an `instructions_to_iris` block telling Gemini to write the brief and call `submit_claude_task` immediately. Alternative considered: have `main.mjs` deterministically hold the text as a "pending attachment" and auto-append it to the very next `submit_claude_task` call. Rejected — it introduces a second, parallel stitching mechanism alongside the proven `SYSTEM_EVENT_*` convention, and raises an unnecessary question of when a pending attachment should be considered "consumed."

**2. Generic freeform single-line text field, not URL-validated.**
Any pasted/typed text is accepted as-is. Validating for URL shape would add logic for no real benefit — the use case (a link today, other precise text tomorrow) doesn't require the field to police its own content; Gemini and Claude are already expected to interpret free text.

**3. No pipeline-role gating; the composer works the same everywhere.**
The event does not carry (or force) a role — `submit_claude_task`'s existing "omit `agent`, use the session's active role" default behavior is left untouched, so the brief is routed to whatever role the user already has selected (PO, DEV, or none).

**4. Client-rendered transcript bubble, independent of Gemini's speech transcription.**
On submit, the renderer immediately pushes a new `TranscriptLine` with a "you"-identifying speaker string, so it renders via the existing `self` bubble path (`/you|user/i.test(line.speaker)`) with zero changes to the bubble-rendering logic in either `CommsPanel` or `HudShell`. This is a client-side echo, not something derived from `inputAudioTranscription` — it exists purely to give the user visual confirmation of what was sent.

**5. Single-line input, Enter-to-send, no send button.**
Matches the app's minimal-chrome, voice-first design language and the composer's intended scope (short supplements, not long-form composition).

**6. Disabled (not buffered) while asleep.**
The composer is disabled whenever the same `awake`/`sidecarRunning` flag that already gates the mic/orb controls is false. Unlike every other `SYSTEM_EVENT_*`, this one is never sent while disconnected — there is nothing to buffer because the UI already prevents submission in that state. The IPC handler calls `notifyIris` with buffering intentionally turned off for this event.

**7. One shared composer component, rendered in both the deck and the HUD.**
`CommsPanel` and the Comms island inside `HudShell` both mount the same presentational component (new, e.g. `src/components/ContextSupplementInput.tsx`) rather than two independent implementations, so the two surfaces cannot drift apart. In the HUD it sits inside the existing collapsible Comms island (same place the transcript already lives), gated behind the same `.hud-hit` treatment so it participates in HUD click-through correctly.

## Risks / Trade-offs

- **[Risk]** Gemini may not always synthesize a strong research brief purely from an `instructions_to_iris` nudge. → **Mitigation**: word the instruction with the same explicit, decisive framing (`CRITICAL: be decisive`, "do not ask clarifying questions") already proven to work for every other `submit_claude_task` trigger in the live system instruction.
- **[Risk]** With no role gating, a supplement sent while no pipeline role is active still fires a generic Claude task, potentially with a thin brief. → **Mitigation**: acceptable — identical to how any other spoken request is already routed today; not a new failure mode.
- **[Risk]** Disabling-without-buffering means a supplement typed in the instant Iris falls asleep could be silently lost. → **Mitigation**: accepted by explicit user decision; the input's disabled state is driven by the same flag already used to gate mic controls, so the race window matches an existing, already-accepted one.
- **[Risk]** Two composer mounts (deck + HUD) could drift in behavior over time. → **Mitigation**: single shared component, not a duplicated implementation.

## Migration Plan

Purely additive — no existing behavior changes, no feature flag needed. Removable by deleting the new component, the new IPC channel, and the new `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` branch if ever needed.

## Open Questions

- Exact wording of the `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` instruction block is an implementation detail to finalize while coding, following the existing `announceAgentSelection`/`askUserQuestionViaVoice` phrasing style.
- Assumes headless Claude (PO/DEV, `bypassPermissions`) already has working network/fetch tools to actually research a submitted link — consistent with existing capability, not newly introduced here, but worth a smoke check during implementation.
