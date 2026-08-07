# claude-code-config

## Purpose
Governs the configuration surface that decides how Claude Code operates **on** this repo — the developer's editing loop — covering what a subagent must declare in order to exist, that installed configuration is configuration actually in use, that anything vendored from an external pack carries a provenance record which is verified rather than trusted, and that a documented pointer to a tool the repo does not provide says so. It governs `.claude/` only, never the Claude Code that Iris ships inside itself. Adjacent to `workflow-quality-gates` and `test-harness` and deliberately separate from both: those govern what is checked and how it runs, this governs what the agent working on this repo is handed before it starts.

## Requirements

### Requirement: The two Claude Code surfaces are named separately and share no configuration

This repo contains **two** Claude Code configurations, and every requirement in this
capability applies to the first one only:

1. **The editing loop** — the Claude Code a developer runs to write this app,
   configured by `.claude/` at the repo root: its subagents, skills, commands,
   settings and hooks. This is this capability's entire subject.
2. **The one Iris ships** — the Agent SDK worker the app dispatches verbs to,
   configured **exclusively** by the plugin tree bundled into the packaged app and
   by the app's own pinned configuration directory. It belongs to
   `verb-tool-surface`, `global-agent-runtime` and their neighbours, not here.

**The shipped surface SHALL take no configuration from `.claude/`.** The bundled
plugin SHALL remain the only source of the skills and commands a dispatched run can
reach.

**A requirement written about one surface SHALL NOT be applied to the other**, and
each requirement here SHALL name the artifacts it governs rather than saying "this
repo's configuration". The two surfaces hold files with identical names and
near-identical contents, so an unqualified statement is not merely vague — it reads
as true of the wrong one, and acting on that misreading changes what the packaged
app does.

One consequence has to be stated because it is the case that costs something: a
dispatched run picks up the project settings of **whatever repository it is working
in**. Pointing the app at *this* repo therefore makes the editing loop's own hooks
and permission rules apply to that run. That is a property of the working directory
under dogfooding, not a configuration path from `.claude/` into the shipped app, and
it SHALL NOT be relied upon as either.

#### Scenario: The shipped worker's skills come from the bundle

- **WHEN** the packaged app dispatches a verb
- **THEN** the skills and commands available to that run come from the bundled plugin, and none are read from this repo's `.claude/`

#### Scenario: A requirement here does not reach the shipped tree

- **WHEN** a requirement in this capability constrains skills, subagents or commands
- **THEN** it governs `.claude/` only, and the bundled plugin tree is left untouched by it

#### Scenario: Working on this repo is not a configuration path

- **WHEN** the app is pointed at this repo as the project a run works in, so that run reads this repo's project settings
- **THEN** that follows from the run's working directory rather than from the app's own configuration, which still comes only from the bundle

### Requirement: A subagent declares the tool surface and the model it runs with

Every subagent definition in this repo SHALL declare both the tools it may use and
the model it runs with. A definition that declares neither inherits the whole tool
surface and the default model, which forfeits the narrowing that is the only
reason to define a subagent rather than ask in the main conversation.

The tool declaration SHALL be written in the form the frontmatter field actually
accepts — a list of tool names. A permission-style scoped pattern such as
`Bash(git diff:*)` SHALL NOT be written there: that syntax belongs to permission
rules, and an entry in this field that resolves to no tool is either dropped or
prevents the subagent from launching at all. Where a subagent needs a *narrowed*
shell rather than none, the narrowing SHALL be expressed as a permission rule and
the tool list SHALL name the tool plainly.

A definition SHALL NOT carry frontmatter fields that are not part of the subagent
frontmatter surface. Such fields are ignored at load time, so they cost nothing at
runtime and mislead every reader — they are the signature of a definition copied
from elsewhere and never checked against this tool's actual contract.

A definition's declared name SHALL be a slug that matches its filename, so a
subagent has one identity rather than two.

#### Scenario: A subagent narrows its tools

- **WHEN** any subagent definition in the repo is read
- **THEN** it declares a tool list and a model, and the tool list contains only tool names

#### Scenario: A scoped pattern is not written as a tool name

- **WHEN** a subagent is intended to run only a narrow shell command
- **THEN** its tool list names the shell tool plainly and the narrowing is expressed as a permission rule, rather than a scoped pattern being placed in the tool list where it would resolve to nothing

