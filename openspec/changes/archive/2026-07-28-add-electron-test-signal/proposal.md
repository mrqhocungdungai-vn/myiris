## Why

Both of the repo's two gates are blind to `electron/`. `tsconfig.json` is `"include": ["src"]` with `"allowJs": false`, so `npm run build`'s `tsc --noEmit` never reads a single line of the main process; and of the 13 `electron/*.test.mjs` files, none imports `electron/main.mjs`. That leaves 4287 lines of `main.mjs` — the Gemini↔Claude bridge, the Live session, the run pipeline, all 47 IPC handlers — with no automated signal of any kind.

This matters now because the next change splits `main.mjs` into ~17 modules. The failure class that refactor introduces is precisely the one nothing here can currently detect: a fumbled import name, a forgotten export, a dropped reference. Such a break would not fail the build, would not fail the tests, and would surface at runtime in the paths nobody exercises by hand — `scheduleReconnect`, listen rotation, `shutdownTeardown`, the corrupt-store quarantine. Building the signal first is the precondition that makes that split safe rather than a leap.

## What Changes

- Add `tsconfig.electron.json` covering `electron/**/*.mjs` and `electron/**/*.cjs` with **`checkJs: true`**, **`strict: false`**, `allowJs: true`, `noEmit: true`, `skipLibCheck: true`, `module`/`moduleResolution: "NodeNext"`, `types: ["node"]`, and the six strict-family flags that cost nothing (below).
  - **Fix the 76 errors this reports**, bringing `electron/` to a green baseline under the new project. Distribution: `main.mjs` 20, `po-session.mjs` 12, `canvas-store.test.mjs` 9, `po-session.test.mjs` 9, `canvas-mcp.mjs` 8, `claude-stream.mjs` 5, and a tail of 13.
  - Crucially, **none of the 76 is an implicit-any annotation error.** They are 34 × `TS2339` (property does not exist), 15 × `TS2353` (unknown object-literal property), 5 × `TS2554` (wrong argument count), 5 × `TS2322`, and a tail — the codes most likely to be genuine latent bugs, and `TS2339`/`TS2305` is exactly the class that catches a bad import or a missing export.
  - Enable the six strict-family flags measured at **+0 errors**: `strictFunctionTypes`, `strictBindCallApply`, `noImplicitThis`, `alwaysStrict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Plus `noUnusedLocals` (+2). Free coverage, taken now.
  - Defer the priced ones, with the price recorded so the next decision is informed rather than guessed: `useUnknownInCatchVariables` **+26**, `strictNullChecks` **+91**, `noImplicitAny` **+719**. Coverage grows by turning flags on, not by editing per-file pragmas.
- Wire the new project into `npm run build`, alongside the existing `tsc --noEmit` and the precedent guard script `node scripts/check-three-dedupe.mjs`.
- Add an import-graph test with **two halves**, because the obvious half alone does not work:
  - *Supply side*: dynamically import every Electron-free module under `electron/` and assert it loads. This must run under **Node's native loader**, not Vite's SSR transform — verified: vitest's transform rewrites named imports into namespace property accesses, so a module importing a name its sibling does not export **passes silently** under vitest while plain `node` throws `SyntaxError: does not provide an export named …`.
  - *Demand side*: statically parse every `electron/**/*.{mjs,cjs}` import block, resolve each relative specifier, and assert the target actually exports each imported name. This covers `main.mjs`, `ipc.mjs` and `window.mjs` — which the supply side must exclude because they need Electron, and which are exactly where the follow-up change's wiring risk lives.
- Document in `CLAUDE.md`'s Conventions section: the typecheck-flag ratchet (`electron/` is checked at the floor automatically; raising coverage means enabling a flag and paying its measured price), and the file-size convention — one responsibility, graspable in a few minutes, target **250–450 lines**, `*.test.*` exempt as append-only case lists. Enforcement is **convention-only by explicit decision**, no guard script; the tradeoff is accepted knowingly, since this is the mechanism under which `main.mjs` grew across 12 consecutive feature changes.
- Correct `CLAUDE.md`'s stale line counts in the File map: `electron/main.mjs` is **4287** lines, not "~1500"; `src/App.tsx` is **1738**, not "~1350".
- Correct `docs/TESTING.md`, which is stale in the same way: it lists 3 `src` and 6 `electron` test files; reality is 9 and 13 (22 files, 175 tests). Replace the enumeration with the include globs so it cannot rot again.

Recorded as follow-ups, explicitly **not** in scope: the three priced flags above; and bringing the over-450 files into compliance — `src/App.tsx` (1738), `src/components/SetupPanel.tsx` (1023), `src/components/VaultGalaxy.tsx` (561), `electron/canvas-mcp.mjs` (542).

**No behavior change.** Runtime modules are touched only to fix type errors — type annotations and genuine bug fixes where a `TS2339` reveals one, never a logic rewrite. Any fix that would alter behavior is out of scope and gets recorded instead. Every existing capability spec must remain true.

## Capabilities

### New Capabilities

(none — the file-size convention is recorded in `CLAUDE.md` as documentation, not as a spec requirement, per the explicit decision that its enforcement stay convention-only)

### Modified Capabilities

- `test-harness`: three changes. The typecheck gate, which today covers only `src`, SHALL also cover `electron/`, with coverage raised by enabling compiler flags rather than per-file opt-in. The harness SHALL assert that every Electron-free module under `electron/` imports cleanly **under Node's native loader**, since the test runner's transform masks the very error class being guarded against. And the harness SHALL statically verify the *demand* side of the module graph, covering the Electron-dependent modules that cannot be imported in a test. The existing "Typecheck stays independent" scenario also needs rewording, as it describes a single TypeScript check.

## Impact

- **New files**: `tsconfig.electron.json`; the import-graph test under `electron/`; a vitest project configuration so the graph test runs against unbundled modules.
- **Modified files**: `package.json` (the `build` script only), `CLAUDE.md`, `docs/TESTING.md`, and the modules holding the 76 type errors (annotations and any genuine bugs those errors reveal).
- **Unmodified**: all of `src/`. No IPC channels, no `window.iris` surface change, no dependencies added (`typescript` 6.0.3, `vitest` and `@types/node` 26.0.1 are all present).
- **Gate behavior**: `npm run build` gains a second `tsc` invocation covering the whole main process. `npm test` gains one test file and one vitest project.
- **Enables**: the follow-up `main.mjs` split. Because the floor applies to the whole directory automatically, every module that split extracts is type-checked from the moment it exists, with no per-module opt-in step and no inherited typing debt — `main.mjs`'s floor error count is 20, and those 20 are fixed here.
