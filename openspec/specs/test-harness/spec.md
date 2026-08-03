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
- **THEN** it performs every configured TypeScript check — the renderer project and the Electron main-process project — and the Vite build, without invoking the test runner

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

The runner SHALL be configured so that the Electron main-process modules under `electron/` can be imported directly as ES modules in a Node environment, matching the repo's `"type": "module"` setting, without a build step.

Where import-correctness is the property under test, those modules SHALL be loaded by Node's native ES module loader rather than through the runner's module transform. The transform rewrites named imports into namespace property accesses, which silently converts a link-time error into an `undefined` binding — so a module verified only through it has not been verified at all.

#### Scenario: Importing a main-process module

- **WHEN** a test file imports `electron/run-queue.mjs`
- **THEN** the import resolves and the module's exports are usable without bundling

#### Scenario: Import correctness is checked without the transform

- **WHEN** the harness verifies that a module's imports resolve and its exports exist
- **THEN** that module is loaded by Node's native loader, so a missing named export fails rather than yielding `undefined`

### Requirement: The typecheck gate covers the Electron main process

The typecheck gate SHALL cover `electron/` in addition to `src/`. Because the repo's root `tsconfig.json` is scoped to `"include": ["src"]` with `"allowJs": false`, a separate TypeScript project SHALL exist for the main process, covering `electron/**/*.mjs` and `electron/**/*.cjs`, and `npm run build` SHALL run it.

That project SHALL enable `allowJs` and `checkJs` so that **every** module under `electron/` is checked, with no per-file opt-in step. Its strictness SHALL be set at the level the directory can sustain green, and coverage SHALL be raised thereafter by enabling additional compiler flags, not by annotating individual files.

`skipLibCheck` SHALL be enabled — without it a transitive dependency's bundled type declarations report errors unrelated to this repo's code.

#### Scenario: The whole directory is checked

- **WHEN** the Electron typecheck project is run
- **THEN** it reports zero errors, and the set of files it read includes every non-excluded `.mjs` and `.cjs` file under `electron/`

#### Scenario: A type error anywhere under electron/ fails the build

- **WHEN** any module under `electron/` contains a type error at the project's configured strictness, whether or not that module carries any pragma
- **THEN** `npm run build` exits non-zero and names the offending file and line

#### Scenario: An unresolvable import fails the build

- **WHEN** a module under `electron/` imports from a path that does not resolve, or imports a name the target module does not export
- **THEN** `npm run build` exits non-zero and names the offending module

#### Scenario: Deferred strictness is priced, not guessed

- **WHEN** a strictness flag is left disabled
- **THEN** its cost in additional errors is recorded, so the decision to enable it later is informed rather than exploratory

### Requirement: The Electron typecheck project's Node types match the Node that Electron embeds

The Electron typecheck project derives its view of the Node standard library from an installed `@types/node` package. Because modules under `electron/` execute on the Node build embedded inside Electron — not on the developer's system Node — those declarations SHALL describe that embedded runtime. A newer `@types/node` admits standard-library APIs that do not exist at runtime, so the typecheck reports success for code that throws on launch.

The authority for which major version is correct SHALL be the `@types/node` range that the installed `electron` package itself declares, not the repo's `engines.node` floor. The two may coincide, but only the former moves in lockstep with the embedded Node, and it is the one Electron's own bundled type declarations are written against.

`npm run build` SHALL fail when the resolved root `@types/node` version does not satisfy the range `electron` declares, and the failure SHALL name both versions so the required correction is unambiguous. This check SHALL run on every build rather than at install time only, so that a change to either package is caught regardless of which one moved.

This requirement exists because the divergence is otherwise silent: `skipLibCheck` is enabled (see "The typecheck gate covers the Electron main process"), and a mismatched `@types/node` produces no error of its own — it simply widens or narrows the API surface the gate accepts.

#### Scenario: Aligned types build successfully

- **WHEN** `npm run build` runs and the resolved root `@types/node` version satisfies the `@types/node` range declared by the installed `electron` package
- **THEN** the build proceeds without any diagnostic from this check

#### Scenario: A newer types major fails the build

- **WHEN** the resolved root `@types/node` major is higher than the range `electron` declares — for example types for Node 26 while Electron embeds Node 24
- **THEN** `npm run build` exits non-zero and reports both the resolved `@types/node` version and the range `electron` declares

#### Scenario: Upgrading Electron to a different embedded Node major is caught

- **WHEN** the `electron` dependency is upgraded to a version declaring a different `@types/node` range, and the root `@types/node` is left unchanged
- **THEN** `npm run build` exits non-zero, so the types are updated as part of that upgrade rather than silently describing the previous runtime

#### Scenario: Duplicate Node declarations do not accumulate

- **WHEN** the root `@types/node` satisfies the range `electron` declares
- **THEN** no nested `@types/node` copy is installed beneath `electron`, so the typecheck program reads a single set of Node global declarations rather than two

### Requirement: Module imports are verified under the native ES module loader

The harness SHALL verify that every module under `electron/` which does not require the Electron runtime can be imported successfully, and it SHALL perform that verification under Node's native ES module loader rather than through the test runner's module transform.

Running these imports through a transform that rewrites named imports into namespace property accesses SHALL NOT be relied upon, because such a transform reports success for a module importing a name its target does not export, and for a circular import that the native loader rejects. The transform masks precisely the failures this requirement exists to detect.

Modules requiring the Electron runtime are out of scope for this requirement, consistent with the existing constraint that tests never boot Electron.

#### Scenario: All Electron-free modules load

- **WHEN** the harness runs on a machine with no `.env`, no `claude` binary, and no network access
- **THEN** every Electron-free module under `electron/` imports successfully and no Electron process is created

#### Scenario: A missing named import is caught

- **WHEN** a module imports a name that its target module does not export
- **THEN** `npm test` exits non-zero and reports the missing export

#### Scenario: A circular import is caught

- **WHEN** two modules form an import cycle that the native loader rejects at evaluation time
- **THEN** `npm test` exits non-zero rather than reporting the affected binding as `undefined`

#### Scenario: The covered set cannot shrink silently

- **WHEN** the harness determines which modules to verify
- **THEN** it asserts the expected number of covered modules and names its intentional exclusions, so a module dropping out of coverage fails the suite instead of passing unnoticed

### Requirement: The module graph is verified on the demand side

The harness SHALL verify, for every module under `electron/` including those requiring the Electron runtime, that each name it imports from a relative sibling is actually exported by that sibling.

This SHALL be performed by static analysis of import statements rather than by importing the module, so that `main.mjs` and any other Electron-dependent module is covered without booting Electron. Static analysis is required because these modules hold the composition wiring, which is where a reorganization's import errors concentrate and which no importable test can reach.

Where the analysis cannot interpret an import form, it SHALL fail rather than skip, so that unparsed imports are visible instead of silently uncovered.

#### Scenario: A bad import in an Electron-dependent module is caught

- **WHEN** the composition root, or any other module that requires the Electron runtime, imports a name that its target sibling does not export
- **THEN** `npm test` exits non-zero and names the importing module, the target, and the missing name

#### Scenario: No Electron process is created

- **WHEN** the demand-side verification runs
- **THEN** it reads module sources without importing them, and no Electron process and no subprocess of the app is created

#### Scenario: An uninterpretable import form fails loudly

- **WHEN** a module uses an import form the analysis does not handle
- **THEN** the harness reports it as a failure rather than omitting that module's imports from verification

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
