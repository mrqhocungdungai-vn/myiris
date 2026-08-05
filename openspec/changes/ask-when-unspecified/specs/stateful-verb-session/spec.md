## MODIFIED Requirements

### Requirement: A stateless verb remains a one-shot headless run

A stateless verb SHALL run as a one-shot headless run per request, independent of the live-session mechanism. The two shapes differ in **lifetime**, not in transport: both run on the Agent SDK's `query()`, a stateful verb as a resident session, a stateless one as a single run that ends when it finishes.

Statelessness SHALL mean holding no resident session. It SHALL NOT be taken to mean, on its own, that the run cannot ask: that is a separate declared property, and where it holds it holds for a stated reason rather than as a consequence of the run's shape. The implementing verb cannot ask **when the task list it works from is already settled** — the grilling that resolves ambiguity happened in the shaping verb, before a `tasks.md` existed, so the answers are already in the change and pausing to re-ask them is redundant. That reasoning SHALL NOT be extended to a run given no specification at all: there is no earlier grilling on that path to have resolved anything, so nothing about it is settled and the redundancy argument does not apply. See `verb-tool-surface` for what governs the permission itself.

Statefulness is not continuity: a stateless verb still resumes its own prior conversation by stored session id. What distinguishes it is that it holds no session between requests.

A stateless run that pauses on a question SHALL still be a one-shot run: it SHALL NOT become resident, and it SHALL NOT be kept alive beyond the request it was started for. Pausing is not residency — a paused run is the same single run, waiting.

#### Scenario: A stateless run is dispatched as a discrete run

- **WHEN** the user submits a stateless-verb task
- **THEN** the app starts a one-shot headless run for it and reports its result when the run completes

#### Scenario: A stateless verb holds no resident session

- **WHEN** a stateless run completes
- **THEN** no resident session remains alive between that verb's tasks

#### Scenario: A run that paused to ask is still not resident

- **WHEN** a stateless run pauses on a question, is answered, and finishes
- **THEN** no resident session remains alive afterwards, exactly as for a run that never paused

#### Scenario: Not asking is justified by settled work, not by the run's shape

- **WHEN** the implementing verb runs against a settled task list and against no specification at all
- **THEN** the first cannot ask because its answers were already collected, and that reason is not claimed for the second
