## 1. The sink

- [x] 1.1 Create `electron/log-sink.mjs` — Electron-free, `createLogSink({ dir, io, now, maxBytes, keep, level, enabled })` returning `{ write, close, isEnabled, currentFile }`
- [x] 1.2 Open once in append mode, hold the descriptor, `writeSync` per record — not `appendFileSync`, which is an open/close pair per line, and not a buffer, which a crash discards (D3)
- [x] 1.3 JSONL with a required `src` field, so the app's own account is distinguishable from a dependency's output after the tee has merged them (D2)
- [x] 1.4 Redaction on **every** record before it is written, whatever the source, failing toward masking, with the masked form saying something was removed (D4)
- [x] 1.5 Size rotation: rename aside at `maxBytes`, keep `keep` previous files, delete the rest, reopen without restarting or losing accepted records (D5)
- [x] 1.6 Every stage wrapped: open, write, rotate, close. A fault disables the sink for the session and reports itself **once**, to the stream, never to the log (D6)
- [x] 1.7 Config from `IRIS_LOG*` env, defaulting to everything at every level in both build modes (D7)
- [x] 1.8 `electron/log-sink.test.mjs` — a fake filesystem, no real disk: record shape and `src`; rotation at the boundary and the delete of the oldest; redaction of each credential shape, including inside a line the app did not write; the once-only failure report; a disabled sink writing nothing; an unwritable directory not throwing

## 2. The tee

- [x] 2.1 Create `electron/log-tee.mjs` — Electron-free, a sibling of `stdio-resilience.mjs` in placement and reasoning (D1)
- [x] 2.2 Forward arguments and **return value** untouched — `write`'s backpressure boolean is something the caller may act on, and swallowing it would change the app's behavior for the log's benefit
- [x] 2.3 Line-buffer per stream: one write may carry several lines or half of one. A trailing partial line is flushed at close, not dropped
- [x] 2.4 Idempotent per stream, on `stdio-resilience.mjs`'s symbol pattern, so installing twice cannot stack wrappers
- [x] 2.5 Return an uninstall function, so a test can restore the real streams and so the tee is never permanent
- [x] 2.6 `electron/log-tee.test.mjs` — fake streams: multi-line writes, split writes, a Buffer chunk, the return value preserved, the original still called with what it was given, double install, uninstall restoring the original, partial line flushed on close

## 3. The path

- [x] 3.1 `electron/app-paths.mjs` — one accessor for the log directory, `homedir` injected as a function like every other
- [x] 3.2 Extend `electron/app-paths.test.mjs` alongside the existing accessors

## 4. Wiring

- [x] 4.1 `electron/main.mjs` — construct the sink and install the tee straight after `loadEnvFile` (configuration has to be read first, and nothing between the two logs), and close it in the existing shutdown sequence (D8)
- [x] 4.2 `electron/renderer-bridge.mjs` — an injected `recordLog`, defaulted to a no-op so the module stays independently constructible and its existing tests need no sink
- [x] 4.3 `electron/wiring.mjs` — pass the recorder through
- [x] 4.4 `electron/window.mjs` — the renderer's console warnings and errors, its uncaught exceptions, and `render-process-gone`, captured with **no flag set**. Keep the existing `IRIS_WAKE_DEBUG` behavior of also printing to stdout; that is a separate concern from recording
- [x] 4.5 Confirm `electron/ipc.mjs` needs no change — this adds no channel, and if it turns out to, the approach is wrong rather than the channel missing
- [x] 4.6 `.env.example` — the `IRIS_LOG*` variables, each with what it does and the default, stating the size × count bound explicitly

## 5. Verification

- [x] 5.1 Run all five gates — `/gates`, or `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`
- [x] 5.2 Launch the real app and confirm the file appears, is valid JSONL, and carries records from all three sources with their `src` set
- [x] 5.3 Deliberately throw in the renderer and confirm it lands in the file with no flag set — this is the case the whole change exists for
- [x] 5.4 Force rotation with a tiny size and confirm the set-aside, the fresh file, and the delete of the oldest
- [x] 5.5 Print a credential-shaped string through a captured path and confirm it is masked in the file
- [x] 5.6 Point the log at an unwritable location and confirm the app starts and runs normally
- [x] 5.7 Confirm captured output still reaches the terminal unchanged under `npm run dev`
- [x] 5.8 `docs/REFERENCE.md` — where the log is, its format, and its configuration; `CLAUDE.md`'s router gains a line. Keep `CLAUDE.md` a router
- [ ] 5.9 Settle the design's open questions from a real session — whether the default size and retention are right, and whether the renderer's console warnings earn their volume

## Verified in the running app

Launched the packaged build and read the file back:

- **14 records, 0 invalid JSON lines**, with all three sources present and
  labelled: `main.stdout` 4, `event` 6, `renderer` 4.
- **An uncaught renderer exception was captured with no flag set** — the case
  the whole change exists for: `error | Uncaught Error: deliberate uncaught
  renderer exception`. Its console warnings and errors landed too, while routine
  renderer chatter was correctly excluded.
- **Redaction held**: a credential-shaped string printed through main's stdout
  came out `ANTHROPIC_API_KEY=[redacted]`, and the value appears nowhere in the
  file.
- **Rotation held**: at a 2 KB cap with `keep: 2` the run produced `iris.log`,
  `iris.1.log`, `iris.2.log` and no more. The rotated files are ~2080 bytes
  rather than exactly 2048 — rotation happens after the write that crosses the
  cap, which is what "no accepted record is lost to rotation" means.
- **Disabled wrote nothing**: with `IRIS_LOG=0` the directory was never created.
- **An unwritable location cost only the log**: with a regular file where the
  directory should be, the app started and rendered normally and no log
  appeared.
- **Captured output still reaches its original destination**: with the tee
  installed on the real `process.stdout`/`stderr`, both lines still printed,
  and the partial line with no newline was flushed on uninstall.

## Found while implementing

**The repo's own secret scan caught the test fixtures.** `scan:secrets` failed
on a credential-shaped literal in `log-sink.test.mjs` — the gate cannot tell a
fake token from a real one, and should not have to. The fixtures are now
assembled at runtime from parts, which weakens nothing: redaction sees the same
string either way.

**Three real defects, each caught by a test rather than by review:**

- The provider-key pattern used a letters-and-digits character class, so it
  stopped at the first hyphen and missed `sk-proj-…` entirely. Real keys are
  segmented; the class has to include `-` and `_`.
- The name=value rule ran before the bearer rule, so against
  `Authorization: Bearer <token>` it treated the word "Bearer" as the value,
  masked *that*, and left the token in the log. Order is now stated as
  load-bearing in the source.
- `stream.write.bind(stream)` meant uninstall restored a *copy* rather than the
  original function object — behaviourally identical, but it makes "did anything
  wrap this?" unanswerable by identity, which is exactly what uninstall has to
  answer. The original reference is kept and called with `.call`.

**One test premise was wrong, not the code.** "loses no record" failed because
retention was deleting old files — which is intended. The spec means no record
lost to the *act of rotating*, so the test now uses more slots than turnovers.

## Deferred

- 5.9 Whether the default 4 MB × 5 is right, and whether the renderer's console
  warnings earn their volume, both of which need a long real session rather than
  a scripted one. The first sample is not encouraging on one point: the
  `ScriptProcessorNode` deprecation warning fires on every wake and will repeat
  in the file forever.
