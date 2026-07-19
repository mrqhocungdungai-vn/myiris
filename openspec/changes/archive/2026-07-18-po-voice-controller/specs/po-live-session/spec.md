## ADDED Requirements

### Requirement: PO session enables skills explicitly

The stateful PO Agent SDK session SHALL enable skills explicitly (`skills: 'all'`) so the globally-installed skills load for the live session regardless of `cwd`, while keeping `settingSources` at its default (all sources) so global `user` settings still apply.

#### Scenario: Global skills are available to the live PO session

- **WHEN** a PO turn runs in a workstream whose `cwd` has no project-local skill config
- **THEN** the live PO session can invoke the globally-installed skills (e.g. `grilling`, the OpenSpec workflow skills)

### Requirement: PO turns are voice control prompts

Iris's PO voice layer SHALL drive the live PO session with short control intents (grill, propose, task-status, archive) rather than hand-authored PRD/issue prompts; the Claude-side PO owns the process and produces the OpenSpec artifacts.

#### Scenario: Voice controls the process, Claude executes it

- **WHEN** the user issues a control intent by voice (e.g. "grill", "propose the change", "are there tasks left?")
- **THEN** the voice layer delivers that intent to the live PO session
- **AND** the Claude-side PO performs the corresponding OpenSpec step, without the voice layer composing the spec content itself
