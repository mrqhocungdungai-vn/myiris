## Context

See proposal.md — Why. The constraints that shape the approach:

- **`electron/live-session.mjs` already owns the mode.** `setListenOnlyEngaged` is the single writer, and `toggleListenOnly` is what the renderer control, the tray item and the global hotkey all call directly. Anything that ends the mode has to go through that writer or there are two authorities for one state.
- **That file is 485 lines and holds no injected clock.** A deadline implemented inside it would be assertable only by booting Electron and waiting, which is the shape the repo has already rejected once.
- **There is a precedent for exactly this.** `electron/system-audio-self-test.mjs` holds "an absolute 6s deadline that re-arming does not extend", Electron-free over an injected clock, for the stated reason that the bound is then assertable without booting Electron. The listening window is the same problem at a different scale.
- **The meeting surface is wide but shallow.** 49 mentions in `capabilities/second-brain.mjs`, 22 in `meeting-capture.mjs`, 14 in `live-session.mjs`, 12 in `vault-write.mjs`, 11 in `wiring-live.mjs` — but most are comments and JSDoc. The load-bearing code is one capability block, one module, one wiring block, and one filter branch in `run-inbox.mjs`.

## Goals / Non-Goals

**Goals:**

- One disengage path, whether the user or the deadline triggers it.
- The bound is testable without Electron, without a real clock, and without waiting five minutes.
- Deleting retention leaves no orphaned plumbing behind — no callback kept alive for a consumer that no longer exists.

**Non-Goals:**

- Recording, transcoding or storing audio anywhere. That was considered and rejected on the token arithmetic in proposal.md; it is not deferred, it is out.
- Deleting or migrating files the user already has under `inbox/meetings/`.
- Any change to the silence guarantee, the system-audio mix, the gain, or the mode's independence from the microphone mute.
- Splitting `capabilities/second-brain.mjs`. It loses ~120 lines here as a side effect; that file's size is a separate problem and stays one.

## Decisions

### D1: Delete retention rather than re-found it on audio

Rejected alternative: keep the record, store PCM, replay it into the session on demand. The Live model's 131,072-token input limit at 32 tokens/second of audio caps the *entire* context at ~68 minutes, and `live-config.mjs` narrows that further — compression triggers at 104,857 tokens (~54 minutes of pure audio) and slides to 52,428. The retention that this would rescue is exactly the long-engagement case, which is the case the numbers rule out.

Rejected alternative: keep text as a searchable index over stored audio. Sound in the general case, but it only earns its complexity when the span is too long to hold in context — which a bounded window never is. Building an index for a five-minute span whose audio is still in the session is work with no consumer.

What remains is the observation that made the whole thing unnecessary: at five minutes the session still holds the audio, so "ask about what you heard" is answered by asking. The `listen-only-mode` spec already guaranteed this ("What Iris hears while the mode is engaged SHALL remain part of the conversation, so that once the mode is disengaged the user can ask about it") — retention was a second mechanism for something the first one already did, built on the weaker signal of the two.

### D2: A new pure module, `electron/listen-window.mjs`

`createListenWindow({ lengthMs, now, setTimer, clearTimer })` → `{ open, close, isOpen, remainingMs, deadlineAt }`, with the expiry callback supplied at construction. Electron-free, no `process.env`, no I/O — the env read happens in `user-config.mjs` and the resolved number is passed in, on the same terms every other policy module in this repo takes its configuration.

Alternative considered: put the timer in `live-session.mjs` next to the state it guards. Rejected for the reason in Context — the bound becomes untestable, and this file already carries the session lifecycle, reconnection, and the in-band note plumbing.

Alternative considered: drive expiry from the renderer, which is already rendering a countdown. Rejected outright: the renderer is not the authority for this state, and the `main-process-structure` and `listen-only-mode` specs both say so. A renderer that could end the mode would be a second writer, and a closed window would stop the clock that makes Iris audible again.

### D3: The deadline is absolute and activity does not extend it

Measured from the moment of engagement, never re-armed. An extending window is not a bound: continuous speech — which is precisely what this mode is pointed at — would hold it open indefinitely, restoring the unbounded case this change exists to remove. This mirrors the self-test's stated rule that re-arming does not extend its deadline.

### D4: Expiry routes through `setListenOnlyEngaged(false)`, not around it

