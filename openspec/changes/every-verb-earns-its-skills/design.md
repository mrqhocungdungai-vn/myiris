## Context

Scoped and designed on a non-building machine; each constraint below was
verified by executing the registry, reading the installed SDK's type
declarations, or reading the named line. Facts are stated with their source so
the implementer never has to re-derive them.

Verified inventory (2026-08-11): 16 shipped skills before the canvas change
landed its 17th (`excalidraw-drawing`); all reachable by at least one verb; no
dead weight. The problem is fit, not coverage.

## Decisions

### D1 — `work_on_note`: own persona, not a skill, not clause-only

Three options existed for where its discipline lives:

- **A skill** — rejected: confirm-before-remove must not be something the model
  *optionally invokes*; it belongs in always-loaded prompt text, and it is
  already backstopped structurally by `guardOpenNoteWrites` (the
  `confirmWrite` seam, `po-session.mjs:121-126`).
- **Clause on the `stateful` persona (today's state)** — rejected: the clause
  is right but the persona under it asserts "You decide WHAT gets built… You
  do **not** write production code… OpenSpec is the only spec surface"
  (`stateful.md:11-15`) — wrong for this verb, and worth ~700 tokens of
  OpenSpec workflow instruction it can't use.
- **A third persona, `resources/personas/note.md`** — chosen. ~150 words: the
  live-session/ask-by-voice/decisions-block content of `stateful.md` minus
  every OpenSpec and shaping section. Zero new mechanism:
  `buildAgentDefinition(base)` resolves any base name
  (`agent-definitions.mjs:58-59`), and `basePersona` is already a per-verb
  registry field.

Skills: `OPEN_NOTE_SKILLS = []`, a named list with its reason beside it, per
the module's own convention. The wiki suite stays whole and bound to
`capture_learning` only — the suite-integrity test (`run-skills.test.mjs:24-27`)
keeps its meaning unchanged.

### D2 — `investigate`/explain: empty, not re-stocked

`openspec-explore`'s own SKILL.md offers interactive exploration ("Ask
clarifying questions that emerge from what they said"), artifact creation ("You
MAY create OpenSpec artifacts… if the user asks"), and proposal hand-off — all
structurally denied by `disallowedTools: ["AskUserQuestion","Write","Edit",
"NotebookEdit"]` (`verbs.mjs:415`). No shipped skill fits a read-and-answer
one-shot; the clause plus ordinary reads plus the `openspec` CLI (Bash is
allowed on this verb) already cover status questions. Do not keep a skill so
the list is non-empty — an empty list is this repo's established way of saying
"the prompt carries it" (`ORDINARY_SKILLS`).

`REVIEW_SKILLS` (judge depth) is untouched: `code-review` and
`diagnosing-bugs` are report-shaped and fit.

### D3 — The dead pointer is fixed toward the already-fixed copy

Bundled `openspec-apply-change/SKILL.md:52` says "suggest using
`openspec-continue-change`" — not shipped anywhere. The developer copy
`.claude/skills/openspec-apply-change/SKILL.md:54` already reads "(if it is
not installed, run `openspec status --change <name>` …)". Edit the bundled
line to match the `.claude/` line. Legality: this pair is already covered by a
version-skew allowance (`scripts/check-plugin-sync.mjs:54-62`), and the edit
*shrinks* the divergence. `skills-lock.json` is untouched — it hashes the
`.claude/` copies only (`check-plugin-sync.mjs:162-173`), and that copy does
not change.

### D4 — The body-reading test, and the two holes it also closes

New test (own file, `electron/plugin-skills.test.mjs`, keeping
`run-skills.test.mjs` about lists): scan every
`resources/iris-plugin/skills/*/SKILL.md` and `resources/personas/*.md`;
tokens matching

- `/\bopenspec-[a-z]+(?:-[a-z]+)+\b/` → must be a shipped skill directory
  (the two-segment hyphen requirement naturally excludes CLI invocations like
  `openspec status`),
- `/iris:[a-z0-9-]+/` → shipped skill,
- `/\/iris:opsx:[a-z]+/` → shipped `commands/opsx/<name>.md`.

