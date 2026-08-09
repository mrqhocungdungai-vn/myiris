## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The diagnostics already exist and already have a destination.** Main writes
  them with `console.log`/`console.error`, which reach `process.stdout`/
  `stderr`. Nothing needs to be added for them to be worth capturing; they need
  a second destination that outlives the process.
- **`stdio-resilience.mjs` already treats those two streams as a seam.** It
  attaches broken-pipe-tolerant error listeners to them at the top of
  `main.mjs`, before anything logs. A capture installed at the same point is a
  sibling of it, not a new idea.
- **`app-paths.mjs` is the single declaration of every path Iris owns**, with
  `homedir` injected as a function so tests never touch the real home.
- **`emitEvent` in `renderer-bridge.mjs` is the one funnel for the event
  stream**, and it already console-logs three event types — so it is both the
  right tap point and proof that a tap there is not novel.
- **The renderer's faults currently escape nowhere.** `window.mjs` hooks
  `console-message` only under `IRIS_WAKE_DEBUG`, and its comment records that
  Electron 42 passes a single details object rather than the widely-documented
  five-argument form.
- **`scan:secrets` is one of the five gates.** Writing a file that could contain
  a credential is a new exposure in a repo that already treats that class
  seriously.
- **Electron access is confined to four modules**, machine-enforced. Anything
  new here is Electron-free.

## Goals / Non-Goals

**Goals**

- A failure in a packaged build can be investigated afterwards.
- Capture what the app already says, without editing where it says it.
- Bounded on disk, by a number the user can compute in advance.
- Impossible to write a credential to it.
- Impossible for it to take the app down.

**Non-Goals**

- Any UI. `camera-activity-log` covers on-screen; this covers on-disk.
- Anything leaving the machine.
- Restructuring how the app logs, or introducing a logger object.
- Logging conversation content — transcripts, notes and runs have their own
  homes and their own retention.

## Decisions

### D1 — Tee the streams, don't touch the call sites

Capture is installed by wrapping `process.stdout.write` and
`process.stderr.write`.

The alternative — a logger module imported at each of the ~dozen `console.log`
sites — was rejected on two grounds. It would be a change to a dozen modules for
a concern none of them has, and it would capture only what we remembered to
convert; a dependency printing a warning is exactly the line most worth having
and the one that route can never reach.

The stream seam gets everything, needs no call-site edits, and is the seam
`stdio-resilience.mjs` already established for these two objects.

Consequences the implementation has to carry:

- **The original write must be untouched.** The wrapper forwards the same
  arguments and returns the same value. A stream's `write` returns a
  backpressure boolean the caller may act on, and swallowing it would be a
  behavior change in the app for the benefit of the log.
- **Writes are not lines.** One `write` may carry several lines or half of one,
  so the tee buffers per stream and emits on newline. A trailing partial line is
  flushed at close rather than lost.
- **Reentrancy.** The sink must not write to the streams it is teeing, or a
  write failure logs a failure that writes. It writes to a file descriptor, and
  it reports its own faults exactly once (D6).
- **Idempotence**, on `stdio-resilience.mjs`'s pattern: a symbol on the stream,
  so installing twice cannot stack two wrappers.

### D2 — JSONL, one record per line

`{"at":…,"level":…,"src":…,"msg":…}`, newline-delimited.

Chosen over plain text for one specific reason rather than general tidiness: a
captured line can contain anything — a stack trace, a JSON blob, a message with
embedded newlines — and in a plain-text log those break the one invariant a
reader needs, that a line is a record. JSON encoding makes a multi-line message
a single line by construction, so `grep` still works and `jq` becomes possible.

`src` is a required field, not decoration: the spec requires a reader be able to
tell the app's own account from a dependency's output, and after the tee those
two arrive through the same door.

### D3 — Synchronous writes to a held descriptor

The file is opened once in append mode and each record is written with a
synchronous write to that descriptor.

Buffering with a periodic flush was rejected: the records immediately before a
crash are the ones the log exists for, and a buffer is exactly what a crash
discards. `appendFileSync` per record was rejected for the opposite reason — it
opens and closes the file every time, which during a burst of run-stream output
is a syscall pair per line for no benefit.

