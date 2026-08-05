## Purpose

A stateful verb runs as a single persistent Agent SDK conversation (one continuous context window) with an explicit lifecycle — created on its first turn, kept alive across follow-ups, reset only on the existing user-controlled triggers (New session, voice new-session, project-folder change) — while a stateless verb remains a one-shot headless run.
## Requirements
### Requirement: A stateful verb runs as a persistent live session

A stateful verb SHALL run as a single long-lived Agent SDK session (one continuous context window) held in the Electron main process, rather than a one-shot process spawned per turn. Follow-up stateful turns SHALL be delivered into the existing live session without spawning a new process or replaying the transcript.

#### Scenario: The first stateful turn opens a live session

- **WHEN** the user submits the first stateful-verb task in a workstream that has no live session
- **THEN** the app creates a persistent Agent SDK session for it in that workstream and keeps it resident after the turn completes

#### Scenario: A follow-up stateful turn reuses the live session

- **WHEN** the user submits a further stateful-verb task in a workstream that already has a live session
- **THEN** the app delivers the task as a new user turn into the existing session
- **AND** no new run is started and no transcript replay is performed for that turn

#### Scenario: A stateful verb remembers earlier turns within the session

- **WHEN** a stateful follow-up references work from an earlier turn in the same session (e.g. "the PRD you wrote")
- **THEN** it responds with that prior context intact, because it is the same continuous conversation

### Requirement: The live session's lifecycle is user-controlled

The live session SHALL persist until an explicit user-controlled reset and SHALL NOT be torn down automatically between turns. Reset SHALL occur only on the existing triggers: the UI "New" session action, a voice new-session request, or selecting a different project folder.

#### Scenario: Session survives across unrelated activity

- **WHEN** other activity occurs between two stateful turns (e.g. a stateless run executes, or time passes)
- **THEN** the live session remains resident and the next stateful turn continues the same conversation

#### Scenario: User resets the session

- **WHEN** the user starts a new session, requests a new session by voice, or picks a different project folder
- **THEN** the current live session is ended and the next stateful turn opens a fresh session

#### Scenario: Live session ends cleanly on app shutdown

- **WHEN** the app quits while a live session is resident
- **THEN** the session is closed without leaving an orphaned Claude process

### Requirement: Verbs that continue one conversation share one live session

Verbs that represent the same conversation in different media SHALL share a single
resident session, so moving between them continues one conversation with its context
intact rather than starting a second one.

The consequences SHALL be declared rather than hidden: verbs sharing a live session
cannot run on different models while that session is alive, and whichever is called
first is what opens it.

This is stated here rather than in `verb-tool-surface` because it specifies what the
session *does*. The registry declares which verbs share a session key; this capability
owns what follows from sharing one.

#### Scenario: Switching medium keeps the context

- **WHEN** a conversation that began by voice moves to the shared visual medium
- **THEN** the run in the new medium has the context of everything already discussed

#### Scenario: The model coupling is declared

- **WHEN** the model is changed for one verb sharing a live session
- **THEN** the change applies to every verb sharing that session, and the system says so rather than appearing to change one

### Requirement: A stateless verb remains a one-shot headless run

A stateless verb SHALL run as a one-shot headless run per request, independent of the live-session mechanism. The two shapes differ in **lifetime**, not in transport: both run on the Agent SDK's `query()`, a stateful verb as a resident session that can pause to ask, a stateless one as a single run that never asks. The implementing verb is stateless because the task list it works from is already settled — the grilling that resolves ambiguity happens in the shaping verb, before a `tasks.md` exists.

Statefulness is not continuity: a stateless verb still resumes its own prior conversation by stored session id. What it cannot do is pause mid-turn and wait for an answer.

#### Scenario: A stateless run is dispatched as a discrete run

- **WHEN** the user submits a stateless-verb task
- **THEN** the app starts a one-shot headless run for it and reports its result when the run completes

#### Scenario: A stateless verb holds no resident session

- **WHEN** a stateless run completes
- **THEN** no resident session remains alive between that verb's tasks

### Requirement: Stateful turns and stateless runs serialize without deadlock

The task queue SHALL treat a stateful verb as a resident conversation whose turns are serialized within the session, and stateless runs as discrete queued tasks, such that a resident session never blocks stateless runs from starting and vice versa.

#### Scenario: A stateful turn is queued while a stateless run is active

- **WHEN** a stateful turn is submitted while a stateless run is in progress
- **THEN** the stateful turn is accepted and begins once the shared execution slot is free, without discarding the live session

#### Scenario: A stateless run is submitted while the session is idle-resident

