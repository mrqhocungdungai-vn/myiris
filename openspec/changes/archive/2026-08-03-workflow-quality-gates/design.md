## Context

See proposal.md — Why. The design-relevant state:

- No `.claude/settings.json` exists; hooks are built from nothing, not extended.
- No linter exists. `docs/TESTING.md` and `CLAUDE.md` both state this as a fact, not a gap to be filled someday.
- `scripts/check-three-dedupe.mjs` and `scripts/check-types-node.mjs` establish the repo's guard-script shape: a plain `.mjs`, no framework, exits non-zero with a message naming the exact correction.
- There is no CI. Whatever is not bound to a local event does not run.

Everything below was measured against the current tree rather than assumed. The numbers are load-bearing — several decisions invert if they change.

| Operation | Measured |
| --- | --- |
| `oxlint` over `src electron scripts` | 0.11s |
| `oxlint` over one file | 0.09s |
| `gitleaks dir` over one file | 0.06s |
| `gitleaks git --staged` | 0.07s |
| `gitleaks git` (134 commits, 5.26 MB) | 0.79s |
| `gitleaks dir .` (38.33 MB) | 7.6s |
| `tsc -p tsconfig.electron.json` | 2.6s |
| `tsc --noEmit` (renderer) | 3.4s |
| `npm run` startup, before running anything | 0.22s |

## Goals / Non-Goals

**Goals:**

- Bind lint and secret scanning to editing events at a cost that does not change how it feels to work in the repo.
- Keep one definition per gate, so the hand-run command and the automatic binding cannot check different things.
- Make every deliberate exclusion legible enough that a later reader can tell it was a decision, not an omission.

**Non-Goals:**

- Reformatting. No formatter is introduced; the existing code style is left exactly as it is.
- Broadening lint coverage beyond what is measured to cost nothing today. Enabling further rule groups is a separate, priced decision.
- Covering commits made outside Claude Code. See Risks.
- Any change to app runtime behavior.

## Decisions

### Claude Code hooks, not git hooks

Git hooks would cover every commit regardless of author or tool, which is strictly broader. They were not chosen because `.git/hooks/` is not versioned, so sharing them requires husky or lefthook — a new dependency and a new install step — to protect a single-developer repo whose changes currently all flow through one tool. Claude Code hooks also fire *earlier*: at the edit, not at the commit, when the file is still the one in hand.

The cost of this choice is a real gap, recorded under Risks rather than glossed.

### oxlint, not Biome or typescript-eslint

Biome bundles a formatter. Running it over 23k lines produces a diff touching nearly every file, which would bury this change's actual content and rewrite blame across the repo. Disabling its formatter leaves something close to oxlint with more configuration.

typescript-eslint's distinguishing value is type-aware rules — and `tsc` already runs over both projects as an existing gate, so that value is largely already collected. Its cost is seconds per run and a substantial config, which would push lint out of the per-edit budget.

oxlint runs the whole tree in 0.11s, which is what makes per-edit binding possible at all. If lint had cost seconds, the entire event-binding design below would collapse into "everything at the end".

### Rule set: `correctness` plus the zero-cost plugins

Measured findings by configuration on the current tree:

| Configuration | Findings |
| --- | --- |
| default (`correctness`) | 7 |
| `+ import` / `+ promise` / `+ node` plugins | 7 (no change) |
| `+ vitest` plugin | 14 |
| `+ react` plugin | 21 |
| `+ suspicious` | 95 |
| `+ pedantic` | 481 |
| `+ restriction` | 1102 |
| `+ style` | 7137 |

`import`, `promise`, and `node` are enabled because they cost nothing now and will catch something later. The rest are excluded, but for two different reasons that must not be conflated:

- `suspicious` / `pedantic` / `restriction` / `style` are excluded on **volume**. Adopting any of them converts this change into a refactor of unrelated code.
- `react` is excluded on **risk**. All 14 of its findings are `react-hooks(exhaustive-deps)` inside `src/App.tsx` — 1738 lines of effects and refs. Mechanically adding the named dependencies is the standard way to satisfy that rule and a well-known way to introduce infinite re-render loops. The correct treatment is to read each of the 14 individually, which is its own change. Recording only "+14" would invite someone to knock it out in an afternoon.

`vitest` is excluded on **value**: `expect-expect` misfires on custom assertion helpers, and `require-to-throw-message` is style.

### The three "unfixable" findings are annotations, not fixes

Of the 7 findings, three describe intentional code, and treating them as defects would make the codebase worse:

- `electron/user-config.mjs:185` — `no-control-regex` fires on `/[\x00-\x1f\x7f]/`, which is the `.env` injection guard. The file's own comment explains it: `parseEnvFile` is line-oriented, so a value carrying a newline reads back as extra variables outside `ALLOWED_CONFIG_KEYS`. The regex matches control characters *because rejecting them is the point*. This gets an inline disable with that reason.
- `electron/run-queue.mjs:291` — `{ child, result, ...rest }` is omit-by-destructuring; the two bindings exist to keep those fields out of `rest`. Renaming to `_child` / `_result` satisfies the rule with no semantic change, which is also what oxlint's own hint suggests.
- `electron/live-session.mjs:53` — `submitClaudeTask` is an unused injected dependency. Unlike the two above, this one is genuinely undetermined: it is either dead wiring or an accepted-but-unused seam. `electron/wiring-live.mjs` must be read before choosing between deleting it and prefixing it. This is called out as a task, not decided here.

The remaining four (`no-new-array` ×2, `no-useless-length-check`, and the third `no-unused-vars`) are ordinary fixes.

### Secret scanning: per-file at the edit, `--staged` at the commit

Three candidate scopes were measured. Whole-tree `gitleaks dir .` is rejected on both counts that matter: 7.6s, and 2 findings that are both false — the developer's real `.env`, and an Excalidraw Firebase key inside a vendored bundle in `dist/`. Both live in gitignored directories, because `gitleaks dir` does not read `.gitignore`. Suppressing them would mean maintaining a `.gitleaksignore` whose entries exist to paper over a scope that was wrong to begin with.

Per-file scanning at the edit (0.06s) avoids the problem structurally: the scanner is only ever handed the file just written. Gitignored paths are filtered with `git check-ignore` rather than a hand-kept list, so the exclusion set is the repository's own and cannot drift.

For the commit gate, `gitleaks git --staged` (0.07s) is used rather than the history scan originally considered (0.79s). It is both an order of magnitude cheaper and *more correct*: it reads exactly the content about to be committed, whereas a history scan re-reads 134 commits that were already clean and never looks at what is staged.

Scanning covers every written file type, not just source. A key pasted into a Markdown document is committed just as readily as one in a `.mjs`.

### Event binding follows what a check reads, not what it costs

| Event | Runs | Measured |
| --- | --- | --- |
| `PostToolUse` (`Edit`, `Write`) | per-file secret scan | 168ms |
| `Stop` | lint, then typecheck for projects whose files changed | 92ms (no-op) – 5.4s |
| `PreToolUse` (`Bash` matching `git commit`) | `gitleaks git --staged` | 0.07s |

This split was initially drawn along cost — cheap checks per edit, expensive ones per turn — and lint was bound to `PostToolUse` on the strength of being fast. That was the wrong axis, and the first live edit proved it: lint blocked a two-edit refactor over an import that the very next edit consumed.

The correct axis is **scope**:

- A **per-file** check reads only the file just written. It cannot be wrong about work in progress, because its verdict depends on nothing else. The secret scan qualifies: a credential is a credential regardless of what any other file currently says.
- A **whole-tree** check reads relationships between files. It is *necessarily* wrong partway through any multi-edit sequence — the instant after a declaration changes but before its use does. Lint and typecheck both qualify.

The failure mode is worse than noise. An agent handed "unused import" mid-refactor may delete the import the next edit was about to use, turning a false alarm into a real defect. Deferring costs nothing in detection: the same condition, if it survives to the end of the turn, is still caught there — verified by reproducing the exact case that misfired.

Cost still constrains binding — typecheck at 6s could not go per-edit whatever its scope — but it does not select the event.

Typecheck cannot be scoped to a single file either: `tsc -p` is a project-level operation by construction. What it *can* be scoped to is which of the two projects runs, since `src/` and `electron/` are separate projects.

That scoping needs to know which files changed during the turn, which the `Stop` event does not itself report. The `PostToolUse` hook therefore appends each written path to a session-scoped ledger file keyed by `session_id`; `Stop` reads it, decides which projects to run, and clears it. A turn that wrote nothing finds an empty ledger and skips the typecheck entirely — which is the common case for a question-answering turn and the reason the 6s is not felt.

### The gates are imported functions, not spawned scripts

The spec requires one definition shared by the hand-run command and the binding. The obvious implementation — have hooks call `npm run lint` — costs 0.22s of npm startup before anything runs, doubling the per-edit budget for no benefit.