Written red-first: `openspec-continue-change` fails it today. While in there,
close the two audited holes in the existing tests: the persona test's capture
group `[a-z0-9-]+` swallows `/iris:opsx:propose` down to `opsx` and silently
skips it (`run-skills.test.mjs:42-43`), and no test ever resolves the `judge`
fork, so `REVIEW_SKILLS` has never been checked against disk
(`verbs.test.mjs:257` iterates states without `depth`) — iterate
`{depth: "judge"}` too.

### D5 — Commands: nothing to build, because configuration already does it

**Superseded by the spike (task 5.1, 2026-08-11). The reasoning below was
sound and its premise was wrong; it is kept because the correction only makes
sense against it.**

What the spike measured, in four live one-shot runs against the installed SDK
(2.1.210) rather than off the type declarations:

- There is no `SlashCommand` tool. A model-invoked plugin command surfaces as a
  **`Skill` tool call** — `Skill {"skill": "iris:opsx:explore"}`.
  `sdk-tools.d.ts`'s `ToolInputSchemas` union declares no `SlashCommandInput`;
  the `SlashCommand` type at sdk.d.ts:6475 is command *metadata*, not a tool.
- **`skills` scopes commands already.** The SDK's transport maps
  `skills: [...]` onto `allowedTools: ["Skill(<entry>)"]` (sdk.mjs,
  `ProcessTransport.initialize`), and commands share that namespace. With
  `skills: ["iris:wiki-lint"]` the runtime refused: *"The skill
  `iris:opsx:explore` is not available in this session. Only `iris:wiki-lint`
  is currently enabled."* With `skills: ["iris:opsx:explore"]` the same command
  ran. So the read below — "Plugin commands cannot be scoped by configuration"
  — is false: it was inferred from the absence of a *second* option named for
  commands, when the existing one covers both.