- **WHEN** a stateless task is submitted while a session is resident but not mid-turn
- **THEN** the stateless run proceeds and the idle session is left intact

### Requirement: The live session enables skills explicitly

The stateful Agent SDK session SHALL enable skills explicitly, as a caller-supplied list naming exactly the skills that verb invokes, so they load for the live session regardless of `cwd`. The list SHALL NOT be "every skill the bundle ships": a run's capability surface is a property of what it was asked to do.

`settingSources` SHALL exclude the `user` scope. Iris ships the skills the personas invoke inside the app and must neither depend on, nor disturb, whatever the user has installed in their own Claude Code. The `project` scope SHALL be kept, so a session still picks up the settings of the repository it is working in.

#### Scenario: The verb's own skills are available to the live session

- **WHEN** a stateful turn runs in a workstream whose `cwd` has no project-local skill config
- **THEN** the live session can invoke the skills that verb needs (grilling and the OpenSpec workflow skills), loaded from the app's own bundle

#### Scenario: The live session cannot reach another verb's skills

- **WHEN** a stateful turn runs
- **THEN** skills belonging to unrelated workflows are not available to it

#### Scenario: The user's own Claude Code is neither read nor required

- **WHEN** a live session is created on a machine with its own Claude Code install
- **THEN** the session loads no settings from the user scope, and behaves identically on a machine that has never had Claude Code installed
### Requirement: Stateful turns are voice control prompts

Each stateful turn SHALL be a short control intent from the voice layer, not a written specification — the voice layer steers, the verb does the analysis.

A stateful verb SHALL be told, through a mechanism the runtime actually reads, that it is invoked from voice as a live continuous session, that it may pause at real decision points and wait for an answer, and that it should apply and record sensible defaults for lower-stakes calls. This instruction SHALL be produced by the same system-prompt policy that serves a stateless run, so the two cannot drift apart, and SHALL differ from it only in the documented shape-specific clause.

A stateful verb SHALL run on the same base system prompt as a stateless run. It SHALL NOT fall back to the runtime's minimal default prompt while a stateless run receives the full one — a difference that is invisible at the call site and changes how the verb behaves.

#### Scenario: A control intent drives a full stateful turn

- **WHEN** the voice layer sends a short control intent
- **THEN** the verb performs the analysis itself and reports a concise result, without the voice layer having written a specification

#### Scenario: The live-session instruction reaches the model

- **WHEN** a live session is created
- **THEN** the live-session instruction is delivered through a mechanism the installed runtime reads, verified by a test on the options handed to the runtime

#### Scenario: Both run shapes share a base prompt

- **WHEN** a live session and a headless run are configured
- **THEN** their base system prompt is identical, differing only in the documented shape-specific clause

### Requirement: An in-flight stateful turn always settles

A stateful turn SHALL always reach a terminal outcome. A turn SHALL NOT be left waiting when its session ends, is torn down, or fails.

This is a property of session lifetime, and has no analogue in a one-shot run: a resident session's stream can end *without throwing* — which is exactly what closing the session produces, and also what a silently-dying subprocess produces — so a turn awaiting that stream can hang while nothing reports an error. That defect held the execution slot forever and required an app restart.

Cancellation is not specified here. A caller stops a run through one lifetime-agnostic path owned by `run-execution-queue`, which holds the slot the stop releases; this capability states only that however a turn ends, it ends.

#### Scenario: A turn settles when its session ends

- **WHEN** a live session ends while a turn is in flight
- **THEN** the turn settles with an outcome attributing why it ended

#### Scenario: A stream that ends without throwing still settles the turn

- **WHEN** a session's stream ends normally rather than by error, while a turn awaits it
- **THEN** the turn settles rather than waiting on a stream that will produce nothing further

### Requirement: A settled stateful turn attributes why it ended

When an in-flight stateful turn settles because its session ended rather than because the turn produced its own result, the terminal status SHALL attribute the reason: a user-initiated teardown SHALL finalize as `cancelled`, and any other unexpected end — a silently-ended stream, a dead subprocess, or a thrown error — SHALL finalize as `error`. The two SHALL NOT be collapsed into a single status, because a silent fault must be distinguishable from a deliberate reset by everything downstream of the queue.

#### Scenario: User teardown is attributed as cancelled

- **WHEN** a stateful turn settles because the user reset the session
- **THEN** the run is finalized as `cancelled`

#### Scenario: An unexpected end is attributed as an error

- **WHEN** a stateful turn settles because its stream ended or died without a user-initiated teardown and without producing a result
- **THEN** the run is finalized as `error`