Calling `node scripts/lint.mjs` instead removes the npm layer but not the underlying problem, which the measurements made plain: Node startup alone is 92ms, and a hook spawning two gate scripts paid it three times. That was 276ms of a 572ms hook spent starting processes rather than checking anything — the same tax `npm run` was rejected for, relabelled.

So the definitions live in `scripts/gates.mjs` as exported functions returning `{ ok, output }`. Three callers import them: `scripts/lint.mjs` and `scripts/scan-secrets.mjs` are thin CLI wrappers behind the npm scripts, and the hooks import the same functions and run them in-process. One definition, no process boundary on the hot path — `PostToolUse` measured 572ms → 168ms across this change and the lint relocation above.

### Fail closed, with an explicit hatch

If `gitleaks` or `oxlint` is absent, the gate fails and prints the install command. This follows the precedent already recorded in `docs/REFERENCE.md`: `engine-strict=true` exists because npm's warn-and-continue behavior let the documented Node floor drift unnoticed for a long time. A security gate that skips silently is the same failure with a worse blast radius — the workflow reports success and the reader concludes the content was scanned.

`IRIS_SKIP_HOOKS=1` is the documented one-off bypass, matching the existing `IRIS_ALLOW_ANY_PLATFORM=1` convention. It announces itself in the output rather than passing quietly.

### Blocking, and the loop guard

Failing gates exit 2, which returns stderr to the agent as correctable feedback rather than merely printing it. This is affordable specifically because the baseline is driven green first: 0 type errors, 0 leaks, 0 lint findings. A blocking gate over a green baseline is silent until something new breaks; a blocking gate over a backlog is an obstacle from the first minute.

The `Stop` hook reads `stop_hook_active` from its input and returns success when it is set, so a failure that cannot be fixed ends the attempt instead of re-triggering indefinitely.

## Risks / Trade-offs

**The commit gate only sees commits made through Claude Code** → Accepted, not mitigated. `PreToolUse` observes `Bash` invocations; `git commit` typed in another terminal bypasses it entirely. Closing this requires a git hook, which was considered and rejected above. The per-edit scan narrows the exposure — a secret written by an edit is caught before it can be staged — but a secret arriving by any other path reaches a manual commit unchecked. This is documented rather than papered over, so the coverage is not overstated.

**`gitleaks` is not pinned by the lockfile** → It is the only tool in the gate chain provisioned outside npm, so a version change arrives silently and could alter findings in either direction. Mitigated by documenting it as a prerequisite with its version, and by the gate failing closed when it is absent. Accepted because the alternative — the `gitleaks` package on npm — is not the tool.

**The npm `gitleaks` package is an unrelated abandoned package** → `npm view gitleaks` returns version `1.0.0`, last published 2022-05-03, from a personal repository, described as "> custom rules". The real tool is at `8.30.1`. The hazard is specifically a *future* maintainer noticing the unpinned dependency and "fixing" it the obvious way. Mitigated by recording the collision in `docs/REFERENCE.md`, where the repo already keeps its dependency footguns.

**Per-edit friction if lint gets slower** → The whole binding rests on lint being ~0.1s. A future rule-set expansion could quietly push it past the threshold where per-edit checking is tolerable. Mitigated by the spec requiring rule-group decisions to be measured, so a cost increase is observed at the moment it is introduced.

**Blocking gates could obstruct unrelated work** → A pre-existing finding in a file untouched by the current work would block a turn that had nothing to do with it. Mitigated by driving the baseline to zero before enabling the gate; there is nothing pre-existing left to trip over. The residual risk returns only if the rule set is later widened without clearing the new findings first — which is what the zero-warning requirement forbids.

**Ledger files accumulate** → The `Stop` hook clears the session ledger it reads, but an abandoned session leaves its file behind. Mitigated by writing them under the OS temp directory, where they are not the repo's problem, and by keying on `session_id` so they cannot collide.

## Migration Plan

Order matters — the baseline must be green before anything blocks:

1. Install `oxlint`, add `.oxlintrc.json`, add the npm scripts. Nothing is bound yet.
2. Resolve the 7 findings. Verify `npm run lint` is clean, and that `npm test` and `npm run build` are unchanged (48 files / 439 tests; build green through all five stages).
3. Only then add `.claude/settings.json`. Binding a gate that is already green means its first failure is necessarily real.
4. Document, including the unpinned prerequisite and the npm name collision.

Rollback is deleting `.claude/settings.json` — the gates revert to hand-run commands, and nothing else in the repo depends on them.
