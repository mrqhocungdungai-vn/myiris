## 1. Drain the buffer at the right point (`main.mjs`)

- [x] 1.1 Add `drainPendingAnnouncements()` — while the buffer is non-empty and `liveSession` is set, `sendRealtimeInput` the `shift()`-ed entry (FIFO). Emptying via `shift()` makes a second call a no-op
- [x] 1.2 Remove the dead `while` loop from `onopen` (`main.mjs:2262-2264`)
- [x] 1.3 Call `drainPendingAnnouncements()` on the line after `liveSession = await ai.live.connect(...)` resolves (`main.mjs:2251`), mirroring `previewVoice` (`main.mjs:1035-1036`)
- [x] 1.4 Confirm no other caller relied on the drain living in `onopen` (grep `pendingClaudeAnnouncements` — only push at 564 and the removed loop should touch it)

## 2. Bound the buffer (`main.mjs`)

- [x] 2.1 At the push site (`main.mjs:564`), cap the buffer at a fixed size (~20): push, then drop from the front while over the cap (drop-oldest, design D3)
- [x] 2.2 Name the cap as a module constant with a one-line comment on why drop-oldest (newest state is the one worth speaking on reconnect)
- [x] 2.3 (Optional) Extract the bounded-push as a pure helper (`pushBounded(arr, item, max)`) in a small testable module so the drop-oldest behavior can carry a unit test; otherwise leave inline and cover by manual verification — left inline (kept minimal per proposal's single-bug scope); covered by manual verification in section 4

## 3. Tests (only if 2.3 is taken)

- [x] 3.1 If a `pushBounded`-style helper was extracted, add a Vitest unit test: pushing more than `max` items keeps the last `max` in order and drops the oldest — n/a, 2.3 not taken

## 4. Verification (the plan's BUG B ritual)

- [x] 4.1 Submit a long DEV run
- [x] 4.2 While it runs, force the Live session to drop (kill network for a few seconds, or wait for the periodic reconnect)
- [x] 4.3 Let the run finish inside that offline window
- [x] 4.4 After reconnect: Iris **proactively reads the result aloud** (the `SYSTEM_EVENT_CLAUDE_COMPLETE` was buffered and delivered), where before it was silently lost
- [x] 4.5 With a temporary log, confirm `pendingClaudeAnnouncements.length` returns to 0 after the drain
- [x] 4.6 Confirm the healthy path is unchanged: with the socket connected throughout, a completion is announced immediately exactly as before (buffer stays empty)

## 5. Build and spec check

- [x] 5.1 `npm run build` passes with no new type errors
- [x] 5.2 `npm test` passes (unchanged unless 2.3/3.1 added a test)
- [x] 5.3 `openspec validate drain-offline-announcements` passes
- [x] 5.4 Re-read the delta: the bounded-buffer scenario and the two disconnected-delivery scenarios are all true against the landed code

## 6. Commit and record

- [x] 6.1 One commit on `develop` (single bug). End the message with the Co-Authored-By trailer
- [x] 6.2 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG B done, note the drain-after-resolve fix and the ~20-entry ring buffer
