# run-execution-queue

## Purpose
Names the execution behavior the delegation model already relies on: the one-at-a-time Claude execution slot shared by every run, whatever verb started it, its queueing/cancellation lifecycle, and the `claude_task_update` event stream it produces.
## Requirements
### Requirement: Single execution slot
The system SHALL allow at most one Claude **job** to be mid-execution at any time, system-wide, where a job is the start of new work: a stateless run, a plain task, or the opening of a resident conversation. A job submitted while the slot is free SHALL start immediately; one submitted while the slot is held SHALL be queued FIFO. Starting a run SHALL be able to fail synchronously (for example, a run rejected at a start-time gate or a transport that fails to launch); when it does, the submitter SHALL receive the run's terminal status rather than a `started` acknowledgement, so the submitter is never told a run started when it did not.

A **turn delivered into a conversation that is already resident** is not a job and SHALL NOT contend for that slot. "Already resident" means a live session exists to deliver into — including one opened in anticipation of use — and SHALL NOT be conflated with whether the user has yet taken part in that conversation, which is the separate question the review gate asks. Such a turn shares an open context window, cannot begin a second worker, and SHALL be serialized per conversation instead: one turn at a time within a conversation, with the next turn waiting for that conversation, not for the system.

A resident turn running beside a job SHALL be bounded by what it is allowed to do rather than by when it may run: it SHALL be confined to the tools and skills its conversation declares, and a turn that would begin repository work SHALL be refused rather than run alongside an unrelated job.

A resident turn SHALL carry its own silence watchdog. The slot's watchdog belongs to the run holding the slot, so a turn outside the slot would otherwise run unwatched — which would trade waiting too long for wedging unnoticed. A turn's own progress SHALL reset only its own watchdog, and SHALL NOT keep an unrelated run alive.

#### Scenario: Submit while idle
- **WHEN** a task is submitted, no run holds the execution slot, and the run begins running
- **THEN** the run acquires the slot and starts, and the submitter receives `status: "started"` with the `run_id`

#### Scenario: Submit rejected synchronously at start
- **WHEN** a task is submitted while the slot is free but the run is finalized during start (e.g. a run rejected for lack of an open change, or a transport that fails to launch)
- **THEN** the submitter receives the run's terminal status (`failed` or `error`) with the reason, not `status: "started"`

#### Scenario: Submit while busy
- **WHEN** a task is submitted while another run holds the execution slot
- **THEN** the run is appended to the queue, the submitter receives `status: "queued"` with its 1-based queue position, and a `claude_task_update` with status `queued` and that position is emitted

#### Scenario: A conversation turn does not wait for unrelated work

- **WHEN** the user speaks to an already-resident canvas conversation while a long unrelated run holds the execution slot
- **THEN** the turn is delivered and answered without waiting for that run to finish

#### Scenario: The first thing said to a warmed conversation does not wait either

- **WHEN** the canvas has been opened, its conversation warmed, and the user says the first thing to it while an unrelated run holds the slot
- **THEN** that turn is delivered without waiting, and is still subject to review on the same terms as before

#### Scenario: Two turns of one conversation still serialize

- **WHEN** a second utterance arrives while the same conversation is mid-turn
- **THEN** it is handled after the current turn of that conversation, not concurrently with it

#### Scenario: A wedged conversation turn is stopped, and the conversation survives

- **WHEN** a resident turn makes no progress for the configured idle bound
- **THEN** that turn is terminated and reported as such, and the conversation remains open

#### Scenario: A talkative conversation does not keep a silent job alive

- **WHEN** a resident turn reports progress while an unrelated run holds the slot in silence
- **THEN** the silent run still reaches its own idle bound

#### Scenario: A conversation turn cannot start repository work

- **WHEN** a resident conversation turn attempts work outside the tools and skills its conversation declares
- **THEN** the attempt is refused, and the refusal is reported rather than silently dropped

### Requirement: Dequeue skips cancelled runs
When the slot is released, the system SHALL start the oldest queued run that is still in status `queued`, discarding queue entries whose runs were cancelled (or are otherwise no longer eligible) without starting them.

#### Scenario: Next eligible run starts on release
- **WHEN** the active run finalizes and the queue holds a run in status `queued`
- **THEN** that run acquires the slot and starts

#### Scenario: Cancelled queued run is skipped
- **WHEN** the active run finalizes and the oldest queue entry refers to a run that was cancelled while waiting
- **THEN** that entry is discarded and the next run still in status `queued` (if any) starts instead

