## Why

Iris only ever hears the microphone. So the one situation where a second pair of
ears would matter most — a meeting, a call, a video the user is watching — is the
one situation Iris is deaf to: the remote participants' voices reach the user's
speakers and never reach Iris. The user has to relay by hand what was just said,
which is exactly the labour the app exists to remove.

Listen-only mode already means "Iris, be quiet" — a mode the user engages
deliberately, at the start of exactly those situations. That makes it the right
place to hang this, and measurement makes it the *only* safe place: system-audio
loopback demonstrably captures this app's own output, and Chromium's
`restrictOwnAudio` constraint is accepted but has no effect on macOS 15. A mode
where Iris is silent is the only mode where that capture is clean.

## What Changes

- **BREAKING** — Listen-only mode becomes a **meeting mode**. Engaging it now
  additionally captures system audio (loopback) and mixes it into the single
  realtime stream sent to Gemini Live, alongside the microphone.
- **BREAKING** — Iris is **completely silent** while the mode is engaged. Nothing
  she produces reaches the user as sound or as text. Turns still happen behind the
  scenes — activity detection keeps closing them whenever speakers pause, which is
  what keeps the transcript flowing — but every reply is discarded at the client.
- The session is **still never reconnected or reconfigured** on either transition,
  and its activity detection is left exactly as it is. Silence is reached by
  discarding replies at the client, plus an in-band request to the model that is
  a cost reduction rather than the mechanism. A per-mode session profile reached
  by reconnecting was built, used, and retired in this app
  (`archive/2026-08-04-replace-listening-mode-with-listen-only`); this change does
  not rebuild it.
- Everything Iris hears while engaged is written to a new vault area,
  **`inbox/meetings/`**, gated on the mode rather than on the ambient-capture
  preference — engaging the mode *is* the consent point, stated as such the first
  time. **That record is the point of the feature**: making sense of a meeting is
  work for a Claude verb reading the file afterwards, where there is a real
  context window and no realtime constraint, not for the voice layer mid-call.
- Microphone mute stays independent: with the mic muted and the mode engaged,
  Iris still hears the speakers.
- With the mode disengaged, nothing changes — Iris hears the microphone only, and
  no loopback stream is ever opened.
- A capture that goes silent or dies mid-session degrades to microphone-only; the
  mode stays engaged, so Iris never becomes audible in the middle of a meeting.
  Exhausting the session's reconnect attempts no longer disengages the mode
  either — today it does, which would make Iris speak aloud into a call.
- New env vars: `IRIS_SYSTEM_AUDIO=0` (restores the pre-change listen-only
  behaviour entirely) and `IRIS_SYSTEM_AUDIO_GAIN` (default `0.7`).

## Capabilities

### New Capabilities

None. This extends existing capabilities rather than introducing one — the
behaviour belongs to the mode that already exists, which is the substance of the
change.

### Modified Capabilities

- `listen-only-mode`: the mode gains a second audio source and loses Iris's voice
  entirely. The never-reconnect requirement is strengthened rather than removed —
  it now also forbids changing activity-detection configuration. The
  silent-reply-presentation requirement is removed; requirements for system-audio
  capture, enforced silence, capture liveness, meeting retention, and the escape
  hatch are added.
- `ambient-session-capture`: the "SHALL NOT introduce any new destination" and
  "capture follows the microphone" requirements are amended — `inbox/meetings/` is
  a second destination on a second consent basis, and what is retained now
  includes audio the machine played rather than only what the microphone heard.
- `renderer-content-security`: device-permission scoping gains a third capture
  surface. System-audio capture is audio-only and must be origin-scoped and
  refused whenever the mode that justifies it is not engaged.
- `orb-expressions`: the silent-reply state is removed, since the mode no longer
  produces replies; its cool accent is reassigned to the engaged-and-listening
  state.

## Impact

**Main process** — `main.mjs` (one Chromium feature switch, before
`app.whenReady`); `renderer-security.mjs` (`setDisplayMediaRequestHandler`,
origin- and mode-scoped); `live-session.mjs` (in-band requests, the
reconnect-exhausted fix, meeting-retention lifecycle); `live-messages.mjs`
(discarding reply turns); `gemini-prompts.mjs` (the two request texts);
`window.mjs` (tray label); `session-capture.mjs` + `vault-write.mjs` +
`renderer-bridge.mjs` (the `inbox/meetings/` area and its transcription feed).

**Renderer** — `useAudioPipeline.ts` (second source, mixer, liveness detection,
teardown); `src/worklets/mic-downsample.js`; `CenterStage.tsx` + `HudShell.tsx`
(degraded indication, first-run consent notice).

**Configuration** — `.env.example` gains `IRIS_SYSTEM_AUDIO` and
`IRIS_SYSTEM_AUDIO_GAIN`.

**Platform** — **macOS 14.2+** for loopback capture (the app is macOS-only
already). Verified to require **no** Screen Recording permission and **no**
relaunch after the one-time system prompt. macOS does display its
screen-recording indicator for the whole capture, which cannot be avoided on this
mechanism.

**Docs** — `docs/ARCHITECTURE.md` (listen-only section), `docs/PIPELINE_GUIDE.md`
(the indicator, the platform floor), `CLAUDE.md` router line.

**Measured before archiving, not assumed**: that transcription keeps arriving
across a long engagement so the record actually fills, and what the discarded
reply turns cost — a cost accepted deliberately, but not yet quantified.
