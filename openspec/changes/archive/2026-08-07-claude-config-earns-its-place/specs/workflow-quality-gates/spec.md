## MODIFIED Requirements

### Requirement: Checks are bound to workflow events by what they read, not by what they cost

Each check SHALL be bound to a workflow event according to the scope of state it examines.

A check that reads only the file just written SHALL be bound to the per-edit event. Such a check cannot be wrong about work in progress: its verdict depends on nothing outside the file it was handed.

A check that reads relationships **between** files SHALL be bound to the end of the unit of work, never to the per-edit event. Any multi-edit sequence passes through states in which such a check is correct about the instant and wrong about the intent — the moment after a declaration changes but before its use does. Reporting those as failures is not merely noise: an agent handed a mid-sequence finding may act on it and undo the change the next edit was about to complete, converting a false alarm into a real defect.

Cost SHALL be measured and SHALL constrain binding — a check too slow for per-edit frequency cannot be bound there regardless of scope — but cost SHALL NOT be the criterion that selects the event. A cheap whole-tree check belongs at the end of the unit of work on the same grounds as an expensive one.

A check bound to the end of the unit of work SHALL run only when that work changed files the check reads, so a unit of work touching no such file incurs no delay. Where the check comprises separable projects, only those whose inputs changed SHALL run.

**Sub-scoping within a check SHALL be applied only where the check's inputs are statically determinable.** Where a check discovers part of what it examines at run time — by enumerating a directory rather than by declaring a dependency — a selection mechanism built on the declared dependency graph cannot see that part, and narrowing by such a mechanism silently drops exactly the coverage that discovery exists to provide. In that case the check SHALL run whole, and the ledger-based decision SHALL remain only *whether* it runs, not which of its parts do.

#### Scenario: A per-file check runs per edit

- **WHEN** a check's verdict depends only on the contents of the file just written
- **THEN** it is bound to the per-edit event, and its findings are reported before further edits are made

#### Scenario: A whole-tree check does not run per edit

- **WHEN** a check's verdict depends on more than one file — for example whether a declaration in one file is used by another
- **THEN** it is bound to the end of the unit of work, even if its measured runtime would be affordable per edit

#### Scenario: An intermediate state is not reported as a failure

- **WHEN** one edit of a multi-edit sequence leaves the tree in a state a whole-tree check would reject, and a later edit in the same sequence resolves it
- **THEN** no failure is reported for that intermediate state

#### Scenario: The same defect is still caught when it persists

- **WHEN** such a sequence ends without resolving the condition
- **THEN** the whole-tree check reports it at the end of the unit of work, so deferring the check costs detection nothing

#### Scenario: No relevant change means no run

- **WHEN** a unit of work completes without modifying any file a given end-of-work check reads
- **THEN** that check does not run and imposes no delay

#### Scenario: A run-time-discovered dependency defeats sub-scoping

- **WHEN** part of a check determines what it examines by enumerating a directory at run time, so no declared dependency links it to a changed file
- **THEN** the check runs whole rather than being narrowed by a dependency-graph selection that would omit that part

#### Scenario: Commit is gated

- **WHEN** a commit is initiated through the gated path
- **THEN** the secret scan runs against the repository before the commit proceeds, and a finding prevents it

### Requirement: The existing build and test gates are not extended

Adding these gates SHALL NOT change what `npm run build` or `npm test` do. The typecheck gate SHALL remain a typecheck, and the test runner SHALL remain a test runner, each runnable on its own.

**Binding a gate to a workflow event is not extending it.** Invoking the behavioral suite from an end-of-turn binding leaves `npm test` itself unaltered — same runner, same configuration, same result — and the two therefore cannot report different verdicts about the same tree. What this requirement forbids is one gate's command growing to perform another's work, not a gate acquiring a second caller.

Gate logic SHALL have a single definition that both the standalone command and the workflow binding invoke, so the two cannot diverge into checking different things.

Where a check is attached to `npm run build` rather than bound to an editing event, it SHALL NOT be counted among the repo's named gates. Such a check is part of what building verifies; presenting it as an additional gate would make the documented count disagree with the commands that exist.

#### Scenario: The typecheck gate is unchanged

- **WHEN** the build command is run
- **THEN** it performs its configured TypeScript checks and the bundle build, and does not run the lint, secret-scanning, or spec-drift gates

#### Scenario: The test runner is unchanged by being bound

- **WHEN** the behavioral suite is invoked by its end-of-turn binding, and separately by `npm test`
- **THEN** both run the same suite under the same configuration, and `npm test` continues to work with no argument and no environment set by the binding

#### Scenario: One definition, two callers

- **WHEN** a gate is invoked by hand and when it is invoked by its workflow binding
- **THEN** both execute the same definition, so a change to the gate's rules takes effect in both without a second edit

#### Scenario: A build-attached check is not counted as a gate

- **WHEN** a check is attached to the build command alongside the other build-attached checks
- **THEN** the documented gate count is unchanged, and the check is described as part of the build rather than as a gate of its own

## ADDED Requirements

### Requirement: The behavioral test gate is bound to the end of the unit of work

