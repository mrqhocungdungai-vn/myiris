## Purpose

The PO runs as a single persistent Agent SDK conversation (one continuous context window) with an explicit lifecycle — created on first PO turn, kept alive across follow-ups, reset only on the existing user-controlled triggers (New session, voice new-session, project-folder change) — while DEV remains a one-shot headless subprocess.
## Requirements
### Requirement: PO runs as a persistent live session

The PO role SHALL run as a single long-lived Agent SDK session (one continuous context window) held in the Electron main process, rather than a one-shot process spawned per turn. Follow-up PO turns SHALL be delivered into the existing live session without spawning a new process or replaying the transcript.

#### Scenario: First PO turn opens a live session

- **WHEN** the user submits the first PO task in a workstream that has no live PO session
- **THEN** the app creates a persistent Agent SDK session for the PO in that workstream and keeps it resident after the turn completes

#### Scenario: Follow-up PO turn reuses the live session

- **WHEN** the user submits a further PO task in a workstream that already has a live PO session
- **THEN** the app delivers the task as a new user turn into the existing session
- **AND** no new `claude -p` process is spawned and no transcript replay is performed for that turn

#### Scenario: PO remembers earlier turns within the session

- **WHEN** a PO follow-up references work from an earlier turn in the same session (e.g. "the PRD you wrote")
- **THEN** the PO responds with that prior context intact, because it is the same continuous conversation

### Requirement: PO session lifecycle is user-controlled

The live PO session SHALL persist until an explicit user-controlled reset and SHALL NOT be torn down automatically between turns. Reset SHALL occur only on the existing triggers: the UI "New" session action, a voice new-session request, or selecting a different project folder.

#### Scenario: Session survives across unrelated activity

- **WHEN** other activity occurs between two PO turns (e.g. a DEV run executes, or time passes)
- **THEN** the live PO session remains resident and the next PO turn continues the same conversation

#### Scenario: User resets the session

- **WHEN** the user starts a new session, requests a new session by voice, or picks a different project folder
- **THEN** the current live PO session is ended and the next PO turn opens a fresh session

#### Scenario: Live session ends cleanly on app shutdown

- **WHEN** the app quits while a live PO session is resident
- **THEN** the session is closed without leaving an orphaned Claude process

### Requirement: DEV remains a one-shot headless run

The DEV role SHALL continue to run as a one-shot `claude -p` subprocess per issue, independent of the PO's live-session mechanism. Introducing the PO live session SHALL NOT change how DEV runs are dispatched or completed.

#### Scenario: DEV run is dispatched as a discrete process

- **WHEN** the user submits a DEV task
- **THEN** the app spawns a one-shot headless `claude -p` subprocess for that issue and reports its result on process exit

#### Scenario: DEV does not hold a resident session

- **WHEN** a DEV run completes
- **THEN** no resident DEV session remains alive between DEV tasks

### Requirement: PO and DEV serialize without deadlock

The task queue SHALL treat the PO as a resident conversation whose turns are serialized within the session, and DEV runs as discrete queued tasks, such that a resident PO session never blocks DEV runs from starting and vice versa.

#### Scenario: PO turn queued while a DEV run is active

- **WHEN** a PO turn is submitted while a DEV run is in progress
- **THEN** the PO turn is accepted and begins once the shared execution slot is free, without discarding the live PO session

#### Scenario: DEV run submitted while PO session is idle-resident

- **WHEN** a DEV task is submitted while a PO session is resident but not mid-turn
- **THEN** the DEV run proceeds and the idle PO session is left intact

### Requirement: PO session enables skills explicitly

The stateful PO Agent SDK session SHALL enable skills explicitly (`skills: 'all'`) so the globally-installed skills load for the live session regardless of `cwd`, while keeping `settingSources` at its default (all sources) so global `user` settings still apply.

#### Scenario: Global skills are available to the live PO session

- **WHEN** a PO turn runs in a workstream whose `cwd` has no project-local skill config
- **THEN** the live PO session can invoke the globally-installed skills (e.g. `grilling`, the OpenSpec workflow skills)

### Requirement: PO turns are voice control prompts

Iris's PO voice layer SHALL drive the live PO session with short control intents (grill, propose, task-status, archive) rather than hand-authored PRD/issue prompts; the Claude-side PO owns the process and produces the OpenSpec artifacts.

#### Scenario: Voice controls the process, Claude executes it

- **WHEN** the user issues a control intent by voice (e.g. "grill", "propose the change", "are there tasks left?")
- **THEN** the voice layer delivers that intent to the live PO session
- **AND** the Claude-side PO performs the corresponding OpenSpec step, without the voice layer composing the spec content itself

### Requirement: An in-flight PO turn always settles

A PO turn delivered into the live session SHALL reach a terminal outcome — never remain permanently unsettled — regardless of how the underlying SDK stream ends. This SHALL hold on all three endings: the stream completes normally, the session is torn down while the turn is in flight, and the stream throws. Because a settled turn is what releases the shared execution slot, an unsettled turn holds that slot against every subsequent run, so the settlement is not optional.

#### Scenario: Turn settles when the stream ends without throwing

- **WHEN** the SDK stream backing an in-flight PO turn ends normally (no error thrown), as happens when the session's message channel is closed
- **THEN** the turn settles rather than hanging, and the run holding the execution slot is finalized so the slot is released for the next run

#### Scenario: Turn settles when the session is torn down mid-turn

- **WHEN** the user resets the session (New session, voice new-session, or picking a different project folder) while a PO turn is in flight, closing the live session
- **THEN** the in-flight turn settles, the run is finalized, the slot is released, and a subsequent PO turn or DEV run starts without queueing behind the torn-down turn

#### Scenario: Turn settles when the stream throws

- **WHEN** the SDK stream backing an in-flight PO turn throws
- **THEN** the turn settles with that error and the run is finalized

### Requirement: A settled PO turn attributes why it ended

When an in-flight PO turn settles because its session ended rather than because the turn produced its own result, the terminal status SHALL attribute the reason: a user-initiated teardown SHALL finalize as `cancelled`, and any other unexpected end — a silently-ended stream, a dead subprocess, or a thrown error — SHALL finalize as `error`. The two SHALL NOT be collapsed into a single status, because a silent fault must be distinguishable from a deliberate reset by everything downstream of the queue.

#### Scenario: User teardown is attributed as cancelled

- **WHEN** a PO turn settles because the user reset the session
- **THEN** the run is finalized as `cancelled`

#### Scenario: An unexpected end is attributed as an error

- **WHEN** a PO turn settles because its stream ended or died without a user-initiated teardown and without producing a result
- **THEN** the run is finalized as `error`

