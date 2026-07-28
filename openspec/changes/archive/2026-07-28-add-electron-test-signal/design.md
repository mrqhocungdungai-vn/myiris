## Context

The repo has two independent gates, `npm run build` (typecheck + Vite build) and `npm test` (vitest). Neither sees `electron/`:

- `tsconfig.json` is `"include": ["src"]` with `"allowJs": false`. No `electron/` file is read by `tsc`.
- 13 test files exist under `electron/`, all covering already-extracted modules. None imports `main.mjs`. `run-queue.test.mjs:481` carries a comment noting a behavior is "not re-testable from this file without a main.mjs harness".

`electron/main.mjs` is 4287 lines with zero coverage from either gate. That is tolerable only while nobody restructures it, and the next change splits it into ~17 modules.

Five measurements shaped this design. All were taken by running `tsc` against candidate configs over `electron/`, and by building the proposed test and probing it with synthetic failures.

**M1 — Error count by strictness.** The choice of strictness dominates cost:

| config | errors |
| --- | --- |
| `checkJs: true, strict: true` | 822 |
| `checkJs: true, strict: false` | **76** |
| `checkJs: false` | 0 |

**M2 — What the 76 actually are.** Not annotation noise. By TS code: 34 × `TS2339` (property does not exist), 15 × `TS2353` (unknown object-literal property), 5 × `TS2554` (wrong argument count), 5 × `TS2322` (not assignable), 5 × `TS2740`, 4 × `TS2345`, and a tail of 8. Zero implicit-any errors. These are the codes that find real bugs — and `TS2339`/`TS2305` is precisely the class that catches a bad import or missing export.

**M3 — Where the other 746 come from.** Adding `noImplicitAny` alone takes 76 → 795. The gap between `strict: false` and `strict: true` is almost entirely annotation grind: 376 × `TS7006`, 172 × `TS7005`, 59 × `TS7034`, 32 × `TS7031`, 36 × `TS7018`. High effort, low bug yield.

**M4 — Per-flag prices.** Each strict-family flag measured individually against the 76-error floor:

| flag | delta |
| --- | --- |
| `strictFunctionTypes` | +0 |
| `strictBindCallApply` | +0 |
| `noImplicitThis` | +0 |
| `alwaysStrict` | +0 |
| `noImplicitReturns` | +0 |
| `noFallthroughCasesInSwitch` | +0 |
| `noUnusedLocals` | +2 |
| `useUnknownInCatchVariables` | +26 |
| `strictNullChecks` | +91 |
| `noImplicitAny` | **+719** |

Six flags are free. One is nearly free. Three are priced, and now priced *known*.

**M5 — The test runner masks the error class being guarded against.** Building the proposed import-graph test and running it against synthetic failures:

