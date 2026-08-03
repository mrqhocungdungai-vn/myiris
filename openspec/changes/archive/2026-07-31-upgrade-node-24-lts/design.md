# Design — Upgrade to Node.js 24 LTS

## Context

See `proposal.md` — Why.

The constraint that shapes every decision: **the runtime is already on Node 24
on both axes**, so this change moves no runtime. It makes the existing reality
declared, enforced, and — via a guard script — kept true.

| Axis | Version | Governs |
| --- | --- | --- |
| System Node | `24.18.1` | build tooling (`vite`, `tsc`, `vitest`, `electron-builder`), `scripts/*.mjs` |
| Electron 42.5.0's embedded Node | `24.17.0` | everything under `electron/` at runtime |

Measured before designing, not assumed:

1. `semver.satisfies(floor, engines.node)` across the lockfile → **0 rejections**
   of the 471 entries declaring `engines.node`, at 24.0.0 / 24.17.0 / 24.18.1.
2. `tsc -p tsconfig.electron.json` → **0 errors** at ES2022 through ES2025 and
   ESNext.
3. `@types/node@24.13.3` installed for real → electron **0 errors**, renderer
   **0 errors**, `vitest run` **48 files / 439 tests passing**.
4. `.npmrc` with `engine-strict=true` → `npm install` *and* `npm ci` both fail
   `EBADENGINE`. Without it, both warn and **succeed**.
5. All five `lib.es2025` headline features (`Set.prototype.union`, iterator
   helpers, `Promise.try`, `RegExp.escape`, `Float16Array`) are present on
   Electron's embedded 24.17.0.

The load-bearing structural fact: **`electron@42.5.0` declares
`"@types/node": "^24.9.0"` as a real dependency**, and `electron.d.ts` opens
with `/// <reference types="node" />`. Electron itself states which types major
belongs to the main-process axis. Because the root is currently at `26.0.1`, npm
installed a nested `node_modules/electron/node_modules/@types/node@24.13.2`, so
the Electron typecheck program pulls **two** sets of Node global declarations
today, masked by `skipLibCheck: true` (`tsconfig.electron.json:18`).

## Goals / Non-Goals

**Goals**

- Machine-enforce the Node 24 floor.
- Make `npm install` reproducible.
- Make `tsc` a real gate for main-process code, and **keep** it one across
  future Electron upgrades.

**Non-Goals**

- Changing application behavior. Nothing under `electron/` or `src/` is edited.
- The **Chromium axis** (`tsconfig.json` at ES2020, `vite.config.ts` with no
  `build.target`). Different governing constraint; recorded as follow-up in the
  proposal.
- Moving `typescript`/`vite`/`@vitejs/plugin-react` out of `dependencies`. Real
  problem, inferred not measured, and a packaging concern. Follow-up.
- Adding CI. Its absence is *why* `engine-strict` matters; standing one up is a
  separate change.

## Decisions

### 1. `engines.node: ">=24.0.0"` plus `engine-strict=true`, with a documented escape hatch

With no CI, `engines` alone is inert — measured fact 4 confirms npm merely warns
and proceeds. `.npmrc` converts it to a hard failure.

The escape hatch (`npm ci --engine-strict=false`, documented in the README) is
not a hedge: this repo's other hard gate — the macOS check — ships with
`IRIS_ALLOW_ANY_PLATFORM=1` and specs it as a named scenario. A gate with no
documented bypass breaks that convention, and fact 1 is a *snapshot*: the
enumerated-LTS pattern (`"^18.18 || ^20.9 || >=21.1"`) is common, so some future
dependency will hard-fail install where today it warns. The escape turns that
from a blocked afternoon into a ten-second problem.

**Known limit, stated plainly:** the gate is **install-time only**. `npm run
build`, `npm start`, `npm run dist:mac` are not engine-checked (measured), so a
contributor holding an existing `node_modules` on Node 22 can still run them.
This change does not close that, and claiming otherwise would overstate it.

- *Rejected — `>=24.18.1`:* pins to the patch on one machine; blocks a working
  24.10.
- *Rejected — `^24 || >=26` (LTS lines only):* truest to "LTS" but needs a manual
  edit every cycle for a benefit no observed failure justifies.

### 2. `@types/node` aligned to `24.13.3` — and a guard script to keep it aligned

`tsconfig.electron.json` sets `"types": ["node"]` with `checkJs: true` over all
of `electron/**`, so `@types/node` governs main-process typechecking directly.
Types for Node 26 there admit APIs that do not exist on the embedded 24.17.0.

The stronger argument, and the one that shapes the guard: the authority for this
major is **`electron`'s own `^24.9.0` declaration**, not `engines.node`. They
agree today by coincidence. A future Electron embedding Node 26 would reopen the
hole with nothing to catch it — so `scripts/check-types-node.mjs` joins the
`build` chain and asserts the root `@types/node` satisfies the range `electron`
declares. This repo already has exactly this pattern for exactly this reason
(`scripts/check-three-dedupe.mjs`, `package.json:21`).

Aligning also collapses the duplicate declaration sets described in Context.

- *Rejected — keep 26.x:* leaves the hole open and the duplicate copies in place.
- *Rejected — 26.x globally with 24.x scoped to `electron/` via `typeRoots`:*
  brittle and hard to explain. Note the renderer is provably unaffected either
  way: `tsconfig.json` has no `types` field, but a probe confirms `process`,
  `Buffer` and `NodeJS` are all unresolved in `src/` — the axis separation is
  real, so the downgrade cannot reach the renderer.

