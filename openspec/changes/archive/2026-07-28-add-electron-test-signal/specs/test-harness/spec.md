## MODIFIED Requirements

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

### Requirement: Node-side modules are testable as ES modules

The runner SHALL be configured so that the Electron main-process modules under `electron/` can be imported directly as ES modules in a Node environment, matching the repo's `"type": "module"` setting, without a build step.

Where import-correctness is the property under test, those modules SHALL be loaded by Node's native ES module loader rather than through the runner's module transform. The transform rewrites named imports into namespace property accesses, which silently converts a link-time error into an `undefined` binding — so a module verified only through it has not been verified at all.

#### Scenario: Importing a main-process module

- **WHEN** a test file imports `electron/run-queue.mjs`
- **THEN** the import resolves and the module's exports are usable without bundling

#### Scenario: Import correctness is checked without the transform

- **WHEN** the harness verifies that a module's imports resolve and its exports exist
- **THEN** that module is loaded by Node's native loader, so a missing named export fails rather than yielding `undefined`

## ADDED Requirements

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