#### Scenario: Fields outside the frontmatter surface are absent

- **WHEN** a subagent definition is read
- **THEN** it carries no frontmatter field that the tool ignores at load time

#### Scenario: One identity per definition

- **WHEN** a subagent definition's declared name is compared with its filename
- **THEN** the name is a slug and the two agree

### Requirement: A subagent's description states when to select it

A subagent's description SHALL state the conditions under which it is the right
thing to delegate to, and SHALL state at least one condition under which it is
not. The description is the only text consulted when deciding whether to delegate,
so a description written as a summary of expertise — what this subagent is good at
— cannot perform the one job the field has.

Where a subagent overlaps a skill that covers similar ground, its description
SHALL name the distinction, so the overlap is resolved by what each declares
rather than by a reader guessing.

#### Scenario: The description answers a selection question

- **WHEN** a subagent's description is read
- **THEN** it names the situations that should route work to this subagent, and names at least one situation that should not

#### Scenario: An overlap is disambiguated in the text

- **WHEN** a subagent and a skill both plausibly cover a request
- **THEN** the subagent's description states which of the two the request belongs to

### Requirement: A subagent's declared expertise matches this repo's stack

A subagent definition retained in this repo SHALL be one whose body addresses
technologies this repo actually uses. A definition whose body is written for an
unrelated stack SHALL be removed rather than kept on the reasoning that it is
harmless.

It is not harmless. Such a definition answers when consulted, and it answers from
the stack it was written for — so a review of this repo's architecture is skewed
by an expertise that does not apply, in a way that reads as competence rather than
as a mismatch.

A description SHALL NOT be treated as evidence of what a definition contains.
Verifying the match SHALL mean reading the body for this repo's own stack terms,
because a pack's descriptions are written to be selected and its bodies are what
actually run.

#### Scenario: An off-stack definition is not retained

- **WHEN** a subagent definition's body addresses a stack this repo does not use
- **THEN** the definition is not present in the repo

#### Scenario: The body is what is checked

- **WHEN** a candidate subagent from an external pack is evaluated for this repo
- **THEN** the evaluation reads the body for this repo's stack terms rather than concluding from the description alone

### Requirement: Installed configuration is configuration in use

Skills, subagents, and commands **under `.claude/`** SHALL be ones the developer's
editing loop actually uses. Configuration that is installed there and unused is not
inert: each item contributes its name and description to context in every editing
session, so an unused item is a permanent cost paid for a capability nobody invokes.

**This requirement SHALL NOT be applied to the bundled plugin tree.** A skill the
worker needs is very often one the editing loop never invokes — the note-keeping
skills are the standing example — so "unused by the developer" is not evidence about
the shipped surface and SHALL NOT be read as grounds for removing anything from it.
Judging the bundle by this requirement would delete capability the app dispatches
verbs to, which is the precise misreading the surface-separation requirement above
exists to prevent.

Removing an unused item SHALL be reversible without loss, which is what the
provenance record below is for. Where reversibility holds, an unused item SHALL be
removed rather than retained against a possible future need.

#### Scenario: An unused skill is removed

- **WHEN** a skill under `.claude/` installed from an external pack is not invoked by the editing loop
- **THEN** it is not present there, and its provenance record makes reinstalling it a single mechanical step

#### Scenario: A skill only the shipped worker uses is kept

- **WHEN** a skill in the bundled plugin tree is never invoked by the developer's editing loop
- **THEN** it remains in the bundle, because this requirement does not govern that tree

#### Scenario: Removal is not a one-way door

- **WHEN** an item is removed for being unused and is later needed
- **THEN** the recorded source and path are sufficient to restore it, so the removal decision never required predicting the future

### Requirement: Vendored configuration carries a provenance record, and the record is checked

Every file **under `.claude/`** vendored from an external source — whatever kind it
is — SHALL be recorded with its source, the path it came from, and a content hash.
The record SHALL cover subagents on the same terms as skills: an unrecorded vendored
file that happens to still match its upstream is matching by luck, and luck is not a
mechanism.

**The bundled plugin tree carries its provenance differently, and SHALL NOT be
duplicated into this record.** Content shipped inside a distributed application is
governed by attribution and license files travelling with it, which is what that
tree already has and what redistribution actually requires. Two provenance
mechanisms over one tree would be the duplication this capability exists to oppose.