### Requirement: A run finalizes exactly once
Every run SHALL reach exactly one terminal status (`completed`, `failed`, `error`, or `cancelled`), even when the underlying transport reports failure through multiple callbacks (e.g. a spawn failure firing both `error` and `close`). Finalization SHALL emit exactly one terminal `claude_task_update` and trigger exactly one completion announcement.

Finalization SHALL release the execution slot, disarm the idle bound, and advance the queue **only for the run that currently holds the slot**. Finalizing a run that does not hold the slot SHALL still bring that run to its single terminal status and emit its one terminal update, but SHALL NOT release or advance the slot, and SHALL NOT disarm the idle bound of whichever run holds the slot — so a finalize targeting a non-slot-holding run can never steal the active run's slot or cancel its idle watchdog. Because a queued run is brought to `cancelled` without being routed through finalization (see "Stopping a run"), and every finalization in normal operation targets the run holding the slot, this guard changes no observed behavior; it makes the slot-ownership invariant structural rather than dependent on caller discipline.

#### Scenario: Double finalization is a no-op
- **WHEN** a run's transport reports termination twice (spawn `error` followed by `close`)
- **THEN** only the first report finalizes the run; the second produces no event, no announcement, and no queue advance

#### Scenario: Finalization releases the slot
- **WHEN** a run that holds the execution slot finalizes with any terminal status
- **THEN** the execution slot is released, its idle bound is disarmed, and the dequeue rule (above) runs

#### Scenario: Finalizing a run that does not hold the slot leaves the active run untouched
- **WHEN** `finalize` is called with the id of a run that is not the one currently holding the slot (and that run was not already finalized)
- **THEN** that run reaches its single terminal status and emits exactly one terminal update
- **AND** the run holding the slot keeps the slot and its idle bound, and no queued run is started as a side effect

### Requirement: One declared status vocabulary
Run lifecycle status SHALL come from a single declared vocabulary, split into stored statuses (`queued`, `running`, `completed`, `failed`, `error`, `cancelled`, `limited` — persisted on the run record) and emitted-only lifecycle markers (`starting`, `started` — appearing only on `claude_task_update` events). No other status strings SHALL appear on run records or task-update events, and the set of terminal statuses SHALL be defined in exactly one place.

`limited` is the outcome of a run stopped by its turn or spend ceiling. It is a stored, terminal status distinct from `failed` and `error`, because a run that reached a limit and a run that broke call for different responses from the user, and reporting them alike hides which happened.

#### Scenario: Lifecycle emissions use the vocabulary
- **WHEN** a run moves through submit → start → activity → finalize
- **THEN** the emitted `claude_task_update` statuses are drawn only from the declared vocabulary (`queued`/`starting` at submit, `started` at transport start, `running` for activity, one terminal status at finalization)

#### Scenario: A ceiling termination is in the vocabulary, not beside it
- **WHEN** a run terminates because it reached its turn or spend ceiling
- **THEN** its stored status is `limited`, drawn from the same declared vocabulary, and every consumer that treats a run as finished recognises it as terminal without a special case

### Requirement: Single task-update projection
The `claude_task_update` event payload SHALL be produced by one projection from the run record, so every emission carries the same field set (`run_id`, `task`, `agent`, `model`, `claude_session_id`, `usage`, plus status-specific extras such as queue `position` or `urgency`) rather than hand-built per call site.

`usage` carries what the run cost as the runtime reported it, and is absent until the run's result message lands. An emission that carries no figures SHALL NOT overwrite figures already recorded for that run.

#### Scenario: Consistent fields across lifecycle
- **WHEN** `claude_task_update` events for one run are compared across its lifecycle (queued, started, running, terminal)
- **THEN** the shared fields are populated identically from the run record at each point in time, with omissions only where a value does not exist yet (e.g. `claude_session_id` before the transport reports one, or `usage` before the run completes)

### Requirement: Stopping a run
Stopping a queued run SHALL remove it from the queue and bring it to the `cancelled` terminal state immediately — emitting exactly one `claude_task_update` with status `cancelled` and marking the run as finalized so it cannot be finalized again — but SHALL NOT route it through the slot-release path: it SHALL NOT release or advance the execution slot and SHALL NOT trigger a completion announcement, because a queued run never held the slot and never started. Stopping the active run SHALL mark it `cancelled` and signal its transport; for a subprocess transport this SHALL target the run's whole process group (SIGTERM to the group), so descendant tool subprocesses spawned by the run are terminated too and never left orphaned — the queue SHALL delegate the actual group-aware kill to an injected transport-kill hook rather than embedding process-group or platform knowledge itself. The slot SHALL be released through the normal finalize-on-termination path, not by the stop call itself. Stopping the active run whose transport has no child process (a stateful turn) SHALL likewise mark it `cancelled` and cancel the in-progress turn through a transport-agnostic cancel hook, bringing the run to the `cancelled` terminal state and releasing the slot through the normal finalize path — never leaving the turn running to completion. The resident stateful session SHALL survive the cancellation, or be torn down in a way that preserves continuity via its stored session id so a subsequent turn continues the same conversation; only the cancelled turn's in-flight work is discarded.

