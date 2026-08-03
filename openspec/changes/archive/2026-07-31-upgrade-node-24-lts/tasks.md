## 1. Baseline and the gate itself

- [x] 1.1 Capture the control lock diff **before** editing anything: copy `package.json` + `package-lock.json` to a scratch dir, run `npm install --package-lock-only` there, and record which entries move. Roughly 18 optional-peer entries from Vite's `sass` subtree (`sass`, `chokidar`, `immutable`, `readdirp`, `node-addon-api`, 13 `@parcel/watcher-*`) drop out on *any* regeneration today — this baseline is what makes the change's own ~2 entries distinguishable later
- [x] 1.2 Create `.npmrc` containing `engine-strict=true`, plus a comment warning that this file is **not** on electron-builder's excluded-names list, so no registry token may ever be put in it
- [x] 1.3 Create `.nvmrc` containing `24`
- [x] 1.4 Confirm `.gitignore` (16 entries: `node_modules/`, `dist/`, `release/`, `.env`, `public/runtime/`, …) excludes neither new file, so both are actually committed

## 2. Dependency pins and the types alignment

- [x] 2.1 Add `"engines": { "node": ">=24.0.0" }` to `package.json`
- [x] 2.2 Replace the 10 non-types `"latest"` specs with the versions the lockfile resolved: `@vitejs/plugin-react` `6.0.3`, `lucide-react` `1.21.0`, `react` `19.2.7`, `react-dom` `19.2.7`, `typescript` `6.0.3`, `vite` `8.1.0`, `@types/react` `19.2.17`, `@types/react-dom` `19.2.3`, `concurrently` `10.0.3`, `wait-on` `9.0.10`
- [x] 2.3 Set `@types/node` to `24.13.3`, satisfying the `^24.9.0` that `electron@42.5.0` itself declares
- [x] 2.4 Run `npm install` (**not** `npm ci`). Note the real mechanism: `npm ci` compares *resolved versions* against specs, not the recorded spec strings — so the ten pins in 2.2 produce zero complaints and it is task 2.3 alone that desyncs the lock (`@types/node@26.0.1` and `undici-types@8.3.0` no longer satisfy the manifest)
- [x] 2.5 Diff `package-lock.json` against the 1.1 control. Exactly two removals should be attributable to this change — `node_modules/electron/node_modules/@types/node` and its nested `undici-types`, both deduped away — plus `undici-types` moving `8.3.0` → `7.18.x`. Anything else is unexpected; stop and investigate

## 3. Checkpoint — isolate the types alignment

- [x] 3.1 Run **both** typecheck projects explicitly — `npx tsc -p tsconfig.electron.json` and `npx tsc --noEmit` — not just `npm run build`. The renderer's `tsconfig.json` has no `types` field, so it auto-includes `@types/*`; it must be checked even though the Chromium axis is otherwise out of scope
- [x] 3.2 Assert `undici-types` resolved to `7.18.x`. Because `skipLibCheck: true` degrades an *unresolved* type import to `any` rather than erroring, a 0-error count alone does not prove the types actually loaded
- [x] 3.3 Run `npm test`; baseline is 48 test files / 439 tests passing
- [x] 3.4 Expect 0 errors — this was measured with `@types/node@24.13.3` genuinely installed. If errors do appear, fix each on its merits (normally meaning real code exceeds the declared floor); revert to `26.x` only if an error proves to be a DefinitelyTyped gap

## 4. Guard the coupling so it cannot rot

- [x] 4.1 Write `scripts/check-types-node.mjs`: read the `@types/node` range that `node_modules/electron/package.json` declares, read the installed root `@types/node` version, exit non-zero with an explanatory message when the latter does not satisfy the former. Follow the shape and tone of the existing `scripts/check-three-dedupe.mjs`
- [x] 4.2 Add it to the `build` script in `package.json`, alongside `check-three-dedupe.mjs`
- [x] 4.3 Verify it **passes** on the aligned tree
- [x] 4.4 Verify it **fails** when fed a mismatch (temporarily install `@types/node@26.1.2`, confirm non-zero exit, then restore). A guard never observed failing is not a verified guard

