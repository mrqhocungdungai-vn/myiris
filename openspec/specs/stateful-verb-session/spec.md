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

The live session's **conversation** SHALL persist until an explicit user-controlled reset. Reset — ending a conversation, so that the next turn starts a fresh one with nothing carried over — SHALL occur only on the existing triggers: the UI "New" session action, a voice new-session request, or selecting a different project folder.

**Residency** is a separate thing from the conversation, and SHALL be specified separately. Exactly one conversation is resident at a time. A conversation that is asked for while a different one is resident SHALL take the resident slot, and the outgoing conversation SHALL be **retained and resumable**: its stored session id SHALL survive, so the next turn addressed to it continues it with its context intact.

Losing residency is therefore NOT a reset, and SHALL NOT be described or implemented as one. A reset discards a conversation; a handoff only stops holding a subprocess open for a conversation nothing is currently talking to. The two are distinguished by what happens to the stored session id: a reset clears it, a handoff leaves it alone.

A conversation SHALL NOT be torn down automatically **as a way of ending it**. It MAY lose residency automatically, on a request for a different conversation — and this SHALL be the only automatic cause. Time passing, unrelated activity, a stateless run executing in between, and **the closing of a surface the conversation is about** SHALL NOT end residency.

A resident conversation SHALL NEVER be delivered a turn belonging to a different conversation. Reusing whichever session happens to be resident, without checking that it is the conversation being addressed, would run that turn with the wrong context, the wrong model, and the wrong scoped skills, and would record it against the wrong stored conversation. Which conversation a resident session belongs to SHALL be checked before a turn is delivered into it, not assumed from the fact that a session exists.

A conversation MAY be opened **in anticipation of use** — warmed when the surface it serves becomes usable — provided the gates that govern any session opening are satisfied. A warmed conversation is an ordinary resident one in every respect except that no turn has been delivered into it, and that distinction SHALL be observable: a warmed transport SHALL NOT be reported as a conversation the user has taken part in, because the review gate decides whether to ask for consent by that question, and a warm that answered it wrongly would send the user's first sentence into a conversation they were never asked about.

#### Scenario: Session survives across unrelated activity

- **WHEN** other activity occurs between two stateful turns (e.g. a stateless run executes, or time passes)
- **THEN** the live session remains resident and the next stateful turn continues the same conversation

#### Scenario: Residency survives the surface closing

- **WHEN** the surface a conversation is about is closed and later reopened
- **THEN** the same conversation continues, with its context intact

#### Scenario: User resets the session

- **WHEN** the user starts a new session, requests a new session by voice, or picks a different project folder
- **THEN** the current live session is ended and the next stateful turn opens a fresh session

#### Scenario: Live session ends cleanly on app shutdown

- **WHEN** the app quits while a live session is resident
- **THEN** the session is closed without leaving an orphaned Claude process

#### Scenario: A different conversation takes the resident slot

- **WHEN** a turn is submitted for a conversation other than the one currently resident
- **THEN** the incoming conversation becomes resident, and the outgoing one keeps its stored session id so it can be resumed

#### Scenario: A handoff is not a reset

- **WHEN** a conversation has lost residency to another and is then addressed again
- **THEN** it resumes with its own context intact, having lost nothing but the subprocess

#### Scenario: A turn is never delivered into the wrong conversation

- **WHEN** a turn is submitted for one conversation while a different one is resident
- **THEN** it is not delivered into the resident session, and the conversation it belongs to is the one that receives it

#### Scenario: Losing residency is not reported as an ended session

- **WHEN** a conversation loses residency to another
- **THEN** nothing reports it as reset, ended, or lost, because its conversation was not

#### Scenario: A warmed conversation is not yet a conversation that has happened

- **WHEN** a conversation is opened in anticipation of use and the user then speaks to it for the first time
- **THEN** that first turn is reviewed on the same terms as one that opened the conversation itself

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

A stateless verb SHALL run as a one-shot headless run per request, independent of the live-session mechanism. The two shapes differ in **lifetime**, not in transport: both run on the Agent SDK's `query()`, a stateful verb as a resident session, a stateless one as a single run that ends when it finishes.

Statelessness SHALL mean holding no resident session. It SHALL NOT be taken to mean, on its own, that the run cannot ask: that is a separate declared property, and where it holds it holds for a stated reason rather than as a consequence of the run's shape. The implementing verb cannot ask **when the task list it works from is already settled** — the grilling that resolves ambiguity happened in the shaping verb, before a `tasks.md` existed, so the answers are already in the change and pausing to re-ask them is redundant. That reasoning SHALL NOT be extended to a run given no specification at all: there is no earlier grilling on that path to have resolved anything, so nothing about it is settled and the redundancy argument does not apply. See `verb-tool-surface` for what governs the permission itself.

Statefulness is not continuity: a stateless verb still resumes its own prior conversation by stored session id. What distinguishes it is that it holds no session between requests.

A stateless run that pauses on a question SHALL still be a one-shot run: it SHALL NOT become resident, and it SHALL NOT be kept alive beyond the request it was started for. Pausing is not residency — a paused run is the same single run, waiting.

#### Scenario: A stateless run is dispatched as a discrete run

- **WHEN** the user submits a stateless-verb task
- **THEN** the app starts a one-shot headless run for it and reports its result when the run completes

#### Scenario: A stateless verb holds no resident session

- **WHEN** a stateless run completes
- **THEN** no resident session remains alive between that verb's tasks

#### Scenario: A run that paused to ask is still not resident

- **WHEN** a stateless run pauses on a question, is answered, and finishes
- **THEN** no resident session remains alive afterwards, exactly as for a run that never paused

#### Scenario: Not asking is justified by settled work, not by the run's shape

- **WHEN** the implementing verb runs against a settled task list and against no specification at all
- **THEN** the first cannot ask because its answers were already collected, and that reason is not claimed for the second

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

