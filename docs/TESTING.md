# Testing & Checks

[← Back to README](../README.md)

Iris has **two independent automated checks** and no linter. The authoritative
conventions are a living spec — `openspec/specs/test-harness/spec.md`. Read it
before adding tests; this page is the practical summary.

## The two gates

| Command | What it is | Notes |
| --- | --- | --- |
| `npm run build` | Typecheck gate — `tsc --noEmit` (renderer, `src/`) + `tsc -p tsconfig.electron.json` (main process, `electron/`) + Vite build to `dist/` | Must **never** depend on the test runner, so a typecheck is always runnable on its own |
| `npm test` | Behavioral gate — `vitest run` | vitest pinned at `4.1.10` |

Run both to verify a change.

There is **no linter** configured (no eslint/prettier/biome dependency or
config), despite a few stray `eslint-disable` comments in the source.

## The Electron typecheck project

`tsconfig.json` (renderer) is scoped to `"include": ["src"]` with
`"allowJs": false`, so it never reads a line of `electron/`. A second,
sibling project — `tsconfig.electron.json` — covers the whole main process
instead: Node ESM (`module`/`moduleResolution: "NodeNext"`, `lib: ["ES2022"]`,
no DOM), `allowJs`/`checkJs: true` so every `.mjs`/`.cjs` under `electron/` is
checked with no per-file opt-in, and `strict: false` (the directory's
measured green floor — `strict: true` costs 822 errors, almost all annotation
grind; `strict: false` costs 76). `skipLibCheck: true` is load-bearing, not
cosmetic: without it, `@excalidraw/excalidraw`'s bundled `.d.ts` reaches
`browser-fs-access` and reports 78 unrelated errors.

Coverage is a **ratchet, not a per-file convention**: seven strict-family
flags are enabled for free (`strictFunctionTypes`, `strictBindCallApply`,
`noImplicitThis`, `alwaysStrict`, `noImplicitReturns`,
`noFallthroughCasesInSwitch` at +0 errors, `noUnusedLocals` at +2), and three
more are priced but deferred — see "Known gaps" below. Raising coverage means
flipping a flag in `tsconfig.electron.json` and paying its measured price,
never adding a per-file pragma; the include glob already covers every module,
so nothing can be silently left out.

One test file is excluded by name:
`electron/canvas-mcp.golden.test.mjs` runs under `// @vitest-environment
jsdom` and legitimately uses DOM globals, which the project's `lib`
deliberately excludes (adding `"DOM"` there would admit browser globals into
every main-process module). See its `exclude` entry in
`tsconfig.electron.json` for the full rationale.

## What vitest picks up

`vitest.config.mjs` defines **two projects** (Vitest 4 does not inherit
root-level `test` options into projects, so each is fully self-contained):

- **`unit`** — `src/**/*.test.ts` and `electron/**/*.test.mjs`, the ordinary
  behavioral suite.
- **`graph`** — `electron-graph.*.test.mjs` at the repo root, the import-graph
  test (below). Repo root, not `electron/`, because `package.json`'s
  `build.files` globs `electron/**` and excludes only `*.test.mjs`; anything
  else dropped there would ship inside the packaged app.

Replace any hand-maintained file/test count here with the include globs
above and `npm test`'s own summary line — a hand-typed enumeration goes stale
the moment a test file is added, which is exactly what happened to this
section before (add-electron-test-signal).

## The import-graph test

Two halves, because the obvious one alone misses real failures:

- **Supply side** (`electron-graph.supply.test.mjs`) — discovers every
  Electron-free module under `electron/`, dynamically imports each, and
  asserts it loads. Runs under the `graph` project's `server.deps.external`
  setting, which routes these imports through **Node's native ESM loader**
  instead of Vite's SSR transform. That distinction is load-bearing: the
  transform rewrites named imports into namespace property accesses, so a
  module importing a name its sibling does not export resolves to
  `undefined` under the transform instead of throwing — silently passing the
  exact defect class this test exists to catch. It also catches a circular
  import the transform would mask as a stale `undefined` binding rather than
  the `ReferenceError` the native loader raises.
- **Demand side** (`electron-graph.demand.test.mjs`) — statically parses the
  import statements of every module under `electron/`, including
  Electron-dependent ones like `main.mjs`, and asserts each relative sibling
  import is actually exported by its target. Importers are only ever parsed,
  never imported — that's what lets this cover `main.mjs` and other modules
  a test cannot boot. Target export lists come from dynamically importing
  the Electron-free targets (same native-loader mechanism as the supply
  side).

`electron/main.mjs` requires Electron and cannot be imported by any test, so
it is covered on the demand side only — its own behavior (the composition
wiring, not just its import statements) stays uncovered; see "Known gaps".

## Conventions (summary of the living spec)

- **Where logic lives.** Pure logic belongs in `src/lib/*.ts` or an
  `electron/*.mjs` module with a colocated `*.test.*`. `downsample.ts` was
  extracted out of the mic path precisely to make it testable — do the same
  rather than testing through the UI or the Electron shell.
- **How a module becomes testable.** By **accepting its dependencies as injected
  parameters with production defaults** — never by restructuring it around the
  test or reaching into its internals.
- **Hard boundaries.** No test may boot Electron, spawn `claude`, require
  `GEMINI_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`, or touch the network.

## Known gaps

Recorded rather than silently left implicit (add-electron-test-signal):

- **Three typecheck flags are priced but deferred.** Measured against the
  76-error floor in `tsconfig.electron.json`: `useUnknownInCatchVariables`
  +26 errors, `strictNullChecks` +91, `noImplicitAny` +719.
  `strictNullChecks` is the highest-value of the three despite not being the
  largest — null-safety (a window that is gone, a session mid-reconnect) is
  the classic Electron main-process failure mode, and `main.mjs` is already
  full of `?.` guards suggesting the author knew it mattered.
- **One behavioral finding surfaced by clearing the 76 errors, deliberately
  not fixed as part of that change.** `main.mjs`'s
  `session.defaultSession.setPermissionRequestHandler` compares the
  `permission` argument against the literals `"audioCapture"` and
  `"videoCapture"` in addition to `"media"`. The installed Electron version's
  type declarations say only `"media"` is ever passed to this specific
  handler — the other two are stale, from an older belief about the
  permission API (or belong to `setPermissionCheckHandler`, a different
  handler). Not a security regression (the checks are overly-permissive dead
  branches, not under-permissive ones — only `"media"` ever actually grants
  access), but worth a look if the security boundary around media
  permissions is revisited.
- **No vitest Electron-stub harness.** `main.mjs`'s own behavior (the
  composition wiring, not just its import statements) has no automated
  coverage — a stub convincing enough to boot it is a harness, not a shim,
  and building it against the pre-split 4297-line file means building it
  twice. Deferred to after the `main.mjs` split (design.md D5 of
  add-electron-test-signal), when `main.mjs` becomes a much smaller
  composition root.
- **Files over the 250–450 line convention** (see Conventions in
  [CLAUDE.md](../CLAUDE.md)): `src/App.tsx` (1738 lines),
  `src/components/SetupPanel.tsx` (1023), `src/components/VaultGalaxy.tsx`
  (561), `electron/canvas-mcp.mjs` (557). Enforcement is convention-only by
  deliberate decision, so these are flagged here rather than silently
  accepted.

## Troubleshooting

- `vitest: command not found` — the checkout's `node_modules` predates the test
  runner being added. `npm ci` fixes it.
