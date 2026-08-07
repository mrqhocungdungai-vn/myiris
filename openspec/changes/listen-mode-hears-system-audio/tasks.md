## 1. Configuration and capture plumbing

- [x] 1.1 Add `IRIS_SYSTEM_AUDIO` (default on, `0` disables) and `IRIS_SYSTEM_AUDIO_GAIN` (default `0.7`) readers to `electron/user-config.mjs` following the existing `envFlag` pattern; unit-test defaults and overrides
- [x] 1.2 Document both in `.env.example` — it is the authoritative list (CLAUDE.md)
- [x] 1.3 Push the resolved `IRIS_SYSTEM_AUDIO` value to the renderer with the mode state, so the renderer never attempts a capture a main-side switch has disabled
- [x] 1.4 Append `enable-features=MacCatapLoopbackAudioForScreenShare` in `electron/main.mjs` before `app.whenReady`, skipped when `IRIS_SYSTEM_AUDIO=0`; extract the decision into a pure Electron-free helper and test the enabled/disabled cases
- [x] 1.5 Add `setDisplayMediaRequestHandler` to `electron/renderer-security.mjs` answering `{ audio: "loopback" }` — no video, no `desktopCapturer.getSources()` call, `useSystemPicker: false`
- [x] 1.6 Scope the handler: app's own frame only, resolved so it holds in a packaged `file://` build as well as dev (reuse `isAppOwnDocument` against the frame's URL, not `securityOrigin`), and denied whenever listen-only mode is not engaged, reading mode state through an injected main-side getter
- [x] 1.7 Add `display-capture` to the existing `setPermissionRequestHandler` allowlist alongside `media`/`audioCapture`/`videoCapture`
- [x] 1.8 Extend `electron/renderer-security.test.mjs`: foreign origin denied, mode-not-engaged denied, escape-hatch denied, packaged-style URL granted, and the handler never returns a video source

## 2. Asking the model to stay quiet (without touching the session)

- [x] 2.1 **Do not add a `realtimeInputConfig` key or a second profile to `electron/live-config.mjs`.** A per-mode profile reached by reconnecting was built and retired in `archive/2026-08-04-replace-listening-mode-with-listen-only`; the module's header comment says so. Add a test asserting `buildLiveConfig`'s key set is unchanged by this change
- [x] 2.2 Add the engage/disengage in-band request texts to `electron/gemini-prompts.mjs` with the other prompt text, and test them there
- [x] 2.3 Send them on each transition from `electron/live-session.mjs` with no `connect` call, using the SDK call that adds conversation content without requesting a reply — not `sendRealtimeInput`, which expects one and would provoke the very turn the request is trying to prevent
- [x] 2.4 Skip both sends when `IRIS_SYSTEM_AUDIO=0` — that path must behave exactly as before this change
- [x] 2.5 Test: no reconnect and no config rebuild on either transition; the request is sent by the non-generating call; the escape hatch sends nothing

## 3. Keeping Iris silent

- [x] 3.1 Discard reply turns while engaged: suppress reply text from the transcript, from any speaking indication, and from retention — audio is already dropped by `shouldDropChunk`
- [x] 3.2 Remove the `setListenOnlyEngaged(false)` call at `electron/live-session.mjs:272` so exhausted reconnects no longer un-suppress audio; the mode is cleared by explicit user stop only
- [x] 3.3 Ensure the welcome greeting cannot fire into an engaged mode — check `GreetGate.arm()`'s interaction with a re-established session while the mode is engaged
- [x] 3.4 Test: a reply arriving while engaged reaches nothing; exhausted reconnects leave the mode engaged; a re-established session speaks no greeting while engaged

## 3b. Refusing to act on what the mode overhears

Found during manual testing, not in the original plan: silence was enforced on
replies but tool calls dispatched regardless, so a YouTube video saying "just
ask your agent to install the concept diagram skill" started a billed Claude
run while Iris was deliberately silent.

