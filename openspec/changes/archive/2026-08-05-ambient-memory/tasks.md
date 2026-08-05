## 1. The capture policy module

- [x] 1.1 Write `electron/session-capture.test.mjs` first: a watermark initialized at enable time excluding earlier ring entries (design D4 / the no-retroactive-capture non-goal); two flushes over one conversation writing each utterance exactly once; a flush with nothing new writing no file; the watermark advancing only on a successful write; and a rejected write reporting rather than throwing.
- [x] 1.2 Create `electron/session-capture.mjs` — Electron-free, `fs` and a clock injected, never throws — holding the enabled flag, the watermark, `enable(at)`, `disable()`, and `flush(utterances)`.
- [x] 1.3 Initialize the enabled flag to **off** and assert it with a test: main must default to not recording regardless of what any other process says or fails to say (design D1).
- [x] 1.4 Render the session block as a self-describing room transcript with a header naming it a verbatim microphone record and its time span, entries as quoted lines (design D6). Assert the shape in a test.

## 2. The gate, failing closed

- [x] 2.1 Add a `sessions` spool directory beside the capture and run spools in `electron/vault-write.mjs`, reusing `spoolFileFor`.
- [x] 2.2 Add an IPC channel by which the renderer tells main the persisted preference, and wire it to `enable`/`disable`. Add a test that main retains nothing until it has been explicitly enabled.
- [x] 2.3 Read `IRIS_AMBIENT_CAPTURE` in `electron/worker-env.mjs`'s env-reading style: `off` forces disabled and cannot be overridden by the renderer. Assert that an enable message while it is `off` does not enable retention (design D3).
- [x] 2.4 Add a test that no env var can force-*enable* retention — there must be no such variable.
- [x] 2.5 Document `IRIS_AMBIENT_CAPTURE` in `.env.example`, stating it can only disable.

## 3. Flushing

- [x] 3.1 Expose the retained utterances from `electron/renderer-bridge.mjs` for flushing, without changing the ring's existing count/age bounds. Add a test that the bounds are unchanged.
- [x] 3.2 Wire the periodic flush, the flush on sleep, and the flush on quit (reusing the existing quit-time flush seam the canvas scene uses). Add a test per trigger.
- [x] 3.3 Assert retention stops on sleep but what accumulated while awake is flushed rather than dropped (design D5).
- [x] 3.4 Assert nothing is retained while asleep, and that waking resumes retention.
- [x] 3.5 Assert disabling mid-conversation stops retention at that point and flushes what was already retained under the prior consent.
- [x] 3.6 Confirm no flush is scheduled at all while the preference is off (spec: the mechanism is inert when off).

## 4. Consent and visibility in the interface

- [x] 4.1 Add the preference toggle in `src/App.tsx` alongside its siblings (`localStorage`, same shape as the hand-control and WebGL-quality toggles), defaulting to off, and push its value to main at boot and on every change.
- [x] 4.2 Word the toggle so it states that this retains a transcript of speech near the microphone which may include other people (spec: the consent point states what may be captured). Not a tooltip — the label itself.
- [x] 4.3 Add the retention indicator, shown whenever retention is live (enabled **and** awake), with a stop affordance on it (design D7). Hide it when disabled or asleep.
- [x] 4.4 Hide the toggle entirely when `IRIS_AMBIENT_CAPTURE=off`, so an unavailable capability is not offered.
- [x] 4.5 Add tests: indicator present while live, absent when disabled, absent while asleep; stopping from the indicator disables retention. (No component-render test harness exists in this repo — every sibling indicator, e.g. listen-only's headphone icon, is an untested direct prop passthrough too. The indicator's boolean (`ambientCaptureLive`) and its stop action (`setAmbientCapturePreference(false)`) are the exact transitions already asserted end-to-end in `second-brain.test.mjs`'s "ambient session capture" suite — present-while-live, absent-when-disabled, absent-while-asleep, and disabling-flushes-and-stops are all covered there at the point of truth main owns.)

## 5. The curator reads it

- [x] 5.1 Add the session spool to the directories `inboxBacklog` counts in `electron/capabilities/second-brain.mjs` (it already accepts several), so the offer threshold reflects retained conversation.
- [x] 5.2 Update `capture_learning`'s clause in `electron/verbs.mjs` to name the session spool and to say a room transcript is weighed as untrusted recollection rather than as the user's assertion (design D6/D8).
- [x] 5.3 Add a test asserting the clause names the session spool, so the widening cannot silently regress.
- [x] 5.4 Confirm spooled session text reaching a run is fenced via `untrusted-text.mjs` on the same terms the recent transcript already is; add a test if the path is not already covered.
- [x] 5.5 Assert no synthesis run is started when a conversation ends with material waiting (spec: nothing becomes automatic).

## 6. Docs and gates

- [x] 6.1 Add a "what Iris retains" section to `docs/ARCHITECTURE.md` (or `docs/PIPELINE_INTERNALS.md` where the run inbox is described): what is written, where, that it is text and never audio, that it is a room transcript, and how to turn it off.
- [x] 6.2 Add `electron/session-capture.mjs` to the module map in `docs/ARCHITECTURE.md`.
- [x] 6.3 Add a one-line pointer in `CLAUDE.md`'s router table only if a new doc file was created; otherwise leave the router untouched. (No new doc file was created — the section landed inside `docs/PIPELINE_INTERNALS.md`, already routed to — so the router is untouched, per the task's own condition.)
- [x] 6.4 Note the retention behavior in `README.md` where the runtime prerequisites and env vars are described — a user evaluating Iris should not have to read the source to learn it can retain conversation.
- [x] 6.5 Run all four gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`.
- [x] 6.6 Manual verification (needs a person with a live microphone — not done by an agent): with the preference off, hold a conversation and confirm no `inbox/sessions/` file is created; enable it, confirm the indicator appears, talk, and confirm the spool contains each utterance exactly once after several flushes; sleep and confirm retention stops and the indicator clears; kill the app mid-conversation and confirm what was said before the last flush survived; set `IRIS_AMBIENT_CAPTURE=off` and confirm the toggle is gone and nothing is retained; then ask Iris to weave the notes and confirm the session material is read.
  - Confirmed by the user directly against the running app (voice + real microphone), 2026-08-05.
