## 1. The bounded window

- [x] 1.1 Add `electron/listen-window.mjs`: `createListenWindow({ lengthMs, onExpire, now, setTimer, clearTimer })` → `{ open, close, isOpen, remainingMs, deadlineAt }`. Electron-free, no `process.env`, no I/O — the resolved length is passed in. Absolute deadline set at `open()`, never re-armed; `open()` on an already-open window replaces it rather than extending. `unref()` the timer where the injected `setTimer` returns one (design D2, D3)
- [x] 1.2 Add `electron/listen-window.test.mjs` over a fake clock: deadline fires at exactly `lengthMs`; activity during the window does not move it; `close()` before the deadline cancels the expiry so `onExpire` never fires; re-`open()` after expiry gives a full-length window; `remainingMs` counts down and floors at zero. No Electron, no real time (design D2)
- [x] 1.3 Add `IRIS_LISTEN_MAX_MINUTES` to `electron/user-config.mjs` beside the existing `IRIS_SYSTEM_AUDIO_GAIN` / `IRIS_LISTEN_HOTKEY` reads: default 5, clamp to a 15-minute ceiling, and fall back to the default for non-numeric, zero and negative values — there is no unbounded value (design D5)
- [x] 1.4 Cover 1.3 in `electron/user-config.test.mjs`: default when unset, clamp above the ceiling, fallback for garbage/zero/negative

## 2. Driving the window from the mode

- [x] 2.1 In `electron/live-session.mjs`, construct the window with the resolved length and an expiry callback that calls `setListenOnlyEngaged(false)` — the same writer the user's toggle uses, so the renderer push, `LISTEN_ONLY_DISENGAGE_REQUEST`, `onListenOnlyChange` and `updateTrayMenu` all happen on one path (design D4)
- [x] 2.2 In `setListenOnlyEngaged`, open the window on engage and close it on disengage, so a manual toggle-off cancels the pending expiry and no second disengage fires at the original deadline (design D4)
- [x] 2.3 Close the window wherever the session tears down or is stopped, alongside where the system-audio capture is released, so no deadline outlives its session and no timer holds the process open (spec: "The window does not outlive the session")
- [x] 2.4 Add the deadline and the window length to `listenOnlyStatePayload()` so the renderer receives them on the same transition push it already gets — one field on the existing authority, not a per-second tick (design D6)
- [x] 2.5 Extend `electron/live-session.test.mjs`: engaging opens a window; expiry disengages through the same path as a manual toggle (renderer push, in-band note, tray update all observed); a manual disengage cancels the expiry; a session teardown closes the window

## 3. The countdown

- [x] 3.1 Show the time remaining in `src/components/ListenOnlyNotice.tsx`, counted down locally from the deadline in the `listen-only:state` payload. Iris is silent while engaged and cannot warn by voice, so this is the warning (spec: "Engaging opens a bounded window")
- [x] 3.2 Widen the `listen-only:state` payload type in `src/vite-env.d.ts` to carry the deadline and length

## 4. Removing retention

