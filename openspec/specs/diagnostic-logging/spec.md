# diagnostic-logging Specification

## Purpose

Iris keeps a durable record of having run, so that "it stopped working" has
something to look at afterwards rather than only while it is happening.

Everything the app already says — what the main process prints, the events it
emits, and the renderer's own faults — is written to one redacted, size-rotated
JSONL file under the application's state root. This is a change of
**destination**, not of what is recorded: nothing reaches the file that the user
did not already have on their screen or in their terminal, and no credential
reaches it at all.

The distinction that matters: the on-screen activity strip is a glance at what
is happening now, and is deliberately shallow. This log is the complete account,
and it outlives the session that produced it.
## Requirements
### Requirement: The app keeps a durable record of what it did

The application SHALL write a diagnostic log to disk, and that log SHALL survive
the process that wrote it, so that a failure can be investigated after it
happened rather than only while it is happening.

The log SHALL be written under the application's own state root, declared in the
same single place every other path the application owns is declared.

Writing SHALL begin before the application performs any other work that logs, so
that a failure during startup is recorded rather than being the one class of
failure the log cannot describe.

Records SHALL be durable against the application crashing: a record accepted for
writing SHALL have been handed to the operating system before the call returns,
rather than held in an application buffer that a crash would discard. The last
lines before a crash are the reason the log exists.

#### Scenario: A record survives the session that wrote it

- **WHEN** the application runs, records activity, and exits
- **THEN** that activity is readable from disk afterwards

#### Scenario: A crash does not take the record of it

- **WHEN** the application crashes
- **THEN** the records written before the crash are on disk, including the most recent ones

#### Scenario: Startup is covered

- **WHEN** the application fails during startup
- **THEN** what it logged before failing is on disk

### Requirement: The log captures what the app already says, not a new stream

The log SHALL be assembled from the diagnostics the application already
produces. Introducing this capability SHALL NOT require editing the places that
log, and SHALL NOT create a second, parallel account of the same events that
could drift from the first.

It SHALL capture, at minimum:

- everything the main process writes to its standard output and standard error,
  including output originating from dependencies rather than from the
  application's own code;
- the application's internal event stream, including the entries surfaced
  elsewhere in the interface;
- faults arising in the user interface process — its uncaught exceptions, its
  reported warnings and errors, and its termination — which SHALL be captured
  without requiring any flag to be set.

Each record SHALL identify which of these it came from, so that a reader can
tell the application's own account from what a dependency happened to print.

Capturing SHALL NOT change what any existing caller writes, where it writes it,
or whether it appears where it appeared before.

#### Scenario: Existing diagnostics are captured where they are already written

- **WHEN** any part of the main process writes a diagnostic the way it already does
- **THEN** that line appears in the log, and it also still appears wherever it appeared before

#### Scenario: A user-interface fault leaves a trace

- **WHEN** the interface process throws an uncaught exception, reports an error, or terminates
- **THEN** the log records it, with no flag having been set to enable that

#### Scenario: A record says where it came from

- **WHEN** the log is read
- **THEN** each record identifies its source, distinguishing the application's own account from a dependency's output

### Requirement: A credential is never written to the log

Every record SHALL pass a redaction step before it is written, and material that
appears to be a credential SHALL be masked rather than recorded.

This SHALL apply to every source without exception, including output the
application did not produce itself. A dependency printing a token is exactly the
case the application cannot fix at the source, and therefore the case the
redaction exists for.

Redaction SHALL fail toward masking: where it is unclear whether a value is a
credential, it SHALL be masked. A log slightly harder to read is recoverable; a
credential written to a file and then copied into a bug report is not.

The masked form SHALL indicate that something was removed, rather than removing
it silently — a reader must be able to tell the difference between "no token was
present" and "a token was here".

#### Scenario: A credential in a captured line is masked

- **WHEN** a line containing a credential is captured, from any source
- **THEN** the credential does not appear in the log, and the record shows that something was masked

#### Scenario: A dependency's output is redacted on the same terms

- **WHEN** the credential appears in output the application did not itself write
- **THEN** it is masked exactly as the application's own output would be

### Requirement: The log is bounded on disk and never grows without limit

The log SHALL be rotated by size: once the active file reaches a configured
size, it SHALL be set aside and a new active file started.

A configured number of previous files SHALL be retained and the rest deleted, so
that total consumption has a stated upper bound the user can compute from the
configuration rather than discover from a full disk.

Rotation SHALL NOT lose records that were accepted for writing, and SHALL NOT
require the application to restart.

#### Scenario: The active file is set aside at its size limit

- **WHEN** the active log file reaches its configured size
- **THEN** it is set aside, a new active file is started, and writing continues uninterrupted

#### Scenario: Old files are deleted, not accumulated

- **WHEN** more files have been set aside than the configured number to retain
- **THEN** the oldest are deleted, and total consumption stays within the bound the configuration states

### Requirement: The log records everything by default, at every level

The log's default depth SHALL be every record, at every level, regardless of how
the application was built or started.

This is deliberately unlike any depth used for display. A displayed log is a
glance and can afford to decide in advance what is interesting; a written log is
an investigation, and the decision about what mattered cannot be taken before
the thing that went wrong has happened. Nothing SHALL couple the two, so that
narrowing what is shown can never narrow what is recorded.

A minimum level SHALL be configurable for users who want a smaller file, and
writing SHALL be able to be switched off entirely. Both SHALL be off the default
path: the shipped behavior is to record everything.

#### Scenario: A production build records as much as a development build

- **WHEN** the application is run as built for production and records routine activity
- **THEN** that activity is in the log, at the same depth a development run would have written

#### Scenario: Narrowing the display does not narrow the file

- **WHEN** something is hidden from a display of the log
- **THEN** it is still written to the file

#### Scenario: Recording can be turned off

- **WHEN** the user configures logging off
- **THEN** nothing is written and no log file is created

### Requirement: Logging never takes the app down with it

A failure to write the log SHALL NOT propagate to the application. A full disk,
a read-only location, a deleted directory, or a permission error SHALL cost the
log and nothing else.

This SHALL hold for every stage — opening, writing, rotating and closing — and
SHALL NOT depend on the caller wrapping anything.

A failure to write SHALL NOT be reported by attempting to write it to the same
log, and SHALL NOT produce output at a rate proportional to the failures.

Capturing output SHALL NOT interfere with that output reaching its original
destination, and SHALL NOT alter what is written there.

#### Scenario: An unwritable location costs only the log

- **WHEN** the log location cannot be written to
- **THEN** the application starts and runs normally, and the failure is not surfaced as an application error

#### Scenario: A failing log does not flood

- **WHEN** writing fails repeatedly
- **THEN** the failure is not reported once per failed write

#### Scenario: Capture does not disturb the original destination

- **WHEN** the main process writes a diagnostic while capture is installed
- **THEN** that output still reaches its original destination, unchanged

