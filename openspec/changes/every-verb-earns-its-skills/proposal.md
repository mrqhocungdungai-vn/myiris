## Why

The scoping thesis of this codebase — "a run sees only the skills its own work
needs; the scoping is the substance" — is right, and an audit of all seven
verbs against the sixteen shipped skills found the substance leaking in five
verified places. None of them is "a verb with no skills" (every shipped skill
is reachable by at least one verb, and `execute`/no-change's empty list is a
pinned, spec-backed decision). All of them are **fit** failures:

1. **`work_on_note` carries six skills for a different job.** Its list is the
   `wiki-*` suite — corpus curation: ingest `raw/`, lint the graph, add
   backlinks. Its job is editing the ONE note open on screen, with a
   confirm-before-remove discipline carried entirely by its ~130-word clause
   (`verbs.mjs:264-272`) and the `guardOpenNoteWrites` seam. Zero overlap. It
   also inherits the `stateful` persona, whose spine — "You decide WHAT gets
   built… You do not write production code… OpenSpec is the only spec
   surface" — is actively false for a verb whose whole job is writing to a
   note.
2. **`investigate`/explain's only skill instructs what the verb forbids.**
   `openspec-explore`'s primary modes are asking clarifying questions and
   creating OpenSpec artifacts (its SKILL.md offers to write proposals and
   tasks); the verb structurally withholds `AskUserQuestion`, `Write`, `Edit`,
   `NotebookEdit` (`verbs.mjs:415`). A loaded skill whose instructions run
   into denials produces churn, not capability.
3. **A shipped skill points at a skill that does not ship.** The bundled
   `openspec-apply-change/SKILL.md:52` tells the model to use
   `openspec-continue-change` — not a directory anywhere in the bundle. This is
   the exact defect class the scoping design exists to prevent ("a skill
   telling the model to invoke one it cannot see", `run-skills.mjs:89-91`), on
   the highest-traffic verb, invisible because no test reads skill bodies. The
   developer-side copy (`.claude/skills/...:54`) already carries the fix.
4. ~~**The command channel is not scoped at all.**~~ **Withdrawn — measured
   false (design.md D5, spike 2026-08-11).** The claim was that
   `run-exec.mjs:491` loads all six `/iris:opsx:*` commands into every run
   while only `skills` is scoped, inferred from `Options` having no command
   analogue of `skills`. Against the installed SDK, commands are invoked
   through the **`Skill` tool** and share its namespace: `skills: [...]` becomes
   `allowedTools: ["Skill(<entry>)"]`, and an unlisted command is refused by
   the runtime. There is no parallel channel. The change carries the correction
   into the spec instead of the gate it originally proposed.
5. **The personas contradict the configuration.** `stateless.md:7` states "the
   question tool is not available to you" — false for `execute`/no-change,
   which resolves `disallowedTools: []` and may ask (the runtime already
   patches the *clause*, `role-prompt.mjs:47-68`, but the persona body is
   unconditioned). `stateless.md:43` instructs archiving, which
   `IMPLEMENTATION_SKILLS` does not grant — reachable today only through the
   unscoped command channel of (4).

Separately, the user's standing goal — Gemini fills every verb's parameters
correctly from voice — currently rests on schema descriptions that have never
been checked against real dispatch records. The registry already records why
every dispatch happened; nothing reads it back.

## What Changes

- `work_on_note` gets an empty skill list (`OPEN_NOTE_SKILLS`) and its own
  persona (`resources/personas/note.md`); the wiki suite stays whole and stays
  with `capture_learning`.
- `investigate`/explain gets an empty skill list; `openspec-explore` remains in
  `SHAPING_SKILLS`, where its modes are legal.
- The bundled `openspec-apply-change` skill drops the dead pointer, matching
  the already-fixed developer copy.
- A new test reads every bundled SKILL.md and persona body and asserts every
  referenced skill/command ships — written red-first against the dead pointer.
  The two blind spots of the existing persona test are closed with it (the
  regex that swallows `/iris:opsx:*`, and the never-resolved `judge` fork).
- The spec states how workflow commands are actually bounded — one namespace
  shared with skills, enforced by configuration — replacing the runtime gate
  this change originally proposed. No runtime code changes; a test pins the
  property so the claim cannot go stale silently.
- The stateless persona stops making availability claims the registry decides,
  and stops instructing `execute` to archive (`finish` owns close-out).
- A schema-accuracy audit task: read the dispatch "why" records and the run log
  on a machine with real usage, and tighten only the descriptions/parameters
  with observed misfills. Bounded, not speculative.

## Impact

- **Affected specs:** `verb-tool-surface` (one MODIFIED requirement, one ADDED
  requirement, one ADDED scenario under the statefulness requirement).
  `stateful-verb-session` and `claude-code-config` deliberately untouched
  (design.md D6/D7).
- **Affected code:** `electron/run-skills.mjs`, `electron/verbs.mjs` (two
  `skills:` bindings, one `basePersona`), `resources/personas/note.md` (new),
  `resources/personas/stateless.md`,
  `resources/iris-plugin/skills/openspec-apply-change/SKILL.md`, tests
  (`verbs.test.mjs`, `run-skills.test.mjs`, `sdk-options.test.mjs`, one new
  body-reading test), and — behind the spike — `electron/run-exec.mjs` /
  `electron/po-session.mjs` for the `SlashCommand` gate.
- **Deliberately unchanged:** `ORDINARY_SKILLS = []` (pinned by four tests and
  the `openspec-native-pipeline` spec; decision reaffirmed with the user),
  `SHAPING_SKILLS`, `IMPLEMENTATION_SKILLS`, `CLOSEOUT_SKILLS`,
  `REVIEW_SKILLS`, the wiki suite's integrity, and the review gate.
- **Token effect:** `work_on_note` sessions drop ~720 tokens of listing; the
  explain depth drops ~120 (`run-skills.mjs`'s measured ~120/skill).
