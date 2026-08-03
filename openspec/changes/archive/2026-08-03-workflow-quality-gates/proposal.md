## Why

The repo has exactly two automated gates — `npm run build` (typecheck) and `npm test` (behavioral) — and **both are opt-in**: something has to remember to run them. There is no CI, no git hook, and no `.claude/settings.json`, so nothing observes a change between the moment it is written and the moment a human chooses to check it. Two classes of defect fall entirely outside those gates:

- **Lint-class defects.** There is no linter at all. Measured on the current tree, `oxlint@1.76.0` reports 7 findings that neither `tsc` nor vitest can see.
- **Leaked secrets.** `.env` holds `GEMINI_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`. Nothing checks that a key never lands in tracked source. Git history is clean today (134 commits, 0 findings) — that is a state worth keeping, not a guarantee.

This repo has already paid for the difference between *documented* and *enforced*. `docs/REFERENCE.md` records why `engine-strict=true` was necessary: without it "npm only warns and installs anyway, which is how the README came to claim 'Node 20+' long after the real floor had moved." The same failure mode applies to any check that is available but not wired to an event.

## What Changes

- **Add `oxlint` as a pinned dev dependency** (`1.76.0` exact, per the repo's no-`latest` rule) with an `.oxlintrc.json` enabling the `correctness` category plus the `import`, `promise`, and `node` plugins — a set measured to cost **0 additional findings** beyond the existing 7.
- **Resolve the 7 existing lint findings** so the gate can be zero-warning from day one. Three of the seven are annotate-not-change: `electron/user-config.mjs`'s control-character regex is the `.env` injection guard (rewriting it would be a security regression), and `electron/run-queue.mjs`'s `{ child, result, ...rest }` is the omit-by-destructuring idiom.
- **Add two npm entry points** — `npm run lint` and `npm run scan:secrets` — so every check is runnable by hand and reusable by a future CI or git hook. `npm run build` is **not** modified.
- **Add `.claude/settings.json` hooks** binding each check to an event according to what it reads: `PostToolUse` runs the per-file secret scan (168ms measured); `Stop` runs lint and the typecheck projects whose files actually changed; `PreToolUse` on `Bash` gates `git commit` with a scan of the staged content.
- **All three gates block** (exit 2) and **fail closed** when their tool is absent, with `IRIS_SKIP_HOOKS=1` as the documented one-off escape, matching the existing `IRIS_ALLOW_ANY_PLATFORM=1` convention.
- **Document `gitleaks` as a developer prerequisite** (Homebrew, `8.30.1`), explicitly noting it is *not* pinned by the lockfile — and that the `gitleaks` package on npm is an unrelated, abandoned third-party package, not the tool.

Not a breaking change: no runtime behavior of the app changes, and `npm run build` / `npm test` keep their current contracts.

## Capabilities

### New Capabilities
- `workflow-quality-gates`: which automated checks run, at which point in the editing workflow, what they block on, and how they behave when their tooling is missing. Covers the lint gate's rule set and zero-warning threshold, the secret-scan gate's scope, and the fail-closed policy.

### Modified Capabilities

None. `test-harness` deliberately keeps its current scope — its stated purpose is the test runner and the testability conventions Node-side modules follow, and its requirement that "`npm run build` SHALL remain the typecheck gate and SHALL NOT be made to depend on the test runner" is the reason this change does not extend `build`. The new capability reuses those gates as-is rather than redefining them.

## Impact

**New files:** `.oxlintrc.json`, `.claude/settings.json`, and hook scripts under `scripts/` (alongside the existing `check-three-dedupe.mjs` / `check-types-node.mjs` guards).

**Modified:** `package.json` (one dev dependency, two scripts), `package-lock.json`, plus documentation — `README.md` (gitleaks prerequisite), `docs/REFERENCE.md` (npm-`gitleaks` supply-chain note), `CLAUDE.md` (router pointer).

**Code touched:** 4 source files carrying the 7 lint findings — `electron/run-queue.mjs`, `electron/user-config.mjs`, `electron/live-session.mjs`, `electron/vault-graph.mjs`, `src/lib/tasks.ts`, `src/App.tsx`. Changes are renames, an annotation, and idiom substitutions; none alter behavior. `electron/live-session.mjs`'s unused `submitClaudeTask` parameter requires reading `wiring-live.mjs` before deciding between removal and an underscore prefix.

**Dependencies:** one new dev dependency (`oxlint`); one new *external, unpinned* developer prerequisite (`gitleaks` via Homebrew) — the first tool in this repo's gate chain not reproducible from the lockfile.

**Known gap, accepted:** the commit gate is a `PreToolUse` hook, so it only sees `git commit` invocations that pass through Claude Code. A commit typed directly in a terminal bypasses it. Closing that would require a git hook (and therefore husky or lefthook), which is deliberately out of scope here.

**Explicitly excluded, with measured cost:** whole-tree `gitleaks dir` scanning (7.6s, and 2 false positives originating in gitignored `.env` and `dist/`, since that mode does not read `.gitignore`); `react-plugin` (+14 findings, all `react-hooks(exhaustive-deps)` inside a 1738-line `App.tsx`, where mechanical fixes risk infinite render loops); `vitest-plugin` (+7, low value); and the `suspicious` / `pedantic` / `restriction` / `style` categories (95 / 481 / 1102 / 7137 findings).
