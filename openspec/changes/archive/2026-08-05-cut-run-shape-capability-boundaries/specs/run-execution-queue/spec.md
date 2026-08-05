## MODIFIED Requirements

### Requirement: Cancellation is one path for every run shape

Cancellation SHALL work identically for a resident session and a one-shot run, from
the caller's point of view. A caller SHALL NOT need to know which lifetime a run has
in order to stop it.

Where the runtime provides an interrupt for a turn already in progress, Iris SHALL use
it rather than tearing down the transport, and SHALL record which queued work survived
the interrupt so the user is not told that something was cancelled when it will still
run.

This is the single statement of the rule. It previously appeared here **and** in the
stateful-session capability, in two independently worded copies of the same
requirement with the same two scenarios — free to drift, with nothing to say which
was authoritative. The copy lives here because the queue owns the slot a cancellation
releases, and because the group-aware kill is delegated to an injected hook precisely
so no session-specific knowledge is needed to stop a run.

#### Scenario: Cancellation is lifetime-agnostic

- **WHEN** a run is stopped
- **THEN** it is stopped through the same path whether it is a resident session or a one-shot run

#### Scenario: An interrupted turn reports what survived

- **WHEN** a turn in progress is interrupted and queued work survives it
- **THEN** the surviving work is recorded and reported, rather than being described as cancelled
