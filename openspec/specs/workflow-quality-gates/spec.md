# workflow-quality-gates

## Purpose
Defines which automated checks guard the editing workflow — lint, secret scanning, a drift check over the living spec, the typecheck projects, and the behavioral suite — where each is bound in the edit-to-commit sequence, what it blocks on, and how it behaves when its tooling is missing. It also covers the one bound check that is not a quality check at all: the guard that refuses an irreversible shell command. A check that exists but is never triggered protects nothing; this capability is about the binding, not the checking.

## Requirements

### Requirement: A lint gate exists and is invocable on its own

The repo SHALL provide a lint check invocable as a single command, independent of the typecheck gate and the test runner. It SHALL exit non-zero when the check fails, so it can gate an editing step, a commit, or a future CI step.

The lint check SHALL cover the renderer sources, the Electron main-process modules, and the build scripts — the same source surface the other gates cover between them. A directory of first-party source that no gate reads is out of contract.

**The gate carries two checks, and both can fail it.** Alongside the linter, it
SHALL run a dead-rule sweep over the stylesheet Iris authored, reporting a class
that no renderer source references anywhere. They share one gate because they ask
the same question — is this first-party source reachable — over the same tree, and
because a check bound to no editing event protects nothing. A sweep finding SHALL
be reported and SHALL fail the gate; it SHALL NOT delete a rule, because a class
assembled dynamically looks dead to a static scan and the cost of a wrong removal
is a broken surface no test would catch. A class confirmed to be built dynamically
SHALL be exempted by name with a stated reason, never by narrowing the sweep.

The sweep's scope SHALL be the stylesheet this repo authored, not the adopted Deep
Space sheets — `deepspace-skin` is where that scoping is decided, and this
requirement SHALL NOT restate the reason for it.

#### Scenario: Lint passes

- **WHEN** the lint command is run and the source tree is clean
- **THEN** it exits with code 0

#### Scenario: Lint fails

- **WHEN** the lint command is run and at least one finding is reported by either check
- **THEN** it exits non-zero and names the offending file plus what is wrong — the line and rule for a linter finding, the unreferenced class for a sweep finding

#### Scenario: A dead style rule fails the gate without being deleted

- **WHEN** the authored stylesheet carries a class that no renderer source references
- **THEN** the lint command exits non-zero naming that class, and the rule is left in place for a human to confirm

#### Scenario: A dynamically built class is exempted by name

- **WHEN** a class is assembled at runtime rather than written as a literal
- **THEN** it is exempted individually with a recorded reason, and the sweep's scope is unchanged

#### Scenario: Lint is independent of the other gates

- **WHEN** the lint command is run
- **THEN** it completes without invoking the typecheck gate or the test runner, and requires none of the app's runtime prerequisites — no `.env`, no `claude` binary, no network

### Requirement: The lint gate admits no warnings

The lint gate SHALL treat every finding as failing, with no distinction between warning-level and error-level severity. A finding that is deliberately acceptable SHALL be suppressed at its site with an inline annotation carrying the reason, not tolerated by raising the gate's threshold.

A numeric allowance — permitting some fixed count of outstanding findings — SHALL NOT be used. Such a threshold cannot distinguish a pre-existing finding from a new one, so it ratchets upward silently and records nothing about why any individual finding was accepted.

This requirement is affordable only because the finding count is driven to zero before the gate is enabled; enabling it against an unresolved backlog is out of contract.

#### Scenario: A new warning fails the gate

- **WHEN** an edit introduces a finding at any severity the linter reports
- **THEN** the lint command exits non-zero

#### Scenario: An accepted finding is annotated, not tolerated

- **WHEN** a finding is judged correct to keep — for example a control-character pattern that exists specifically to reject control characters
- **THEN** it is suppressed by an inline annotation at that site stating the reason, and the gate's threshold remains zero

#### Scenario: The gate starts green

- **WHEN** the lint gate is first enabled
- **THEN** the source tree reports zero findings, so the gate's first failure is necessarily a new one

### Requirement: The lint rule set is chosen by measured cost, and exclusions are recorded

The set of enabled rules SHALL be selected against a measured finding count on the actual source tree, not adopted wholesale from a preset. For each rule group considered and rejected, its measured cost SHALL be recorded, so a later decision to enable it is informed rather than exploratory.

Rule groups that cost zero additional findings on the current tree SHALL be enabled by default: they add coverage against future defects while incurring no present debt.

A rule group SHALL NOT be excluded merely because it is expensive. Where the exclusion is instead about *risk* — a rule whose mechanical satisfaction can introduce a defect — that reasoning SHALL be recorded alongside the count, because the count alone would suggest the wrong remedy.