A signalled transport that does not terminate SHALL NOT hold the slot indefinitely. After a bounded grace period following the signal, the system SHALL escalate to an unconditional kill of the same process group, and SHALL finalize the run and release the slot even if the transport never reports termination itself. For a stateful turn (no subprocess), the idle-time bound remains the backstop if a cancelled turn fails to settle.

#### Scenario: Stop a queued run
- **WHEN** `stop` is called with the id of a run in status `queued`
- **THEN** the run leaves the queue, reaches the `cancelled` terminal state, is marked finalized, and a `claude_task_update` with status `cancelled` is emitted
- **AND** no other run is started and no completion is announced, since the run never held the slot

#### Scenario: Cancelling a queued run does not disturb the active run
- **WHEN** `stop` is called on a queued run while another run holds the execution slot
- **THEN** the active run keeps the slot and continues running, and no second run is started as a side effect of the cancel

#### Scenario: A cancelled queued run cannot be re-finalized
- **WHEN** `finalize` is later called with the id of a run that was cancelled while queued
- **THEN** the call is a no-op — no further event, no announcement, and no queue advance — because the run is already marked finalized

#### Scenario: Stop the active stateless run
- **WHEN** `stop` is called with the id of the active run and that run has a child process
- **THEN** the run is marked `cancelled` and its process group is sent SIGTERM through the injected kill hook; when the process closes, the run finalizes as `cancelled` and the slot is released
- **AND** no descendant tool subprocess of that run is left running

#### Scenario: Stop an active stateful turn
- **WHEN** `stop` is called with the id of the active run and that run has no child process (a stateful turn)
- **THEN** the run is marked `cancelled`, the in-progress turn is cancelled through the cancel hook, the run finalizes as `cancelled` exactly once, and the slot is released
- **AND** the turn does not continue to completion, while the resident stateful session remains available (or resumable via its stored session id) for the next turn

#### Scenario: A signalled process ignores the signal
- **WHEN** `stop` is called on the active run, SIGTERM is sent to its process group, and the process has not closed when the grace period elapses
- **THEN** the process group is killed unconditionally through the injected kill hook, the run is finalized as `cancelled` exactly once, and the slot is released

### Requirement: The execution slot has a bounded lifetime

A run SHALL NOT hold the execution slot indefinitely without producing progress. The system SHALL bound the slot on **idle time** — the interval since the run last produced a progress signal — not on total elapsed runtime, so that a long but healthy run is never terminated for being long.

The bound SHALL be configurable through an explicit environment budget (`IRIS_RUN_IDLE_TIMEOUT_MS`) with a documented default, consistent with the other explicit budgets in the system.

Only the run currently holding the slot SHALL be subject to the bound. A queued run SHALL NOT be timed, since it is not consuming the slot.

#### Scenario: A healthy long run is not terminated

- **WHEN** a run produces progress signals at intervals shorter than the idle bound, for a total runtime far exceeding that bound
- **THEN** the run is never terminated by the bound and keeps the slot until its transport finalizes it normally

#### Scenario: A silent run loses the slot

- **WHEN** the run holding the execution slot produces no progress signal for longer than the idle bound, and is not suspended
- **THEN** the run is finalized with a terminal status, exactly one terminal `claude_task_update` is emitted, the completion announcement fires once, and the slot is released so the next queued run starts

#### Scenario: A queued run is not timed

- **WHEN** a run sits in the queue for longer than the idle bound while another run holds the slot
- **THEN** the queued run is unaffected and starts normally when the slot is released

#### Scenario: The bound is disarmed by normal termination

- **WHEN** a run's transport finalizes it normally before the idle bound elapses
- **THEN** no timeout finalization occurs afterwards, and the run's terminal status is the one its transport reported

### Requirement: A run blocked awaiting a human is not counted as idle

While the active run is legitimately blocked waiting for a human answer, the idle bound SHALL be suspended and SHALL NOT accrue. It SHALL resume when the run is unblocked, regardless of how the block was resolved.

This is required because a stateful turn paused on `AskUserQuestion` produces no progress signal for as long as `IRIS_CLAUDE_QUESTION_TIMEOUT_MS` allows. Without suspension the bound would terminate precisely those runs that are behaving correctly.

