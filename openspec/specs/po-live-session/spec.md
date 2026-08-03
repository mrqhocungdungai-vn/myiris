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
- **AND** no new run is started and no transcript replay is performed for that turn

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

The DEV role SHALL run as a one-shot headless run per issue, independent of the PO's live-session mechanism. The two roles differ in **lifetime**, not in transport: both run on the Agent SDK's `query()`, PO as a resident session that can pause to ask, DEV as a single run that never asks. DEV is stateless because the task list it works from is already settled — the grilling that resolves ambiguity happens in PO, before a `tasks.md` exists.

#### Scenario: DEV run is dispatched as a discrete process

- **WHEN** the user submits a DEV task
- **THEN** the app starts a one-shot headless run for that issue and reports its result when the run completes

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

The stateful PO Agent SDK session SHALL enable skills explicitly, as a caller-supplied list naming exactly the skills the PO role invokes, so they load for the live session regardless of `cwd`. The list SHALL NOT be "every skill the bundle ships": a run's capability surface is a property of what it was asked to do.

`settingSources` SHALL exclude the `user` scope. Iris ships the skills the personas invoke inside the app and must neither depend on, nor disturb, whatever the user has installed in their own Claude Code. The `project` scope SHALL be kept, so a session still picks up the settings of the repository it is working in.

#### Scenario: The PO role's own skills are available to the live session

- **WHEN** a PO turn runs in a workstream whose `cwd` has no project-local skill config
- **THEN** the live PO session can invoke the skills its role needs (grilling and the OpenSpec workflow skills), loaded from the app's own bundle

#### Scenario: The live session cannot reach another role's skills

- **WHEN** a PO turn runs
- **THEN** skills belonging to unrelated workflows are not available to it

#### Scenario: The user's own Claude Code is neither read nor required

- **WHEN** a PO session is created on a machine with its own Claude Code install
- **THEN** the session loads no settings from the user scope, and behaves identically on a machine that has never had Claude Code installed
### Requirement: PO turns are voice control prompts

Each PO turn SHALL be a short control intent from the voice layer, not a written specification — the voice layer steers, the PO does the analysis.

The PO SHALL be told, through a mechanism the runtime actually reads, that it is invoked from voice as a live continuous session, that it may pause at real decision points and wait for an answer, and that it should apply and record sensible defaults for lower-stakes calls. This instruction SHALL be produced by the same system-prompt policy that serves the headless role, so the two cannot drift apart, and SHALL differ from it only in the documented role-specific clause.

PO SHALL run on the same base system prompt as the headless role. It SHALL NOT fall back to the runtime's minimal default prompt while the headless role receives the full one — a difference that is invisible at the call site and changes how the role behaves.

#### Scenario: A control intent drives a full PO turn

- **WHEN** the voice layer sends a short control intent
- **THEN** the PO performs the analysis itself and reports a concise result, without the voice layer having written a specification

#### Scenario: The live-session instruction reaches the model

- **WHEN** a PO session is created
- **THEN** the live-session instruction is delivered through a mechanism the installed runtime reads, verified by a test on the options handed to the runtime

#### Scenario: Both roles share a base prompt

- **WHEN** a PO session and a headless run are configured
- **THEN** their base system prompt is identical, differing only in the documented role-specific clause

### Requirement: An in-flight PO turn always settles

A PO turn SHALL always reach a terminal outcome. A turn SHALL NOT be left waiting when its session ends, is torn down, or fails.

Cancellation of a PO turn SHALL go through the same caller-facing path as cancellation of a headless run, so a caller does not need to know a run's lifetime in order to stop it. Where the runtime provides an interrupt for a turn already in progress, that SHALL be used rather than tearing down the transport, and any queued work that survives the interrupt SHALL be recorded rather than reported as cancelled.

#### Scenario: A turn settles when its session ends

- **WHEN** a PO session ends while a turn is in flight
- **THEN** the turn settles with an outcome attributing why it ended

#### Scenario: Cancellation is lifetime-agnostic

- **WHEN** a PO turn is cancelled
- **THEN** it is cancelled through the same path used to cancel a headless run

#### Scenario: An interrupt reports what survived

- **WHEN** a PO turn is interrupted and queued work survives
- **THEN** that work is recorded and reported rather than described as cancelled

### Requirement: A settled PO turn attributes why it ended

When an in-flight PO turn settles because its session ended rather than because the turn produced its own result, the terminal status SHALL attribute the reason: a user-initiated teardown SHALL finalize as `cancelled`, and any other unexpected end — a silently-ended stream, a dead subprocess, or a thrown error — SHALL finalize as `error`. The two SHALL NOT be collapsed into a single status, because a silent fault must be distinguishable from a deliberate reset by everything downstream of the queue.

#### Scenario: User teardown is attributed as cancelled

- **WHEN** a PO turn settles because the user reset the session
- **THEN** the run is finalized as `cancelled`

#### Scenario: An unexpected end is attributed as an error

- **WHEN** a PO turn settles because its stream ended or died without a user-initiated teardown and without producing a result
- **THEN** the run is finalized as `error`

