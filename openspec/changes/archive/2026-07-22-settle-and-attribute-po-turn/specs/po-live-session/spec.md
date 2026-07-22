## ADDED Requirements

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
