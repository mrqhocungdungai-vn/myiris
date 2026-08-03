# Upgrade to Node.js 24 LTS

## Why

Iris already *runs* on Node 24 on both axes that matter — the developer machine
(`24.18.1`) and the Node that Electron 42.5.0 embeds to run `electron/main.mjs`
(`24.17.0`) — but nothing in the repo declares or enforces that floor, and
nothing couples the type declarations to it. The result is documentation that
misleads, a build that is not reproducible, and a typecheck gate with a hole in
it.

**The hazard is live, not theoretical.** The repo pins `typescript` and `vite`
to the string `"latest"`. As of today:

| package | what the lockfile holds | what `latest` resolves to now |
| --- | --- | --- |
| `typescript` | `6.0.3` | **`7.0.2`** — a major already published |
| `vite` | `8.1.0` | `8.2.0` |
| `react` | `19.2.7` | `19.2.8` (`@react-three/fiber` peers `>=19 <19.3`) |

A single `npm install` from a fresh clone lands TypeScript 7. Eleven
dependencies are exposed this way, including the entire toolchain. This
contradicts `docs/REFERENCE.md`, which already argues against `"latest"` — but
applies that reasoning to exactly one package, `electron`.

Two further gaps:

- **`README.md` claims "Node.js 20+"** while the toolchain's real floor is
  already `22.12` (`vite@8.1.0`, `electron@42.5.0`). Worse, without
  `engine-strict` the mismatch does not even fail cleanly: a contributor on
  Node 20 today gets an `npm warn EBADENGINE` and a *successful* install, then
  breaks later and more confusingly.
- **`@types/node` resolves to `26.0.1` against a Node 24 runtime.** The real
  source of truth here is not `engines.node` — it is `electron@42.5.0`'s own
  `"@types/node": "^24.9.0"` dependency. Because the root is at 26.x, npm has
  installed a *second, nested* copy at
  `node_modules/electron/node_modules/@types/node`, so the Electron typecheck
  project currently pulls two different sets of Node global declarations,
  masked only by `skipLibCheck: true`. Aligning the root to 24.x collapses them
  to one.

## What Changes

- Declare the floor: `engines.node: ">=24.0.0"` in `package.json`.
- Enforce it: `.npmrc` with `engine-strict=true`. The repo has **no CI**, so
  this is the only mechanism that makes the declaration real. Measured: with it,
  both `npm install` and `npm ci` fail `EBADENGINE`; without it, they warn and
  succeed.
- Guide it: `.nvmrc` containing `24`; and document the
  `npm ci --engine-strict=false` escape hatch, matching the precedent set by
  `IRIS_ALLOW_ANY_PLATFORM` for the repo's other hard gate.
- Replace all 11 `"latest"` specs with the exact versions the lockfile resolved.
- Align `@types/node` to `24.13.3` — satisfying `electron`'s `^24.9.0` and
  eliminating the duplicate declaration set.
- **Add `scripts/check-types-node.mjs` to the `build` chain**, asserting that
  the root `@types/node` major satisfies the `@types/node` range `electron`
  declares. Without it the next Electron bump silently reopens this hole.
  Precedent: `scripts/check-three-dedupe.mjs`.
- Raise `tsconfig.electron.json` `target`/`lib` from `ES2022` to **`ES2025`** —
  Node 24's actual capability (all of `Set.prototype.union`, iterator helpers,
  `Promise.try`, `RegExp.escape`, `Float16Array` verified present on Electron's
  embedded 24.17.0). Not `ESNext`, which drifts with every TypeScript upgrade.
- Regenerate `package-lock.json`, then update `README.md`,
  `docs/REFERENCE.md`, and `CLAUDE.md`.

Not **BREAKING** for the application: no runtime behavior changes. It *is*
breaking for a contributor on Node < 24, who is now stopped at install with a
clear `EBADENGINE` instead of failing obscurely later. That is the point.

