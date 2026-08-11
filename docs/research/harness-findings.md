# Harness, Gates & Dependency Health — Research Findings

*Independent analysis of the test harness, the five quality gates, and dependency
health. Companion reports: `hotspot-findings.md`, `renderer-findings.md`,
`main-process-findings.md`.*

Baseline: all five gates green. `npm test` = **106 files / 1908 tests / 4.4s**.
Nothing here is broken; every finding is about what *would not be caught*.

## Ranked findings

| # | Finding | Impact | Likelihood | Cheapest fix |
|---|---|---|---|---|
| 1 | **No CI.** There is no `.github/` at all — all five gates are bound only to Claude Code hooks on the maintainer's machine. A commit made in a terminal, or by any other tool, is ungated. | Critical | High | ~40-line `.github/workflows/gates.yml` |
| 2 | **The gate that guards the living spec has no test.** `scripts/check-spec-drift.mjs` is 574 lines and 0 tests. A bug that makes it return `ok: true` passes all five gates and silently disables the fifth. Same for `runLint`/`runTests`/`runSecretScan` in `gates.mjs` (only `checkForbiddenCommand` is tested) and for `dead-claude-css.mjs`. | Critical | Medium | fixture-driven `check-spec-drift.test.mjs` (~80 lines) |
| 3 | **A test file with the wrong extension is invisible and nothing says so.** `vitest.config.mjs` includes exactly `electron/**/*.test.mjs`, `src/**/*.test.ts`, `scripts/**/*.test.mjs`. A `src/**/*.test.tsx`, `electron/**/*.test.ts` or `scripts/**/*.test.ts` file runs zero tests, exits 0, and looks like coverage in review. | High | Medium | `harness-globs.test.mjs`: every `*.test.*` on disk matches an include |
| 4 | **73% of renderer LOC has no test file.** 12,933 of 17,677 lines under `src/`. `src/components/`: **34 of 35** files untested. `src/hooks/`: **8 of 9**. The `src/lib/` discipline is excellent (27/32) — the untested mass is exactly the tier the extract-to-`lib` convention never reached. | High | High | admit `*.test.tsx` (#3) + 3 render-smoke tests |
| 5 | **No file-size guard, and the documented exception list has already drifted.** `docs/TESTING.md` "Known gaps" lists App.tsx at 1738 (now **2226**), SetupPanel 1023 (now 858), VaultGalaxy 1035 (now 1106), canvas-mcp 557 (now **804**), and omits `electron/capabilities/second-brain.mjs` (**1317**) entirely. 25 files exceed the 450-line convention. Prose is the only enforcement and prose rotted. | High | Certain (already happened) | line-count **ratchet** with a checked-in baseline |
| 6 | **`npm run build`'s three extra checks are not bound to any editing event.** The Stop hook runs `tsc -p` only — `check-three-dedupe.mjs`, `check-types-node.mjs` and `plugin-sync.mjs` run solely on a manual `npm run build`. A second `three` copy or an `@types/node` major drift surfaces at package time, not at edit time. | Medium-High | Medium | run them in CI (#1); they are seconds |
| 7 | **19 advisories in the production tree** (6 high), incl. a reachable `js-yaml@3.15.0` ReDoS under `gray-matter` — which parses *user vault frontmatter*. No `npm audit` step exists in any gate. | Medium-High | Medium | advisory `audit` step in CI, `--audit-level=high` |
| 8 | **No coverage instrumentation at all.** `@vitest/coverage-v8` is not installed, so "is this module tested" is answerable only by filename convention — which is how 34 untested components went unremarked. | Medium | High | add the provider, report-only, threshold on `electron/` + `src/lib/` only |
| 9 | **The secret gate only sees staged content and written files.** Already recorded in TESTING.md; restated because #1 makes it worse — a push never passes through it. | Medium | Low | `gitleaks detect` (whole history) in CI |
| 10 | **No bundle budget.** `dist/` is 105 MB; `index-*.js` alone is **2.0 MB** and `chunk-EIO257PC` 1.8 MB. Nothing fails when a chunk doubles. | Low-Medium | Medium | `build.chunkSizeWarningLimit` + a size assertion on the entry chunk |
| 11 | **No a11y / dead-export check.** The dead-CSS sweep is the only reachability check; unused *exports* and unreferenced components are uncaught. | Low | Medium | `oxlint` `import/no-unused-modules` — measure first |

---

## 1. Coverage shape

Method: `git ls-files`, then a colocated-`*.test.*` match per module (the repo's own
convention). Counts are files, not statements — there is no coverage tooling (#8).

| Tier | Modules | Untested | Untested LOC |
|---|---|---|---|
| `electron/` | 71 | **6** | 981 |
| `src/lib/` | 32 | 5 | 561 |
| `src/hooks/` | 9 | **8** | 2,247 |
| `src/components/` | 35 | **34** | 7,195 |

**The main process is in good shape and the renderer is not.** That asymmetry is the
single biggest fact in this report.

### 1a. `electron/` — the six without a colocated test

| Module | LOC | Status |
|---|---|---|
| `electron/vault-graph.mjs` | 225 | Covered indirectly by `second-brain.test.mjs` + the graph tests; its *parse* half is split out and tested (`vault-graph-parse.test.mjs`). **Real gap: the watcher/debounce half.** |
| `electron/main.mjs` | 339 | Demand-side graph test only — by design. `whenReady()` ordering, `shutdownTeardown`, quit handlers untested (recorded in TESTING.md). |
| `electron/preload.cjs` | 236 | Declarative `contextBridge` list; **not** covered by either graph test (both are `.mjs`-only). A renamed channel here is caught by nothing. |
| `electron/claude-stream.mjs` | 98 | Exercised through `run-exec.test.mjs`. |
| `electron/untrusted-text.mjs` | 52 | Exercised through `announcements.test.mjs`. **This is a sanitizer** — indirect coverage is the wrong shape for it. |
| `electron/hotkeys.mjs` | 31 | **Zero coverage, direct or indirect.** Not imported by any test file. |

Ranked by risk: `preload.cjs` (the whole renderer↔main contract, no gate reads it) >
`untrusted-text.mjs` (a security boundary tested only through a caller) >
`vault-graph.mjs` watcher > `main.mjs` startup order > `hotkeys.mjs` > `claude-stream.mjs`.

### 1b. `src/` — untested modules, ranked by LOC x import-count

Top of the list (full list is every file below except the 29 tested `src/lib/*`):

| Module | LOC | Imported by (non-test) |
|---|---|---|
| `src/App.tsx` | 2226 | 3 |
| `src/components/VaultGalaxy.tsx` | 1106 | 2 |
| `src/components/SetupPanel.tsx` | 858 | 1 |
| `src/hooks/useGalaxyCameraDrive.ts` | 811 | 1 |
| `src/components/HudShell.tsx` | 667 | 1 |
| `src/vite-env.d.ts` | 582 | 0 |
| `src/components/EyeReadout.tsx` | 555 | 2 |
| `src/components/PermissionsStep.tsx` | 531 | 1 |
| `src/components/EyeReticle.tsx` | 434 | 2 |
| `src/components/ReactorCore.tsx` | 411 | 2 |
| `src/hooks/useHandControl.ts` | 399 | 13 |
| `src/hooks/useWakeWord.ts` | 344 | 1 |
| `src/components/NoteReader.tsx` | 235 | 1 |
| `src/components/CenterStage.tsx` | 227 | 1 |
| `src/lib/galaxy-anchor-rings.ts` | 217 | 2 |
| `src/hooks/useEyeTracking.ts` | 214 | 9 |
| `src/components/CameraDock.tsx` | 200 | 2 |
| `src/components/ReaderCore.tsx` | 194 | 2 |
| `src/hooks/useGalaxyAnchor.ts` | 191 | 2 |
| `src/lib/galaxy-label-sprites.ts` | 156 | 1 |
| `src/components/WorkCard.tsx` | 148 | 5 |
| `src/hooks/useHandoffFx.ts` | 145 | 1 |

`src/App.tsx` (2,226 lines, 55 `useState`, 30 `useEffect` per the hotspot report) is
the single largest untested unit in the repo. `useHandControl.ts` (399) and
`useEyeTracking.ts` (214) are pure-logic hooks with 13 and 9 importers respectively —
they are the cheapest high-value extractions, and the `src/lib/` precedent
(`downsample.ts`, `eye-hud.ts`, `hand.ts`) is exactly the pattern to repeat.

---

## 2. Test quality

I read the ten largest test files. **The prevailing quality is high** — tests are
named for behavior, most assert on real filesystem effects or returned values, and
many carry a comment naming the defect they exist to prevent. `note-write-guard`,
`app-identity`, `verbs`, `second-brain` and the two `electron-graph.*` tests are
exemplary. Specific weaknesses, honestly small:

**2a. Structural-assertion tests that are correct but fragile-by-design.**
`sdk-options.test.mjs` asserts the *complete key set* of the `Options` object and
`electron-graph.supply.test.mjs` asserts an exact module count. Both assert
implementation shape rather than behavior — and both are **right to**: each has a
written rationale (the `appendSystemPrompt` incident; silent coverage shrinkage).
Flagged only so a future reader does not "clean them up".

**2b. Assertions that would not fail if the feature broke.**
- `stateful-session.test.mjs` → *"defaults to `DECISION_OUTPUT_FORMAT` when the caller
  passes nothing"* asserts only `expect(options.outputFormat).toBeDefined()`. Pass the
  **wrong** format and this test still passes. Its sibling (`omits outputFormat
  entirely when the caller passes false`) is precise; this one should be
  `toBe(DECISION_OUTPUT_FORMAT)`.
- `run-skills.test.mjs` → *"leave no verb with the full bundle"* asserts
  `skills.length < shipped.length`. A verb reduced to one skill, or scoped to the
  *wrong* skills, passes. The substance of per-verb scoping ("`skills` is scoped per
  verb, and that scoping is the substance" — CLAUDE.md) is asserted by a `<`.

**2c. Mock-shape assertions.** ~55 `it` blocks assert only `toHaveBeenCalledWith` on
an injected collaborator. For genuinely effect-emitting modules
(`announcements`, `live-messages`, `renderer-security`) this is the only available
shape and is fine. Two are thinner than the rest:
- `ipc.test.mjs` → *"sidecar:start delegates to startLive"* asserts only that a mock
  was called, with no arguments checked. It restates the wiring rather than testing
  it — swap two handlers' bodies and roughly half this describe-block still passes.
  (The file's *channel-registry* assertions above it are strong; it is the
  delegation block specifically that is thin.)
- Correction worth recording: `run-sessions.test.mjs`'s *"names the session"* looked
  thin by the same automated scan and is **not** — it asserts the exact argument
  triple. Mock-call assertions are not inherently weak; unargued ones are.

**2d. Zero `it.skip` / `it.todo` / snapshots across 1,908 tests.** Notable and good —
no quarantined tests, no snapshot rot.

---

## 3. Gate gaps — what passes all five today

Concretely, each of these is green on every gate:

1. **A commit made outside Claude Code.** No CI, so *none* of the five ran. This
   subsumes every item below for any contributor who is not the maintainer.
2. **A broken gate.** Edit `check-spec-drift.mjs` to always return `{ok: true}` →
   build ✓ test ✓ lint ✓ secrets ✓ spec:check ✓ (it reports its own pass).
3. **A test file that never runs.** Add `src/components/Foo.test.tsx` with a failing
   assertion → 106 files still run, suite green.
4. **Any renderer regression.** Break `App.tsx`'s run-status rendering, `WorkCard`,
   `PipelineBar`, the setup wizard, or any of the 34 untested components: `tsc` sees
   types, `oxlint` sees syntax, nothing sees behavior. There is **no DOM-rendering
   test in the repo** (`@testing-library/*` is not a dependency; `jsdom` is used only
   for two non-React tests).
5. **A preload channel rename** that misses one call site in `src/` — `preload.cjs` is
   `.cjs`, so both graph tests skip it, and `checkJs` cannot link a string channel name.
6. **Unbounded file growth.** `App.tsx` may reach 5,000 lines; the convention has no guard.
7. **A dead export / orphaned component.** The dead-CSS sweep covers classes only.
8. **A doubled bundle.** No size budget anywhere.
9. **A new CVE in a production dependency.** No `audit` step exists.
10. **An a11y regression** (focus order, missing label, contrast) — no check of any kind.
11. **A second `three` copy or an `@types/node` major drift**, until someone runs the
    full `npm run build` (the Stop hook runs `tsc` only, not the three build scripts).

---

## 4. Dependency health

### 4a. Advisories — `npm audit --omit=dev`: **19 (6 high, 13 moderate)**

| Package | Sev | Path | Reachability |
|---|---|---|---|
| `js-yaml@3.15.0` | **high** | `gray-matter@4.0.3` → js-yaml | **Reachable.** `gray-matter` parses frontmatter of *user vault notes* (`second-brain.mjs`, `vault-write.mjs`, `vault-graph-parse.mjs`). Quadratic-CPU `!!omap`; the fix is **not backported to 3.x** and gray-matter pins `^3.13.1`, so no override fixes it — replacing gray-matter is the only real fix. Local-file input, so DoS-on-self only. |
| `ip-address`, `fast-uri` | **high** | transitive | Not on a first-party path. |
| `lodash-es`, `nanoid` | **high** | `@excalidraw/excalidraw@0.18.1` → mermaid/chevrotain | `nanoid` is used for element ids in the canvas; fix requires downgrading Excalidraw to 0.17.6 (breaking) — **do not**. |
| `@hono/node-server`, `hono` | mod | `@modelcontextprotocol/sdk@1.29.0` | Canvas MCP binds `127.0.0.1` + ephemeral port + bearer token; the Windows path-traversal advisory is macOS-irrelevant. Fixed in MCP SDK 1.30.0. |
| `dompurify`, `mermaid`, `postcss`, `protobufjs` | mod | Excalidraw / Vite / genai | Low first-party reachability. |

**No advisory here is exploitable remotely against Iris as shipped** (no server surface
beyond loopback+token, no untrusted HTML from the network). The finding is that
*nothing measures this* — a future dependency with a genuinely reachable RCE would
land in exactly the same silence.

### 4b. `npm outdated` — 24 behind, none urgent

Safe-looking patch/minor drift: `@react-three/*`, `react`/`react-dom` 19.2.7→19.2.8,
`@types/react*`, `concurrently`, `wait-on`, `@vitejs/plugin-react`, `vite` 8.1.0→8.2.1,
`oxlint` 1.76.0→1.78.0, `@google/genai` 2.10→2.16.

### 4c. **Do NOT bump** (documented couplings — `docs/REFERENCE.md`)

| Package | Current | Why it is not a routine bump |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `^0.3.210` (0.3.227 available) | **Also a Claude Code CLI bump and a ~250 MB asset change.** The CLI ships as a per-platform native binary in the SDK's own `optionalDependencies`; SDK `0.3.210` ⇄ CLI `2.1.210`. Touching it drags `prepare-mac-binaries.mjs`, `prune-foreign-arch.mjs`, `asarUnpack`, and `sdk-options.test.mjs`'s `sdk.d.ts` parse. |
| `electron` | `42.5.0` exact (43.3.0 available) | `webPreferences.sandbox: true` and the renderer CSP both assume a fixed, known Electron. Also drives the correct `@types/node` major. |
| `@types/node` | `24.13.3` exact (26.2.0 available) | **Must track the range the installed `electron` declares**, not `engines.node`. Guarded by `scripts/check-types-node.mjs`. Bumping to 26 admits stdlib APIs Electron's embedded Node does not have. |
| `three` | `^0.181.2` | Exactly one copy must resolve (`overrides.three` + `resolve.dedupe`); `scripts/check-three-dedupe.mjs` fails the build otherwise. `3d-force-graph@1.80.0` is pinned exact for the same reason. |
| `typescript` | `6.0.3` exact | `latest` is already at **7.0.2** — a major. The "no `latest`" rule exists because of this exact near-miss. |
| `oxlint` | `1.76.0` exact | The zero-warning gate's rule set is measured against this version; a bump can add rules and turn the gate red on untouched code. |
| `@mediapipe/tasks-vision` | `^0.10.35` (1.0.1 available) | WASM fileset is **vendored** from `node_modules` by `vendor-runtime-assets.mjs`; a major changes the vendored asset shape and the CSP-constrained runtime. |
| `vitest` | `4.1.10` | Vitest 4's non-inheriting `projects` semantics are load-bearing in `vitest.config.mjs`. |
| `gitleaks` | `8.30.1`, **not** lockfile-pinned | Homebrew Go binary. The npm package named `gitleaks` is an **abandoned unrelated package** — never "fix" the asymmetry by adding it. |
| `@modelcontextprotocol/sdk` | `1.29.0` exact | Pinned exact but with **no recorded reason** — the only exact pin in this list whose rationale is not written down anywhere. Worth documenting or relaxing; 1.30.0 clears two advisories. |

---

## 5. Proposed additions — minimal, ranked

Each is a single small file. None is a rewrite; none changes app behavior.

**P1. `.github/workflows/gates.yml`** (~40 lines). `npm ci` on Node 24, then the five
gates plus `npm run build`. Uses `gitleaks/gitleaks-action` for the secret gate (the
one tool not in the lockfile). Turns the hooks from *the* enforcement into a fast
local pre-echo of a real gate. **Highest leverage item in this report.**

**P2. `scripts/check-spec-drift.test.mjs`** (~80 lines). Build a temp spec tree in
`os.tmpdir()`, one fixture per check — a registered retired term, a `TBD` Purpose, a
self-contradicting requirement, an empty capability — assert each fails and a clean
tree passes. Extend `gates.forbidden.test.mjs`'s pattern to `runLint`/`runTests`
fail-closed behavior (`oxlint` unresolvable ⇒ `ok: false`).

**P3. `harness-globs.test.mjs`** (~25 lines). Read `vitest.config.mjs`'s include globs
and every `*.test.*` file from `git ls-files`; assert the two sets are equal. A test
file that can never run becomes a failing test. Pair with adding `src/**/*.test.tsx`
to the `unit` include so component tests are *possible*.

**P4. `scripts/check-file-size.mjs` + `file-size-baseline.json`, folded into the lint
gate** (the dead-CSS precedent — same tree, same zero-tolerance shape). Rules: any
*new* file over 450 lines fails; any file in the baseline that **grows** fails.
Shrinking updates the baseline. This enforces the convention without demanding a
refactor, and makes the stale TESTING.md list self-maintaining. Seed it from today's
25 over-limit files.

**P5. Three renderer smoke tests** (needs P3). Add `@testing-library/react`; render
`PipelineBar`, `WorkCard` and `ReviewBanner` under jsdom and assert the user-visible
text for each run status. Establishes the pattern and the dependency; the remaining
31 components follow incrementally. Alternatively — and more in keeping with this
repo's `downsample.ts` precedent — extract `useHandControl`/`useEyeTracking`'s pure
logic into `src/lib/` and test it there, no new dependency at all.

**P6. Coverage, report-only first.** Add `@vitest/coverage-v8`; `npm test -- --coverage`
in CI as an artifact. Set a threshold on `electron/**` and `src/lib/**` only (both
already near-complete, so it starts green and ratchets), and deliberately **no global
percentage** — a global number would be gamed by the 12,933 untested renderer lines.

**P7. `npm audit --omit=dev --audit-level=high` as an advisory CI step** (non-blocking
initially), plus a one-line note in `docs/REFERENCE.md` recording the `gray-matter`/
`js-yaml@3` decision as *accepted, with reason* rather than unexamined.

**P8. `electron/preload.cjs` contract test.** Assert that every channel string in
`preload.cjs` appears in an `ipcMain.handle`/`on` registration in `electron/ipc.mjs`,
and vice versa. ~30 lines, pure text parse, closes finding #5 and the one hole both
graph tests structurally cannot reach.

---

## Parent verification (independent re-check)

I re-ran the load-bearing claims in this report myself rather than accepting
them. **All verified; nothing overstated.** Detail worth adding:

| Claim | Verification | Result |
|---|---|---|
| #1 No CI | `ls -d .github` + checked `.gitlab-ci.yml`, `.circleci`, `Jenkinsfile` | **Confirmed.** No CI config of any kind. |
| #2 spec-drift gate untested | Only `scripts/check-plugin-sync.test.mjs` and `scripts/gates.forbidden.test.mjs` exist | **Confirmed.** 574-line gate, 0 tests. |
| #3 Wrong extension = invisible | **Empirical probe** (below) | **Confirmed, strongest finding.** |
| #5 TESTING.md drift | `docs/TESTING.md:411-413` vs. `wc -l` | **Confirmed and worse than listed** (below). |
| #7 19 advisories / 6 high | `npm audit --omit=dev` | **Confirmed.** |
| #7 js-yaml reachable | Traced to call sites; checked `gray-matter` dep range | **Confirmed reachable; confirmed unfixable by override.** |

### #3 — proven empirically, not by reading the glob

I wrote a deliberately failing test at `src/lib/__globprobe.test.tsx`:

```ts
it("MUST FAIL if picked up", () => { expect(1).toBe(2); });
```

Result: `Test Files 104 passed (104) / Tests 1836 passed (1836)`, exit 0. The
file was **never collected**. A `.tsx` test can therefore be written, committed,
and reviewed as coverage while asserting nothing — and the suite stays green.
(Probe deleted immediately; the repo is unchanged.)

This elevates #3: it is not a latent risk, it is a *silent-failure mode that is
live right now*, and it is the mechanism that would defeat any future attempt to
fix #4 by adding component tests.

### #5 — the drift is larger than the report states

`docs/TESTING.md:411-413` vs. reality:

| File | TESTING.md says | Actual | Delta |
|---|---|---|---|
| `src/App.tsx` | 1738 | **2226** | **+488** |
| `electron/canvas-mcp.mjs` | 557 | **804** | **+247** |
| `src/components/VaultGalaxy.tsx` | 1035 | 1106 | +71 |
| `src/components/SetupPanel.tsx` | 1023 | **858** | **-165** |
| `electron/capabilities/second-brain.mjs` | *(absent)* | **1317** | unlisted |

Note `SetupPanel` moved the *right* way (-165) — so the list is not merely
stale, it is stale in **both directions**. That is the useful detail: a reader
cannot tell from the document whether a number is a live constraint or a
historical artifact, which is precisely why a checked-in ratchet (#5's proposed
fix) is the right shape rather than a prose refresh.

### #7 — reachability and the override question, confirmed

The advisory path is real, not theoretical:

- `gray-matter@4.0.3` is a **production** dependency (`package.json` `dependencies`).
- It is imported at `electron/vault-write.mjs:25` and
  `electron/capabilities/second-brain.mjs:10`.
- `electron/vault-write.mjs:222` calls `matter(markdown)` on note content —
  i.e. **user vault files**, the untrusted-ish input the advisory concerns.
- Installed: `node_modules/gray-matter/node_modules/js-yaml@3.15.0`.
- `gray-matter` declares `"js-yaml": "^3.13.1"` — so an `overrides` bump to
  js-yaml 4 would violate its declared range.

The report's "accept with a recorded reason" conclusion is therefore correct.
Worth adding: `vault-write.mjs:220-224` **already wraps `matter()` in
try/catch** and returns `{ ok: false, error: "Malformed frontmatter" }` rather
than throwing — so malformed input is handled. That mitigates corruption but
**not** the advisory, which is quadratic CPU consumption (a hang, not an
exception) and so is not caught by try/catch. The mitigation and the
vulnerability address different failure modes; the acceptance note should say
so explicitly rather than cite the try/catch as cover.
