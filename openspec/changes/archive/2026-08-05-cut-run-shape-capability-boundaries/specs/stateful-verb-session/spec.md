## MODIFIED Requirements

### Requirement: An in-flight stateful turn always settles

A stateful turn SHALL always reach a terminal outcome. A turn SHALL NOT be left
waiting when its session ends, is torn down, or fails.

This is a property of session lifetime, and has no analogue in a one-shot run: a
resident session's stream can end *without throwing* — which is exactly what
closing the session produces, and also what a silently-dying subprocess produces —
so a turn awaiting that stream can hang while nothing reports an error. That defect
held the execution slot forever and required an app restart.

Cancellation is not specified here. A caller stops a run through one lifetime-agnostic
path owned by `run-execution-queue`, which holds the slot the stop releases; this
capability states only that however a turn ends, it ends.

#### Scenario: A turn settles when its session ends

- **WHEN** a live session ends while a turn is in flight
- **THEN** the turn settles with an outcome attributing why it ended

#### Scenario: A stream that ends without throwing still settles the turn

- **WHEN** a session's stream ends normally rather than by error, while a turn awaits it
- **THEN** the turn settles rather than waiting on a stream that will produce nothing further

## ADDED Requirements

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
