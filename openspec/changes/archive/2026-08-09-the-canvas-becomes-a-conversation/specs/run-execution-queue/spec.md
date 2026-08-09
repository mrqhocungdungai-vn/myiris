## MODIFIED Requirements

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