#### Scenario: A zero-cost rule group is enabled

- **WHEN** a candidate rule group is measured to produce no additional findings on the current source tree
- **THEN** it is enabled

#### Scenario: An excluded rule group carries its price

- **WHEN** a rule group is left disabled
- **THEN** its measured finding count on the current tree is recorded, so the size of enabling it later is known rather than estimated

#### Scenario: A risk-based exclusion states the risk

- **WHEN** a rule group is excluded because satisfying its findings mechanically could introduce a defect, rather than because the count is large
- **THEN** the recorded rationale names that risk, so the exclusion is not later reversed by someone who reads only the count

### Requirement: A secret-scanning gate exists and is invocable on its own

The repo SHALL provide a secret-scanning check invocable as a single command, independent of every other gate. It SHALL exit non-zero when a candidate secret is found, and SHALL identify the finding's file, line, and matched rule without printing the secret's value.

#### Scenario: A clean tree passes

- **WHEN** the secret scan runs and no candidate secret is present in scanned content
- **THEN** it exits with code 0

#### Scenario: A planted credential is caught

- **WHEN** a string matching a known credential format is present in scanned content
- **THEN** the scan exits non-zero and reports the file, line, and rule

#### Scenario: The finding does not leak the secret

- **WHEN** the scan reports a finding
- **THEN** the secret's value is redacted in the output, so the diagnostic itself is not a disclosure

### Requirement: Secret scanning is scoped to content that can reach the repository

Secret scanning SHALL be applied to content that can plausibly enter version control, and SHALL NOT be applied to paths excluded from version control. A scan that reads ignored paths reports the developer's own working credentials and third-party build-output constants as findings — noise that is indistinguishable from a real leak and that trains the reader to dismiss the gate.

Ignored paths SHALL be determined from the repository's own ignore rules rather than a separate hand-maintained exclusion list, so that the two cannot drift apart.

Scanning the entire working tree indiscriminately SHALL NOT be used as the routine scope. Its cost is disproportionate to the narrower scopes, and it necessarily reads the ignored paths this requirement excludes.

#### Scenario: The developer's own credential file is not a finding

- **WHEN** the secret scan runs on a working tree containing a local environment file that holds real API credentials and is excluded from version control
- **THEN** that file produces no finding

#### Scenario: Build output is not a finding

- **WHEN** the working tree contains generated build artifacts, excluded from version control, that embed third-party configuration constants resembling credentials
- **THEN** those artifacts produce no finding

#### Scenario: A credential in tracked source is a finding

- **WHEN** a credential is written into a file that is not excluded from version control — including documentation and configuration, not only executable source
- **THEN** the scan reports it

### Requirement: A fifth gate checks the living spec for drift

The gate chain SHALL include a check over `openspec/specs/` that fails when the
living spec carries retired vocabulary, placeholder text, a requirement contradicted
by its own scenarios, or an empty capability or requirement.

Every other gate in this repo checks code. The living spec is named as the source of
truth and is what the next change is authored from, yet it is the one artifact with
no automated check: a structural validator reported 43 capabilities passing while the
tree described three versions of the system at once, held one requirement duplicated
verbatim across two capabilities, and mandated four controls that no longer existed.
One of those stale requirements shipped a user-facing defect, because a scenario that
contradicted its own requirement read as the contract and was implemented.

**Retired vocabulary SHALL be registered, not inferred.** The check cannot know that a
term stopped naming something, so retiring a concept SHALL include registering its
name in the check's term list. Each registered term SHALL carry its own matching rule,
because a single global rule cannot be right for all of them: `PO` matches
case-sensitively with word boundaries, since `IRIS_PO_QUESTION_TIMEOUT_MS` and
`SYSTEM_EVENT_PO_QUESTION` are identifiers the code actually reads and a spec citing
them is correct; the noun `role` matches case-insensitively, because a
case-sensitive-only criterion is exactly what let 72 lowercase occurrences survive a
sweep that reported zero.

**Placeholder text SHALL fail.** A `Purpose` reading `TBD`, or a note to a future reader
such as "update after archive", is the source of truth declaring that it is not one.

**Checks SHALL be lexical or structural, never semantic.** The gate SHALL NOT attempt to
decide whether a requirement is true — no checker can, and one that tried would be
wrong often enough to be ignored. Verifying truth remains a human reading the code.

**The check SHALL NOT examine `openspec/changes/archive/`.** The archive is history and
must retain its retired vocabulary; it is the only record of where a rule used to
live, and a gate that rewrote it would destroy that record.

**An exemption SHALL be explicit and SHALL state its reason**, so a legitimate occurrence
is a decision visible in the diff rather than a silent adjustment to a pattern.

