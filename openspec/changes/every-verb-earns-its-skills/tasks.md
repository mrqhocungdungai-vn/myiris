## 0. Before touching anything

- [x] 0.1 Confirm the starting state design.md describes:
      `node --input-type=module -e "import {VERB_NAMES, resolveVerb} from './electron/verbs.mjs'; for (const n of VERB_NAMES) for (const s of [{changes:['c'],depth:'judge'},{changes:[],depth:'explain'}]) { const v=resolveVerb(n,s); console.log(n, s.depth, v.basePersona, JSON.stringify(v.skills)); }"`
      — expect `work_on_note` on `stateful` with six `iris:wiki-*`, and
      `investigate`+explain with `["iris:openspec-explore"]`.
- [x] 0.2 Confirm the dead pointer: bundled
      `resources/iris-plugin/skills/openspec-apply-change/SKILL.md` names
      `openspec-continue-change`; `.claude/skills/openspec-apply-change/SKILL.md`
      already carries the `openspec status` fallback wording instead.

## 1. Skill lists and bindings

- [x] 1.1 `electron/run-skills.mjs` — add `OPEN_NOTE_SKILLS = []` with its
      reason beside it (the note discipline lives in the persona/clause and the
      `guardOpenNoteWrites` seam; the wiki suite is corpus curation and belongs
      to `capture_learning`).
- [x] 1.2 `electron/run-skills.mjs` — `INVESTIGATION_SKILLS` becomes `[]`, with
      the reason: `openspec-explore`'s primary modes (asking, artifact
      creation) are structurally denied by the verb; the skill stays in
      `SHAPING_SKILLS` where those modes are legal.
- [x] 1.3 `electron/verbs.mjs` — `work_on_note.skills: OPEN_NOTE_SKILLS`.
      No other list changes (design.md D7).
- [x] 1.4 Flip the pinned assertions, same commit:
      `sdk-options.test.mjs:441-444` (note skills `[]`, not equal to
      capture_learning's), plus wherever `verbs.test.mjs` equates
      `work_on_note`/`investigate` lists with the old constants.

## 2. The note persona

- [x] 2.1 `resources/personas/note.md` (~150 words): live-session base —
      continuous conversation, ask via AskUserQuestion at real decision points,
      the `## Decisions needed` block — with every OpenSpec/shaping section of
      `stateful.md` absent. No skill names in the body (the persona test
      enforces this).
- [x] 2.2 `electron/verbs.mjs` — `work_on_note.basePersona: "note"`; confirm
      `buildAgentDefinition("note")` resolves with zero mechanism changes
      (`agent-definitions.mjs:58-59`).
- [x] 2.3 Flip `verbs.test.mjs:114` (`"stateful"` → `"note"`).
- [x] 2.4 `run-skills.test.mjs:48` — derive the persona set from the registry's
      `basePersona` values instead of the hard-coded
      `["stateful", "stateless"]`, so any future persona is covered by
      construction.
- [x] 2.5 Check `resources/personas/` packaging: `extraResources` ships the
      whole `resources/personas` directory — verify, no edit expected.

## 3. Cross-reference integrity

- [x] 3.1 New `electron/plugin-skills.test.mjs` (red first): scan
      `resources/iris-plugin/skills/*/SKILL.md` + `resources/personas/*.md`
      with the three patterns from design.md D4; every token resolves to a
      shipped skill directory or shipped `commands/opsx/<name>.md`. It must
      fail on `openspec-continue-change` before 3.2.
- [x] 3.2 Edit bundled `openspec-apply-change/SKILL.md` to the `.claude/`
      copy's wording (the `openspec status --change <name>` fallback). Do not
      touch `skills-lock.json` (design.md D3 says why). Run
      `npm run build`-attached `plugin-sync` to confirm the pair's divergence
      shrank and no new divergence appeared.
- [x] 3.3 Close the two audited test holes: (a) the persona-test regex that
      reduces `/iris:opsx:propose` to `opsx` and skips it silently; (b) add
      `{changes:["a-change"], depth:"judge"}` to the states
      `verbs.test.mjs:257` iterates, so `REVIEW_SKILLS` is finally checked
      against shipped directories.

## 4. Personas stop contradicting the registry

- [x] 4.1 `resources/personas/stateless.md` — make the body ask-agnostic:
      remove ":3 never asks" and ":7 the question tool is not available to
      you"; defer to the run instructions (the `STATEFULNESS_CLAUSES` in
      `role-prompt.mjs:47-68` are the authoritative per-run text).
