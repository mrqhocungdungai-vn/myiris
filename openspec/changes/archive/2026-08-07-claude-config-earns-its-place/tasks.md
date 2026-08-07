## 1. Sequencing hazard, read first

- [x] 1.1 **Do section 6's deletions before section 2 lands the denylist.** The guard refuses recursive deletion, so `rm -rf .claude/skills/<name>` stops working the moment it is installed — an implementer who reverses this order blocks their own next step and will be tempted to weaken the guard to get past it. Delete the skills first, or delete them with a non-recursive removal, and never by relaxing the pattern
- [x] 1.2 Note that from section 4 onward every turn pays the suite (~7s) — expected, not a regression to chase

## 2. The brake, two layers (D1, D2)

- [x] 2.1 Add a `permissions.deny` block to `.claude/settings.json`: `Read(./.env)` and the destructive shell patterns. No `allow` block — under this repo's permission mode an allowlist changes nothing and would read as protection that is not there
- [x] 2.2 Confirm by hand that the deny rule on `.env` also refuses `cat .env` through Bash, which is the documented behavior of Read rules over recognised file commands — if it does not, the regex fallback in 2.3 is load-bearing rather than belt-and-braces, and say so in the comment
- [x] 2.3 Add `checkForbiddenCommand(command)` to `scripts/gates.mjs` — a pure predicate returning the matched operation or nothing, no I/O, no spawn, so it is testable without any tool installed (D5, and the test-harness delta's last scenario)
- [x] 2.4 Seed the pattern set with exactly the operations **not** already covered: recursive delete of a project path, `git push --force`/`-f`, `git checkout .`/`git restore .`, `git reset --hard`, and reading the credential file. Do NOT add `rm -rf /` or `rm -rf ~` — the tool already prompts for those as a built-in circuit breaker, and a denylist that spends lines on covered cases invites being read as noise
- [x] 2.5 Reuse `pre-bash.mjs`'s existing segment-splitting so a destructive verb in a compound command line is matched, rather than writing a second command parser next to it
- [x] 2.6 Wire it into `pre-bash.mjs` **above** `isBypassed()`, blocking via the existing `block()` helper so it exits 2 like every other refusal here
- [x] 2.7 Make the refusal text name the matched operation, echo the command, and state that the developer can run it directly — a refusal with no way forward is a refusal that gets deleted (D1)
- [x] 2.8 Rewrite the bypass announcement in `pre-bash.mjs`: `IRIS_SKIP_HOOKS=1` no longer means "no hook ran", it means "no scan ran, the guard still applies". The repo's convention that a bypass announces itself is only kept if the announcement is true (D2)
- [x] 2.9 Update the header comment of `pre-bash.mjs` to describe the file as two checks with different reasons for existing, and keep the existing known-gap paragraph — a command typed in a terminal still does not reach either layer

## 3. `scripts/` becomes testable (D5)

- [x] 3.1 Add `scripts/**/*.test.mjs` to the `unit` project's `include` in `vitest.config.mjs`, with a comment noting that `build.files` never lists `scripts/`, so unlike `electron/**` no exclusion rule is needed to keep tests out of the packaged app
- [x] 3.2 Write `scripts/gates.forbidden.test.mjs` against the predicate: each declared operation refused; flag-cluster and flag-order variants (`rm -fr`, `rm -r -f`); a destructive segment after `&&`; and the refusals that must NOT happen — `rm` of a single file, `git push` without force, `git checkout <branch>`, a path that merely contains `.env` as a substring
- [x] 3.3 Confirm the new test file is collected: `npx vitest run --project unit` reports a file count one higher than before

## 4. The behavioral gate gets bound (D3, D4)

- [x] 4.1 Add `runTests()` to `scripts/gates.mjs`, resolving the runner the way `runLint()` resolves oxlint — through `require.resolve("vitest/package.json")` then its declared `bin`, never a hardcoded `node_modules` path — and failing closed with `failClosed()` when it cannot be resolved
- [x] 4.2 Add `npm run test:gate` (or extend `scripts/`'s existing CLI-entry pattern with `scripts/test-gate.mjs`) so the gate has the one-definition-two-callers shape the capability requires, and leave `npm test` exactly as it is
- [x] 4.3 Bind it in `stop.mjs` off the ledger, reusing `LINTABLE_EXTENSIONS` rather than declaring a second near-identical extension set — the code files lint reads are the code files the suite reads
- [x] 4.4 Place it **last** in the failure-accumulation order, after typecheck, so the cheapest correctable failure is still reported first (D4)
- [x] 4.5 Write the comment that states why the whole suite runs and not `vitest related`, with the measured numbers — 88 files/1378 tests/~7.4s against 15 files and zero from the `graph` project. This is the single most likely thing for a future reader to "optimise" back, and the measurement is the only thing that will stop them
- [x] 4.6 Confirm a docs-only turn still exits at the ledger check and pays nothing

## 5. Subagents (D7)

- [x] 5.1 Delete `.claude/agents/engineering-senior-developer.md` and `.claude/agents/engineering-backend-architect.md`
- [x] 5.2 For each of the three kept: set `name` to the slug matching its filename, add `tools` as **plain tool names only**, add `model`, and delete `emoji` and `vibe`. Keep `color` — it is part of the surface
- [x] 5.3 Verify each `tools` list against the tool set a background subagent actually keeps, since background is the default — a list that resolves to nothing prevents launch, and a list that resolves partly is silently narrowed further
- [x] 5.4 Rewrite each `description` as a trigger: when to select it, and at least one case not to. For `code-reviewer`, name the boundary against the `code-review` skill explicitly — skill for in-session review with the diff in context, subagent for delegating a review into its own context window
- [x] 5.5 Confirm the three load: `claude` starts clean and each appears under its slug with no error in the debug log

## 6. Skills and the provenance lock (D8, D9)

- [x] 6.1 Remove the sixteen unused skill directories named in D9 from `.claude/skills/` (before section 2 — see 1.1)
- [x] 6.2 Drop their entries from `skills-lock.json`, so the lock describes what is installed rather than what once was — this is what makes the lock checkable at all
- [x] 6.3 Add an `agents` section covering the three kept subagent files with source, upstream path, and content hash, and bump `version` to 2 since the shape changed
- [x] 6.4 Record in the lock's own surroundings (or `docs/`) that it is now hand-maintained, because the skill that used to maintain it is one of the sixteen removed — and that this is only acceptable because 7.x checks it
- [x] 6.5 Note the hashes must be computed for the **rewritten** subagent files from 5.2, not the upstream originals — the check verifies what is installed, and these are now deliberately local edits. Record that divergence-from-upstream is expected here, so a future reader does not "restore" them

## 7. The duplication and provenance check (D6, D8)

- [x] 7.1 Write `scripts/check-plugin-sync.mjs` on the same shape as `scripts/check-spec-drift.mjs`: exported check function returning `{ ok, output }`, no `process.exit` inside, so it composes like the other checks
- [x] 7.2 Compare every file present in **both** `.claude/{skills,commands}` and `resources/iris-plugin/{skills,commands}` by content hash, and verify the lock's recorded hashes for `.claude/skills` and `.claude/agents` in the same pass
- [x] 7.3 Seed the allowance list with the twelve already-divergent pairs — six `openspec-*` skills, six `opsx/*` commands — each keyed to its own pair with the reason naming the version skew (`generatedBy: 1.7.0` in `.claude/`, `1.6.0` in the plugin). Twelve separate allowances, never one directory-wide exemption (D6)
- [x] 7.4 Make the check report only. It must not write to either tree — `resources/iris-plugin/` ships inside the app via `extraResources`
- [x] 7.5 Attach it to `npm run build` beside `check-three-dedupe.mjs` and `check-types-node.mjs` in `package.json`, and add a CLI entry point matching the existing `scripts/lint.mjs`/`spec-check.mjs` pattern
- [x] 7.6 Bind it in `stop.mjs` off the ledger when either `.claude/` or `resources/iris-plugin/` changed, plus the check script itself — the same trigger shape `SPEC_TRIGGERS` uses, and for the same reason: editing an allowance changes what the check reports
- [x] 7.7 Add a test beside it covering an undeclared divergence failing, a declared pair passing, and a lock hash mismatch failing
- [x] 7.8 Confirm the check does **not** become a sixth gate anywhere in wording — `CLAUDE.md`, `docs/TESTING.md` and the capability spec all say five, and this is build-attached like its two siblings
- [x] 7.9 Fix the retired vocabulary in `resources/iris-plugin/.claude-plugin/plugin.json`'s description — it ships inside the app and the spec-drift gate cannot see it, which is that gate's documented weakness showing up in practice

## 8. Honesty fixes and `/gates` (D10)

- [x] 8.1 Add `.claude/settings.local.json` to `.gitignore` — one line, and it must be there before the file is
- [x] 8.2 Add one clause to `CLAUDE.md`'s NotebookLM row marking it maintainer-local and not a repo prerequisite, so a fork knows the instruction is not addressed to it. Do not add a `.mcp.json`: the server's configuration is personal and lives outside version control
- [x] 8.3 Write `.claude/commands/gates.md` running all five gates and reporting which are red, with `allowed-tools` scoped to those five commands and an `argument-hint`
- [x] 8.4 Add `argument-hint` to the six `.claude/commands/opsx/*.md` files
- [x] 8.5 Confirm `/gates` is worth its existence as written — it must cover the full `npm run build` including `vite build` and the staged secret scan, which no editing-event binding produces (D10). If it ends up duplicating the Stop hook, drop it rather than shipping a command that repeats what already ran

## 9. Docs, living spec, gates

- [x] 9.1 Edit `openspec/specs/workflow-quality-gates/spec.md`'s **Purpose** directly — it currently scopes itself to checks "beyond the typecheck and behavioral test gates", which stops being true when the behavioral gate is bound. A delta cannot carry a Purpose change; this is the sanctioned direct edit, made as part of this change rather than silently
- [x] 9.2 Update `docs/TESTING.md`'s binding table with the test gate and its **measured** cost, and re-measure the `Stop` row's upper bound — the existing "up to 5.4s" becomes wrong the moment 4.3 lands (D4)
- [x] 9.3 Add the `claude-code-config` capability to `CLAUDE.md`'s "Where to read more" table as one row, and keep the file a router — no new detail beyond the pointer
- [x] 9.4 Document the denylist and its limits in `docs/TESTING.md` beside the gates, using the guard-against-accident wording and never "sandbox" or "containment"
- [x] 9.5 Measure the real end-of-turn worst case on this tree and record it. If it is materially worse than ~13s, say so and reconsider D4's rejected alternative rather than absorbing it silently
- [x] 9.6 Manual pass on the guard: attempt each declared operation and confirm refusal with the operation named; attempt each near-miss from 3.2 and confirm it proceeds; set `IRIS_SKIP_HOOKS=1` and confirm the guard still refuses while the scan announces it was skipped
- [x] 9.7 Manual pass on the test gate: a docs-only turn runs nothing; a turn touching one `.mjs` runs the whole suite; a deliberately broken test blocks the turn and names itself
- [x] 9.8 Run all five gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`
- [x] 9.9a `openspec validate claude-config-earns-its-place --strict` passes; all five gates green
- [x] 9.9b Archived. Delta specs synced and verified requirement-by-requirement: `claude-code-config` created (Purpose + 9 requirements), `test-harness` 9→10, `workflow-quality-gates` 11→14 with both MODIFIED replacements in place and no sibling requirement lost. `npm run spec:check` passes over the merged tree — the new capability's text reached the spec-drift gate for the first time here and cleared the registered retired terms. `openspec validate --specs --strict`: 49/49
