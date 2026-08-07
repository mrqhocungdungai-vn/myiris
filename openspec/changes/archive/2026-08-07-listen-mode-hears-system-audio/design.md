## Context

See proposal.md — Why.

**Everything below marked [M] was measured on this machine** (macOS 15.7.8,
Electron 42.5.0, Chromium 148.0.7778.271) with a throwaway spike, not inferred
from documentation. An earlier revision of this design was built on community
write-ups and got the mechanism, the permission model, and the failure mode all
wrong; the measurements replaced them.

- **[M] The capture mechanism is smaller than expected.** A handler answering
  `{ audio: "loopback" }` plus `getDisplayMedia({ video: false, audio: true })`
  yields a live, non-silent, 48 kHz **mono** track. No screen source, no video
  track to discard, no `desktopCapturer.getSources()` call.
- **[M] No Screen Recording permission is involved.** `getMediaAccessStatus("screen")`
  read `denied` throughout every successful capture. macOS prompts once, for its
  own system-audio consent, and the grant sticks — no relaunch, no re-prompt.
- **[M] No transient user activation is required.** `executeJavaScript(..., false)`
  acquired the stream, so the tray item and the global hotkey can start capture.
- **[M] The capture is genuinely system-wide, and includes this app.** A separate
  process (`afplay`) registered at RMS 0.378; this app's own renderer registered
  at 0.396. Requesting `restrictOwnAudio: true` is accepted and reported back as
  `true` in `getSettings()` — **and has no effect**; own audio still arrives at
  full level.
- **[M] Blocking Catap reproduces the silent-stream failure exactly.** With
  `--disable-features=MacCatapLoopbackAudioForScreenShare`, `getDisplayMedia`
  still resolves and a track is still created, but every sample is bit-exact zero
  and the track later ends. Silence reads as RMS `0`; a working capture never did.
- **[M] macOS shows its screen-recording indicator** for the entire capture, on
  the Catap path, with no video involved. It is not avoidable by feature flag.
- **[V] The session already reconnects constantly.** `live-session.mjs:71`:
  "Gemini Live closes each WebSocket connection after ~10 minutes… on close we
  reconnect with the latest handle so the conversation continues seamlessly."
- **[V] Exhausting reconnects disengages the mode.** `live-session.mjs:272` calls
  `setListenOnlyEngaged(false)`, which un-suppresses audio — i.e. today's code
  can make Iris audible mid-meeting after a network blip.
- **[V] The retention source is turn-gated.** `recentUtterances` is written only
  by `flushTranscripts()`, called only on `turnComplete`/`interrupted`
  (`live-messages.mjs:109-112`), and bounded at 40 entries / 10 minutes
  (`renderer-bridge.mjs:17-18`).

## Goals / Non-Goals

**Goals:**

- Add the second source without changing the shape of what crosses IPC — one
  mixed PCM stream, exactly as today.
- Make silence and retention compatible. They are in direct conflict under a
  turn-gated transcript, and resolving that is the point of D3.
- Keep every failure mode ending in "Iris is still silent."
- Detect the failure that actually happens (a live track of zeroes), not the one
  that is easy to imagine (a rejected promise).
- Put decisions in Electron-free modules with injected dependencies
  (`main-process-structure`); keep media APIs at the edges.

**Non-Goals:**

- Signal processing to undo speaker bleed — no ducking, no source switching.
- Speaker diarisation. One mixed stream yields one transcription; the boundary is
  recorded per span, never per utterance.
- Summarising or curating the meeting record. `inbox/meetings/` holds raw
  transcript; curation is the curator's job.
- Code signing / notarisation. The chosen mechanism needs no entitlement.
- Removing the macOS screen-recording indicator. Measured as unavoidable here.

## Decisions

### D1 — Audio-only loopback via Catap, explicitly enabled

`app.commandLine.appendSwitch("enable-features", "MacCatapLoopbackAudioForScreenShare")`
before `app.whenReady`, a handler returning `{ audio: "loopback" }`, and
`getDisplayMedia({ video: false, audio: true })` in the renderer.

The feature is currently default-on, so the switch looks redundant. It is not:
[M] blocking it produces a silent stream rather than an error, so a future
Chromium that flips the default would break this feature **invisibly**. Naming it
explicitly converts a silent regression into one that at least fails the same way
every time, and documents which path we depend on.

