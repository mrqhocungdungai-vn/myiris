## ADDED Requirements

### Requirement: One system-prompt policy serves every role

The base system prompt for PO, DEV, and plain Claude SHALL be produced by a single policy module. No run's prompt text SHALL be assembled at a call site, so the roles cannot drift apart the way they did when each built its own.

Iris SHALL configure a run's system prompt only through mechanisms the installed SDK declares and honours. A run SHALL NOT be configured through a field the SDK does not read: an instruction that is silently discarded is worse than an absent one, because the code and the tests both claim it is in force.

The roles' prompts SHALL differ only in their documented role-specific clause — PO is a live session permitted to pause and ask; DEV is headless and never asks. Every other part of the prompt SHALL be identical between them.

#### Scenario: PO and DEV receive the same base prompt

- **WHEN** a PO run and a DEV run are started with the same configuration
- **THEN** the base system prompt handed to the SDK is identical for both, differing only in the role-specific clause

#### Scenario: An instruction meant for a role actually reaches it

- **WHEN** Iris configures a role with runtime instructions about how it was invoked
- **THEN** those instructions reach the model, verified against the installed SDK rather than assumed from the option's name

#### Scenario: An undeclared option cannot be introduced unnoticed

- **WHEN** the options object handed to the SDK is built for any role
- **THEN** a test asserts its fields, so an option the SDK does not read fails the test suite instead of a user's run

### Requirement: Every run has a turn ceiling and a spend ceiling

Every run SHALL be started with a maximum number of agentic turns and a maximum estimated spend. Ceilings SHALL be configurable per role and overridable by environment variable, and SHALL default high enough that no workflow the app supports today reaches them — the ceiling is a runaway guard, not a quota. A ceiling that fires in ordinary use would be switched off, which is worse than having none.

A run terminated by a ceiling SHALL be reported as a distinct outcome, naming which ceiling fired, the value it fired at, and how to raise it. It SHALL NOT be reported through the generic failure path, because a run that hit a limit and a run that broke need different responses from the user.

Iris SHALL warn while a run is still executing when it crosses a fraction of its spend ceiling, so a long run becomes visible before it terminates rather than after.

#### Scenario: A runaway run is stopped

- **WHEN** a run exceeds its configured turn or spend ceiling
- **THEN** the run terminates and the user is told which ceiling was reached and at what value

#### Scenario: A ceiling is not mistaken for a failure

- **WHEN** a run terminates on a ceiling
- **THEN** its reported outcome is distinct from a run that failed for any other reason

#### Scenario: Ordinary work is unaffected

- **WHEN** a run representative of the app's normal workflows executes
- **THEN** it completes without approaching either ceiling

### Requirement: A role that must not ask is prevented from asking, not merely told not to

DEV's guarantee that it never pauses for a question SHALL be enforced by the runtime configuration of the run, not only by prompt text. The question tool SHALL be unavailable to a headless role.

Because prevention can be bypassed by a future configuration change, a headless run SHALL additionally carry a handler for the question path that fails the run with a diagnostic. A headless run SHALL NOT be able to reach a state where it waits for an answer nobody is listening for.

#### Scenario: A headless role cannot ask

- **WHEN** a DEV run executes
- **THEN** the question tool is not available to it

#### Scenario: A question on the headless path fails loudly

- **WHEN** a headless run somehow reaches the question path
- **THEN** the run fails with a diagnostic naming the violation, rather than waiting for an answer that will never arrive

### Requirement: Runs are observable through the runtime's own instrumentation

Iris SHALL capture the runtime's error output for every run and attach it to a failed run's report, so a transport failure is diagnosable rather than reduced to a single message.

Iris SHALL use the runtime's tool-lifecycle callbacks as the authoritative source of tool boundaries and tool failure, rather than inferring them from message content — an inferred boundary cannot distinguish a tool that failed from a tool that returned an error-shaped result.

Iris SHALL surface runtime state changes that would otherwise look like a stall — notably context compaction — as user-visible state.

#### Scenario: A failed run carries its diagnostics

- **WHEN** a run fails at the transport level
- **THEN** the runtime's error output is included in the reported failure

#### Scenario: A failed tool is distinguished from an error-shaped result

- **WHEN** a tool invocation fails during a run
- **THEN** the step timeline records it as a failure, distinct from a tool that completed and returned an error-shaped payload