### 3. Exact pins for all 11 `"latest"` specs

Taken from what the lockfile already resolved, so no *version* regresses except
the deliberate `@types/node` alignment. `typescript@latest` being `7.0.2` today
makes this urgent rather than hygienic.

**The trade this incurs, stated rather than glossed:** with `vite` at exactly
`8.1.0` while twelve deps still float on carets, a future caret-minor that peers
on `vite ^8.2` turns today's silent auto-upgrade into a hard `ERESOLVE`. That is
the intended bargain — a loud failure beats a silent one — but it is a real
cost. Likewise `npm audit fix` can no longer act without a manifest edit.

- *Rejected — caret ranges:* blocks majors, but the repo's convention for
  load-bearing deps is exact pinning, and the toolchain is as load-bearing as it
  gets.

### 4. `tsconfig.electron.json` → ES2025

Fact 5 shows Node 24's real capability is ES2025, and fact 2 shows it costs 0
errors. Declaring `ES2024` while knowing the runtime offers ES2025 would
reintroduce the precise declared-≠-real gap this change exists to close.

Not `ESNext`: that silently shifts the available API surface on every TypeScript
upgrade — the drift `docs/REFERENCE.md` exists to prevent. ES2025 is exactly as
fixed a target as ES2024.

**This decision loosens, it does not tighten.** With `noEmit: true`, `target` is
nearly inert and only `lib` matters — and `lib` *widens* what `electron/**` may
call. The tightening in this change comes entirely from decision 2. Both are
included because both close a declared-≠-real gap, but they point in opposite
directions and should not be read as one move.

*Caveat:* fact 5 was measured on 24.17/24.18. That every `lib.es2025` feature
exists on Node **24.0.0** is inference — those features landed in V8 ≤ 13.5 and
Node 24.0.0 ships V8 13.6 — not measurement.

### 5. `.nvmrc` containing `24`, and nothing else

`engines` blocks; `.nvmrc` gives the blocked developer something to *do*.
Contents `24`, not `24.18.1`, to match `>=24.0.0`.

- *Rejected — `packageManager` (corepack):* adds a second version axis and
  requires corepack enabled, with no CI to reap the benefit.
- *Rejected — also `.node-version`:* two files stating one fact is two places to
  drift.

### 6. One spec delta, on `test-harness`

The change is overwhelmingly tooling, and inventing capabilities to satisfy
validation would be wrong. But `openspec/specs/test-harness/spec.md:61`
("The typecheck gate covers the Electron main process") already specs the exact
TypeScript project this change edits — direct precedent that this repo specs
developer-facing gates. The `@types/node`↔Electron coupling from decision 2 is a
requirement, not an implementation detail: it is the one thing here that will
rot, and the guard script is its enforcement.

`platform-support` remains untouched and correct — it governs *runtime launch
admission* (`process.platform`), not build-time toolchain.

## Risks / Trade-offs

- **The `@types/node` alignment was the flagged risk; it is measured at zero**
  (fact 3). Keep the checkpoint anyway — it costs seconds — but the "revert to
  26.x" branch is not expected to fire. → Extend the checkpoint to the renderer
  project too: `skipLibCheck: true` means an *unresolved* type import degrades
  to `any` rather than erroring, so a green run can mask a resolution failure.
  Mitigation: assert `undici-types` resolved to `7.18.x` explicitly rather than
  trusting a 0-error count.

- **The lock diff contains churn this change did not cause.** ~18 optional-peer
  entries (Vite's `sass` subtree) drop on any regeneration today. → Capture a
  control diff on the *unmodified* manifest first, so the ~2 entries actually
  attributable here are distinguishable from the ~18 that are not.

- **The stated reason for the lock desync in the first draft was wrong**, and the
  correction matters. `npm ci` validates the *resolved version* against the
  package.json spec, not the recorded spec string — so the ten `"latest"`→exact
  pins produce zero complaints. Only the `@types/node` change desyncs the lock.
  → `npm install` is still required, but anyone dropping the types alignment
  should know the regeneration would then be needed for a *different* reason:
  to stop `packages[""]` from recording `"latest"` while `npm ci` stays green.

- **`engine-strict` blocks contributors mid-work.** → Intended; mitigated by
  `.nvmrc` and the documented `--engine-strict=false` escape.

- **`.npmrc` is not on electron-builder's excluded-names list.** Harmless today
  (`package.json`'s `files` allowlist excludes it, and it holds only
  `engine-strict=true`), but if `files` is ever loosened the file ships. → Add a
  comment in `.npmrc` warning against ever putting a registry token in it.

## Migration Plan

Ordered so the gate exists before the install it is meant to govern, and so the
one uncertain step is isolated:

1. Capture a control lock diff on the unmodified manifest (baseline churn).
2. Create `.npmrc` and `.nvmrc`.
3. Edit `package.json`: `engines`, 10 exact pins, `@types/node@24.13.3`.
4. `npm install` — resync lock, pull new types. Diff against the step-1 control.
5. **Checkpoint:** both typecheck projects + `npm test`, attributing any
   breakage to the types alignment alone.
6. Add `scripts/check-types-node.mjs`, wire into `build`, verify it passes *and*
   that it fails when deliberately fed a mismatch.
7. Raise `tsconfig.electron.json` to ES2025; rebuild.
8. Docs, then the `test-harness` spec delta.
9. Full verification, including the negative test that Node < 24 is actually
   rejected — without it, decision 1 is unproven.

**Rollback:** every step is a version-controlled file edit with no data
migration and no runtime component. `git revert` plus `npm install` restores the
previous state completely.
