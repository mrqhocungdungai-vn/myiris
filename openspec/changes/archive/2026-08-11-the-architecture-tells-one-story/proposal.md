## Why

The architecture the user experiences is right, and the documentation describes
an older one. Gemini Live hears the request, picks a **verb**, and behind that
verb a full Claude Agent SDK agent runs with its own model, skills, tool bounds,
and lifetime; the human review gate is the barrier in front of privileged work.
All of that is implemented and specified (`verb-tool-surface`,
`prompt-review-gate`, `talk-and-build-modes` — the last already declares the
Talk/Build model *explanatory, not operational*).

The written story has not kept up, in ways that were each verified against the
running registry (`VERB_NAMES.length === 7`):

- **The verb count is wrong in nine places.** `docs/PIPELINE_INTERNALS.md`
  (:130, :135-136, :168, :650) and code comments (`gemini-tools.mjs:25,39`,
  `run-exec.mjs:320,498`, `verbs.test.mjs:300` title) all say "eight verbs";
  the registry has seven since `review` was folded into `investigate`'s
  `depth` enum. CLAUDE.md, README, and PIPELINE_GUIDE say seven.
- **`docs/ARCHITECTURE.md` documents the pre-verb world.** Its mermaid edge and
  flow steps route delegation through `submit_claude_task` — deprecated, marked
  "do not call this" (`gemini-tools.mjs:70`). Its Gemini-tools list names two
  tools that do not exist (`answer_po_question`, `set_agent_model`; the real
  names are `answer_claude_question`, `set_verb_model`) and omits the seven
  verbs entirely. `run-queue.mjs` is missing from the module list, so the
  execution slot and the resident lane have no home in the architecture doc.
- **`docs/PIPELINE_INTERNALS.md` contradicts itself.** The verb table (:30-40)
  is missing `work_on_note` — a stateful verb with its own per-note session,
  vault access, and write guard. :158-162 and :229 say one global slot while
  the canvas section documents the resident lane (`run-queue.mjs:335`)
  correctly. :213 lists `review` among verbs that never park. :662 says
  stateless verbs never ask, while :224 correctly explains that
  `execute`/no-change may.
- **`README.md:9` holds three errors in one sentence**: it names `review`,
  counts two stateful verbs (there are three — `work_on_note` is stateful),
  and therefore counts five stateless (there are four).
- **Registry fields that shape real behavior are documented nowhere by name**:
  `speakWhileWorking`, `spokenResult`, `vault`, `structuredOutput`,
  `guardOpenNoteWrites`.
- **Stale evidence in code comments**: `run-skills.mjs:16` cites a token
  measurement "over 17 skills" against a bundle that ships 16;
  `run-skills.mjs:83` heads `REVIEW_SKILLS` with the name of the deleted
  `review` verb.

None of this is a behavior defect — which is exactly why nothing catches it:
the five gates check code and the living spec, and the docs are neither. But
this repo's own convention says CLAUDE.md and `docs/` are the router and the
manual; a manual that names dead tools and miscounts the surface teaches every
future session the wrong system.

## What Changes

- `docs/ARCHITECTURE.md` retells the delegation flow as it exists: one diagram
  and one ordered sequence from the registry through declaration, tool call,
  gates, queue lanes, `query()`, and the completion announcement — and states
  the framing plainly: *each tool Gemini sees is a verb; behind each verb is a
  full Claude Code agent; Gemini decides, the human gate is the barrier.*
- `docs/PIPELINE_INTERNALS.md` gets a complete verb table (seven rows), the
  resident lane wherever the old single-slot story remains, and the
  never-named registry fields.
- `README.md`'s verb sentence is corrected.
- The stale code comments listed above are corrected in the same sweep.
- Talk/Build is retold as what its spec already says it is: a way of
  *describing* capability on request, not something anyone operates.

## Impact

- **Affected specs:** none — the living spec is accurate on every point above;
  it is the prose around it that drifted. This change carries no delta specs,
  deliberately.
- **Affected files:** `docs/ARCHITECTURE.md`, `docs/PIPELINE_INTERNALS.md`,
  `README.md`, `docs/PIPELINE_GUIDE.md` (one framing paragraph), and comments
  in `electron/gemini-tools.mjs`, `electron/run-exec.mjs`,
  `electron/run-skills.mjs`, `electron/verbs.test.mjs` (a test *title*, not an
  assertion).
- **Behavior:** unchanged. No option, no prompt text delivered to any model,
  and no test assertion changes — only descriptions of the system.
