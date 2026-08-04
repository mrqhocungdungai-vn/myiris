# openspec-native-pipeline Specification

## Purpose
OpenSpec is the pipeline's only spec-driven-development surface. Requirements are grilled before any planning artifact exists, process work is specified before it is implemented, and the project's own `openspec/` tree — never a parallel task list Iris keeps for itself — is what gets read to answer what remains. The implementing verb reads the project's actual state and acts on it rather than refusing when no change happens to be open.
## Requirements

### Requirement: Grilling gates artifact creation
The shaping verb SHALL NOT create any planning artifact until it has been instructed to grill, and SHALL use the `grilling` skill to elicit and stress-test requirements first. Grilling's clarifying questions SHALL surface through the voice relay (`AskUserQuestion`), not raw stdin.

#### Scenario: The shaping verb refuses to produce artifacts before grilling

- **WHEN** the shaping verb receives a work intent but has not been told to grill
- **THEN** it starts a grilling pass to clarify the request
- **AND** it does not yet create an OpenSpec change or any spec/task file

#### Scenario: Grilling questions reach the voice user

- **WHEN** the grilling pass needs a decision from the user
- **THEN** the question is raised via `AskUserQuestion` and answered by voice before grilling continues

### Requirement: Process work is specified before it is implemented
Work that goes through the software-development process SHALL still be specified before it is implemented: shaping produces a change with tasks, and the execution verb implements those tasks.

What SHALL NOT be required is that the **user** enforces this ordering by naming a worker or operating a control. The ordering follows from the project's own state, which the execution verb reads at dispatch.

#### Scenario: Process work is specified first

- **WHEN** the user asks for a new feature and agrees to shape it
- **THEN** a change with tasks is produced before implementation begins

#### Scenario: The ordering is not the user's to enforce

- **WHEN** the user asks to build something and then asks to get on with it
- **THEN** the correct verb runs at each point without the user naming a worker or operating a control

### Requirement: The execution verb reads the project rather than refusing
The execution verb SHALL read the project at dispatch and behave according to what is there:

- An open change with unchecked tasks SHALL be implemented through the OpenSpec apply workflow, with the OpenSpec workflow skills available.
- No open change with unchecked tasks SHALL mean ordinary work, carried out directly, with the OpenSpec workflow skills **not** loaded and no process artifacts created.

The execution verb SHALL NOT refuse a request because no change has been proposed. A user asking for a small piece of work is not asking for a software-development process, and refusing them is not a safety measure — it is a refusal to do the job.

**This deliberately removes the gate that previously prevented implementation without a specification.** It is recorded here as a decision, not an omission. The protection that gate provided — an unattended run writing code against no agreed specification — now comes from the execution verb being reviewed before **every** dispatch. If that review is ever weakened, this decision SHALL be revisited with it.

#### Scenario: Work with a specification follows the process

- **WHEN** the execution verb is called in a project with an open change that has unchecked tasks
- **THEN** the run implements those tasks through the OpenSpec apply workflow

#### Scenario: Work without a specification is simply done

- **WHEN** the execution verb is called in a project with no open change with unchecked tasks
- **THEN** the run carries out the work directly, without loading the OpenSpec workflow skills and without creating process artifacts

#### Scenario: A request is never refused for lacking a change

- **WHEN** the execution verb is called and no change has been proposed
- **THEN** the run proceeds as ordinary work rather than failing

#### Scenario: The removed gate is replaced by review, not by nothing

- **WHEN** the execution verb is dispatched, with or without an open change
- **THEN** it is parked for the user's review before any work begins

### Requirement: Task-status query reads OpenSpec
When asked whether tasks remain, the verb that answers SHALL read the open changes' `tasks.md` files and report done/not-done. When none remain, Iris MAY follow up by invoking the shaping verb to brainstorm a new change.

#### Scenario: Outstanding tasks are reported

- **WHEN** the user asks "are there tasks left?"
- **THEN** the answering verb reads `openspec/changes/*/tasks.md` and reports which tasks are outstanding or that all are complete

#### Scenario: No tasks remain

- **WHEN** all changes are complete and the user asks what is next
- **THEN** completion is reported, and Iris may go on to propose or brainstorm a new change

### Requirement: OpenSpec is the single SDD surface
The pipeline SHALL use OpenSpec (`openspec/changes/` → `openspec/specs/`) as the only spec-driven-development surface; the personas SHALL NOT create or read a `.scratch/<slug>/` hand-written SDD. A `cwd` without OpenSpec SHALL be initialized with `openspec init` before proposing.

#### Scenario: New project is initialized

- **WHEN** the shaping verb is about to propose in a `cwd` that has no `openspec/` directory
- **THEN** `openspec init` is run in that `cwd` before the change is created

#### Scenario: No .scratch artifacts are produced

- **WHEN** the shaping verb completes its work for a feature
- **THEN** the deliverables live under `openspec/changes/<name>/` and no `.scratch/<slug>/` analysis/PRD/issue files are written
