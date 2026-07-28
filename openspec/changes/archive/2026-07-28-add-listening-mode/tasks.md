## 1. Extract the session configuration into a testable module

`buildLiveConfig()` cannot be tested where it lives: it closes over module state
(`envFlag("IRIS_ENABLE_GOOGLE_SEARCH")`, `buildClaudeTools()`, `buildSystemInstructionText()`) and
`electron/main.mjs` imports Electron, which `docs/TESTING.md` forbids a test from booting.

- [x] 1.1 Create `electron/live-config.mjs` exporting a builder that takes its inputs as parameters
      (`{ mode, resumeHandle, tools, systemInstruction, voice, ... }`), per `docs/TESTING.md`'s
      injected-dependencies convention.
- [x] 1.2 `mode: "converse"` returns today's configuration verbatim — **no `realtimeInputConfig` key
      at all** — so the existing conversation path cannot drift.
- [x] 1.3 `mode: "listen"` adds `realtimeInputConfig` with `automaticActivityDetection: { disabled:
      true }`, `turnCoverage: "TURN_INCLUDES_ALL_INPUT"`, `activityHandling: "NO_INTERRUPTION"`, **and an
      empty `tools` array**. Everything else identical between modes. The empty tool set is not cosmetic:
      `handleLiveMessage` dispatches `message.toolCall` (`main.mjs:3212`) before it looks at
      `serverContent`, so with `buildClaudeTools()` present (`:3046`) a forced boundary turn could start a
      real Claude run that suppressing audio and text would not stop.
- [x] 1.4 Rewire `main.mjs`'s call site to the new module, keeping its existing behavior for
      `"converse"`.
- [x] 1.5 Vitest (`electron/live-config.test.mjs`): the two modes' outputs differ **only** by the
      `realtimeInputConfig` key and the emptied `tools`, for the same inputs. Assert the difference, not a
      committed snapshot — a snapshot rots on the next unrelated config change.
- [x] 1.6 Vitest: `"listen"` disables automatic activity detection and sets turn coverage to
      `TURN_INCLUDES_ALL_INPUT`. This is the test that fails if someone later "simplifies" the config
      back toward defaults.

## 2. The boundary sequence

The measured ordering is load-bearing and its failure mode is silent. See `design.md` Decision 5.

- [x] 2.1 Implement a boundary as an ordered sequence: `sendRealtimeInput({ activityEnd: {} })` →
      await `turnComplete` → **await a `resumable=true` handle issued after that `activityEnd`** →
      disconnect → reconnect carrying that handle → `sendRealtimeInput({ activityStart: {} })` (rotation
      only). Depends on 5.1 — the reconnect must not enter the failure-backoff path.
      The freshness check is load-bearing: `resumptionHandle` is module-scoped and already non-null from
      the converse session (`main.mjs:3201`), so "wait until a handle exists" passes instantly and
      reproduces the bug this ordering exists to prevent.
- [x] 2.2 Bound both waits, and log what was missing if either elapses instead of hanging the
      transition.
- [x] 2.3 Suppress **every** boundary turn (rotation and the final one alike) **in `handleLiveMessage`,
      in main**: while a boundary is in flight, skip the `modelTurn` loop (`main.mjs:3231`) and the
      `outputTranscription` append (`:3229`). Do **not** try to reuse the renderer's speaker-mute
      suppression — main appends the turn's text to the transcript it emits (`:3241`) and emits
      `audio_state: "speaking"` per chunk (`:3238`) before the renderer sees anything, so a boundary
      would still print a transcript line and flip the orb. Suppressing in main means nothing crosses
      IPC, so there is nothing to suppress downstream.
- [x] 2.4 Accumulate each chunk's `inputTranscription` into an in-memory segment record. Two consumers
      only: the closing synthesis when a boundary's bounded wait elapsed, and the synthesis after an
      unexpected disconnect (4.7). Discard it once the closing synthesis has been delivered. Never write
      it to disk or the notes vault.