- [x] 4.2 `stateless.md:43` — archiving instruction becomes "report ready to
      archive"; `finish` owns close-out.
- [x] 4.3 Guard test (extend the persona describe in `run-skills.test.mjs`):
      the stateless body makes no availability claim about the question tool.

## 5. The command channel (spike decides the branch)

- [x] 5.1 **Spike**: on this machine with the installed SDK, run a scripted
      one-shot `query()` that invokes `/iris:opsx:explore` and log every
      `canUseTool(toolName, input)` call. Determine: does a plugin command
      surface as a `SlashCommand` tool call that `canUseTool` sees?

      **Result (2026-08-11, four live one-shot runs against the installed SDK
      2.1.210 / bundled binary, ~$0.12 total): NO — and the question turns out
      to be the wrong one. D5's premise is refuted.**

      1. There is no `SlashCommand` tool. A model-invoked plugin command
         surfaces as a **`Skill` tool call**: `Skill {"skill":
         "iris:opsx:explore"}`. `sdk-tools.d.ts`'s `ToolInputSchemas` union
         declares no `SlashCommandInput`; the SDK's `SlashCommand` type
         (sdk.d.ts:6475) is command *metadata*, not a tool.
      2. **Commands ARE scoped by configuration, through `skills` itself.** The
         SDK transport maps `skills: [...]` to
         `allowedTools: ["Skill(<entry>)"]` (sdk.mjs, ProcessTransport
         `initialize`), and commands live in the same `Skill` namespace.
         Measured: with `skills: ["iris:wiki-lint"]` the runtime refused —
         *"The skill `iris:opsx:explore` is not available in this session. Only
         `iris:wiki-lint` is currently enabled."* With
         `skills: ["iris:opsx:explore"]` the same command ran.
      3. `canUseTool` never fired in any run. The SDK emits
         `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`: under `permissionMode:
         "bypassPermissions"` — which BOTH run shapes set
         (`po-session.mjs:313`, `run-exec.mjs:480`) — tool calls are
         auto-approved before the callback is consulted. So 5.2's gate would
         not have worked even if a `SlashCommand` tool existed.
      4. Consequence for today's lists: every entry is a skill directory name
         (`iris:openspec-apply-change`), never a command entry
         (`iris:opsx:apply`), so **no verb can invoke any `/iris:opsx:*`
         command today** — the channel is already closed, not open. Asked for
         `/iris:opsx:apply` with `IMPLEMENTATION_SKILLS` in scope, the model
         substituted `Skill{skill:"iris:openspec-apply-change"}` and reached
         the same workflow. The personas' `/iris:opsx:*` references
         (`stateless.md:23`, `stateful.md:18/20`) therefore name entries the
         run cannot use and are quietly routed around.

      Neither 5.2 nor 5.3 is the right branch: 5.2's runtime gate is
      unnecessary AND unreachable, and 5.3's "accepted limitation" would ship a
      spec statement that is false — the channel is bounded, by the very
      mechanism the requirement asks for. See 8.1.
