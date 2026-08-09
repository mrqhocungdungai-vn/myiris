## Why

Iris keeps no record of having run. Nothing she logs survives the process that
logged it.

The main process writes diagnostics with `console.log`/`console.error` — the
reconnect attempts in `live-session.mjs`, the goAway notices in
`live-messages.mjs`, the credential changes in `user-config.mjs`, every
`gemini_status` and `sidecar_status` in `renderer-bridge.mjs`. All of it goes to
stdout. Under `npm run dev` that is a terminal's scrollback. In a packaged
`.app` launched from Finder it goes nowhere at all.

`stdio-resilience.mjs` exists because that destination can die mid-run, and its
comment states the position plainly: *"Losing log output when nothing is reading
it is correct."* That was a defensible thing to say when the only reader was a
developer's terminal. It stops being defensible the moment the app ships,
because then the destination is **never** being read and the losses are total.

The renderer's own account has the same shape. `pushLog` builds an eighty-entry
in-memory array, `camera-activity-log` draws five of them, and a reload discards
the lot. A renderer exception — the most common way this app breaks for a user —
leaves nothing behind at all: no file, no trace, nothing to send anyone.

`app-paths.mjs` declares every path Iris owns: `.env`, `claude-home/`,
`claude-sessions.json`, `canvas.json`, `workspace/`. There is no log path,
because there is no log.

So when a user says "it stopped working", there is nothing to look at. Not a
degraded story — an absent one.

## What Changes

**Iris writes a diagnostic log to disk, and it survives the session.** One JSONL
file under `~/.myiris/logs/`, rotated by size, keeping a bounded number of
previous files. `app-paths.mjs` gains the path, so it stays the single place any
path Iris owns is declared.

**It captures what the app actually already says, rather than a new stream
written for it.** Three sources, none of which requires editing an existing call
site:

- **Everything the main process writes to stdout and stderr**, by teeing those
  streams. Every `[IRIS][…]` line that exists today is captured where it is
  already being written, including output from dependencies that no logging call
  of ours would ever have reached.
- **The event stream** — the `{ type: "log" }` events the renderer already draws
  in the camera strip, plus the status and fatal events, tapped where they are
  emitted.
- **The renderer's faults** — its uncaught exceptions, its console warnings and
  errors, and the process going away underneath it. Today none of these leave
  the renderer unless a debug flag happens to be set.

**Nothing is captured that a user did not already have on their screen or in
their terminal.** This is a change of *destination*, not of what is recorded.

**A credential can never reach the file.** Everything written passes a redaction
pass first. This is the one requirement that makes writing logs to disk safe
rather than merely useful, and it is why the file is written by one module with
one entry point instead of by whoever happens to want to log something.

**It is configured by environment, like everything else here** — the level, the
file size, how many to keep, and an off switch, all `IRIS_*` and all documented
in `.env.example`.

**The file records everything by default, at every level, in both development
and production.** It is a place to look *after* something went wrong, so the
decision about what is interesting cannot be taken before it does. That is the
opposite of the camera strip's rule, deliberately: the strip is a glance and its
depth follows the build; the file is an investigation and its depth does not.

Explicitly **not** in this change:

- *A log viewer, an export button, or any UI.* The file is for a terminal and
  for attaching to a report. `camera-activity-log` already covers "what is
  happening right now" on screen.
- *Uploading anything anywhere.* Nothing leaves the machine. There is no
  telemetry, no crash reporter, no remote sink, and adding one would be a
  different change with a different set of questions.
- *Restructuring how the app logs.* No call site changes, no logger object
  threaded through modules, no new levels. The existing `console.*` calls stay
  exactly as they are — the point is that they now land somewhere.
- *Logging the conversation.* Transcripts, notes and run records already have
  their own homes and their own retention rules. This captures diagnostics.

## Capabilities

### New Capabilities

- `diagnostic-logging`: a durable, rotated, redacted record of what the app did,
  written to disk from the sources the app already produces.

### Modified Capabilities

None. In particular `camera-activity-log` is untouched: its threshold is a
display rule over the same event stream, and this change deliberately does not
couple the two — see the file's "records everything" rule above.

## Impact

- `electron/log-sink.mjs` + test — **new.** The writer: JSONL, size rotation,
  the level threshold, and the redaction pass. Electron-free, with the
  filesystem and clock injected.
- `electron/log-tee.mjs` + test — **new.** Wrapping `process.stdout`/`stderr`
  so what is already written is also captured. Electron-free, and a sibling to
  `stdio-resilience.mjs` in both placement and reasoning.
- `electron/app-paths.mjs` + test — one accessor for the log directory.
- `electron/main.mjs` — install the sink before anything logs, and close it in
  the existing shutdown sequence. The composition root is where this belongs;
  no module self-registers.
- `electron/renderer-bridge.mjs` + test — an injected recorder on `emitEvent`,
  defaulted to a no-op so the module stays independently constructible.
- `electron/wiring.mjs` — passes that recorder through.
- `electron/window.mjs` — the renderer's faults reaching main, no longer gated
  behind a debug flag.
- `.env.example` — the `IRIS_LOG_*` variables.
- `docs/REFERENCE.md` + `CLAUDE.md`'s router — where the log is and how to read
  it.
- No new dependency. No renderer change, no IPC change, no change to what any
  existing call site logs.