## 5. Compile target

- [x] 5.1 In `tsconfig.electron.json`, change `target` `"ES2022"` → `"ES2025"` and `lib` `["ES2022"]` → `["ES2025"]`. Leave the file's existing comment block alone — it documents the `canvas-mcp.golden.test.mjs` exclusion and has nothing to do with the compile target
- [x] 5.2 Re-run `npm run build`; expect 0 errors (measured at ES2025)
- [x] 5.3 Leave `tsconfig.json` and `vite.config.ts` untouched — Chromium axis, out of scope

## 6. Documentation

- [x] 6.1 Fix `README.md` "Prerequisites": `Node.js 20+ (LTS recommended).` → Node 24 LTS or newer. State that `npm ci` now fails outright with `EBADENGINE` on older versions, point at `.nvmrc`, and document the `npm ci --engine-strict=false` escape hatch
- [x] 6.2 In `docs/REFERENCE.md`, put the Node floor and the `@types/node`↔Electron rule in the **footgun section** (where the `electron` pin rationale already lives), *not* in the table above it — that table is titled "Exact Google Models, SDKs & Assets" with a column headed "Exact identifier we use", and already contains ranges misfiled as exact. A change about closing declared-≠-real gaps should not widen that one
- [x] 6.3 Broaden the `"latest"` footgun entry so its reasoning covers every dependency, not just `electron`. Cite the live evidence: `typescript@latest` is `7.0.2` against a lock at `6.0.3`
- [x] 6.4 Record the Node floor in `CLAUDE.md` next to the **Commands** block, as a build-toolchain requirement — *not* under "Runtime prerequisites", which lists what the running app needs (macOS, `GEMINI_API_KEY`, the `claude` binary). A packaged Iris ships its own Node
- [x] 6.5 Re-measure or footnote the three deferred-flag error counts in `CLAUDE.md` (`useUnknownInCatchVariables +26`, `strictNullChecks +91`, `noImplicitAny +719`). They were measured against `@types/node@26` and are presented as exact

## 7. Spec delta

- [x] 7.1 Create the `test-harness` delta under `openspec/changes/upgrade-node-24-lts/specs/`, extending "The typecheck gate covers the Electron main process" (`openspec/specs/test-harness/spec.md:61`): the Electron typecheck project's `@types/node` major SHALL satisfy the `@types/node` range `electron` declares, and `npm run build` SHALL fail when they diverge
- [x] 7.2 Run `openspec validate upgrade-node-24-lts` and confirm it passes with `skip_specs` removed

## 8. Verification

- [x] 8.1 **Negative test first, while `node_modules` is still intact.** On a Node older than 24, confirm `npm ci` fails with `EBADENGINE` specifically (not merely a non-zero exit). This machine has only `v24.18.1` under `~/.nvm/versions/node/`, so `nvm install 22` is required first. Finish with `nvm use 24` — a failed `npm ci` leaves `node_modules` absent and would break every later step
- [x] 8.2 Confirm the escape hatch works: `npm ci --engine-strict=false` on that older Node should succeed
- [x] 8.3 Back on Node 24: `rm -rf node_modules && npm ci` succeeds, proving lock sync and that the gate passes
- [x] 8.4 `npm run build` — all five stages clean: renderer `tsc`, electron `tsc`, `vite build`, `check-three-dedupe.mjs`, `check-types-node.mjs`
- [x] 8.5 `npm test` — 48 files / 439 tests, unchanged
- [x] 8.6 Assert reality matches the declarations: `engines.node` is `>=24.0.0`; `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -p process.versions.node` reports `24.17.0`; installed `@types/node` is `24.13.3`; `undici-types` is `7.18.x`; no nested `node_modules/electron/node_modules/@types` remains
- [x] 8.7 Confirm no `"latest"` specs remain in `package.json`
- [x] 8.8 Manual smoke: `npm start`, confirm the app launches and the Orbital Deck renders. Note there is **no `.env` in the repo**, so verifying voice additionally requires supplying `GEMINI_API_KEY`; without it, launch-and-render is the honest limit of this check
