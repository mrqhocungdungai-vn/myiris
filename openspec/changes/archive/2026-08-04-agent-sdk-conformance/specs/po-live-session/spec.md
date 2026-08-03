## MODIFIED Requirements

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