**Scope honesty — the target bump is a loosening, not a tightening.** With
`noEmit: true`, `target` is nearly inert; only `lib` has real effect, and it
*widens* the API surface visible to `electron/**`. The gate is tightened solely
by the `@types/node` alignment and the new guard script. Both are included
because the change's thesis is *make the declared thing match the real thing* —
and `lib: ES2022` understates Node 24 exactly as `README` understates the floor.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `test-harness`: the existing requirement *"The typecheck gate covers the
  Electron main process"* (`openspec/specs/test-harness/spec.md:61`) names the
  separate Electron TypeScript project that this change edits. It is extended
  with the coupling that must not rot: the Electron typecheck project's
  `@types/node` major SHALL track the `@types/node` range `electron` declares —
  i.e. the types must describe the Node that Electron actually embeds — and
  `npm run build` SHALL fail when they diverge.

This is the change's most durable output. Everything else (`engines`, `.nvmrc`,
the pins) is an inert declaration; this is the part that keeps being true after
the next Electron upgrade.

## Impact

**Files changed**

| File | Change |
| --- | --- |
| `package.json` | `engines` block; 11 specs `"latest"` → exact; `@types/node` → `24.13.3`; guard script added to `build` |
| `package-lock.json` | regenerated via `npm install` |
| `scripts/check-types-node.mjs` | **new** — build-time guard |
| `.npmrc` | **new** — `engine-strict=true` |
| `.nvmrc` | **new** — `24` |
| `tsconfig.electron.json` | `target`/`lib` `ES2022` → `ES2025` |
| `README.md` | prerequisites: Node 20+ → Node 24 LTS+, plus the escape hatch |
| `docs/REFERENCE.md` | Node floor + the `@types/node`↔Electron rule, in the footgun section |
| `CLAUDE.md` | Node floor recorded as a **build-toolchain** requirement |
| `openspec/specs/test-harness/` | delta spec (see Capabilities) |

**Explicitly not touched, as decisions rather than oversights**

- The 12 `^`-ranged deps and 8 already-exact ones. Note `three` stays at
  `^0.181.2` despite being the one dep with a dedicated guard script: a caret on
  a `0.x` version floats only the patch, and `postprocessing` peers it at
  `< 0.186.0`, so the practical exposure is small.
- **The Chromium axis** — `tsconfig.json` (currently `ES2020`, a wider gap than
  the Node-side one being fixed) and `vite.config.ts` (no `build.target`, so
  Vite 8 downlevels for browsers that never run this app). Different governing
  constraint; recorded here as a named follow-up so it is not merely forgotten.
- **`typescript`, `vite` and `@vitejs/plugin-react` live in `dependencies`, not
  `devDependencies`** (`package.json:40,50,51`), so electron-builder likely
  ships the TypeScript compiler inside the `.app`. This change pins them where
  they sit rather than moving them: the impact is *inferred*, not measured — no
  one has run `package:mac` to confirm — and it is a packaging concern, not a
  Node-version one. Follow-up.

**Verified before proposing**

- `engine-strict` rejects **0 of 471** lockfile entries that declare
  `engines.node`, at floors 24.0.0 / 24.17.0 / 24.18.1.
- `tsc -p tsconfig.electron.json` → **0 errors** at ES2022, ES2023, ES2024,
  ES2025 and ESNext.
- With `@types/node@24.13.3` actually installed: electron project **0 errors**,
  renderer **0 errors**, `vitest run` **48 files / 439 tests passing** — i.e.
  the types alignment is empirically a non-event, not the risk it first appeared
  to be.

**Known diff noise.** Task 1's `npm install` moves three packages, not one:
`undici-types` `8.3.0` → `~7.18.0` (a dependency of `@types/node@24`), and the
nested `@types/node` + `undici-types` under `node_modules/electron/` disappear
via dedupe. Separately, ~18 optional-peer entries from Vite's `sass` subtree
drop out on *any* lock regeneration today, unrelated to this change. The task
list captures a control diff first so the two are distinguishable.