#### Scenario: Turn paused on a question outlives the idle bound

- **WHEN** the active run raises a question to the user and the user takes longer than the idle bound to answer
- **THEN** the run is not terminated, and its idle bound resumes counting only once the question is settled

#### Scenario: Suspension ends however the question settles

- **WHEN** a pending question is settled by any path — a voice answer, a UI answer, its own expiry, or being abandoned by a session reset
- **THEN** the idle bound resumes for the active run

#### Scenario: A run that stays silent after being unblocked still loses the slot

- **WHEN** a question is settled and the run then produces no further progress signal for longer than the idle bound
- **THEN** the bound elapses and the run is finalized, releasing the slot

### Requirement: A run carries what it cost

Every run SHALL record the cost and usage the runtime reports on completion — estimated spend, token usage including cache reads and writes, per-model usage where more than one model was involved, and the number of agentic turns taken. These SHALL be persisted with the run and projected to the interface alongside its result.

The user SHALL be able to ask by voice what a run cost and be answered from recorded data, never from an estimate Iris constructs.

Per-model usage SHALL be the basis for accounting whenever a run used subagents, since a single top-level figure attributes their spend incorrectly.

#### Scenario: A completed run reports its cost

- **WHEN** a run completes
- **THEN** its estimated spend, token usage, and turn count are recorded and shown with its result

#### Scenario: Cost is answerable by voice

- **WHEN** the user asks what a run cost
- **THEN** Iris answers from the recorded figures

#### Scenario: Subagent spend is attributed

- **WHEN** a run that used subagents completes
- **THEN** its accounting is derived from per-model usage rather than a single aggregate

### Requirement: Termination on a ceiling is its own outcome

A run terminated because it reached its turn ceiling or its spend ceiling SHALL be finalized with an outcome distinct from every other failure, naming which ceiling fired, the value it fired at, and how to raise it.

This outcome SHALL NOT be reported through the generic failure message. A user whose run stopped because it was long needs a different response than one whose run broke, and collapsing the two hides which happened.

Iris SHALL emit a warning while a run is still executing when it crosses a configured fraction of its spend ceiling, so a long run is visible before it stops rather than after.

A resident conversation SHALL carry **two** ceilings, and they SHALL be distinguishable: a per-turn ceiling, whose exhaustion ends that turn and leaves the conversation open, and a per-conversation ceiling, whose exhaustion ends residency. Ending residency SHALL be said out loud; the next utterance SHALL NOT silently open a fresh conversation presented as the same one.

#### Scenario: A ceiling termination is named

- **WHEN** a run terminates because it reached its turn or spend ceiling
- **THEN** the outcome names the ceiling, its configured value, and how to change it

#### Scenario: A ceiling is distinguishable from a failure

- **WHEN** the interface or the voice layer reports a ceiling termination
- **THEN** it is presented differently from a run that failed for any other reason

#### Scenario: A long run is visible before it stops

- **WHEN** an executing run crosses the configured warning fraction of its spend ceiling
- **THEN** the user is warned while the run is still executing

#### Scenario: A turn's ceiling does not end the conversation

- **WHEN** a turn of a resident conversation reaches its per-turn ceiling
- **THEN** that turn is finalized as limited and the conversation remains open for the next utterance

#### Scenario: The conversation's own ceiling is announced, not hidden

- **WHEN** a resident conversation reaches its per-conversation ceiling
- **THEN** the user is told the conversation has ended and why, and a later utterance does not resume under the same name as though nothing happened

### Requirement: Cancellation is one path for every run shape

Cancellation SHALL work identically for a resident session and a one-shot run, from the caller's point of view. A caller SHALL NOT need to know which lifetime a run has in order to stop it.

Where the runtime provides an interrupt for a turn already in progress, Iris SHALL use it rather than tearing down the transport, and SHALL record which queued work survived the interrupt so the user is not told that something was cancelled when it will still run.

This is the single statement of the rule. It previously appeared here **and** in the stateful-session capability, in two independently worded copies of the same requirement with the same two scenarios — free to drift, with nothing to say which was authoritative. The copy lives here because the queue owns the slot a cancellation releases, and because the group-aware kill is delegated to an injected hook precisely so no session-specific knowledge is needed to stop a run.

#### Scenario: Cancellation is lifetime-agnostic

- **WHEN** a run is stopped
- **THEN** it is stopped through the same path whether it is a resident session or a one-shot run

#### Scenario: An interrupted turn reports what survived

- **WHEN** a turn in progress is interrupted and queued work survives it
- **THEN** the surviving work is recorded and reported, rather than being described as cancelled