- [x] 2.5 Structure the sequence to accept an injected session-like object with production defaults,
      so tests can drive it without a live session (`docs/TESTING.md`) — the same pattern
      `run-queue.mjs` and `po-session.mjs` already use.
- [x] 2.6 Vitest: the boundary emits `activityEnd` before any disconnect, and does not disconnect until a
      handle issued **after** that `activityEnd` has arrived or the bounded wait elapsed. **Seed a
      pre-existing handle in the test** and assert the boundary still waits — otherwise the test passes
      against the very implementation it is meant to reject. Also assert `activityStart` is re-sent after
      a rotation's reconnect. **This is the anti-regression test for the measured total-context-loss
      failure.**
- [x] 2.7 Vitest: every boundary turn's audio and text are suppressed, the final one included, and a
      tool call arriving during a boundary is ignored.

## 3. Chunk rotation

- [x] 3.1 Start a rotation timer when the mode engages, interval from `IRIS_LISTEN_CHUNK_MS` (default
      8 minutes — margin below the ~10 minute connection lifetime documented at `main.mjs:87`).
- [x] 3.2 Trigger an immediate rotation on the server's `goAway` (handled at `main.mjs:3206`) if it
      arrives before the timer.
- [x] 3.3 Clear the timer on exit, on sleep, and on any session teardown.
- [x] 3.4 Vitest: rotation is driven by the interval, and `goAway` short-circuits it. Inject the timer
      so the test does not wait 8 minutes.

## 4. Mode state and lifecycle

- [x] 4.1 Add listening-mode state owned by the main process, defaulting to disengaged, never read
      from or written to configuration.
- [x] 4.2 Enter sequence: reconnect into `"listen"` config carrying the current resumption handle → drive
      the entry confirmation turn with `sendClientContent({ turns, turnComplete: true })` → await its
      `turnComplete` → `activityStart`. Do **not** copy `sendWelcomeGreeting`'s
      `sendRealtimeInput({ text })` (`main.mjs:3075`) — text realtime input under AAD-off is the one path
      recorded as unmeasured, and if the server discards it the confirmation silently never speaks.
- [x] 4.3 Exit sequence: run a boundary exactly like a rotation, **suppressed** → reconnect into
      `"converse"` config carrying the captured handle → **then** drive the synthesis turn there, also via
      `sendClientContent`. Requesting the synthesis at the boundary returns the one-word acknowledgement
      the listen instruction asks for; this ordering is what the working spike does.
- [x] 4.4 If the enter reconnect fails, land disengaged with converse restored and surface the failure
      — never report engaged over a session that is not listening.
- [x] 4.5 Add a transitioning flag; ignore toggles from every surface while a transition (enter, exit,
      or rotation) is in progress.
- [x] 4.6 A toggle from any surface runs the full exit sequence (4.3). Sleep and app quit do **not** — they
      end the mode and drop the session, losing the current chunk. Committing there accomplishes nothing
      observable: `startLive` nulls `resumptionHandle` on every fresh start (`main.mjs:3081`), quit runs
      under the 8 s `shutdownDeadlineMs` budget shared with DEV children and PO settle (`main.mjs:3784`),
      and at sleep the renderer tears down audio before `stopSidecar` (`src/App.tsx:1046`) so no synthesis
      could be heard.
- [x] 4.7 **End the mode on an unexpected disconnect, then synthesize.** When `onclose` fires while
      engaged and `userStopped` is false (`main.mjs:3132`) — machine slept, network dropped, quota tripped
      — reset to disengaged, clear the rotation timer, let the existing failure-reconnect path restore
      converse unchanged, and once it is up drive a synthesis from the segment record so the user is told
      what was captured. Do **not** let the mode ride across the reconnect: `scheduleReconnect` →
      `connectLive` → `buildLiveConfig(resumptionHandle)` (`main.mjs:3110`) has no notion of mode, so
      converse leaves the icon lit while Iris interrupts, and listen without an `activityStart` discards
      every subsequent byte *and* the transcription with it.
