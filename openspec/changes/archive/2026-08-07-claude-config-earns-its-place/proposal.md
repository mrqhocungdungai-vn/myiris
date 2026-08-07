## Why

An external audit of this repo's Claude Code setup scored the hook system 5/5 and
the permission layer 1/5, and the gap between those two numbers is one sentence
this repo already wrote about itself. `CLAUDE.md` records, about the app's own
headless worker: *"`bypassPermissions` is the intentional default for the headless
worker. The `PreToolUse` denylist is a guard against accidents, not a sandbox."*
That is an exactly correct description of the editing loop that **builds** the
app, which runs under `--dangerously-skip-permissions` on the developer's own
machine. The mechanism was designed, reasoned about, written down — and applied
only to the worker. The loop that writes the worker has no denylist at all:
`pre-bash.mjs` recognises one pattern, `git commit`, and passes everything else.

The second gap is the same shape. `workflow-quality-gates` opens with *"A check
that exists but is never triggered protects nothing; this capability is about the
binding, not the checking."* Four of the five gates are bound to editing events.
The fifth — `npm test`, **86 files and 1344 tests** at the time this was written — is bound to nothing. It runs
when the developer remembers to type it. A turn can end with lint green, typecheck
green, spec-drift green, and the behavioral suite red, and nothing says so. The
capability's own opening sentence is currently true of the largest check it does
not mention.

Both of those are the repo failing to apply its own stated rule to itself. The
third problem is the opposite failure — configuration that was never chosen at
all. Twenty-eight skills are installed from a community pack; about twelve are
used, and every one of the other sixteen puts a name and a description into
context in every session. Five subagents exist and **not one declares `tools` or
`model`**, so each inherits the whole tool surface and the default model, which
forfeits the only reason a subagent exists. Two of the five describe stacks this
repo does not have: `engineering-senior-developer.md` says *"Masters
Laravel/Livewire/FluxUI"* and mentions Laravel over twenty times, and
`engineering-backend-architect.md` is a microservices-and-cloud architect for a
desktop app with no backend. Both have reviewed real architecture decisions here;
the archive records *"Honest caveat (Backend Architect review)"* against a change
about Electron process-group kills.

And one duplication the repo has already named as a defect class. Four skills are
**byte-for-byte identical** between `.claude/skills/` and
`resources/iris-plugin/skills/`, while all six `openspec-*` skills and all six
`opsx/*` commands have **already drifted** — the `.claude/` copies were generated
by OpenSpec 1.7.0 and the shipped plugin copies by 1.6.0. Nothing checks this.
`CLAUDE.md` names the failure mode precisely, about verbs: *"A verb is defined in
exactly one place… three hand-wired copies is the mechanism that produced the
silently-dropped `appendSystemPrompt`."* The principle was never extended to the
configuration surface, and the surface has already started drifting.

## What Changes

**The editing loop gets the brake the worker has, in two layers.** A
`permissions.deny` list in `.claude/settings.json`, and a denylist in
`pre-bash.mjs` placed **above** the `IRIS_SKIP_HOOKS` bypass — that bypass exists
to skip a slow secret scan, not to disarm a guard against deleting work. The two
layers are not redundant. Deny rules are declarative and are evaluated **before**
the hook and independently of permission mode, and `Read`/`Edit` deny rules also
cover the file-reading commands Claude Code recognises inside Bash (`cat`, `head`,
`tail`, `sed`), which no regex in a hook can match as reliably. The hook covers
what a rule pattern cannot express: a destructive verb anywhere inside a compound
command line. Neither layer is described as containment — the same wording
discipline `CLAUDE.md` already applies to the worker's denylist applies here.

**The behavioral gate gets bound, at the end of the turn, off the existing
ledger.** The full suite, not a dependency-scoped subset. This is a measured
decision and it reverses the audit's own recommendation: `vitest related` runs in
384ms against the full suite's ~7.4s, but it selects tests by static import graph,
and the `graph` project's tests discover the modules they check with
`readdirSync` at runtime. Measured on this tree, `vitest related electron/verbs.mjs`
selects 15 test files and **zero** from the `graph` project — so the cheap option
structurally skips the one test that exists to catch a newly added module
importing a name its sibling does not export. Scoping stays where the spec already
puts it: off the per-session ledger, so a turn that touched no code file pays
nothing.

**`scripts/` becomes a place tests can live**, because a denylist that decides
whether a destructive command runs is exactly the kind of logic that must not be
asserted by reading it. No test file in this repo can reach `scripts/` today —
vitest's `unit` project includes `electron/**` and `src/**` only. Adding
`scripts/**/*.test.mjs` costs nothing at packaging time: `build.files` does not
ship `scripts/`.

**Five subagents become three, each declaring what it may touch.** The two
off-stack definitions are deleted. The three that remain — desktop-app-engineer,
software-architect, code-reviewer — each get `tools`, `model`, a `name` that is a
slug matching its filename, and a `description` rewritten to answer *when to
select me*, including when not to. The dead `emoji` and `vibe` fields, which are
not part of the subagent frontmatter surface, are removed. `tools` is written as a
**plain tool-name allowlist**, which is what the field accepts; the audit's
suggested `Bash(git diff:*)` form belongs in `permissions`, not here, and would
have resolved to nothing.