The expiry callback calls the same writer the user's toggle calls. Everything that already hangs off that writer — the renderer push, `LISTEN_ONLY_DISENGAGE_REQUEST`, `onListenOnlyChange`, `updateTrayMenu` — then happens for free and cannot drift from the manual path. The spec requires expiry to be indistinguishable from a user toggle, and sharing the writer is what makes that true by construction rather than by two code paths agreeing.

Symmetrically, `setListenOnlyEngaged` is where the window opens and closes, so a manual disengage cancels the pending timer and no second disengage fires at the original deadline.

### D5: `IRIS_LISTEN_MAX_MINUTES`, default 5, clamped, with no unbounded value

Read in `user-config.mjs` alongside `IRIS_SYSTEM_AUDIO_GAIN` and `IRIS_LISTEN_HOTKEY`, documented in `.env.example`. Non-numeric, zero, and negative values fall back to the default rather than disabling the bound; a value above the ceiling clamps to it. There is deliberately no "0 means forever" escape hatch — that value is the behaviour being removed, and an escape hatch that restores it would make the spec's bound a suggestion.

The ceiling is 15 minutes. It is a round number well past the use case and well under the compression trigger (~54 minutes of audio), so any permitted window still leaves the whole engagement in context — which is the property the removal of retention depends on.

### D6: The renderer is sent a deadline, not a tick

`listenOnlyStatePayload()` already pushes `{ engaged, systemAudio, systemAudioGain }` on every transition. It gains the deadline (an absolute timestamp) and the window length. The renderer counts down locally from that. A per-second IPC push for a purely decorative countdown would put a timer's worth of traffic across the boundary for something the renderer can compute; the transition push is already the one authority, and one more field on it keeps it that way.

### D7: The utterance-boundary hooks go; the utterance timer stays

Verified against the code rather than assumed. `onInputTranscription` and `onUtteranceBoundary` in `live-messages.mjs` have **exactly one consumer each**, both in `wiring-live.mjs`, both meeting capture (`appendMeetingFragment`, `closeMeetingUtterance`). Both hooks are deleted with it.

The idle-timer machinery around them is **not** deleted. `closeUtterance()` does two things — `flushTranscripts()` and `onUtteranceBoundary()` — and the first is what makes the live readout near the orb update while a video plays with no turn boundary in it. That readout is a requirement this change keeps. So `noteTranscriptionFragment`, `utteranceTimer` and `closeUtterance` survive; only the `onUtteranceBoundary()` call inside `closeUtterance` and the `onInputTranscription(...)` calls go.

One of those `onInputTranscription` calls is new, added by the tool-call transcript flush landed in this repo days ago. The `appendUserTranscript(...)` beside it is the part that fix was about and it stays untouched; only the meeting feed beside it is removed.

### D8: `appendSpoolRecordTo` stays

Checked before deleting: `vault-write.mjs`'s own `appendSpoolRecord` delegates to it for the per-day spool. Only `meetingsSpoolDir` and `meetingFileFor` are meeting-specific and only those two go.

## Risks / Trade-offs

**A user who did want a long engagement loses it, with no setting to get it back.** → Accepted deliberately, and it is the point rather than a side effect. The mode was never a recorder and the numbers say it cannot become one; the ceiling is configurable up to 15 minutes for anyone who needs longer than five.

**Existing `inbox/meetings/` files become orphans — nothing writes there, nothing reads them, and the app stops mentioning them.** → They stay on disk untouched and remain plain readable markdown named by their own timestamps. Deleting a user's records as part of removing the feature that made them would be the worse failure. Called out in the spec's Migration note so it is a stated decision, not a leftover.

**An expiry timer that keeps the process alive would turn a five-minute window into a five-minute quit delay.** → `unref()` the timer, as `noteTranscriptionFragment` and the second-brain flush timers in this repo already do, and close the window in the session teardown path.

**A window whose deadline passes while the app is asleep or the session is down could make Iris audible on the next wake, or fire into a dead session.** → The window is closed by the same teardown that stops the system-audio capture, and toggling while asleep is already a no-op. The spec states this as its own scenario so it is tested rather than assumed.

**The countdown and the real deadline could drift** if the renderer's clock and main's disagree. → Cosmetic only: main owns expiry, the renderer only renders. A drifting countdown shows a wrong number for a moment; it cannot extend or shorten the window.

## Migration Plan

No data migration. No configuration migration — `IRIS_LISTEN_MAX_MINUTES` is new and its absence means the default. Rollback is `git revert`; the only durable artefact is the user's existing meeting files, which this change does not touch in either direction.