*Alternatives considered.* A bundled Swift Core Audio tap was rejected earlier on
the grounds that it needs an entitlement and therefore hardened runtime and
signing. That reasoning was never tested and is now moot — the Chromium path
needs no permission of ours at all. The one thing a native tap might still buy is
removing the screen-recording indicator, which [M] this path does display. That
is a real cost, judged not worth building a signing and notarisation pipeline for.
A virtual audio driver (BlackHole) remains rejected: Iris installs nothing.

*Platform floor:* macOS 14.2+, the Catap requirement. Up from the 13+ this design
previously claimed.

### D2 — Mix in the renderer's input `AudioContext`, one worklet, one chunk stream

Both sources become nodes in the existing input context: the mic at unity, the
loopback stream through a `GainNode` at `IRIS_SYSTEM_AUDIO_GAIN`, summed into the
existing `mic-downsample` worklet. `sendAudioChunk`, the IPC channel,
`live-messages.mjs` and the chunk format are untouched.

Three properties fall out rather than being engineered: the browser resamples the
loopback stream to the context rate; muting the mic (`track.enabled = false`)
silences one branch while the other keeps flowing, which is the
mic-muted-still-hears-the-meeting requirement; and dropping a dead loopback source
is one `disconnect()`.

*Channel count is pinned explicitly.* [M] The track is mono with default
processing but **stereo** when `echoCancellation`/`noiseSuppression`/
`autoGainControl` are disabled. The worklet reads `inputs[0][0]` only
(`mic-downsample.js:37`), so a stereo input would silently discard the right
channel. The `AudioWorkletNode` is therefore constructed with
`channelCount: 1, channelCountMode: "explicit"`, which forces a proper
`0.5*(L+R)` down-mix regardless of which processing settings a future change picks.

*Headroom, not clamping.* The worklet already clamps
(`mic-downsample.js:15,29`), and clamping **is** clipping — it adds harmonic
distortion, which degrades transcription. With `autoGainControl: true` on the mic
(`useAudioPipeline.ts:99`) normalising toward full scale, unity mic + 0.7 system
exceeds 1.0 whenever both are active, which in a meeting is most of the time. The
mic branch therefore also carries a gain below unity, and the sum is measured
rather than assumed.

### D3 — The session is never reconnected or reconfigured, and VAD is left alone

`buildLiveConfig` keeps its single profile with no `realtimeInputConfig` key.
Engaging and disengaging send an in-band client text turn asking the model to
stay silent; nothing about the transport or the session configuration changes.

*This was decided once, reversed, and reversed back on evidence.* The reversal
argued that reconnecting is nearly free because [V] the session already reconnects
about six times an hour, so a meeting profile could disable activity detection and
stop the model generating replies that get discarded.

That argument is answered by the project's own history.
`openspec/changes/archive/2026-08-04-replace-listening-mode-with-listen-only/`
retired a feature that did **exactly** this — "a main-process session
reconfiguration … tearing down the Gemini Live socket and reconnecting with a
different config profile (empty tool set, **automatic activity detection
disabled**)". Its stated verdict: *"the reconnect is not worth what it buys. The
one thing listening mode does that speaker mute cannot — keep Iris from
interjecting during a long monologue — is worth less than the disruption of
switching in and out of it."*

That is the same mechanism, sold on the same benefit, already tried in this app
and already rejected from use. Rebuilding it two days after it was deleted
requires new evidence, and there is none — the reconnect-cadence fact was true but
does not touch the finding, which was about the seam a *deliberate* transition
puts in a conversation, not about the transport's cost.

*What follows from leaving VAD on.* Activity detection keeps committing turns
whenever speakers pause, which is the normal rhythm of a meeting. The model keeps
being asked for a reply and keeps producing one that is discarded. **That cost is
accepted deliberately**, not overlooked: it is the price of not reintroducing a
retired mechanism, and it buys a working transcript as a side effect, since turns
completing is what drives the transcription flush.

*What this means for the design's ambitions.* The mode is not trying to make
Gemini a good meeting analyst in real time. It captures. Synthesis happens
afterwards, from the record, through a Claude verb — see D11.

### D4 — Every failure ends in "still silent, still engaged"