**Sixteen unused skills are removed, and the provenance lock is extended to cover
subagents.** `skills-lock.json` already records source and hash for every
vendored skill — a genuinely unusual thing for a repo to do, and the reason
removing them carries no risk. Subagents vendored from the same kind of external
pack have no such record, so today's byte-for-byte match with upstream is luck
rather than mechanism. The lock becomes the provenance record for every vendored
configuration file present, and a check verifies the files match it.

**A drift check covers the files duplicated between `.claude/` and
`resources/iris-plugin/`**, with the same allowance-plus-reason shape the
spec-drift gate already uses. It joins `npm run build` alongside
`check-three-dedupe.mjs` and `check-types-node.mjs` — build-attached checks, not a
sixth gate, so the five-gate vocabulary in `CLAUDE.md` and `docs/TESTING.md` stays
true. The twelve already-drifted OpenSpec-generated pairs are recorded as declared
allowances naming the version skew, **not** silently reconciled: regenerating the
plugin tree changes what ships inside the packaged app, and that is its own
decision to make deliberately.

**Two honesty fixes and one convenience.** `CLAUDE.md`'s NotebookLM row points at
an MCP server the repo does not provide, in a public MIT repo that invites forks —
it gains one clause marking it maintainer-local rather than a prerequisite.
`.claude/settings.local.json` is added to `.gitignore` before it exists, because
the day it exists is the day it gets committed. And a `/gates` command runs all
five gates and reports which are red, replacing five commands typed by hand from
a prose description.

Explicitly **not** in this change:

- *CI.* The audit is right that a workflow running the five gates is the one
  L3→L4 gap worth closing for a public repo whose quality currently depends on
  one Mac mini. It is also a different kind of work — a new execution
  environment, `gitleaks` provisioning, an arch-specific `npm ci` — and bundling
  it here would produce exactly the 2000-line commit the audit criticised. It
  follows next.
- *Deleting either the `code-reviewer` subagent or the `code-review` skill.* They
  overlap and the audit says pick one. Both are kept, with the subagent's
  description narrowed to the case the skill does not serve — delegating a review
  into its own context window — so the overlap is resolved by what each
  declares rather than by removing a working tool.
- *Reconciling the drifted plugin tree.* The check makes the skew visible and
  declared. Regenerating content that ships inside the app is a separate change.
- *A real git hook (husky/lefthook).* `pre-bash.mjs` already records this as a
  known gap and deliberately out of scope; one developer committing through
  Claude Code does not change that.
- *Turning the denylist into a sandbox.* It stops accidents. Anything stronger is
  OS-level, and this change will not claim otherwise anywhere in its wording.

## Capabilities

### New Capabilities

- `claude-code-config`: the configuration surface that governs how Claude Code
  operates **on this repo** — what a subagent must declare to exist, that
  installed configuration must be configuration in use, that anything vendored
  from outside carries a provenance record which is checked rather than trusted,
  and that a pointer to a tool the repo does not provide says so. This is
  developer-loop configuration, adjacent to `workflow-quality-gates` and
  `test-harness` and deliberately separate from both: those two govern what is
  checked and how it runs, this governs what the agent working on the repo is
  handed.

### Modified Capabilities

- `workflow-quality-gates`: the behavioral gate joins the bound chain at the end
  of the unit of work, scoped off the ledger, running the whole suite for a stated
  reason. A destructive-command guard is added as a distinct kind of bound check —
  the first one here that is not a code-quality check — and is required to sit
  above the bypass hatch that the quality gates sit below. The duplicated-config
  drift check is declared as build-attached, like its two existing siblings.
- `test-harness`: `scripts/` enters the test runner's reach, so gate logic is
  covered by tests on the same terms as the code it guards.

## Impact

- `.claude/settings.json` — a `permissions.deny` list; the three hook bindings are
  unchanged.
- `scripts/gates.mjs` — the denylist predicate and a `runTests()` definition, each
  defined once here and called by both the hook and a CLI entry point, per the
  capability's existing one-definition-two-callers requirement.
- `scripts/hooks/pre-bash.mjs` — the denylist check, above `isBypassed()`.
- `scripts/hooks/stop.mjs` — the test gate, scoped off the ledger, and the
  duplicated-config check when either tree changed.
- `scripts/check-plugin-sync.mjs` (new) + `package.json`'s `build` script — the
  drift check and its allowance list.
- `vitest.config.mjs` — `scripts/**/*.test.mjs` in the `unit` project; plus
  `scripts/gates.forbidden.test.mjs` (new).
- `.claude/agents/` — two files deleted, three rewritten frontmatter-only.
- `.claude/skills/` — sixteen directories removed.
- `skills-lock.json` — the sixteen removed entries dropped, subagents added, and
  a version bump, since the file's shape changes.
- `.claude/commands/gates.md` (new); `argument-hint` added to the six `opsx/*`
  commands.
- `CLAUDE.md` — the NotebookLM row's one clause, and the router pointers for the
  new capability. `docs/TESTING.md` — the binding table gains the test gate with
  its measured cost.
- `.gitignore` — one line.
- No change to `src/`, `electron/`, the verb registry, or anything the packaged
  app runs. `resources/iris-plugin/` is read by the new check and not written by
  it, with one exception: its `plugin.json` description carries retired
  vocabulary that the spec-drift gate cannot see because it ships outside
  `openspec/specs/`.
