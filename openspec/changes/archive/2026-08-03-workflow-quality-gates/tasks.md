## 1. Baseline capture

- [x] 1.1 Record the pre-change baseline so regressions are attributable: `npm run build` green through all five stages, `npm test` at 48 files / 439 tests, and `git status` before any edit
- [x] 1.2 Re-run `oxlint` over `src electron scripts` and confirm the finding set is still exactly the 7 recorded in design.md — if it has changed, reconcile before proceeding rather than assuming

## 2. Lint tooling

- [x] 2.1 Install `oxlint` as a devDependency pinned to the exact version `1.76.0` (no caret, no `latest` — per the rule in `docs/REFERENCE.md`)
- [x] 2.2 Create `.oxlintrc.json` enabling the `correctness` category and the `unicorn`, `typescript`, `oxc`, `import`, `promise`, and `node` plugins; do not enable `react`, `vitest`, or the `suspicious`/`pedantic`/`restriction`/`style` categories
- [x] 2.3 Verify the config resolves as intended with `oxlint --print-config`, and that the finding count against it is still 7
- [x] 2.4 Add the `lint` script to `package.json`, running oxlint over `src electron scripts` with `--deny-warnings` so warnings produce a non-zero exit
- [x] 2.5 Confirm `npm run build` and `npm test` are byte-for-byte unaffected by the new dependency and script

## 3. Clear the lint baseline to zero

- [x] 3.1 `electron/user-config.mjs:185` — add an inline oxlint disable for `no-control-regex` whose comment states that the pattern is the `.env` injection guard and that matching control characters is its purpose; do not alter the regex
- [x] 3.2 `electron/run-queue.mjs:291` — rename the omit-by-destructuring bindings to `_child` / `_result`, preserving the field-exclusion semantics exactly
- [x] 3.3 `electron/live-session.mjs:53` — read `electron/wiring-live.mjs` to determine whether `submitClaudeTask` is dead wiring or an accepted-but-unused injected seam, then either remove it from the destructure and its wiring, or prefix it; state which was found and why in the commit
- [x] 3.4 Fix the two `unicorn(no-new-array)` findings in `electron/vault-graph.mjs:14` and `src/lib/tasks.ts:171` using the form the rule's hint indicates for a length argument
- [x] 3.5 Fix `unicorn(no-useless-length-check)` at `src/App.tsx:673`, confirming the length check is genuinely redundant for the `Array#some()` call it guards rather than assuming
- [x] 3.6 Verify `npm run lint` exits 0 with zero findings
- [x] 3.7 Verify `npm test` still reports 48 files / 439 tests passing and `npm run build` is still green — none of 3.1–3.5 may change behavior

## 4. Secret-scanning gate

- [x] 4.1 Write `scripts/scan-secrets.mjs` as the single definition of the secret gate, supporting a repository-staged mode (`gitleaks git --staged`) and a single-file mode (`gitleaks dir <path>`), always with redacted output
- [x] 4.2 In single-file mode, skip paths that `git check-ignore` reports as ignored, so the repository's own ignore rules are the exclusion set and no `.gitleaksignore` is introduced
- [x] 4.3 Make the script fail closed when `gitleaks` is not on `PATH`: exit non-zero naming the missing tool and printing `brew install gitleaks`
- [x] 4.4 Honour `IRIS_SKIP_HOOKS=1` as an explicit bypass that announces itself in the output rather than passing silently
- [x] 4.5 Add the `scan:secrets` script to `package.json` invoking the staged mode
- [x] 4.6 Verify positively and negatively: a planted fake credential in a temporary tracked-path file is reported (file, line, rule, value redacted) and exits non-zero; a clean tree exits 0; the real `.env` and `dist/` produce no findings

## 5. Hook scripts

- [x] 5.1 Write the `PostToolUse` hook script: read the hook JSON from stdin, extract the written file path, run the single-file secret scan, and append the path to a session ledger keyed by `session_id` under the OS temp directory
- [x] 5.2 Let the secret scan see every written file type including Markdown and configuration; restrict lint (now on `Stop`) to turns that touched a file extension oxlint reads
- [x] 5.3 Write the `Stop` hook script: read `stop_hook_active` and return success immediately when set; otherwise read the session ledger, run lint plus only the typecheck projects whose files changed, and clear the ledger on success
- [x] 5.4 Make the `Stop` hook a no-op when the ledger is empty or absent, so a turn that wrote no files incurs no delay
- [x] 5.5 Write the `PreToolUse` hook script: detect a `git commit` invocation in the `Bash` tool input and run the staged secret scan, allowing all other Bash commands through untouched
- [x] 5.6 Make every hook script exit 2 on failure with the diagnostic on stderr, and exit 0 otherwise
- [x] 5.7 Have the hook scripts import the gate definitions in-process rather than spawning them, avoiding both the 0.22s `npm run` startup and the 92ms-per-spawn Node startup on the per-edit path

## 6. Hook wiring

- [x] 6.1 Create `.claude/settings.json` binding `PostToolUse` with matcher `Edit|Write`, `Stop`, and `PreToolUse` with matcher `Bash` to their respective scripts
- [x] 6.2 Verify the `PostToolUse` binding fires on a real edit and that its measured wall time stays at roughly 0.2s
- [x] 6.3 Verify the `Stop` binding runs only the project whose files changed: edit an `electron/` file and confirm the renderer typecheck is skipped, then the reverse; confirm a docs-only turn runs neither lint nor typecheck
- [x] 6.4 Verify the `PreToolUse` binding blocks a `git commit` carrying a staged fake credential, and does not interfere with any other Bash command
- [x] 6.5 Verify the loop guard: force a `Stop`-gate failure that cannot be corrected and confirm the hook does not re-trigger indefinitely
- [x] 6.6 Verify fail-closed end to end by making `gitleaks` temporarily unreachable on `PATH` and confirming the gate blocks with the install instruction rather than passing

## 7. Documentation

- [x] 7.1 `README.md` — add `gitleaks` (Homebrew, 8.30.1) to the from-source setup prerequisites, stating explicitly that its version is not pinned by the lockfile unlike every other tool in the chain
- [x] 7.2 `docs/REFERENCE.md` — add a footgun entry recording that the `gitleaks` package on npm is an unrelated abandoned package (`1.0.0`, last published 2022-05-03) and not the tool, so a future attempt to pin it does not install the wrong thing
- [x] 7.3 `docs/REFERENCE.md` — add `oxlint` `1.76.0` to the pinned-identifiers table
- [x] 7.4 `CLAUDE.md` — add a one-line router pointer to the new capability, and correct the standing statement that there is no linter
- [x] 7.5 `docs/TESTING.md` — describe the gates and their event bindings, and correct any statement there that the two existing gates are the only automated checks

## 8. Final verification

- [x] 8.1 Run `npm run build` and confirm it is green and still performs no lint or secret scan — the gates must remain independent
- [x] 8.2 Run `npm test` and confirm 48 files / 439 tests passing, unchanged
- [x] 8.3 Run `npm run lint` and `npm run scan:secrets` by hand and confirm both exit 0
- [x] 8.4 Delete `node_modules` and run `npm ci`, confirming the pinned `oxlint` resolves and the lockfile is consistent
- [x] 8.5 Confirm the documented rollback works: with `.claude/settings.json` removed, editing proceeds ungated and both npm scripts still run
- [x] 8.6 Manual smoke: launch the app and confirm nothing in this change reached runtime behavior
