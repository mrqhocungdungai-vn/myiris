## Why

Listen-only mode retains what Iris hears to `inbox/meetings/`, and it builds that
record out of raw `inputAudioTranscription` fragments — the **least reliable thing
the Live session produces**. Gemini Live's audio in and audio out are accurate; its
transcription text routinely is not. So the one artifact meant to survive the
engagement is a lossy copy of speech the session itself already holds correctly.

The obvious repair — store the audio and hand it back to the session when the user
asks — does not work at meeting length. `gemini-3.1-flash-live-preview` has a
131,072-token input limit and audio costs 32 tokens per second, so ~68 minutes is
the ceiling for the *entire* context, system instruction and conversation included.
`electron/live-config.mjs` narrows that further on purpose: compression triggers at
104,857 tokens (~54 minutes of pure audio) and slides down to 52,428 (~27 minutes).
An hour of meeting audio is evicted before anyone can ask about it.

Which exposes the real error: **Iris was never the right place to record a meeting.**
The need this mode actually serves is small and short — hear the question the person
across the table (or on the call) is asking, then go find the answer. At that
length the problem dissolves. Five minutes of audio is ~9,600 tokens, far below the
compression trigger, so the session still holds the **original audio** — the form
that was accurate all along. Asking it again is just asking. No file needs to exist.

So this change does not replace the retention mechanism. It **deletes** it, and
bounds the mode to the span it was always for.

## What Changes

- **BREAKING**: Listen-only mode no longer retains anything. `inbox/meetings/` is
  never written, the per-engagement meeting record is gone, and the
  `SYSTEM_EVENT_MEETING_RECORDED` note is no longer sent to the session. Existing
  files under `inbox/meetings/` are left alone — they are the user's, and nothing
  in the app will delete them.
- **BREAKING**: The mode now ends on its own. A bounded listening window opens when
  the mode engages and closes at an **absolute** deadline measured from that moment;
  when it closes, the mode disengages exactly as if the user had toggled it off.
  This reverses the current rule that nothing but the user may disengage the mode.
- The window's length is `IRIS_LISTEN_MAX_MINUTES`, default **5**, clamped to a
  ceiling. There is deliberately no unbounded setting — the unbounded case is what
  this change removes.
- Continued speech does **not** extend the deadline. A window that renews itself
  while someone keeps talking is not a window.
- The renderer shows the remaining time. Iris is silent while engaged, so she
  cannot warn by voice; the countdown is the warning.
- **Unchanged**: the silence guarantee, system-audio capture and its mix, the gain,
  stereo handling, and the mode's independence from the microphone mute. System
  audio is why the mode is worth having — the person asking may be on a call.

## Capabilities

### New Capabilities

None. The bounded window is a property of the existing mode, not a separate
capability — giving it its own spec would split one behaviour across two files.

### Modified Capabilities

- `listen-only-mode`: removes the retention requirement entirely; replaces
  "nothing disengages the mode except the user" with a rule that admits exactly one
  additional terminator (the window's deadline) and no others; adds the bounded
  listening window and its scenarios.
- `ambient-session-capture`: its yielding rule survives but its *reason* changes.
  Today ambient capture stands aside because "the mode's retention owns that span."
  With no such retention, it stands aside because the span is **wider than this
  consent covers** — while engaged, Iris also hears whatever the machine plays,
  which is other people's speech. That must not land in the session spool under a
  preference the user gave for their own conversations. The consequence is that the
  span is retained by **nobody**, and the scenario asserting the mode's retention
  continues is now false.

`session-announcements` mentions listen-only mode but only in terms of delivery
while engaged, which is untouched. No delta.

## Impact

**Deleted**: `electron/meeting-capture.mjs` and its test; `meetingsSpoolDir` and
`meetingFileFor` in `electron/vault-write.mjs`; the meeting-capture block in
`electron/capabilities/second-brain.mjs` (~10 functions, its share of teardown, and
the ambient predicate's dependence on it); `meetingRecordNote` in
`electron/gemini-prompts.mjs`; `announceMeetingRecord` in
`electron/live-session.mjs`; the meeting lifecycle wiring in
`electron/wiring-live.mjs`; the `meeting-*.md` branch of the inbox backlog filter in
`electron/run-inbox.mjs`.

**Added**: `electron/listen-window.mjs` — the deadline, pure and over an injected
clock, in the same shape as `electron/system-audio-self-test.mjs`, whose absolute
6-second bound is assertable without booting Electron for the same reason.

**Modified**: `electron/live-session.mjs` (drives the window from
`setListenOnlyEngaged`), `electron/user-config.mjs` (reads
`IRIS_LISTEN_MAX_MINUTES`), `electron/live-messages.mjs` (the tool refusal string
still calls this a meeting), `src/components/ListenOnlyNotice.tsx` (the countdown),
`.env.example`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `README.md`,
`docs/PIPELINE_GUIDE.md`.

**Not touched**: `openspec/changes/archive/**`. It is history and stays wrong on
purpose.
