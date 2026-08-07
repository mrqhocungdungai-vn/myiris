## Context

This change comes out of an external audit of the repo's Claude Code setup
(63/100, L3). The audit's own summary names the shape of the problem: the hook
system is among the best it had read, and the cost is being paid at two opposite
extremes — the permission layer is **entirely empty** while the loop runs with
prompting disabled, and the configuration layer is **overfull** with a community
pack installed wholesale and never pruned.

Two of the audit's specific recommendations were measured against this tree before
being adopted, and **both changed**:

| Audit recommended | Measured here | Adopted |
| --- | --- | --- |
| Adding permission rules is pointless under `--dangerously-skip-permissions` | The tool's own documentation: *"Claude Code evaluates deny and ask rules regardless of what a PreToolUse hook returns… preserves the deny-first precedence."* `bypassPermissions` skips **prompts**, and a deny rule is not a prompt | Both layers, with the hook load-bearing and rules as the earlier, more precise layer |
| Bind the test gate with `vitest related` | Full suite **7.4s** (88 files, 1378 tests). `vitest related electron/verbs.mjs` → 15 files, **zero from the `graph` project** | Whole suite, scoped by the ledger |
| `tools: Read, Grep, Bash(git diff:*)` on a subagent | The `tools` frontmatter field is a **tool-name allowlist**; a scoped pattern there resolves to no tool, and a list resolving to nothing prevents launch | Plain tool names; shell narrowing moves to `permissions` |

Three further facts were established from the tree rather than the audit, and each
changes a decision below: the four duplicated skills are byte-identical but the six
`openspec-*` skills and six `opsx/*` commands have **already drifted** on an
OpenSpec version skew (`generatedBy: 1.7.0` in `.claude/`, `1.6.0` in the shipped
plugin); **no test file in this repo can reach `scripts/`**, because vitest's `unit`
project includes `electron/**` and `src/**` only; and `resources/iris-plugin/.claude-plugin/plugin.json`
still describes the app in vocabulary the spec-drift gate has registered as retired,
which that gate cannot see because it ships outside `openspec/specs/`.

## Goals / Non-Goals

**Goals**

- The editing loop has the same guard against accident the app's worker has, for
  the same stated reason, at a layer that survives prompting being disabled.
- The behavioral suite cannot be green-by-omission at the end of a turn.
- Every subagent that exists declares what it may touch and when to pick it.
- Nothing in the configuration surface is present without being used, and nothing
  vendored is trusted without being checked.
- The already-started drift between the two configuration trees becomes visible and
  declared.

**Non-Goals**

- CI. It is the right next change and a different kind of work; bundling it here
  produces the oversized commit the audit criticised.
- A sandbox. Every guard here stops accidents, and no wording in this change will
  suggest otherwise.
- Reconciling the drifted plugin tree. The check makes the skew declared;
  regenerating content the packaged app loads is its own decision.
- Adding subagents. The audit evaluated five candidates from the same pack against
  the gaps in this repo and recommended none; the remaining gaps are mechanical
  and have concrete answers, not answers that need another persona.

## Decisions

### D1 — Two layers for the brake, because they see different things

The audit treated permission rules as dead weight under
`--dangerously-skip-permissions`. The documentation says otherwise: `bypassPermissions`
"skips permission **prompts**", and separately, *"Hook decisions don't bypass
permission rules. Claude Code evaluates deny and ask rules regardless of what a
PreToolUse hook returns… This preserves the deny-first precedence."* A deny rule
blocks; it does not prompt. So rules are live in this configuration.

They are also live *earlier* and, for one important class, more precisely. Read and
Edit deny rules apply not only to the file tools but to *"file commands Claude Code
recognizes in Bash, such as `cat`, `head`, `tail`, and `sed`"* — so
`Read(./.env)` covers the credential-into-transcript case far better than the
regex the audit proposed, which enumerates readers and misses the next one.

What a rule cannot express is a destructive verb buried in a compound command line.
That is what the hook is for, and the hook has a second property nothing else has:
*"A hook that exits with code 2 stops the tool call before permission rules are
evaluated"* — it is the outermost layer.

