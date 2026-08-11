## MODIFIED Requirements

### Requirement: A verb sees only the capabilities its work needs

Each verb SHALL declare the skills and external tool servers available to the
runs it starts. A verb SHALL NOT receive the full set of capabilities the
application ships.

A skill listed for a verb SHALL be one whose primary modes the verb's own tool
bounds permit. A skill whose central instructions require tools the verb
withholds — asking the user, writing files — is not a capability for that verb;
it is a set of instructions the run can only fail to follow, and it SHALL NOT
be listed. An empty list is the correct declaration for a verb whose job is
carried by its prompt and its structural guards.

Workflow commands SHALL be scoped on the same terms as skills, derived from the
same declared surface: a run may invoke a workflow command only when its
resolved skill list carries it. Commands and skills share one invocation
namespace, so this bound is enforced by configuration rather than at the point
of invocation — the runtime refuses an unlisted command and names the scope it
refused against. A verb's declared list is therefore the whole of what its runs
can reach, with no parallel channel that silently un-decides it.

This is what makes verbs distinct tools rather than distinct names for one
agent: without bounded capability surfaces, every verb would be the same worker
under a different label.

#### Scenario: A verb cannot reach an unrelated capability

- **WHEN** a run started by an implementation verb executes
- **THEN** skills belonging to unrelated workflows — requirement-shaping, note-keeping — are unavailable to it

#### Scenario: Capability bounds come from the registry

- **WHEN** a run is configured for a verb
- **THEN** its available skills and tool servers are exactly those the registry declares for that verb

#### Scenario: A skill is not listed where its modes are forbidden

- **WHEN** the read-only explaining depth is configured
- **THEN** it carries no skill whose primary modes are asking the user and creating artifacts, and the note-editing verb carries no corpus-curation suite

#### Scenario: A workflow command is bounded by the verb's skill surface

- **WHEN** a run whose declared list does not carry a workflow command invokes that command
- **THEN** the invocation is refused and the refusal names the scope it was refused against, while a run whose declared list carries it may invoke it

## ADDED Requirements

### Requirement: Shipped instruction text refers only to capabilities that ship

Every skill body and persona body bundled into the app SHALL reference only
skills and commands that ship in the same bundle, and SHALL NOT assert the
availability of a tool whose presence the registry decides per run. Both SHALL
be asserted by a test that reads the shipped text, because instruction prose
is a capability surface with neither a typechecker nor a runtime failure when
it goes stale — a skill directing the model to a skill that does not exist
fails only at the moment a real run follows the pointer.

#### Scenario: A dead cross-reference cannot ship

- **WHEN** a bundled skill or persona names a skill or workflow command
- **THEN** a test resolves that name against the shipped bundle, and an unshipped name fails the suite

#### Scenario: The persona does not claim what the registry decides

- **WHEN** a persona body used by verbs whose ability to ask varies with project state is checked
- **THEN** it makes no claim that the question tool is or is not available, leaving that statement to the per-run instruction that knows