- [x] 3b.1 Refuse every tool call in `electron/live-messages.mjs` while the mode is engaged, checked before dispatch — by the time a verb runs it has already cost money and may already have written
- [x] 3b.2 Refuse ALL tools rather than allowlisting the harmless ones: while engaged the user is not addressing Iris, so no request is legitimate and an allowlist only has to be wrong once
- [x] 3b.3 Answer the refusal back to the session so the model is not left waiting, and report each one — a silent refusal is its own kind of wrong
- [x] 3b.4 Add "call no tools" to the in-band engage request as a cost reduction; the client-side refusal remains the guarantee
- [x] 3b.5 Add the requirement to the `listen-only-mode` delta spec — this is behaviour, not an implementation detail
- [x] 3b.6 Test: a tool call while engaged executes nothing, is answered and reported, covers every tool name, and dispatches normally once the mode ends

## 3c. Not attributing what she overhears to the user

Also found by running it: the transcript labelled system audio as "You". Correct
before this change — Iris only heard the microphone — and a false statement about
the user's own words after it.

- [x] 3c.1 Push the attribution from main with the mode state: `renderer-bridge.mjs` takes the speaker label as an injected thunk rather than hardcoding `"you"`
- [x] 3c.2 Add a third displayed voice, `heard`, in ONE shared decision (`src/lib/transcript-speaker.ts`) so the deck and the HUD cannot disagree about whose words the user is reading
- [x] 3c.3 Do NOT guess which source a line came from — the two are summed in the worklet and are unseparable, and a wrong guess is worse than no attribution
- [x] 3c.4 Stop the speech-lock ripple firing for overheard input; it means "your speech just locked in"
- [x] 3c.5 Keep overheard speech out of `recentUtterances` — every consumer renders that ring into a run prompt as "what the user said recently", and it outlives the mode by up to 10 minutes
- [x] 3c.6 Add the requirement to the `listen-only-mode` delta spec
- [x] 3c.7 Test: the overheard id can never match the self test, the label is read at flush time, the ring stays clean, buffers still clear, and ordinary conversation is unchanged

## 4. Renderer capture and mixing

- [x] 4.1 In `src/hooks/useAudioPipeline.ts`, acquire the loopback stream with `getDisplayMedia({ video: false, audio: true })` and sum it into the existing worklet through a `GainNode` at the configured gain
- [x] 4.2 Construct the `AudioWorkletNode` with `channelCount: 1, channelCountMode: "explicit"` so a stereo source is down-mixed rather than having its right channel dropped by `mic-downsample.js:37`
- [x] 4.3 Give the mix headroom (mic below unity) instead of relying on the worklet's existing clamp, which is clipping by another name; leave the clamp as the last resort
- [x] 4.4 Add explicit refs for the loopback stream/source/gain nodes and tear them down in `stopCapture()`, so a mic hot-swap via `restartCapture` does not leak a live capture or silently lose system audio
- [x] 4.5 Re-acquire the loopback branch in `startCapture()` when the mode is engaged, so a device swap restores it
- [x] 4.6 Extract the mix decision (which sources are live, what gain each carries, what the resulting state is) into a pure tested function alongside `shouldDropChunk`
- [x] 4.7 Handle window close with the mode engaged: main must not keep the mode engaged with no renderer, capture, or retention behind it

## 5. Capture liveness and degradation

- [x] 5.1 Attach an `AnalyserNode` to the loopback branch and treat bit-exact-zero RMS over a short window after engage as a failed capture — this is the failure that actually occurs; acquisition succeeding proves nothing
- [x] 5.2 Treat `ended` the same way, and in both cases drop only the system-audio source: mode stays engaged, Iris stays silent, mic keeps flowing
- [x] 5.3 Surface the degraded state persistently and record the failure
- [x] 5.4 Extract the liveness decision into a pure tested function (samples in, verdict out) so the threshold behaviour is testable without Web Audio
- [x] 5.5 Test: all-zero samples yield a failed verdict; a normal signal does not; degradation never disengages the mode

## 6. Meeting retention