- [x] 4.1 Delete `electron/meeting-capture.mjs` and `electron/meeting-capture.test.mjs`
- [x] 4.2 Delete `meetingsSpoolDir` and `meetingFileFor` from `electron/vault-write.mjs`, and their cases from `electron/vault-write.test.mjs`. Keep `appendSpoolRecordTo` — `appendSpoolRecord` delegates to it for the per-day spool (design D8)
- [x] 4.3 Delete the meeting block from `electron/capabilities/second-brain.mjs`: `createMeetingCapture` import, `NOTES_MEETINGS_DIR`, `flushMeetingCapture`, `startMeetingFlushTimer`, `stopMeetingFlushTimer`, `setMeetingCaptureEngaged`, `appendMeetingFragment`, `closeMeetingUtterance`, `isMeetingCaptureEngaged`, `notesMeetingsDir`, and the meeting half of teardown
- [x] 4.4 In the same file, drop `!meetingCapture.isEngaged()` from the ambient-capture predicate and replace it with a direct read of whether listen-only mode is engaged — ambient still stands aside for that span, now because the span is outside its consent rather than because another writer owns it (spec: `ambient-session-capture`)
- [x] 4.5 Remove the `/^meeting-.+\.md$/` branch from the inbox backlog filter in `electron/run-inbox.mjs` — this one is live code, not a comment
- [x] 4.6 Delete `meetingRecordNote` from `electron/gemini-prompts.mjs` and rewrite `LISTEN_ONLY_ENGAGE_REQUEST`: it currently frames the engagement as "a meeting or a call" and promises a record. It should instead say what the mode is actually for — the user is presenting, someone in the room or on the call is asking a question, and Iris's job is to take that question in and hold it, because she will be asked about it the moment the mode ends. No record is promised, because none is written
- [x] 4.7 Delete `announceMeetingRecord` from `electron/live-session.mjs` along with its `formatDuration` / `meetingRecordNote` imports and its export. Replace the one conversation entry it produced with one stating how long Iris listened (spec: "The engagement leaves one entry behind")
- [x] 4.8 Remove the meeting lifecycle from `electron/wiring-live.mjs`: the three JSDoc fields, the `onInputTranscription` / `onUtteranceBoundary` wiring, and the `setMeetingCaptureEngaged` → `announceMeetingRecord` chain
- [x] 4.9 In `electron/live-messages.mjs`, delete the `onInputTranscription` and `onUtteranceBoundary` parameters and every call to them — both had exactly one consumer and it was meeting capture. Keep `noteTranscriptionFragment`, `utteranceTimer` and `closeUtterance`: `closeUtterance` also calls `flushTranscripts()`, which is what keeps the live readout updating through continuous audio. Keep the `appendUserTranscript(...)` beside the removed call in the tool-call branch — that is the transcript-flush fix and it is not part of this (design D7)
- [x] 4.10 Rewrite the tool refusal string in `electron/live-messages.mjs` that says "overhearing a meeting or a recording", and the stale comments in the same file, `electron/renderer-bridge.mjs` and `electron/user-config.mjs`
- [x] 4.11 Update `electron/live-messages.test.mjs`, `electron/wiring-live.test.mjs` and `electron/capabilities/second-brain.test.mjs`: delete the meeting cases. The remaining listen-only cases (silence, system audio, tool refusal) must stay green **without being edited** — if one needs changing, more was removed than intended

## 5. Documentation

- [x] 5.1 Rewrite the listen-only block in `.env.example` (the `IRIS_LISTEN_HOTKEY` and `IRIS_SYSTEM_AUDIO` entries) to drop every mention of retention, and document `IRIS_LISTEN_MAX_MINUTES` with its default and ceiling
- [x] 5.2 Rewrite the **Retention** paragraph in the listen-only section of `docs/ARCHITECTURE.md` — it is now about the bounded window and about the session holding the audio, not about `inbox/meetings/`
- [x] 5.3 Update the listen-only router row in `CLAUDE.md`: drop `inbox/meetings/` retention, name the bounded window
- [x] 5.4 Sweep `README.md` and `docs/PIPELINE_GUIDE.md` for the remaining meeting-mode wording
- [x] 5.5 Edit the `## Purpose` paragraph of `openspec/specs/listen-only-mode/spec.md` by hand — it states that everything Iris hears "is retained to her own vault area", which a delta cannot reach (an existing capability's Purpose is not deltaable)

## 6. Gates

- [x] 6.1 `npm run build` — tsc over `src` and `electron`, plus the vite build
- [x] 6.2 `npm test` — including the new `listen-window` cases and the untouched surviving listen-only cases
- [x] 6.3 `npm run lint` — oxlint, zero warnings; catches anything left unused by the deletions
- [x] 6.4 `npm run scan:secrets`
- [x] 6.5 `npm run spec:check` — the gate that matters here: the living spec must still be true after the removal
- [ ] 6.6 `grep -rn -i meeting electron src docs .env.example README.md CLAUDE.md openspec/specs` returns nothing outside `openspec/changes/archive/`

## 7. Verify in the running app

- [ ] 7.1 `npm run dev`, engage listen-only, speak for a while: Iris stays silent, the countdown runs, and no file appears under `inbox/meetings/`
- [ ] 7.2 Let the window expire: the mode disengages on its own, Iris is audible again, and the tray item and the renderer control both show it
- [ ] 7.3 Engage and disengage by hand before the deadline: nothing fires later at the original deadline
- [ ] 7.4 Play audio from another app while engaged: Iris still hears it — system audio is untouched
- [ ] 7.5 Immediately after a window ends, ask Iris what the question was: she answers from the session's own audio context, with no record involved. This is the claim the whole change rests on
