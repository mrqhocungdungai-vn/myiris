# test-harness

## Purpose
Establishes the repo's automated test runner and the testability conventions Node-side modules follow so they can be exercised outside the app's runtime prerequisites — a build-only typecheck gate (`npm run build`) is not a substitute for behavioral tests.

## Requirements

### Requirement: An automated test runner exists and is invocable

The repo SHALL provide an automated test runner invocable as `npm test`, in addition to the existing `npm run build` typecheck gate. The runner SHALL exit non-zero when any test fails, so it can gate a commit or a CI step.

`npm run build` SHALL remain the typecheck gate and SHALL NOT be made to depend on the test runner — a typecheck must stay runnable on its own.

#### Scenario: Tests pass

- **WHEN** `npm test` is run and every test passes
- **THEN** the runner exits with code 0 and reports the number of tests that ran

#### Scenario: A test fails

- **WHEN** `npm test` is run and at least one test fails
- **THEN** the runner exits with a non-zero code and names the failing test and assertion

#### Scenario: Typecheck stays independent

- **WHEN** `npm run build` is run
- **THEN** it performs the TypeScript check and Vite build without invoking the test runner

### Requirement: Tests run without the app's runtime prerequisites

Tests SHALL run to completion in an environment that has none of Iris's runtime prerequisites. Specifically, no test SHALL require booting Electron, launching a `BrowserWindow`, resolving or spawning the `claude` binary, holding a `GEMINI_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, or reaching the network.

A test that cannot meet this constraint SHALL be considered out of scope for this harness rather than a reason to relax it.

#### Scenario: Clean environment

- **WHEN** `npm test` is run on a machine with no `.env`, no `claude` binary on `PATH`, and no network access
- **THEN** every test still runs and passes

#### Scenario: No subprocess is spawned

- **WHEN** the full test suite runs
- **THEN** no `claude` subprocess and no Electron process is created

### Requirement: Node-side modules are testable as ES modules

The runner SHALL be configured so that the Electron main-process modules under `electron/` can be imported directly as ES modules in a Node environment, matching the repo's `"type": "module"` setting, without a build step or transpilation of those files.

#### Scenario: Importing a main-process module

- **WHEN** a test file imports `electron/run-queue.mjs`
- **THEN** the import resolves and the module's exports are usable without bundling or transpiling

### Requirement: Modules under test expose dependencies by injection

A module brought under test SHALL be made testable by accepting its external dependencies as injected parameters with production defaults, not by restructuring it, duplicating its logic, or reaching into its internals from the test.

Injection SHALL preserve production behavior exactly: an existing call site that does not pass the dependency SHALL behave as it did before the parameter existed.

#### Scenario: Existing call site is unaffected

- **WHEN** a caller invokes a seamed function without supplying the injected dependency
- **THEN** the real production dependency is used and behavior is identical to before the seam was added

#### Scenario: Test substitutes a fake

- **WHEN** a test invokes the same function supplying a fake dependency
- **THEN** the module drives the fake instead of the real dependency, and no production dependency is loaded

### Requirement: The execution slot's invariants are covered by tests

The run queue's slot invariants SHALL be asserted by tests, driven through the queue's public interface with an injected fake run starter. The tests SHALL cover, at minimum, the invariants already stated in the `run-execution-queue` capability: that at most one run holds the execution slot system-wide, that a run reaches exactly one terminal status, that cancelled queued runs are skipped when the slot is released, and that the slot is released exactly once per run.

These tests SHALL assert existing behavior only. This capability SHALL NOT be used to introduce or change run-queue behavior.

#### Scenario: Single slot is enforced

- **WHEN** a run is submitted while another run holds the execution slot
- **THEN** the test observes the second run queued rather than started, and the injected run starter was invoked exactly once

#### Scenario: Finalize is once-only

- **WHEN** a run that has already reached a terminal status is finalized again
- **THEN** the test observes that no second terminal event is emitted and the slot is not released a second time

#### Scenario: Cancelled queued run is skipped

- **WHEN** the active run finalizes and the oldest queue entry refers to a run cancelled while waiting
- **THEN** the test observes that entry discarded without being started, and the next eligible queued run started instead
