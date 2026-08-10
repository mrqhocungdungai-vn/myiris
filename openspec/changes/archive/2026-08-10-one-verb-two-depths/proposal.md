## Why

Counting every verb call ever logged:

| verb | calls |
| --- | --- |
| `execute` | 18 |
| `shape_on_canvas` | 15 |
| `investigate` | 4 |
| `shape_requirements` | 3 |
| `capture_learning` | 2 |
| `finish` | 1 |
| `work_on_note` | **0** |
| `review` | **0** |

`review` is not dead weight — it is the most expensive verb in the registry: the
STRONGEST model with the review skills, against `investigate`'s FAST model with
investigation skills. It has never run once.

Their descriptions overlap. "is that done" belongs to `investigate`; "is this
any good" to `review`. A user cannot tell those apart, and neither can the model
choosing between them. **A routing contest between two sentences has no error
path**: the model always picks something, so a user asking for a judgement
silently received the cheap verb with the wrong skills, and the configuration
they were paying for never applied. Nothing ever reported a failure, because by
the app's own reckoning nothing failed.

Deleting `review` would have been exactly backwards — it is capability that is
configured, paid for, and never delivered.

## What Changes

**`investigate` becomes one verb with two depths**, and `review` is removed.

`depth` is a **required enum** (`explain` | `judge`). The API constrains the
value, so the choice cannot be fudged and there is no second description to lose
to. `model`, `skills`, `structuredOutput` and `clause` all resolve from it —
judging gets the strongest model, the review skills, and the ranked-findings
clause; explaining stays fast and cheap.

`depth` is carried on the run, **including across the review gate**, so an
approved run executes as the call that was made rather than as a default. Absent
(an older parked run), it falls to `explain` — never to the expensive one.

Neither depth may write. That was true of both verbs separately and stays
structural.

## Impact

- Specs: `verb-tool-surface` (MODIFIED)
- `electron/verbs.mjs`, `electron/run-dispatch.mjs`, `electron/run-exec.mjs`, `src/lib/verbs.ts`, `src/vite-env.d.ts`
- Docs: `CLAUDE.md`, `docs/PIPELINE_INTERNALS.md` — seven verbs, not eight