- `canUseTool` never fired at all. The SDK warns
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`: under `permissionMode:
  "bypassPermissions"`, which both run shapes set (`po-session.mjs:313`,
  `run-exec.mjs:480`), tool calls are auto-approved before the callback is
  consulted. The gate proposed below would have been unreachable as well as
  unnecessary.

So the premise of proposal item 4 is wrong in the reassuring direction: the
channel was never open. Today's lists name skill directories
(`iris:openspec-apply-change`), never command entries (`iris:opsx:apply`), so
**no verb can invoke any `/iris:opsx:*` command**. The requirement is met by
configuration; the delta records the mechanism that actually holds, and no
runtime code changes. What remains true and unfixed is cosmetic: the personas
still write `/iris:opsx:apply`, an entry no run carries, and the model quietly
substitutes the equivalent skill — noted, not chased here.

The superseded reasoning follows.

#### (superseded) Gate at the tool call, because configuration cannot

Verified against the installed SDK (`sdk.d.ts`): `SdkPluginConfig` is exactly
`{type, path, skipMcpDiscovery}` (:4081-4093); `Options` has no command
analogue of `skills`; `Query` has no command setter. **Plugin commands cannot
be scoped by configuration.** But command *execution* is a tool call
(`SlashCommand`), and both run shapes already route tool permission through
`canUseTool` (stateless: `run-exec.mjs:586-591`; stateful:
`po-session.mjs:87-129`).

Plan: `run-skills.mjs` exports the command↔skill map
(`/iris:opsx:apply` ↔ `iris:openspec-apply-change`, likewise archive, propose,
update, sync, explore) and `allowedCommandsFor(skills)`. Both shapes'
`canUseTool` gain a `SlashCommand` branch: an `/iris:opsx:*` command is allowed
iff the run's resolved skill list carries its workflow skill; the deny message
names the verb. Verbs with no workflow skills (`execute`/no-change,
`capture_learning`, `work_on_note`, `investigate`/explain) get `/iris:opsx:*`
denied outright. Non-`/iris:opsx:*` commands pass through untouched.

**Spike first, and it decides the branch.** Whether a model-invoked plugin
command surfaces through `canUseTool` as a `SlashCommand` tool call under the
*installed* SDK has not been verified — only that configuration cannot scope
it. If the spike shows it does not surface: do **not** restructure into
per-verb plugins (that multiplies the bundled tree and breaks the one-bundle
attribution story the config discipline protects). Instead the spec delta takes
its fallback form: the command channel is declared an accepted limitation, in
the same register as `run-skills.mjs:23-25`'s "a context filter, not a
sandbox".

### D6 — Personas become ask-agnostic instead of conditioned

`stateless.md` states an availability fact the registry owns. Two edits:

- :3/:7 ("never asks" / "the question tool is not available to you") → the
  body defers: run instructions state whether the question tool is present on
  this run; when absent, work autonomously. The authoritative per-run text
  already exists and survives the persona replacement — the three
  `STATEFULNESS_CLAUSES` selected off the run's *effective* `disallowedTools`
  (`role-prompt.mjs:47-68`).
- :43 (archive when done) → report that every task is checked and the change is
  ready to archive; close-out is `finish`'s job (`CLOSEOUT_SKILLS` owns
  `openspec-archive-change`). This also closes the only route by which
  `execute` could archive: the unscoped command channel of D5.

Guard test: extend the persona checks to assert the stateless body makes no
claim about the question tool's availability (regex over the source, same seam
`run-skills.test.mjs:40-46` uses). This enforces at the persona surface what
`verb-tool-surface` already requires of prompts ("a verb given the tool but
told not to ask… same defect", spec:101).

`work_on_note`'s persona swap flips three pinned tests, all in one commit:
`verbs.test.mjs:114` (`basePersona === "stateful"` → `"note"`),
`sdk-options.test.mjs:441-444` (its `skills` becomes `[]`, no longer equal to
`capture_learning`'s), and `run-skills.test.mjs:48`'s hard-coded
`["stateful", "stateless"]` persona set → derived from the registry's
`basePersona` values, so a fourth persona cannot dodge the check.

### D7 — What is deliberately not touched

- `ORDINARY_SKILLS = []`: pinned by `verbs.test.mjs:81`,
  `sdk-options.test.mjs:204/:225`, `run-exec.test.mjs:679`, and required by the
  `openspec-native-pipeline` spec. Reaffirmed with the user 2026-08-11: the
  no-change fork exists to do a note-sized request without ceremony, and every
  shipped skill is process, not domain. Domain skills join a verb when a
  domain needs one (the canvas verb's `excalidraw-drawing` is the pattern).
- `stateful-verb-session`: no delta — its "one skill surface" requirement
  covers the shared shaping session; `work_on_note` has its own per-note
  session (`noteSessionKey`, `verbs.mjs:232-240`).
- `claude-code-config`: no delta — it governs `.claude/` only, and the
  `.claude/` copy of the apply skill is already correct.

### D8 — Schema accuracy is audited, not guessed

This machine has no runtime logs. The change carries a bounded audit task, not
speculative rewrites: on the implementing machine, read the dispatch records
(the `verb-tool-surface` requirement "Every dispatch records why it happened"
exists precisely for this) and `~/.myiris/logs/iris.log`, and list observed
misfills — wrong verb for the utterance, required fields left thin, `depth`
mis-chosen. Only observed failures earn a description/schema edit; each edit
cites the record it fixes. Stopping criterion: the most recent N dispatches
(pick N ≈ 50 or all-time if fewer) reviewed once, findings filed, edits made,
done — no standing obligation.

## Risks

1. **The SlashCommand spike fails** → the command gate does not land, and the
   spec's fallback requirement (declared limitation) is what syncs. Everything
   else in this change is independent of the spike; tasks are ordered so the
   spike cannot block them.
2. **Persona split re-drifts** — the "Decisions needed" block now lives in
   three persona files. Mitigation: `note.md` stays minimal; the persona-set
   test derives from the registry, so adding personas without tests is the
   thing that fails.
3. **Rewriting `work_on_note`'s skill surface while its sessions are per-note
   and resident** — a live per-note session opened before the change keeps its
   old skills until it ends (skills are fixed at open; there is no
   setPoSessionSkills). Accepted: residency already ends on app quit, and the
   stale surface is strictly larger, never smaller, than the new one.