- [x] 4.8 Vitest: an unexpected close while engaged leaves the mode disengaged with the segment record
      intact, and does not reconnect into listen configuration.
- [x] 4.9 Reset listening mode to disengaged on any transition to not-running, including
      server-initiated teardown — mirroring how `speaker-mute` handles the same case.
- [x] 4.10 Make toggling a no-op while the session is asleep.
- [x] 4.11 Vitest: enter opens the activity only after the confirmation turn completes, never before.
- [x] 4.12 Vitest: a toggle during a transition is ignored; a session teardown while engaged leaves
      the mode disengaged.

## 5. Deliberate reconnect path

`onclose` (`main.mjs:3129`) calls `scheduleReconnect` unless `userStopped` is set, and
`scheduleReconnect` nulls `resumptionHandle` after three attempts (`main.mjs:3167`) — which would
destroy the listening context. `startLive` early-returns when `liveSession` is set (`main.mjs:3079`)
and `stopLive` nulls the handle (`main.mjs:3248`), so neither is reusable.

- [x] 5.1 Add a deliberate-transition flag that `onclose` honours the way it honours `userStopped`,
      without the offline teardown, so a config swap or rotation does not enter failure backoff.
- [x] 5.2 Route the reconnect through the existing `{ isReconnect: true }` path so `GreetGate.arm()`
      (`main.mjs:3121`) does not re-fire the welcome greeting on every toggle and rotation.
- [x] 5.3 Vitest: a deliberate close does not schedule a failure reconnect and does not clear the
      handle.

## 6. Announcement deferral

- [x] 6.1 In `notifyIris` (`main.mjs:720`), treat "engaged" as not deliverable — take the buffer path
      rather than `sendRealtimeInput({ text })`.
- [x] 6.2 Skip `drainPendingAnnouncements()` on a listen-config connect and on a rotation reconnect
      (it currently runs on every connect, `main.mjs:3147`); drain after the exit reconnect instead.
- [x] 6.3 Vitest: an announcement raised while engaged is buffered, and is delivered in order once the
      mode ends.

## 7. IPC, renderer state, and control surfaces

- [x] 7.1 Expose exactly three things on `window.iris` in `electron/preload.cjs`: a toggle **request**,
      a one-way state **subscription**, and a state **query** for boot/reload. Nothing carries a path,
      prompt, or other argument main would have to validate.
- [x] 7.2 Push state changes from main to the renderer one-way. Add **no** report-back channel — do
      not copy `speaker-mute`'s mirror, whose renderer side fires on mount and seeds `false`
      (`src/App.tsx:488`); with main owning this state, a reload while a chunk was open would flip the
      authoritative flag to disengaged. The tray label reads main's own variable.
- [x] 7.3 Thread the state into `src/App.tsx` alongside the existing mute states, as pure display —
      seeded from the query on mount, updated by the push, never asserted back.
- [x] 7.4 Add the ear control to `src/components/HudShell.tsx`, beside the existing microphone and
      speaker mute buttons, crossed out while disengaged.
- [x] 7.5 Add the same control to the deck's control cluster.
- [x] 7.6 Add the tray item, label reflecting current state, disabled while asleep. Its `click` calls
      main's toggle **directly** — not `emitToRenderer` the way the mute item does (`main.mjs:3433`).
- [x] 7.7 Register the `IRIS_LISTEN_HOTKEY` global shortcut **with a literal default** (the existing
      accelerator helpers always have one, `main.mjs:3463` and `:3467`, because
      `globalShortcut.register(undefined)` throws). Its callback calls main's toggle directly, not
      `emitToRenderer` (`main.mjs:3747`). Choose a modifier+key accelerator, not a media key, so no
      Accessibility or Input Monitoring grant is involved. Log and survive a registration conflict. No
      unregistration code: `will-quit` already calls `unregisterAll()` (`main.mjs:3778`).