#### Scenario: Compaction is not mistaken for a stall

- **WHEN** a long-running session compacts its context
- **THEN** the user sees that this is happening, rather than an unexplained pause

### Requirement: A directory a run must write to is granted, not described

When a run is expected to operate on a directory outside its working directory — the personal-notes vault being the standing case — that directory SHALL be granted to the run through the runtime's own directory-access mechanism.

Prose alone SHALL NOT be the mechanism, and Iris SHALL NOT compensate for a prose directive by inspecting the filesystem afterwards to guess whether the model complied.

#### Scenario: An out-of-tree vault is writable without being described

- **WHEN** a run is expected to write to the notes vault while working in an unrelated project folder
- **THEN** that vault directory is granted to the run through the runtime's directory-access mechanism

#### Scenario: No after-the-fact compliance check is needed

- **WHEN** a run that was granted the vault directory completes
- **THEN** Iris reports its result without appending a caveat derived from inspecting the vault for changes

### Requirement: Guardrails under bypassed permissions are honest about what they are

The headless worker runs with permission checks bypassed, which remains the intentional default because no interactive approval exists on that path. Iris SHALL intercept a small, explicit set of destructive operations before they execute — recursive deletion outside the working directory, force-pushing, and writes outside the working directory and its granted directories.

This interception SHALL be documented as a guardrail against obvious accidents, NOT as a sandbox. Iris SHALL NOT claim, in its interface or its documentation, that a bypassed-permission run is contained.

#### Scenario: An obviously destructive operation is stopped

- **WHEN** a run attempts a recursive deletion outside its working directory
- **THEN** the operation is denied and the model is told why

#### Scenario: The guardrail is not oversold

- **WHEN** the guardrail is described to the user or in the documentation
- **THEN** it is described as a guard against accidents, not as containment

### Requirement: Every SDK option is either used or declined on the record

Options the runtime offers and Iris does not use SHALL be recorded with the reason, so an omission is distinguishable from an oversight. An audit of this surface SHALL start from a decision rather than from a blank.

#### Scenario: A deliberate omission is not re-litigated

- **WHEN** the runtime configuration is audited
- **THEN** each unused option has a recorded reason, distinguishing a deliberate decision from an unnoticed gap

### Requirement: A run sees only the skills its work needs

The set of skills available to a run SHALL be supplied by the caller as an explicit list, not fixed at "every skill the bundle ships". A run's capability surface is a property of what it was asked to do; a constant surface means a run can reach for a capability that has nothing to do with its job.

Each default list SHALL be derived from the skills its persona and the plugin's own cross-references actually invoke, established by inspection rather than by intent, and each entry SHALL have a recorded reason.

This narrows what a run can do. A skill omitted from a list is unavailable to that run, and the omission SHALL be deliberate and recorded rather than incidental.

#### Scenario: A run cannot reach an unrelated capability

- **WHEN** a run configured for implementation work executes
- **THEN** skills belonging to unrelated workflows are not available to it

#### Scenario: The list reaches the runtime unchanged

- **WHEN** a run is configured with a skill list
- **THEN** that exact list is what the runtime receives, asserted by test

#### Scenario: Each entry is justified

- **WHEN** a default skill list is defined
- **THEN** every entry has a recorded reason tied to a skill the persona or plugin actually invokes

### Requirement: The user's own words are retained, bounded, and fenced

The verbatim transcript of what the user said SHALL be retained in a bounded, timestamped buffer that survives the display flush, so the system holds the user's own words rather than only a paraphrase of them.

The buffer SHALL be capped by both count and age, and SHALL NOT be persisted to disk. A verbatim record of everything spoken near the microphone is not something to accumulate.

Anything derived from this buffer that reaches a model prompt SHALL be fenced as untrusted input, on the same terms as spoken content already captured elsewhere in the system. Being the user's own speech SHALL NOT exempt it — the microphone does not distinguish who is speaking near it.

#### Scenario: The transcript outlives its display

- **WHEN** a spoken utterance has been transcribed and displayed
- **THEN** it remains retrievable from the buffer rather than being discarded

#### Scenario: The buffer does not grow without bound

- **WHEN** utterances accumulate beyond the configured count or age
- **THEN** the oldest are dropped, and nothing is written to disk

#### Scenario: Retained speech is fenced before reaching a model

- **WHEN** retained speech is included in a prompt
- **THEN** it is fenced as untrusted input