- [x] 6.1 Add `meetingsSpoolDir(vaultDir)` → `inbox/meetings/` to `electron/vault-write.mjs`; assert in a test that `vault-graph-parse.mjs`'s `inbox/` exclusion already covers it
- [x] 6.2 Write one file per engagement rather than appending into a per-day file, so a single meeting can be identified and deleted
- [x] 6.3 Feed retention from `inputAudioTranscription` fragments directly, NOT from `recentUtterances` — that ring is capped at 40 entries / 10 minutes and flushed on a 30s timer, so a busy meeting loses whatever is pruned between flushes; its bounds are a privacy property and must not be raised
- [x] 6.3a Mark meeting records as their own spool kind, distinct from captures and run outcomes, per `personal-knowledge-notes`' requirement that each kind be distinguishable — this is what lets a later Claude verb read a meeting on its own terms
- [x] 6.4 Add a `renderMeetingBlock()` whose header names the wider source: room speech and audio the machine played
- [x] 6.5 Drive retention from the mode alone: start on engage, flush progressively, flush-and-stop on disengage and on session end, independent of the ambient-capture preference
- [x] 6.6 Make ambient capture yield the span: while the mode is engaged its watermark advances without writing, and it resumes afterwards without back-filling
- [x] 6.7 Keep the never-throws discipline and write-at-most-once watermark
- [x] 6.8 Add `inbox/meetings/` to the inbox backlog list in `second-brain.mjs` so meeting records are offered for curation
- [x] 6.9 Test: retention with no turns taken still produces a record; two engagements produce two files; ambient capture writes nothing for the span; repeated flushes do not duplicate; a failed write is reported

## 7. Interface

- [x] 7.1 First-run consent notice on the first engage: what is retained, that it may include other people, and where it is written
- [x] 7.2 Persistent degraded indication on the headphone control in `CenterStage.tsx` and `HudShell.tsx`
- [x] 7.3 Headphone advisory on engage when output is going to speakers (`enumerateDevices` on `audiooutput`); non-blocking
- [x] 7.4 Replace the silent-reply orb state with the listening-mode state, held for the duration of the mode rather than a turn
- [x] 7.5 Update the tray label in `electron/window.mjs` and the control tooltips
- [x] 7.6 Verify the existing HUD transcript open/restore behaviour still holds — now showing input transcription rather than Iris's replies

## 8. Measurement (required before archive)

- [ ] 8.1 **Go/no-go:** confirm `inputAudioTranscription` keeps arriving over a 10-minute continuous-audio engagement, so `inbox/meetings/` fills. The whole retention path depends on it
- [ ] 8.2 Record the token cost of the reply turns generated and discarded over that engagement. The cost is accepted, not unknown — but the number decides whether it stays accepted
- [x] 8.3 Disengage and ask about the played content; confirm Iris answers from that context
- [ ] 8.4 Measure a real meeting with headphones; record whether `0.7` and the mic headroom are right, and adjust the documented defaults
- [ ] 8.5 Measure alignment between the two branches — Chromium delays the mic when using system loopback as an AEC reference, so check whether a compensating delay on the loopback branch is needed for coherent transcription
- [ ] 8.6 Over a 60-minute engagement, record main-process event-loop lag (p95), RSS delta, and battery draw; the rate is unchanged but the duration is new
- [ ] 8.7 Write the numbers from 8.1–8.6 into the change directory before archiving

## 9. Manual acceptance (not covered by the five gates)

`vitest.config.mjs` runs `environment: "node"` and includes only `electron/**/*.test.mjs` and `src/**/*.test.ts` — no jsdom, no `.tsx`. The Web Audio graph, the React hook, and every §7 item are therefore unreachable by automated test and are verified here instead.

- [ ] 9.1 Engage the mode; confirm system audio reaches Iris and the transcript fills
- [x] 9.2 Mute the mic while engaged; confirm Iris still hears the meeting
- [x] 9.3 Swap the mic device mid-engagement; confirm system audio survives and no capture leaks (recording indicator clears when expected)
- [ ] 9.4 Engage from the tray item and from the global hotkey; confirm both start capture
- [ ] 9.5 Run in a `npm run package:mac:host` build and confirm capture works there, not only in dev
- [ ] 9.6 Confirm the first-run consent notice, degraded indication, headphone advisory, and orb state all render correctly in both deck and HUD

## 10. Docs and gates

- [x] 10.1 Update `docs/ARCHITECTURE.md`'s listen-only section, its Purpose framing, and the `CLAUDE.md` router line — the mode's meaning has changed
- [x] 10.2 Document in `docs/PIPELINE_GUIDE.md`: macOS 14.2+, the one-time system prompt with no relaunch needed, and that macOS displays its screen-recording indicator for the whole engagement even though Iris captures no video
- [x] 10.3 Run all five gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`