| Failure | Behaviour |
| --- | --- |
| `getDisplayMedia` rejects | Mode does not engage; the user is told. No permission story — [M] there is nothing of ours to grant. |
| Capture yields silence (D5) | Mode **stays** engaged, mic-only, degraded indication. |
| Track `ended` | Same as above. |
| Session reconnects exhausted | Mode **stays** engaged. **This is a behaviour change**: `live-session.mjs:272` currently disengages, which un-suppresses audio and makes Iris speak aloud into a call after a network blip. |

The asymmetry is deliberate and is the design's most load-bearing choice.
Refusing to engage costs a retry. Auto-disengaging mid-meeting makes Iris audible
in a room where the user engaged the mode specifically so she would not be, at a
moment when they are not looking at the screen.

*Where the gate lives:* `live-session.mjs`, alongside `setListenOnlyEngaged` —
the one place all three control surfaces already funnel through.

### D5 — Detect silence, not rejection

An `AnalyserNode` on the loopback branch; if RMS is bit-exact zero for a few
seconds after engage, the capture is treated as failed.

[M] This is the failure that actually occurs. With the Catap path blocked,
`getDisplayMedia` resolved, the track was created and reported `live`, and every
sample was zero. A rejection-based check sees nothing wrong. [M] The detector is
unambiguous: a working capture never read exactly zero across a window, and true
silence read exactly zero, so the threshold needs no tuning.

The previous design probed `getMediaAccessStatus("screen")` before engaging.
[M] That call reports `denied` on a machine where capture works perfectly — it
answers a different question — so the probe is removed entirely, along with the
fail-closed permission gate, the System Settings link, and the relaunch message
that were built on it.

### D6 — Activity detection is untouched, and its behaviour is a feature here

Folded into D3. No `realtimeInputConfig` is set, for the mode or otherwise.

The concern that VAD would misbehave against near-continuous audio is real but
inverted in consequence. When speakers pause — which they do constantly in a
meeting — VAD commits end-of-speech and the turn closes. That is what makes the
transcription flush fire, which is what fills the record. The mechanism that
looked like the risk is the one carrying the payload.

What it costs is a discarded reply per turn. What it would cost to avoid is
rebuilding a retired feature. The trade is made knowingly, and 8.2 measures the
number rather than leaving it as a feeling.

### D7 — `inbox/meetings/`, mode-gated, fed from transcription directly

A fourth area alongside `captures/`, `runs/`, `sessions/` — inside `inbox/`, so
`vault-graph-parse.mjs`'s existing exclusion keeps it out of the galaxy with no
new code ([V] `NOTES_PLUMBING_FOLDERS` matches on `segments[0]`).

*It does not reuse the ambient ring.* [V] `recentUtterances` is capped at 40
entries and 10 minutes (`renderer-bridge.mjs:17-18`) and is flushed on a 30-second
timer. Turns do complete under D3, so the ring does fill — but a multi-speaker
meeting can easily produce more than 40 utterances between two flushes, and
anything pruned in between is gone permanently. Meeting retention therefore
consumes `inputAudioTranscription` fragments directly and flushes on its own
schedule. Raising the ring's bounds is not an option — they are a stated privacy
property (`renderer-bridge.mjs:13-16`).

*One record, one consent basis.* While the mode is engaged, meeting retention owns
the utterances and ambient capture's watermark advances past them without writing.
Otherwise both would write the same speech to two places under two different
consents, which makes "delete what I recorded" unanswerable.

*Per engagement, not per day.* `vault-write.mjs:29-32` appends to a per-day file.
A meeting is not a day, and D7's whole argument is that a record must be
identifiable if consent is withdrawn — so meeting retention writes one file per
engagement.

*The consent expansion is real and named.* `ambient-session-capture` forbade a
second destination; the delta amends it rather than routing around it, because
engaging the mode is a deliberate, indicated, per-session act.

### D8 — Two env vars, both documented in `.env.example`

`IRIS_SYSTEM_AUDIO` (`0` disables the system-audio half entirely, restoring
pre-change behaviour including no reconnect-on-toggle) and
`IRIS_SYSTEM_AUDIO_GAIN` (default `0.7`). Follows the `IRIS_ALLOW_ANY_PLATFORM` /
`IRIS_SKIP_HOOKS` precedent. Main owns the flag but the capture lives in the
renderer, so the resolved value is pushed to the renderer rather than read twice.