- [x] 5.2 ~~**If yes**~~ — **not taken.** The spike says no, and the gate would
      also be unreachable under `bypassPermissions`. Nothing implemented.

      Superseded text: `run-skills.mjs` exports the command↔skill map and
      `allowedCommandsFor(skills)`; stateless `canUseTool`
      (`run-exec.mjs:586-591`) and stateful `buildCanUseTool`
      (`po-session.mjs:87-129`) gain the `SlashCommand` branch — allow an
      `/iris:opsx:*` command iff the run's resolved skills carry its workflow
      skill, deny with the verb's name, pass all other commands through. Tests
      on both shapes: execute/no-change denied `/iris:opsx:apply`;
      execute/open-change allowed; `capture_learning` denied all
      `/iris:opsx:*`; a non-opsx command untouched.
- [x] 5.3 ~~**If no**: … the channel is a declared limitation~~ — **not taken
      either.** Its fallback assumed the channel was open; it is closed, so
      declaring a limitation would ship a false statement. Decided with the
      user 2026-08-11: correct the delta's mechanism sentence to what actually
      holds, implement no runtime code, and pin the property.

      Landed instead:
      - Delta requirement: commands and skills share one invocation namespace,
        so the bound is enforced by configuration; the refusal names the scope.
      - `run-skills.mjs` module comment records the four measured runs, beside
        the module's existing measured token facts.
      - `run-skills.test.mjs` — "bound workflows through their skills, never
        through a command entry": no verb's resolved list, in any state, may
        contain an `iris:opsx:*` entry. That is the condition under which
        "reachable iff its skill is listed" stays true.
      - design.md D5 and proposal item 4 marked superseded/withdrawn in place,
        with the measurement that refuted them.

## 6. Schema accuracy audit (bounded, evidence-first — design.md D8)

- [ ] 6.1 On the machine with real usage: pull the last ~50 dispatch records
      (the dispatch "why" log) and the `skills [...]`/verb lines from
      `~/.myiris/logs/iris.log`; list observed misfills — wrong verb, thin
      required fields, wrong `depth`.

      **NOT RUN — no data on this host (2026-08-11).** `~/.myiris/` exists but
      is empty: no `logs/iris.log`, no session store. This is the
      non-building machine design.md's Context anticipated, so the audit has
      nothing to read. Deliberately left unchecked rather than closed as
      "audited, clean" — zero records is not zero misfills, and recording it as
      passed would retire an obligation nobody discharged.
- [ ] 6.2 For each observed misfill only: tighten the owning description or
      parameter in `electron/verbs.mjs`, citing the record in the commit
      message. No observed failure ⇒ no edit; close the task with the finding
      list either way.

      No edits made, since 6.1 produced no findings to justify one.

## 7. Gates and real-app verification

- [x] 7.1 All five gates (`/gates`). Green 2026-08-11 (build incl. the
      build-attached `plugin-sync`, 1883 tests, lint, secret scan, spec drift).
      One test flipped that the change did not anticipate:
      `pipeline-install.test.mjs`'s `verbsSnapshot` fixture hand-wrote the two
      personas, so `work_on_note` reported `loadable: false` — the fixture now
      derives them from the registry, like the other persona checks.
- [x] 7.2 Resolve-table check: the 0.1 command now shows `work_on_note` on
      `note` with `[]`, investigate+explain with `[]`, judge unchanged with
      `["iris:code-review","iris:diagnosing-bugs"]`. Verified.
- [ ] 7.3 Live: open a note, ask to hear it and then to remove a paragraph —
      verbatim read-back and the AskUserQuestion confirm still work with zero
      skills listed (they never came from skills).
- [ ] 7.4 Live: ask "what's left on the current change?" — investigate/explain
      answers from reads + the `openspec` CLI without a skill listing.
- [ ] 7.5 Token check: the note session's input-token listing drop (~720)
      visible in the run log / ledger.

## 8. Close out

- [x] 8.1 Delta reconciled with the spike BEFORE archiving, per this task's own
      rule that a delta must not sync a requirement the code does not meet.
      Neither the deny-branch nor the fallback form was right; the requirement
      now states the configuration-level bound that the code does meet, and
      `run-skills.test.mjs` pins the condition it depends on.
- [ ] 8.2 Archive; deltas sync into `openspec/specs/verb-tool-surface/`.