The denylist's contents are chosen against what is **already** covered so it does
not spend its credibility on redundancy. The tool already prompts for
`rm -rf /` and `rm -rf ~` *"as a circuit breaker against model error"*, even in
bypass mode. What is uncovered is the ordinary, plausible accident: a recursive
delete aimed at a project path, `git push --force` on the wrong branch,
`git checkout .` or `git reset --hard` over uncommitted work. Those four, plus the
credential read, are the set.

*Alternative considered:* rules only, no hook. Rejected — it leaves compound
command lines uncovered and makes the repo's stated reasoning about its own worker
false of the loop that writes it. *Alternative considered:* hook only, no rules.
Rejected — it forfeits the earlier evaluation and the `cat`/`head`/`sed`
recognition, both of which come free.

### D2 — The guard is evaluated above the bypass hatch

`IRIS_SKIP_HOOKS=1` currently short-circuits all of `pre-bash.mjs`. That hatch was
built for a specific purpose the repo wrote down: skipping a gate whose tooling is
missing or slow. Deleting uncommitted work is not slow and there is no version of
"skip it just this once" that helps.

So the denylist goes **above** `isBypassed()`. The consequence is deliberate and
worth stating plainly: `IRIS_SKIP_HOOKS=1` stops meaning "no hook ran" and starts
meaning "no *check* ran". The bypass announcement text has to change with it, or
the repo's own convention that a bypass announces itself becomes a
half-truth.

### D3 — The whole suite, not a dependency-selected subset

This reverses the audit. The measurement is the argument:

```
full suite                                  7.41s   88 files   1378 tests
vitest related electron/run-dispatch.mjs    0.38s    2 files     36 tests
vitest related electron/verbs.mjs             —     15 files   0 from `graph`
```

`related` selects by static import graph. `electron-graph.supply.test.mjs`
discovers its subjects with `readdirSync(electronDir, { recursive: true })` — it has
no declared dependency on any module it checks, by design, because that is how it
covers modules nobody remembered to add. So `related` can never select it. The
scenario where it matters is exactly the scenario it was built for: a new
main-process module lands importing a name its sibling does not export, `related`
selects the tests that import the new module (there are none yet), and the graph
test that would have caught it does not run.

At ~7.4s for the whole suite against 0.38s for a subset that structurally omits the
repo's most load-bearing test, the trade is not close. The saving is real and the
thing being traded away is the reason the test exists.

The ledger scoping stays, so the decision is *whether* the suite runs, not which
parts. A docs-only turn still pays nothing.

*Alternative considered:* `related` plus an unconditional run of the `graph`
project. Rejected — two selection mechanisms whose combined coverage has to be
reasoned about every time a test is added, to save about six seconds. The
spec now states the general rule instead: sub-scoping applies only where inputs are
statically determinable.

### D4 — The test gate runs last, and the worst case gets measured

Stop-hook ordering follows cost, cheapest first, so the fastest correctable failure
is reported first: lint (223ms) → spec-drift → typecheck (2.6s + 3.4s) → suite
(6.8s). Failures accumulate rather than short-circuit, which is the existing shape
and worth keeping — an agent handed every failure at once fixes them in one pass.

**Measured after implementing, which corrected two numbers this section
originally estimated.** Per-gate on this tree: lint 0.39s, spec-drift 0.13s, tsc
renderer 3.55s, tsc electron 2.89s, suite 7.4–8.3s. End-to-end through the hook:

| Turn touched | Before | After |
| --- | --- | --- |
| docs or specs only | 0.09s | **0.09s** (unchanged — the ledger exits first) |
| one typecheck project | ~3.6s | **11.5–12.1s** |
| both projects (worst case) | ~7.8s | **15.4s** |

Two corrections fall out of that. First, the estimate above said "near 13s"; the
real worst case is **15.4s**, and this section is left showing both so the estimate
is not quietly replaced by the measurement. Second, `docs/TESTING.md`'s documented
ceiling of "up to 5.4s" **was already stale before this change** — the real
pre-change worst case is ~7.8s, because both typecheck projects grew since 5.4s was
measured. That is a pre-existing drift this change found rather than caused, and
fixing the figure is part of it.