The record SHALL describe what is present. An entry for a file that is no longer
installed makes the record a claim about the past rather than a check on the
present.

A recorded hash SHALL state which artifact it hashes. A hash taken from an upstream
source is provenance and cannot be verified locally; a hash taken from the installed
file is integrity and can. A field that does not say which it is will be read as the
one it is not — and a record whose integrity claim is unverifiable, while appearing
to be verified, is worse than no record, because it is trusted.

A check SHALL verify the installed files against the record, so the record's
accuracy does not depend on whoever last edited it remembering to update it.

#### Scenario: A vendored subagent is recorded

- **WHEN** a subagent definition under `.claude/` originates from an external pack
- **THEN** its source, upstream path, and content hash appear in the provenance record

#### Scenario: The shipped tree is not entered into this record

- **WHEN** the bundled plugin tree contains skills vendored from an external pack
- **THEN** their provenance is the attribution and license files shipped alongside them, and no entry for them appears in this record

#### Scenario: Upstream and installed hashes are distinguishable

- **WHEN** a record holds a hash of an upstream source and a hash of the installed file
- **THEN** each is named for which artifact it covers, so neither is mistaken for the other

#### Scenario: The record matches what is installed

- **WHEN** the provenance record is compared against the configuration directory
- **THEN** every recorded entry corresponds to an installed file, and the check fails if a recorded file is absent or its content no longer hashes to the recorded value

### Requirement: Configuration duplicated between the developer surface and the shipped plugin has a declared owner

Where the same configuration file exists both in the repo's own Claude Code
directory and in the plugin tree that ships inside the packaged app, the pair
SHALL be checked for divergence. Two copies of one workflow with nothing keeping
them together is the failure this repo has already named and paid for elsewhere:
an edit lands on one side and the other silently falls behind.

A pair that is permitted to differ SHALL carry an explicit allowance stating the
reason it differs, so a divergence is a decision visible in the diff rather than an
accident indistinguishable from one. An allowance SHALL name the specific pair it
covers and SHALL NOT be expressed as a blanket exemption for a directory.

The check SHALL NOT resolve a divergence by rewriting either side. The shipped
plugin tree is content the packaged app loads, and changing it changes the app's
behavior — which is a decision to take deliberately, not a side effect of a check
running.

#### Scenario: An undeclared divergence fails the check

- **WHEN** a file present in both trees differs between them and no allowance covers that pair
- **THEN** the check fails and names the file and both paths

#### Scenario: A declared divergence passes, carrying its reason

- **WHEN** a pair is permitted to differ
- **THEN** an allowance names that pair and states why, and the check passes for that pair only

#### Scenario: The check changes nothing

- **WHEN** the check finds a divergence
- **THEN** neither copy is modified; the check reports and exits

### Requirement: A documented pointer to a tool the repo does not provide declares itself as such

Where this repo's documentation instructs the reader to consult an external tool
that the repo does not configure — an integration whose configuration lives
outside version control — the documentation SHALL state that the tool is not a
prerequisite of the repo, so a reader who does not have it knows the instruction
is not addressed to them.

This repo is public and invites forks. An instruction to call a tool that is
absent from a fresh clone is a dead pointer that fails silently: the reader
concludes the tool is missing from their setup rather than that it was never part
of the repo. Either the repo SHALL provide the configuration, or the pointer SHALL
say whose tool it is.

#### Scenario: A maintainer-local tool is labelled

- **WHEN** documentation directs the reader to an external integration the repo does not configure
- **THEN** the same passage states that it is maintainer-local and not a prerequisite, so a fork can skip it knowingly

#### Scenario: A provided integration needs no label

- **WHEN** the repo does configure an external integration in version control
- **THEN** no such disclaimer is required, because a fresh clone has what the instruction refers to

### Requirement: Machine-local configuration overrides cannot be committed by accident

The file Claude Code uses for a developer's machine-local configuration overrides
SHALL be excluded from version control. The exclusion SHALL be in place
independently of whether the file currently exists: the exclusion's whole purpose
is to be there before the file is, since the moment it first appears is the moment
it is committed.

#### Scenario: The local override file is ignored before it exists

- **WHEN** the repo contains no machine-local override file
- **THEN** the ignore rule for it is nonetheless present, so its first appearance is untracked
