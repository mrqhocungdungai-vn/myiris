# global-agent-runtime Specification

## Purpose
The personas, skills, and commands every run depends on ship inside the app and are handed to the runtime by value, so any workstream can use them with nothing installed on the machine and nothing read from or written to the user's own Claude Code.
## Requirements

### Requirement: cwd holds only project code and its OpenSpec
A workstream `cwd` SHALL be used only for the project's own code and its `openspec/` directory; capability configuration (agents, skills, commands) SHALL NOT be required in the `cwd`.

#### Scenario: Arbitrary project directory works as cwd

- **WHEN** the user points a workstream at an arbitrary project directory
- **THEN** the run operates there using globally-installed capabilities, and only that project's `openspec/` is created or read locally

### Requirement: Personas and capabilities ship with the app, not on the machine
The personas SHALL ship inside the app and be handed to the runtime **by value**, never installed into or read from the user's own agent directory. A project-local override SHALL still win, so a persona customized for one project keeps its customization.

There SHALL be one persona per **run shape** — not one per job — named for the property that actually differs at runtime: whether the run may pause and ask. What each verb is *for* SHALL come from its registry clause, and what it may *reach* from its declared skills, so one persona can serve several verbs without describing capabilities some of them lack.

A persona SHALL NOT name a specific skill unless every verb using that persona can reach it, since naming one otherwise instructs a run to invoke something it cannot see.

The app SHALL be able to remove persona files an earlier version installed into the user's agent directory — including those named for the retired roles — on explicit user action only.

#### Scenario: A run fails loudly when its persona cannot be loaded

- **WHEN** a run starts and its persona cannot be read from the bundle
- **THEN** the run fails with an error naming the verb, rather than silently running as something else

#### Scenario: A project-local override wins

- **WHEN** a project supplies its own copy of a persona
- **THEN** that copy is used for runs in that project, and the bundled one elsewhere

### Requirement: One system-prompt policy serves every run
The base system prompt for **every** run SHALL be produced by a single policy module. No run's prompt text SHALL be assembled at a call site, so two runs cannot drift apart by being built in two places.

The policy SHALL compose the prompt from two parts: the clause every run of a given **statefulness** receives — whether it may pause mid-turn and ask the user — and the one-line clause naming the **specific job** of the verb being run, which the verb registry declares. Runs of the same statefulness SHALL therefore differ by exactly their verb clause, and this SHALL be assertable by stripping the clauses and comparing what remains.

The policy SHALL emit the prompt on the field the runtime actually reads. An undeclared field that looks correct at the call site is silently discarded, which is how a resident session came to run with no base prompt at all while one-shot runs got a full one.

#### Scenario: Two runs of the same statefulness differ by one clause

- **WHEN** the instructions for two verbs of the same statefulness are built
- **THEN** removing each one's own verb clause leaves two identical strings

#### Scenario: A stateful run is told it may ask, a stateless one that it may not

- **WHEN** the instructions for a stateful and a stateless verb are built
- **THEN** only the stateful one is told to ask at real decision points, and the stateless one is told the question tool is not available to it

#### Scenario: No prompt is composed without a job

- **WHEN** the policy is called with no verb clause
- **THEN** it fails loudly rather than producing a prompt that names no job

Whether a stateless verb can actually be *prevented* from asking — not merely told
not to — is specified by `voice-decision-relay`'s "A stateful verb may ask; a
stateless verb cannot", not here. This module composes what the prompt says; that
capability owns the runtime enforcement and its failure handler.

### Requirement: Every run has a turn ceiling and a spend ceiling
Every run SHALL be started with a maximum number of agentic turns and a maximum estimated spend. Ceilings SHALL be configurable per verb and overridable by environment variable, and SHALL default high enough that no workflow the app supports today reaches them — the ceiling is a runaway guard, not a quota. A ceiling that fires in ordinary use would be switched off, which is worse than having none.

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