The suite roughly doubles the worst case. That is a real change to the feel of the
loop, and D4's rejected alternative below does **not** remedy it: skipping the
suite when typecheck already failed leaves the all-green path — which is the 15.4s
path — untouched. Recorded as an open question for the developer rather than
absorbed silently, since the trade is theirs to accept.

*Alternative considered:* skip the suite when typecheck already failed. Rejected for
now — it saves time only on turns that are already going to be corrected and
re-checked, and it costs the property that one Stop reports everything wrong.

### D5 — `scripts/` enters the test runner, because this change puts decisions there

A predicate that decides whether a destructive command runs is the last thing that
should be verified by reading it. The interesting cases are the ones the author did
not imagine — `rm -fr`, flag clusters, a destructive segment after `&&`, a path that
merely contains `.env`.

There is no test file in this repo that can reach `scripts/`. Adding
`scripts/**/*.test.mjs` to vitest's `unit` project is a two-line change and ships
nothing: `build.files` lists `dist/**` and `electron/**` and never `scripts/`. Note
the asymmetry that makes this safe — `electron/**` is shipped-by-default and needs
an explicit `!electron/**/*.test.mjs` exclusion, while `scripts/` is excluded by
simply not being listed.

This also removes an inconsistency the lint gate already documented: lint covers
`src`, `electron`, **and `scripts`**, described in its own requirement as "the same
source surface the other gates cover between them" — while the test runner covered
two of the three.

*Alternative considered:* put the predicate in `electron/` to reach existing test
coverage. Rejected — it is not main-process code, it would be shipped inside the
app for no reason, and `electron/`'s own structure spec is about the app's runtime.

### D6 — The duplication check is build-attached, and reports rather than reconciles

Two questions, answered separately.

**Where it binds.** Not as a sixth gate. `check-three-dedupe.mjs` and
`check-types-node.mjs` are already attached to `npm run build` and are not counted
among the five; this is the same kind of check and takes the same place. "Five
gates" appears in `CLAUDE.md`, `docs/TESTING.md` and the capability spec, and a
sixth would make all three wrong for a hash comparison. It is *additionally* bound
in the Stop hook off the ledger when either tree changed, which is where the scope
rule puts it and costs a few lines given the ledger already exists.

**What it does about the drift it will immediately find.** Twelve pairs already
differ. The tempting move — regenerate the plugin tree from OpenSpec 1.7.0 so
everything matches — is wrong to fold in here: `resources/iris-plugin/` is shipped
via `extraResources` and loaded by the packaged app, so regenerating it changes what
the app runs, inside a change about developer configuration. So the twelve are
recorded as declared allowances naming the version skew, and reconciling them is a
follow-up made deliberately.

The allowance shape is copied from `check-spec-drift.mjs`: keyed to the specific
pair, carrying a stated reason, never a directory-wide exemption. A blanket
exemption for `openspec-*` would silently cover a *content* divergence introduced
later for an entirely different reason.

One finding this check does not cover, fixed here as a one-line edit because it is
adjacent and small: `plugin.json`'s description carries retired vocabulary. The
spec-drift gate reads `openspec/specs/` only, and this file ships inside the app —
a documented weakness of that gate showing up in practice.

### D7 — Three subagents, each declaring a narrowed surface

Deleted: `engineering-senior-developer.md` (Laravel/Livewire/FluxUI, mentioned 20+
times, in an Electron + React repo) and `engineering-backend-architect.md`
(microservices, cloud, database architecture, for a desktop app with no backend).
These are not inert. The archive records *"Honest caveat (Backend Architect
review)"* on a change about Electron process-group kills — a self-described
microservices specialist reviewing process supervision. It answered; the expertise
it answered from was the wrong one, and it read as competence.