| failure class | vitest (Vite SSR transform) | plain `node` |
| --- | --- | --- |
| unresolvable specifier `"./nope.mjs"` | caught | caught |
| imports a name the sibling does not export | **passes silently** | `SyntaxError: does not provide an export named 'typoName'` |
| circular `const` import (TDZ) | **passes silently** | `ReferenceError: Cannot access before initialization` |
| circular factory wiring (the follow-up's D6 hazard verbatim) | **passes silently** | `ReferenceError` |

Vite's SSR transform rewrites named imports into property accesses on a namespace object, so a nonexistent named import becomes `undefined` at use time rather than a link-time error. This was reproduced independently twice.

## Goals / Non-Goals

**Goals:**

- Cover the whole of `electron/` with a typecheck gate that starts green, and whose coverage can be raised by a known amount for a known price.
- Give `electron/` import-level coverage that actually detects a fumbled import — including in the Electron-dependent modules a test cannot import.
- Ensure the follow-up split inherits no typing debt and needs no per-module opt-in step.
- Correct the stale counts in `CLAUDE.md` and `docs/TESTING.md`.
- Change no behavior.

**Non-Goals:**

- `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables`. Priced and deferred (M4).
- Coverage of `main.mjs` *behavior*. It cannot be imported without Electron. A vitest Electron stub was considered and rejected (D5).
- Splitting `main.mjs`. That is the follow-up.
- The other over-450 files. Follow-ups.
- Any file-size enforcement machinery. Explicitly declined.

## Decisions

### D1 — A separate TypeScript project

`tsconfig.json` serves the renderer: `lib: ["DOM", …]`, `jsx: "react-jsx"`, and it feeds `vite build`. The main process is a Node program with no DOM. Widening `include` would mean one options set describing two incompatible environments.

**Decision**: `tsconfig.electron.json` as a sibling project, run as a second `tsc -p` in `build`. Exact options:

```
target: "ES2022", lib: ["ES2022"],
module: "NodeNext", moduleResolution: "NodeNext",
allowJs: true, checkJs: true, strict: false,
strictFunctionTypes: true, strictBindCallApply: true, noImplicitThis: true,
alwaysStrict: true, noImplicitReturns: true, noFallthroughCasesInSwitch: true,
noUnusedLocals: true,
noEmit: true, skipLibCheck: true, types: ["node"],
include: ["electron/**/*.mjs", "electron/**/*.cjs"]
```

`skipLibCheck: true` is **load-bearing, not cosmetic**: without it, `@excalidraw/excalidraw`'s bundled `.d.ts` reaches `browser-fs-access` and reports 78 × `TS7016` that have nothing to do with this repo's code.

`NodeNext` rather than `Bundler`: the main process is Node ESM, not a bundled target. Verified to give an identical baseline, so the change is free, and it yields better diagnostics — for an extensionless relative import (which Node rejects at runtime) `NodeNext` reports `TS2835: … Did you mean './helper.mjs'?` where `Bundler` reports a generic `TS2307`.

`.cjs` sits correctly in the same project: verified that `module: "NodeNext"` treats `.cjs` as CommonJS and `require("electron")` resolves.

*Alternative considered*: project references. Rejected — designed for composite emitting builds; both projects here are `noEmit`.

### D2 — `checkJs: true` with `strict: false`, and a per-flag ratchet

This is the load-bearing decision, and an earlier draft of this design got it wrong. It framed the choice as three options — fix all 822, `@ts-nocheck` the offenders, or `checkJs: false` with per-file `// @ts-check` opt-in — and chose opt-in. Its own measurement table already contained a fourth option it never evaluated: `strict: false`, **76 errors**.

**Decision**: turn `checkJs` on for the whole directory at `strict: false`, fix the 76, take the six free flags (M4), and raise coverage later by enabling a flag rather than by editing files.

Why this beats the per-file opt-in it replaces, all verified:

1. **Opt-in delivers nothing for unopted files.** With `checkJs: false`, a file containing a *completely unresolvable import* yields 0 errors, exit 0. `tsc` contributes nothing to import safety for any file without a pragma.
2. **`main.mjs` would never have a pragma** (822-era count 376), so under opt-in it stays permanently outside the gate — and the import-graph test excludes it too. The wiring block containing the follow-up's known hoisting hazard would have been covered by *neither* mechanism.
3. **The cost was mispriced by 10×.** 822 was an artifact of choosing `strict: true`. The real floor is 76, and the 746 difference is annotation grind (M3), not safety.
4. **It dissolves the follow-up's worst problem.** The earlier draft forced the split to either clear ~376 errors mid-refactor or defer the pragma for 9 of 14 modules. At the floor, `main.mjs` has **20** errors, fixed here — so the split inherits zero debt and needs no opt-in step at all.
5. **A flag ratchet cannot rot.** Coverage state is one config file, not N pragmas scattered across files, and no new module can be silently omitted — the include glob covers everything.

*Alternative considered*: `strict: true` and fix all 822. Rejected — multi-day, mostly JSDoc annotation, and it mixes bug fixes into a change advertised as behavior-neutral.

*Alternative considered*: `@ts-nocheck` on the offenders plus global `checkJs`. Rejected — suppressions are invisible until grepped and are never removed.

*Alternative considered*: per-file `// @ts-check`. Rejected for the five reasons above. Noted for the record: with global `checkJs: true` the pragma becomes a no-op, and TypeScript has no per-file `strict`, so the "floor plus per-file strict opt-in" hybrid an earlier draft implied is not actually expressible.

### D3 — The import-graph test needs two halves, and must bypass the test runner's transform

The single-half design (discover, dynamically import, assert exports) fails at its stated purpose. M5 shows it catches a bad *path* but not a bad *name*, and it is blind to circular-import breakage — which is the follow-up change's specifically-identified hazard. It also only ever checks the **supply** side (module X exports N) while the failure mode is on the **demand** side (module Y imports N correctly), and the biggest demand-side file, `main.mjs`, is excluded because it needs Electron.

**Decision — supply side**: keep filesystem discovery and dynamic import, but run these modules through **Node's native loader**, by giving the graph test its own vitest project that externalizes `electron/**/*.mjs` (`server.deps.external`). Verified: this makes all three masked cases in M5 fail correctly, and all 14 real non-test modules import cleanly under the native loader with the real suite still green. Scope it to that project, not the global config, so the other 21 test files are unaffected.

**Decision — demand side**: statically parse every `electron/**/*.{mjs,cjs}` import block, resolve each relative specifier, and assert the target exports each imported name. Parsing needs no Electron, so this covers `main.mjs`, `ipc.mjs` and `window.mjs` — the highest-risk surface — in roughly 30 lines. It also **replaces the hand-maintained export map** an earlier draft specified, which was already wrong (it omitted all 10 names imported from `po-session.mjs`, plus two sibling-to-sibling edges) and would have gone stale again.

**Decision — guard the candidate set**: the Electron-exclusion rule is a text match, so a module gaining an `import type` line, or merely a *comment* mentioning `from "electron"`, would silently drop out of coverage — the exact hole the discovery approach exists to close. Assert the expected candidate count and list intentional exclusions explicitly, so an unexpected exclusion fails loudly.

Note the exclusion rule must also handle `require("electron")` (`preload.cjs`) or state explicitly that the graph test covers `.mjs` only.

*Alternative considered*: a hardcoded module list. Rejected — a later module escapes silently.

### D4 — Fix the 76, but only where fixing is behavior-neutral

The 76 are semantic errors (M2), not annotations, so some will be genuine bugs. That cuts both ways: valuable to find, dangerous to "fix" in a change advertised as behavior-neutral.

**Decision**: an error whose fix is a type annotation or a JSDoc typedef is fixed here. An error revealing a genuine behavioral bug is **recorded as a separate finding, not fixed here** — and if it cannot be silenced without changing behavior, a narrowly-scoped `/** @type */` assertion plus a recorded follow-up is preferred over a logic change.

The security-relevant modules get explicit attention because a careless "fix" could weaken them: `worker-env.mjs`'s withholding of `GEMINI_API_KEY` from both roles and `CLAUDE_CODE_OAUTH_TOKEN` from DEV; `user-config.mjs`'s `assertConfigValueIsSafe`; `pipeline-probes`' `assertExecutable`; and `announcements`' untrusted-text fencing. All are covered by the `config-persistence`, `agent-subscription-auth` and `voice-decision-relay` capabilities and by existing tests.

One known case: `live-config.mjs`'s `TS2339: Property 'realtimeInputConfig' does not exist` cannot be cleared by annotation alone. Its module comment guarantees converse mode emits no `realtimeInputConfig` key at all, and `live-config.test.mjs:14`/`:40` assert exactly that — so a restructure would be caught, but a `/** @type {Record<string, unknown>} */` assertion is the intended fix.

### D5 — Do not stub Electron to bring `main.mjs` under test

A vitest alias mapping `"electron"` to a stub would make `main.mjs` importable and cover the composition wiring — the strongest available net.

**Decision**: not in this change.

`main.mjs` does substantial work at import time and inside `app.whenReady()`; a stub convincing enough is a harness, not a shim, and building it against the pre-split 4287-line file means building it twice. After the split, `main.mjs` is a ~200-line composition root and `ipc.mjs` a flat registration list — far cheaper. Recorded as a follow-up to reconsider then.

The residual gap is narrower than it was, because D3's demand-side check does cover `main.mjs`'s import statements statically. What remains uncovered is whether the *wiring calls* pass the right things — a genuine hole, and one the follow-up's manual smoke path must carry.

### D6 — File-size convention as documentation, no enforcement

One responsibility per file, graspable in a few minutes, 250–450 lines, `*.test.*` exempt. Recorded in `CLAUDE.md` only.

The test exemption is substantive: `run-queue.test.mjs` is 613 lines with one responsibility, an append-only list of cases nobody scrolls hunting for a function. Capping it would force `run-queue-2.test.mjs`, which is worse.

The absence of enforcement is an accepted trade-off, made knowingly. `scripts/check-three-dedupe.mjs` shows the repo already runs bespoke guard scripts in `build`, so a size ratchet was available and was declined. Honest expectation: this is the mechanism under which `main.mjs` grew across 12 consecutive feature changes, so the next drift will be caught by a human, not the build.

## Risks / Trade-offs

**[Fixing 76 semantic errors could change behavior]** — These are real type violations, and some fixes are genuine bug fixes rather than annotations. In a change advertised as behavior-neutral, that is the main risk. → Mitigated by D4's rule (annotate or assert; record real bugs rather than fixing them here), by the fact that 23 of the 76 are in test files where a behavior change is self-evident, and by the existing 175-test suite. Each fix should be individually reviewable — do not batch them into one commit.

**[The demand-side check is a hand-rolled parser]** — Regex or lightweight parsing over import statements will not handle every ESM form (dynamic `import()`, re-exports, namespace imports, side-effect-only imports). → Accept partial coverage but make its boundaries explicit: assert the parser saw the expected number of import statements per file, so a form it cannot parse fails loudly rather than being skipped. Static `import { … } from "./x.mjs"` is the only form the follow-up's split produces at scale, and that is the form to get right.

**[Two vitest project configs add complexity]** — Externalizing `electron/**/*.mjs` for one project while leaving the global config alone is a subtlety a future contributor could undo, silently restoring the M5 masking. → Comment the config with *why*, and add the missing-name case as an explicit test task so an undone externalization fails the suite rather than quietly weakening it.

**[Six free flags are free only today]** — `noUnusedLocals` at +2 and the six +0 flags are measured against the current tree; a future change could make one expensive. → That is the ratchet working as intended: a new violation fails the build at the moment it is introduced, which is the cheapest time to fix it.

**[`strictNullChecks` at +91 is the most valuable deferred flag]** — Null-safety bugs are the classic Electron main-process failure (a window that is gone, a session mid-reconnect), and `main.mjs` is full of `?.` guards suggesting the author knew. → Recorded as the highest-priority follow-up of the three, ahead of `noImplicitAny` despite being smaller, because its bug yield per error fixed is far higher.

**[Stale counts will go stale again]** — 4287 / 1738 / "22 files, 175 tests" are all perishable, and the follow-up split invalidates the first immediately. → Replace enumerations with globs where possible (`docs/TESTING.md`), and accept that `CLAUDE.md`'s File map is rewritten by the follow-up anyway.

## Migration Plan

No migration. Rollback is deleting `tsconfig.electron.json`, the test file and the vitest project, and reverting `package.json`, `CLAUDE.md`, `docs/TESTING.md` and the type fixes.

Verification: `npm run build` green on a clean tree (proving the 76 are cleared and the six flags hold), `npm test` green including the new test, and the four synthetic failure cases from M5 each confirmed to fail.

## Open Questions

- Whether the 23 of 76 errors that live in `*.test.mjs` files should be fixed or the test files excluded from the project. Excluding them is defensible (they are not shipped) and would cut the work by a third; including them is better (a type error in a test often means the test asserts the wrong shape). Leaning include, since `po-session.test.mjs`'s 9 errors include a `TS2740` on a hand-rolled `Query` fake that may indicate the fake has drifted from the real SDK interface.
- Whether the demand-side check belongs in the same test file as the supply-side one. They have different mechanisms (static parse vs native import) and different exclusion rules. Leaning two files for clarity, one vitest project.
- Whether any of the 76 turns out to be a genuine behavioral bug significant enough to warrant its own change rather than a recorded follow-up. Unknowable until they are worked; the 34 `TS2339`s are the likely candidates.