### D9 — The retired silent-reply accent is reused

Removing the silent-reply state frees the cool accent it reserved; it now marks
"engaged and taking the conversation in" — a state lasting the length of the mode
rather than of a turn. This requires an `orb-expressions` delta, since that
capability currently *declares* the silent-reply state.

### D10 — Interface cues keep playing, and are captured

[M] The capture includes this app's own output, and `restrictOwnAudio` does not
work. So the interface cues (`src/lib/sounds.ts`, played to `ac.destination`) are
fed back into the capture and land in `inbox/meetings/`.

They keep playing anyway. The existing requirement making cues independent of
listen-only mode is deliberate, and it matters *more* now: with Iris silent, a
cue is the only signal that a run finished or needs approval. The cost is a few
short tones in a meeting transcript, which is a transcription nuisance rather than
a correctness problem.

What changes is the honesty: the proposal's previous claim that coupling capture
to silence makes the stream "clean by construction" is [M] false. It makes it
clean *of Iris's voice*, which is the part that would have fed back into the
conversation. Cues are a known, accepted residue.

### D11 — The record is the deliverable; synthesis is a Claude verb, afterwards

The mode is not trying to make the realtime voice layer understand a meeting.
Gemini's job while engaged is to hear and transcribe; the raw record in
`inbox/meetings/` is what the mode produces. Making sense of it — summary,
decisions, actions, who-said-what — is work for a Claude verb reading that file
afterwards, where there is a real context window, real tools, and no realtime
constraint.

This is why the design tolerates VAD chopping the conversation into turns, and
why it does not chase transcript fidelity through session reconfiguration. A
segmentation artefact that would be fatal to realtime comprehension is
inconsequential to a model reading the whole file at once.

*What this change delivers toward it:* the record itself, in the spool area the
curator already reads, distinguishable from the other spool kinds as
`personal-knowledge-notes` requires — so it is reachable by a verb without new
plumbing, and counted in the inbox backlog so Iris can offer to work on it.

*What it does not deliver:* a dedicated synthesis verb or prompt. That is a
follow-up change against `verb-tool-surface`, kept out of scope so this one stays
about capture. If the existing curator proves sufficient, no follow-up is needed
at all.

## Risks / Trade-offs

**Discarded reply turns are billed for the length of a meeting** → accepted
deliberately (D3/D6). The alternative is rebuilding a retired feature. 8.2
measures the number so the decision can be revisited with data if it is worse
than expected.

**The screen-recording indicator is visible for the whole meeting** → [M]
unavoidable on this mechanism, including on the Catap path with no video. Users
will need to explain it. The only escape is a native tap plus a signing pipeline;
documented here so revisiting has its reasoning already written down.

**The in-band silence instruction expires** → it lives in the conversation, so
`contextWindowCompression` (`live-config.mjs:28-31`) eventually evicts it, plausibly
inside a long meeting. Client-side discarding is what actually guarantees silence
and is not evictable; the instruction only reduces generation. Accepted: the
guarantee does not depend on the thing that expires.

**The model may interject despite the instruction** → it cannot be heard or seen
either way, since replies are discarded. The residue is cost, covered above.

**A future Chromium flips the Catap default** → [M] fails as silence, not as an
error. D5's detector is the defence; D1's explicit switch makes the dependency
visible.

**Speaker bleed doubles every remote voice** → advise headphones, do nothing
else. A ducking bug eats the user's own voice, which is invisible until it
matters; degraded transcription is recoverable.

**`0.7` is a guess, and so is the mic headroom** → env-tunable by construction,
measured in T7.

**Continuous capture for 60+ minutes is a new duration, not a new rate** → the
worklet posts ~375 messages/second and main base64-encodes each. That is today's
behaviour; what changes is holding it for an hour. T7 measures main-process
event-loop lag and RSS over a full-length engagement.

## Migration Plan

No data migration. `inbox/meetings/` is created on first use; existing vaults are
untouched.

Rollback is `IRIS_SYSTEM_AUDIO=0`, which restores pre-change behaviour without a
code change — no capture, no reconnect on toggle, no retention. Full revert is a
normal revert; no state written by this change is read by anything else.
