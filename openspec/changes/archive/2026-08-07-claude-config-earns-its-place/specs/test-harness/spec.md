## ADDED Requirements

### Requirement: The logic that gates the workflow is itself reachable by the test runner

The repo's build and gate scripts SHALL be within the test runner's reach, so logic
that decides whether work proceeds is covered by tests on the same terms as the
code it guards.

This closes an asymmetry the lint gate already names. Lint covers three source
directories — the renderer, the main process, and the build scripts — described
there as "the same source surface the other gates cover between them", yet the test
runner's own configuration reached only the first two. A predicate that decides
whether a destructive shell command runs, or whether two configuration trees have
diverged, is exactly the kind of logic whose correctness cannot be established by
reading it: the interesting cases are the ones the author did not think of, which
is what a test enumerates and an inspection does not.

Extending the runner's reach SHALL NOT change what the packaged app contains. The
scripts directory is not among the paths the packaging configuration ships, so test
files added beside those scripts cannot reach a user's install — unlike the
main-process directory, where test files are shipped-by-default and excluded by an
explicit rule.

The constraint that no test may require the app's runtime prerequisites SHALL apply
to these tests unchanged. A gate's pure decision logic SHALL be separable from its
invocation of an external tool, so the decision can be tested without the tool
being installed or a subprocess being spawned.

#### Scenario: A gate predicate is covered by tests

- **WHEN** a gate's decision logic determines whether a workflow step proceeds
- **THEN** a test file beside that logic exercises it directly, including the cases it must refuse and the cases it must allow

#### Scenario: Test files beside the build scripts are collected

- **WHEN** the test runner collects test files
- **THEN** test files in the build-scripts directory are included in the run, alongside the renderer and main-process suites

#### Scenario: Extending the runner's reach ships nothing new

- **WHEN** the app is packaged after test files are added beside the build scripts
- **THEN** the packaged app contains neither those test files nor the scripts directory

#### Scenario: A gate's decision is testable without its tool

- **WHEN** a gate's decision logic is tested on a machine where the external tool that gate invokes is absent
- **THEN** the tests run and pass, because the decision is separable from the invocation