The gate SHALL fail closed and SHALL NOT offer a warn-only mode, consistent with the
rest of the chain: a warning on a fault with no runtime symptom is a warning nobody
reads. It SHALL remain independently runnable and SHALL NOT be folded into the
typecheck gate, for the same reason `lint` and `scan:secrets` are kept out of it.

#### Scenario: Retired vocabulary fails the gate

- **WHEN** a capability spec uses a term registered as retired
- **THEN** the gate fails, naming the file, the line, and the term

#### Scenario: An identifier containing a retired term still passes

- **WHEN** a spec cites `IRIS_PO_QUESTION_TIMEOUT_MS` or `SYSTEM_EVENT_PO_QUESTION`
- **THEN** the gate passes, because those are names the code reads and the spec is correct to use them

#### Scenario: A placeholder Purpose fails the gate

- **WHEN** a capability's `Purpose` is `TBD`, or contains a note directed at a future reader
- **THEN** the gate fails

#### Scenario: A requirement contradicted by its own scenario fails the gate

- **WHEN** a requirement forbids something and one of its own scenarios asserts that same thing as expected behavior
- **THEN** the gate fails, naming both the requirement and the scenario

#### Scenario: The archive is not examined

- **WHEN** the gate runs on a repository whose `openspec/changes/archive/` is full of retired vocabulary
- **THEN** the gate passes, having examined only the living spec

#### Scenario: The gate fails closed

- **WHEN** the check cannot complete
- **THEN** it exits non-zero rather than reporting success or skipping

#### Scenario: An exemption carries a reason

- **WHEN** an occurrence is deliberately allowed
- **THEN** the allowance is recorded explicitly with a stated reason, and the gate passes only for that occurrence

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

### Requirement: A failing gate blocks rather than warns

A gate that fails SHALL stop the workflow step it guards and surface the failure as actionable feedback, rather than emitting a diagnostic that the workflow proceeds past.

The blocking mechanism SHALL be loop-safe: where a gate can re-fire on the same unit of work, it SHALL detect that it is already handling that failure and decline to re-trigger, so an unresolvable failure ends the attempt instead of repeating it indefinitely.

#### Scenario: A failing check halts the step

- **WHEN** any bound check reports a failure
- **THEN** the workflow step it guards does not complete, and the failure text is returned as feedback for correction

#### Scenario: An unresolvable failure terminates

- **WHEN** a gate bound to the end of a unit of work fails, and the attempt to correct it fails again
- **THEN** the gate does not re-trigger indefinitely; control returns with the failure reported

### Requirement: A gate whose tooling is absent fails closed

When a gate's underlying tool cannot be found, the gate SHALL fail rather than pass. It SHALL report which tool is missing and the exact command that installs it.

Silently skipping an absent check SHALL NOT be done. A skipped security check is worse than an absent one: the workflow reports success, and the reader concludes the content was scanned and found clean. This repo has already recorded the cost of a warn-and-continue gate — the documented Node floor drifted for exactly that reason.

A documented environment-variable escape hatch SHALL exist for the one-off case where a gate must be bypassed deliberately, following the repo's existing convention for such hatches. Its use SHALL be an explicit act, never a default.

#### Scenario: A missing tool blocks

- **WHEN** a bound check runs on a machine where its tool is not installed
- **THEN** the gate fails, names the missing tool, and prints the command that installs it

#### Scenario: The escape hatch is explicit

- **WHEN** the documented bypass variable is set
- **THEN** the gates do not run, and this is visible in the gate's output rather than silent

#### Scenario: The default is not bypass

- **WHEN** no bypass variable is set
- **THEN** the gates run, and an absent tool is reported as a failure rather than treated as a pass

### Requirement: Externally provisioned gate tooling is declared as unpinned

Where a gate depends on a tool that is not resolvable from the dependency lockfile, that dependency SHALL be documented as a developer prerequisite, and its unpinned nature SHALL be stated rather than left implied. Every other tool in this repo's gate chain is version-locked; an exception that is not labelled as one reads as an oversight.

Where a package registry carries a package whose name collides with such a tool but which is not that tool, the collision SHALL be documented, so that a future attempt to "properly pin" the dependency does not install an unrelated package under the assumption that a matching name means a matching tool.

#### Scenario: The unpinned prerequisite is documented

- **WHEN** a developer sets up the repo from source
- **THEN** the documentation names the externally provisioned tool, how to install it, and that its version is not pinned by the lockfile

#### Scenario: The name collision is recorded

- **WHEN** a package published under the tool's name exists on the dependency registry but is not the tool
- **THEN** the documentation states this, so the collision cannot be mistaken for the real dependency

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