- [x] 7.8 Verify the tray item and the hotkey still end the mode with **no window open** — the deck's
      close button calls `mainWindow.close()` (`main.mjs:3712`), `window-all-closed` does not quit on
      darwin (`:3791`), and `emitToRenderer` returns early with no window (`:213`). This is the check
      that catches a copy of the mute routing.
- [x] 7.9 Verify a window reload while engaged shows the mode engaged, seeded from the query.
- [x] 7.10 Confirm no "answer now" control was added anywhere: ending the mode is the only way Iris is
      permitted to speak.

## 8. Prompt text

- [x] 8.1 Write the entry confirmation: one short line saying Iris is now listening and will
      synthesize when the mode ends.
- [x] 8.2 Add the listen-mode system instruction telling Iris to answer a boundary as briefly as
      possible (measured: this yields a one-word reply). Cost optimisation only.
- [x] 8.3 Write the closing synthesis prompt, driven **after** the converse reconnect (4.3), drawing on
      the segment record only when a boundary's wait elapsed or the mode ended on a disconnect.
- [x] 8.4 Verify no prompt is load-bearing for silence or for suppression — replacing the listen
      instruction with text that says nothing about staying quiet must leave a mode that still cannot
      complete a turn, and a long boundary reply must still be suppressed.

## 9. Documentation

- [x] 9.1 Add `IRIS_LISTEN_HOTKEY` (with its default named — `Alt+L` unless it conflicts, alongside the
      existing `Alt+Space` and `Alt+M`) and `IRIS_LISTEN_CHUNK_MS` to `.env.example`, following the
      precedent at `.env.example:63,68`.
- [x] 9.2 Add a one-line pointer for listening mode in `CLAUDE.md`, keeping that file a router as its
      own conventions require.
- [x] 9.3 Document the mode in the appropriate `docs/` file, including the three measured constraints
      a reader will otherwise trip over: audio outside an opened activity is discarded; closing the
      session without `activityEnd` loses the current chunk; and no resumption checkpoint exists while
      an activity is open, so a boundary must wait for the handle before disconnecting.
- [x] 9.4 Note the user-visible surprises: voice sleep and voice delegation do not work while the mode
      is engaged (both need a model turn); a PO question raised while engaged will time out to its
      default unheard; the mode ends by itself if the machine sleeps long enough to drop the connection;
      and the mode gives no signal if microphone capture dies, since silence is the designed behavior.

## 10. Verification

- [x] 10.1 `npm run build` passes (typecheck gate).
- [x] 10.2 `npm test` passes (behavioral gate).
- [x] 10.3 Manual run via `npm start`: engage the mode, speak specific details with long pauses for
      several minutes, confirm Iris stays completely silent throughout.
- [x] 10.4 Manual run: stay engaged past at least two rotations (temporarily lower
      `IRIS_LISTEN_CHUNK_MS` to make this quick), confirm nothing is heard or rendered at a boundary,
      then end the mode and confirm the synthesis references details from the **first** chunk — and that
      you hear the synthesis **once**, with no boundary acknowledgement before it.
- [x] 10.5 Manual run: end the mode, then ask a follow-up and confirm the context is still there.
- [x] 10.6 Manual run: toggle from all three surfaces; confirm sleep/wake leaves the mode disengaged
      and that toggling does not re-greet.
- [x] 10.7 Manual run: trigger an announcement (e.g. switch role) while engaged; confirm silence
      during, and delivery after the mode ends.
- [x] 10.8 Manual run: engage the mode, close the window, and confirm the tray item and the hotkey
      still end it. Then engage, reload the window, and confirm the ear control comes back showing
      engaged.
- [x] 10.9 Manual run: engage the mode and sleep the machine (or kill the network) long enough to drop
      the connection; confirm the mode ends, ordinary conversation returns, and Iris's synthesis still
      reflects what was said before the drop.