The behavioral suite SHALL be bound to the end of the unit of work, so a unit of
work cannot conclude with the suite failing and nothing reporting it. Until it was
bound, it was the largest check in the repo and the only one whose execution
depended on a person remembering it — which this capability's own purpose names as
protecting nothing.

It SHALL be scoped off the same record of written files the other end-of-work
checks use, and SHALL run only when the unit of work changed a file the suite
reads. A unit of work that touched only documentation SHALL NOT pay for it.

**The whole suite SHALL run, rather than a subset selected from the changed
files.** This is required rather than merely permitted, because the suite contains
tests that discover the modules they check by enumerating a directory at run time.
A dependency-graph selection cannot associate those tests with any changed file, so
narrowing would omit precisely the tests that exist to catch a newly added module —
the case where the suite has the most to say and a subset has nothing. The measured
cost of running whole SHALL be recorded, so the decision rests on a number rather
than an assumption.

The gate SHALL fail closed when the runner cannot be resolved, naming the command
that installs it, on the same terms as every other gate here.

#### Scenario: A code change pays for the suite

- **WHEN** a unit of work writes a file the behavioral suite reads
- **THEN** the suite runs before the unit of work concludes, and a failure blocks with the failing test named

#### Scenario: A documentation-only change does not

- **WHEN** a unit of work writes only files the suite does not read
- **THEN** the suite does not run

#### Scenario: The suite is not narrowed to a dependency-selected subset

- **WHEN** the gate runs
- **THEN** it runs the whole suite, including tests whose subjects are discovered at run time and which no dependency-graph selection would have chosen

#### Scenario: A missing runner blocks

- **WHEN** the gate runs on a checkout where the test runner cannot be resolved
- **THEN** the gate fails, names the runner, and prints the command that installs it, rather than reporting a pass it cannot justify

### Requirement: A guard against destructive commands is bound before the command runs

A check SHALL be bound ahead of shell command execution that refuses a command
matching a declared set of irreversible operations — recursive deletion, a history
rewrite or force update of a remote branch, a discard of the working tree, and
reading a credential file into the transcript.

The reason this guard is required here, and not left to permission rules alone, is
that the editing loop for this repo runs with permission prompting disabled. In
that configuration a pre-execution check is evaluated regardless of permission
mode, so it is the layer that still applies. The repo has already written down this
exact reasoning for the app's own headless worker; the loop that builds the app
runs under the same conditions and SHALL have the same guard.

The guard SHALL be described as protection against accident and SHALL NOT be
described as containment or as a sandbox. It observes commands issued through the
agent; a command typed directly in a terminal does not reach it, and a subprocess
that performs the same operation by other means is outside what it can see. Naming
that boundary is part of the requirement, because a guard believed to be a sandbox
invites the behavior a sandbox would permit.

Declarative permission rules SHALL be used in addition to the guard, not instead of
it. The two see different things: rules are evaluated ahead of the check and cover
the file-reading commands the tool recognises inside a shell invocation, while the
check can recognise a destructive operation anywhere within a compound command
line, which a rule pattern cannot express. Neither alone covers what both do.

When the guard refuses, it SHALL name which operation it matched and SHALL state
that the developer can perform the operation directly if it was intended — a
refusal that does not say what to do instead is a refusal that gets disabled.

#### Scenario: An irreversible command is refused

- **WHEN** a shell command matching a declared destructive operation is about to run
- **THEN** it does not run, and the refusal names the matched operation and the command line

#### Scenario: A destructive operation inside a compound command is still matched

- **WHEN** a declared destructive operation appears as one segment of a command line that also contains benign segments
- **THEN** the guard matches it, rather than only inspecting the command's first token

#### Scenario: Reading a credential file into the transcript is refused

- **WHEN** a command or a file-reading tool call targets the repo's local credential file
- **THEN** it is refused, so the credential does not enter the conversation

#### Scenario: The guard's limits are stated where it is documented

- **WHEN** the guard is described in the repo's documentation or its own source
- **THEN** the description names it as a guard against accident, and states that a command issued outside the agent does not reach it

#### Scenario: A refusal says what to do instead

- **WHEN** the guard refuses a command that the developer did intend
- **THEN** the refusal text states that the operation can be performed directly, so the guard is not bypassed wholesale to get past it

### Requirement: The destructive-command guard is not subject to the gates' bypass hatch

The documented environment-variable bypass SHALL NOT disable the
destructive-command guard. That hatch exists so a developer can skip a slow or
temporarily broken quality check; the guard is not a quality check and skipping it
has no comparable benefit.

The guard SHALL therefore be evaluated before the bypass is consulted. A single
switch that turns off both the checks a developer might reasonably want to skip and
the protection against destroying uncommitted work is a switch whose stated purpose
and actual effect differ.

#### Scenario: The bypass skips the quality checks and not the guard

- **WHEN** the bypass variable is set and a command matching a declared destructive operation is about to run
- **THEN** the command is still refused, while the secret scan is skipped and announces that it was

#### Scenario: The guard is evaluated first

- **WHEN** a command is about to run
- **THEN** the guard's verdict is reached before the bypass is read, so no bypass state can prevent the guard from running
