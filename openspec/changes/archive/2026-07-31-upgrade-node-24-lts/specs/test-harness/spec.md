## ADDED Requirements

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
