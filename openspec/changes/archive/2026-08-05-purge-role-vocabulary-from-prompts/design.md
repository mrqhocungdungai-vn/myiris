## Context

`replace-roles-with-verb-tools` replaced PO/DEV with seven verbs and made the
registry (`electron/verbs.mjs`) the single definition of each. That refactor was
enforced everywhere a machine reads a verb: `gemini-tools.mjs` derives the
declarations, `run-dispatch.mjs` derives the park label, `run-exec.mjs` derives
the `query()` options, and `sdk-options.test.mjs` locks the option key sets.

Prompt prose is the one verb-describing surface with no such binding. It is a
string; nothing typechecks it, nothing fails at runtime when it is wrong, and the
only symptom is a model behaving on stale instructions. Three lines in
`announcements.mjs` therefore came through the migration unchanged, and one of
them now contradicts its own neighbour.

The same class of miss is already documented in this repo: `appendSystemPrompt`
sat unread for months because the SDK silently drops an undeclared option, and
the fix was not just to set it but to add a test asserting the complete option
set. This change follows that precedent — fix the strings, then bind them.

## Goals / Non-Goals

**Goals**

- The prompt text Iris receives describes only things that exist.
- A decisions follow-up has an explicit addressee.
- A future role-era relapse fails a test instead of misinforming the model.

**Non-Goals**

- Renaming code identifiers. `electron/role-prompt.mjs`, `savePoToken`,
  `poBillingStatus`, `PoQuestionBanner`, `IRIS_PO_QUESTION_TIMEOUT_MS`, and
  `SYSTEM_EVENT_PO_QUESTION` keep their names here. They are internal names, not
  statements to the model, and renaming them is a separate mechanical change with
  its own blast radius.
- Rewording prompt content beyond the role/agent claims. This is not a prompt
  quality pass.
- Touching `gemini-prompts.mjs`, which was verified clean.

## Decisions

### D1 — The prohibition lives in `verb-tool-surface`, not in `session-announcements`

The defect appeared in announcements, but its subject is the verb surface: what a
verb is, and who chooses it. `verb-tool-surface` already carries *"Iris picks the
verb, per request"* and *"One registry defines every verb"*. Putting the rule
anywhere else would leave the registry's authority split across capabilities
again — the exact shape that produced three hand-wired copies of a verb
definition before.

### D2 — The rule is about claims, not about the substring "role"

A requirement banning the word would be unenforceable and wrong: prose may
legitimately say "the shaping verb's role in the pipeline", and the code has
identifiers containing `PO`. The requirement is scoped to **claims**: prompt text
SHALL NOT tell the model that a current role or active worker exists, and SHALL
NOT instruct it about a parameter for selecting one.

The test that enforces it asserts the narrow, checkable form — no prompt string
contains an instruction to set, or not set, an agent/role parameter, and none
refers to a currently-active worker. A blunt substring ban would fail on the
first legitimate sentence and get deleted.

### D3 — A decisions follow-up names the producing verb, and the verb comes from the run

The old text said "the SAME role", relying on Gemini to remember an addressee
that the surface no longer has. The announcement is built from a finalized run,
and that run already knows its verb — `run-dispatch.mjs` records why every
dispatch happened, and the completion card already shows the verb. So the
follow-up instruction can name it concretely rather than gesturing at continuity.

This is the substantive behavior fix in the change. Everything else removes a
false statement; this one replaces a broken instruction with a working one.

### D4 — No new capability

Two ADDED requirements on existing capabilities. A "prompt vocabulary" capability
would be a folder describing a rule about other capabilities, which is how a spec
tree grows entries nobody can locate later.

## Risks / Trade-offs

- **The test can be gamed by rewording.** A prohibition on claims is judgement,
  and a sufficiently creative sentence passes the assertion while still
  misinforming the model. Accepted: the test's job is to catch the mechanical
  relapse (a copied line from the role era), not to referee prose.
- **Naming the verb in a follow-up instruction makes the prompt longer.** Accepted;
  it is one identifier, and the alternative is an instruction with no addressee.
- **`role-prompt.mjs` keeps a name that no longer matches its subject.** Deliberate,
  per Non-Goals. It is recorded here so the next reader knows it was seen and
  deferred rather than missed.

## Migration Plan

None. No stored state, no config, no persisted format changes. The next
announcement built after the change carries the corrected text; nothing needs to
be migrated or invalidated.
