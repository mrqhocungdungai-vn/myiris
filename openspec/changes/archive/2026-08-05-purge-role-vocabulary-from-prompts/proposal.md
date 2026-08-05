## Why

The prompt text Iris receives still describes the role surface that was deleted
on 2026-08-04. Three lines in `electron/announcements.mjs` survived the verb
migration, and one of them contradicts the line directly above it:

```
123: "- Immediately call the verb that fits, with parameters combining …"
124: "- Do not set the agent field, let it route to whichever role is already
      active for this session."
```

Line 123 tells Gemini to choose the verb. Line 124 tells it not to choose, and to
let the request route to "whichever role is already active" — a thing that no
longer exists. It also instructs Gemini about an `agent` field that no longer
exists: a verb *is* the tool name now, seven declarations each with their own
schema, so there is no parameter to leave unset.

Lines 185 and 188 tell Gemini to "submit a follow-up task to the **SAME role**"
after reading a run's deferred decisions aloud. "The same role" has no referent,
so the instruction resolves to nothing and Gemini picks a verb by guesswork. The
failure this produces is not cosmetic: a decision the user just made inside a
shaping conversation can be routed to `execute`, which acts on it instead of
continuing to shape.

**The living spec is already right about this.** `per-verb-model-selection` says
it outright — *"no such control exists — the verb is chosen per request"* — and
`verb-tool-surface` establishes that Iris picks the verb per request. So this is
code contradicting spec, not a behavior anyone proposed.

What let it survive is that **nothing forbids it**. `verb-tool-surface` requires
that the app choose the verb per request; no requirement says the prompts must
not tell Iris otherwise. The registry is the single definition of a verb, and it
is enforced for declarations, dispatch, and run options — but prompt prose was
never bound to it. That is the gap this change closes, so a third role-era
relapse is caught by a test rather than by someone reading the file.

## What Changes

- **The three surviving lines are rewritten** to name what actually exists: Iris
  chooses the verb per request, and a follow-up carrying the user's decisions goes
  to the verb that produced them.
- **`verb-tool-surface` gains a requirement** that prompt text may not name a
  current role, an active worker, or an agent parameter. The registry is already
  the single definition of a verb; this extends that rule from the machine-read
  surfaces (declarations, dispatch, options) to the prose surface, which is the
  one that drifted.
- **`session-announcements` gains a requirement** that a completion announcement
  carrying deferred decisions names the verb the follow-up should go to, rather
  than leaving the addressee implicit.
- **A test asserts the prohibition**, so this cannot regress silently. Prompt
  prose has no typechecker and no runtime error — it simply misinforms the model,
  which is why it went unnoticed through a whole migration.

## Capabilities

### Modified Capabilities

- **`verb-tool-surface`** — one ADDED requirement binding prompt prose to the
  registry's model of a verb.
- **`session-announcements`** — one ADDED requirement fixing the addressee of a
  decisions follow-up.

## Impact

- `electron/announcements.mjs` — three instruction lines.
- One new test asserting no prompt string names a role/agent parameter.
- No `query()` options change, no new env var, no IPC change, no UI change.
- Behavioral effect is confined to what Gemini is told; nothing about dispatch,
  the registry, or the run shapes moves.