Kept, each gaining `tools`, `model`, a slug `name` matching its filename, a
trigger-shaped `description`, and losing the `emoji`/`vibe` fields that are not part
of the frontmatter surface:

| Definition | Why it stays | Declared surface |
| --- | --- | --- |
| `desktop-app-engineer` | Electron, IPC contracts, context isolation, signing, notarization — the actual stack, 204 lines of it | Read-mostly plus shell; the model choice reflects that it reviews rather than implements |
| `software-architect` | Trade-off framing with nothing stack-specific to be wrong about | Read-only; no editing surface for a design conversation |
| `code-reviewer` | Kept alongside the `code-review` skill, with the overlap resolved in the description | Read-only plus shell for diffs |

`tools` is written as plain names. The audit's `Bash(git diff:*)` form would have
been dropped or, if it were the only entry resolving to nothing, prevented the
subagent from launching. Shell narrowing, if wanted, is a permission rule — which
this change is adding a `deny` block to anyway.

On the `code-reviewer`-versus-`code-review`-skill overlap the audit says pick one:
both are kept, because they serve different situations, and the description now says
which. The skill is the in-session review with the diff in context; the subagent is
for delegating a review into its own context window when the main conversation
should not carry it. That is a real distinction, and stating it costs less than
removing a working tool.

### D8 — The provenance lock covers subagents and describes the present

`skills-lock.json` records source, upstream path, and hash per skill — genuinely
unusual, and the reason pruning is safe rather than risky. Subagents from the same
kind of pack have no such record; today they match upstream byte-for-byte, which is
luck.

Three consequences follow:

1. **The lock gains subagents**, and its `version` is bumped because its shape
   changes.
2. **Entries for removed skills are dropped.** A lock that lists sixteen skills that
   are not installed is a historical record, and cannot be *checked* — which is the
   point of adding a check. The way back is `git` plus the recorded source and
   path, both of which survive in history.
3. **A check verifies installed files against the lock**, folded into the same
   script as D6's duplication check. Both answer "is this vendored file still what
   it claims to be", against two different references.

Worth naming: the skill that maintains this file, `setup-matt-pocock-skills`, is on
the removal list, so the lock becomes hand-maintained. That is acceptable **only**
because the check exists — a hand-maintained lock with nothing verifying it would be
worse than no lock, since it would read as a guarantee.

### D8a — `computedHash` never hashed the installed file (found while implementing)

Implementing D8's check surfaced something the audit praised and nobody had tested.
`skills-lock.json`'s `computedHash` matches **none** of the files it appears to
describe. Verified three ways: the working-tree files are byte-identical to what was
committed at `8a8cc6c`, so nothing was edited after install; no plain, normalized,
body-only, or whole-directory digest of the local file reproduces the recorded
value; and the committed blob does not either.

The field records the hash of the **upstream source** at install time. That is
provenance — it says where the file came from — and it is genuinely useful, which is
why the audit was right to call it unusual. But it is **not** an integrity check,
cannot be verified without refetching upstream, and the name `computedHash` implied
the opposite. Nothing noticed for the same reason the repo already knows well: no
check read it.

So `version` becomes 2 and the field splits, rather than being redefined:

- **`upstreamHash`** — the old value, unchanged, renamed to say what it is.
- **`installedHash`** — sha256 of the file actually present. This is what the check
  verifies, and it is what makes a local edit to a vendored skill detectable at all.

The lock also gains a `_readme` array, because JSON cannot carry comments and every
one of these distinctions is exactly the kind that gets lost. `supportingFiles` are
listed but deliberately **not** hashed — only `SKILL.md` is covered, stated as a
limitation rather than left implied.

For the three subagents, `upstreamHash` is absent and `locallyEdited: true` is set:
their frontmatter was rewritten on purpose in D7, so divergence from the pack is the
intended state and a future reader must not "restore" them.

*Alternative considered:* redefine `computedHash` as the installed file's hash.
Rejected — it would destroy the provenance that makes reinstalling and diffing
against upstream possible, to save one field.

### D9 — Sixteen skills out, twelve in