A held descriptor with `writeSync` costs one syscall per record and hands the
bytes to the operating system before returning, which is what "durable against
the application crashing" means and all it can mean without an `fsync` per line.

### D4 — Redaction is unconditional, applied at the sink, and fails toward masking

Every record passes the redaction step, whatever its source.

At the sink rather than at each source, because the sources include output we do
not write. A dependency printing a token is the case that cannot be fixed
upstream, and therefore the case redaction exists for; putting the step anywhere
else would leave it uncovered.

The rule fails toward masking. A log made slightly harder to read is a
recoverable mistake; a credential written to a file and then pasted into a bug
report is not, and the whole point of this change is that the file gets shared.

The masked form states that something was removed. "No token was present" and "a
token was here" have to be distinguishable, or a reader cannot tell whether the
redaction did anything.

### D5 — Rotate by size, keep N, and state the bound

Once the active file passes its configured size it is renamed aside and a fresh
one opened; files beyond the retained count are deleted.

Size rather than time, because the failure being defended against is a runaway
log filling a disk, and that is a size problem — a daily log can be a megabyte
or a gigabyte depending on what went wrong, which is precisely when it goes
wrong. Size times count is a bound the user can compute from `.env.example`
before anything happens.

### D6 — The log can fail; the app cannot

Every stage — open, write, rotate, close — is wrapped so a fault costs the log
and nothing else. A full disk or a read-only directory must not stop the app
from starting.

A write failure disables the sink for the session and reports itself **once**,
to the stream, not to the log. Reporting per failure would produce output at the
rate of the failures; reporting to the log would attempt the write that just
failed.

Disabling rather than retrying is deliberate: the failures this sees are not
transient. A read-only directory stays read-only, and a full disk is not
something a log should busy-wait on.

### D7 — The file records everything; the strip's threshold does not reach it

The file's default is every record at every level, in both build modes.

This is the direct opposite of `camera-activity-log`'s rule, and the contrast is
the point. A displayed log is a glance and can afford to decide in advance what
is interesting. A written log is an investigation, and the decision about what
mattered cannot be taken before the failure has happened — which is the same
argument that makes a production build's silence unacceptable in the first
place.

The two are therefore not coupled by anything. A future change narrowing what is
shown must not be able to narrow what is recorded, and the way to guarantee that
is that neither reads the other's threshold.

`IRIS_LOG_LEVEL` exists for a user who wants a smaller file, and `IRIS_LOG=0`
turns it off. Both are off the default path.

### D8 — Installed by the composition root, before anything logs

`main.mjs` constructs the sink and installs the tee immediately after
`loadEnvFile` — configuration has to be read first, and nothing between the two
logs — and closes it in the existing shutdown sequence.

No module self-registers, on `main-process-structure`'s rule that teardown
ordering stays central. The event tap reaches `renderer-bridge.mjs` as an
injected recorder defaulting to a no-op, so that module stays independently
constructible and its existing tests need no sink.

## Risks / Trade-offs

- **Wrapping a global write is invasive.** It is the price of capturing what we
  did not write. Mitigated by forwarding arguments and return value untouched,
  by idempotence, and by the tee being its own tested module rather than a few
  lines in the composition root.
- **A redaction pass that fails toward masking will mask innocent things.**
  Accepted, and stated in the spec as the intended direction.
- **Synchronous writes are on the main process's thread.** One syscall per
  record at human log rates. A pathological burst would be felt — and the
  mitigation for that is a level threshold, which already exists.
- **The log will contain whatever the app prints.** This change does not audit
  what that is; it redacts credentials and captures the rest. If something else
  sensitive is being printed today, this makes it durable — which is an argument
  for looking, not for not capturing.

## Open Questions

- Whether the default size and retention are right. They are a first guess sized
  so the total bound is small enough that nobody has to think about it, and the
  running app is what says whether the active file turns over uselessly fast.
- Whether the renderer's console warnings are worth capturing at all, or whether
  its exceptions and terminations are the whole of the value. Only a real
  session's volume can say.
