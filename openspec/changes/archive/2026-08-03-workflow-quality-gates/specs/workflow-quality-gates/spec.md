## Purpose

Defines which automated checks guard the editing workflow beyond the typecheck and behavioral test gates — lint and secret scanning — where each is bound in the edit-to-commit sequence, what it blocks on, and how it behaves when its tooling is missing. A check that exists but is never triggered protects nothing; this capability is about the binding, not the checking.

## ADDED Requirements

### Requirement: A lint gate exists and is invocable on its own

The repo SHALL provide a lint check invocable as a single command, independent of the typecheck gate and the test runner. It SHALL exit non-zero when the check fails, so it can gate an editing step, a commit, or a future CI step.

The lint check SHALL cover the renderer sources, the Electron main-process modules, and the build scripts — the same source surface the other gates cover between them. A directory of first-party source that no gate reads is out of contract.

#### Scenario: Lint passes

- **WHEN** the lint command is run and the source tree is clean
- **THEN** it exits with code 0

#### Scenario: Lint fails

- **WHEN** the lint command is run and at least one finding is reported
- **THEN** it exits non-zero and names the offending file, line, and rule

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

### Requirement: Checks are bound to workflow events by what they read, not by what they cost

Each check SHALL be bound to a workflow event according to the scope of state it examines.

A check that reads only the file just written SHALL be bound to the per-edit event. Such a check cannot be wrong about work in progress: its verdict depends on nothing outside the file it was handed.

A check that reads relationships **between** files SHALL be bound to the end of the unit of work, never to the per-edit event. Any multi-edit sequence passes through states in which such a check is correct about the instant and wrong about the intent — the moment after a declaration changes but before its use does. Reporting those as failures is not merely noise: an agent handed a mid-sequence finding may act on it and undo the change the next edit was about to complete, converting a false alarm into a real defect.

Cost SHALL be measured and SHALL constrain binding — a check too slow for per-edit frequency cannot be bound there regardless of scope — but cost SHALL NOT be the criterion that selects the event. A cheap whole-tree check belongs at the end of the unit of work on the same grounds as an expensive one.

A check bound to the end of the unit of work SHALL run only when that work changed files the check reads, so a unit of work touching no such file incurs no delay. Where the check comprises separable projects, only those whose inputs changed SHALL run.

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

Gate logic SHALL have a single definition that both the standalone command and the workflow binding invoke, so the two cannot diverge into checking different things.

#### Scenario: The typecheck gate is unchanged

- **WHEN** the build command is run
- **THEN** it performs its configured TypeScript checks and the bundle build, and does not run the lint or secret-scanning gates

#### Scenario: One definition, two callers

- **WHEN** a gate is invoked by hand and when it is invoked by its workflow binding
- **THEN** both execute the same definition, so a change to the gate's rules takes effect in both without a second edit
