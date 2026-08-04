## ADDED Requirements

### Requirement: The second brain is a verb Iris can call, not prose it must recite

Capturing to and querying the second brain SHALL be reachable through a named verb with its own parameter schema, scoped to the note-keeping skills.

It SHALL NOT be offered only as prose in the voice layer's system instruction directing it toward a general-purpose task tool. A capability that ships its own skills but contributes no callable function is not reachable on its own terms — it depends on the voice layer remembering to describe it correctly.

#### Scenario: Note work has its own function

- **WHEN** the voice layer's tool declarations are built and the worker is available
- **THEN** a declaration exists for second-brain work, with its own parameters

#### Scenario: The verb is scoped to note-keeping

- **WHEN** a second-brain run executes
- **THEN** it has the note-keeping skills available and does not have skills belonging to unrelated workflows

### Requirement: Every run's outcome is recorded, without costing a run

When a run reaches a terminal state, its outcome SHALL be appended to the second-brain vault: the verb, the request, the result, the cost, the error if any, and the tools it used. **Failures SHALL be recorded on the same terms as successes** — a failed attempt is at least as worth keeping as a successful one.

This capture SHALL be a direct file write. It SHALL NOT start a Claude run, SHALL NOT consume tokens, and SHALL NOT occupy the single execution slot — bookkeeping must never delay the user's next request, and knowledge must never be lost because the queue was busy.

Capture SHALL NOT depend on the voice layer choosing to record something. Accumulated knowledge that requires a model to remember to save it is knowledge that will be lost.

#### Scenario: A successful run is recorded

- **WHEN** a run completes successfully
- **THEN** its verb, request, result, cost, and tools used are appended to the vault

#### Scenario: A failed run is recorded

- **WHEN** a run fails, is cancelled, or terminates on a ceiling
- **THEN** its outcome and error are appended on the same terms as a success

#### Scenario: Capture never blocks the queue

- **WHEN** a run finalizes and its outcome is captured
- **THEN** no additional run is started, no tokens are spent, and the execution slot is not held

#### Scenario: Capture is not conditional on the voice layer

- **WHEN** a run finalizes without the voice layer taking any action
- **THEN** the outcome is still captured

### Requirement: Synthesis is deliberate, and offered rather than imposed

Turning captured records into structured knowledge — distilling and weaving them into the vault — SHALL happen when the second-brain verb is called, not automatically after each run.

Iris SHALL be able to notice that enough has accumulated to be worth synthesizing and offer it. It SHALL NOT run synthesis unprompted.

Raw capture is a log; synthesis is the learning. Separating them means the log is never lost to a busy queue, and the expensive step happens when there is enough material to justify it.

#### Scenario: Synthesis runs when asked

- **WHEN** the second-brain verb is called for synthesis
- **THEN** the accumulated records are read and woven into the vault

#### Scenario: Synthesis is offered, not imposed

- **WHEN** enough records have accumulated to be worth synthesizing
- **THEN** Iris offers to do it and waits, rather than starting it

#### Scenario: No synthesis run follows an ordinary run

- **WHEN** an ordinary run finalizes
- **THEN** no synthesis run is started as a consequence