Kept: the six `openspec-*`, `grilling`, `grill-me`, `code-review`, `tdd`,
`diagnosing-bugs`, `implement`.

Removed: `ask-matt`, `grill-with-docs`, `teach`, `wayfinder`, `to-spec`,
`to-tickets`, `triage`, `research`, `prototype`, `codebase-design`,
`domain-modeling`, `handoff`, `improve-codebase-architecture`,
`resolving-merge-conflicts`, `setup-matt-pocock-skills`, `writing-great-skills`.

The keep list is what the work here actually invokes; the cost of the rest is a name
and a description in context every session, forever, for a capability nobody calls.
`codebase-design` and `domain-modeling` are the two closest calls — both are decent
documents — but "decent and unused" is the exact category this decision is about,
and the lock makes the removal a one-step reversal.

### D10 — `/gates` exists even though four gates are now automatic

The Stop hook covers lint, spec-drift, typecheck, and now the suite. `/gates` is
still worth having, because it is not the same check: it runs the **full**
`npm run build` including `vite build` and the build-attached checks, plus the
staged secret scan — the pre-commit picture, which no editing-event binding
produces. Today that sequence exists only as prose in `CLAUDE.md` and five commands
typed by hand.

The six `opsx/*` commands also gain `argument-hint`, which is a
two-minute correctness fix on files that already exist.

## Risks / Trade-offs

- **The turn gets slower.** Up to ~13s worst case against 5.4s. Mitigated by the
  ledger (docs-only turns pay nothing) and by D4's requirement to measure and
  publish the real number rather than accept an estimate. If it lands materially
  worse, the fallback is D4's rejected alternative — skip the suite when typecheck
  already failed — reconsidered on evidence.
- **The denylist will one day refuse something intended.** That is the cost of a
  guard against accident, and the reason the refusal text must state that the
  developer can run it directly. The failure mode to avoid is not a false positive;
  it is a false positive so unhelpful that the guard gets deleted.
- **Twelve declared allowances on day one** is a check that starts yellow rather
  than green, which is against this repo's instinct — the lint gate's own spec
  requires starting at zero findings. The difference is that these allowances each
  name a real, understood cause, whereas a numeric threshold names nothing. The
  follow-up that regenerates the plugin tree removes them.
- **Removing sixteen skills will occasionally be wrong.** Reinstalling is one step
  and the lock holds the address. This is the cheapest reversible decision here.
- **A hand-maintained lock can be edited to match a file instead of the reverse.**
  Nothing prevents someone updating a hash to silence the check. Recorded rather
  than solved: the same is true of the spec-drift gate's allowances, and the answer
  in both cases is that the edit is visible in review.

## Open Questions

- **Is 15.4s an acceptable worst-case turn?** Measured, not estimated (D4). It
  applies only to a turn touching both `src/` and `electron/`; one project is
  11.5–12.1s and a docs turn is still 0.09s. The suite is 8.28s of it and there is
  no sub-scoping available that does not reintroduce D3's hole. The genuine options
  are to accept it, or to bind the suite to something rarer than every turn — a
  pre-commit point rather than end-of-turn — which trades away the property that a
  turn cannot end with a red suite. Left for the developer to decide against the
  measured numbers rather than settled here.
- **Should the denylist refuse `git commit --amend` and `git rebase` on pushed
  history?** Both rewrite history and both are routine in this repo's single-developer
  loop. Left out of the initial set because the false-positive rate looks high enough
  to threaten the guard's credibility. Revisit after the first month of the set
  above.
- **Does the `graph` project need to run on turns that touch no `electron/` file?**
  D3 runs the whole suite, so it does — a src-only turn pays for the import-graph
  tests. Cheap enough today at ~7.4s total. If the suite grows past a threshold
  worth naming, this is the first place to look, and the answer is a declared
  project-level scope, not `related`.
- **Is `software-architect` earning its place?** The audit's verdict was "not wrong,
  but brings nothing the base model lacks". It is kept and narrowed here rather than
  removed, which defers rather than answers the question. Worth revisiting once the
  three narrowed definitions have been used a few times.
