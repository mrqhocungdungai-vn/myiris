## 0. Ground rules

- [x] 0.1 design.md's fact sheet is the source for every edit below — verify a
      line number only if the file has changed since the audit (2026-08-11);
      do not re-derive the facts.
- [x] 0.2 Confirm the count before writing it anywhere:
      `node --input-type=module -e "import {VERB_NAMES} from './electron/verbs.mjs'; console.log(VERB_NAMES.length, VERB_NAMES)"`
      — expect 7.

## 1. docs/ARCHITECTURE.md

- [x] 1.1 Replace the mermaid diagram: the eight-station chain from design.md
      ("The real chain"), stations named after files, no line numbers inside
      the diagram. The deprecated `submit_claude_task` edge goes away.
- [x] 1.2 Rewrite "How The Flow Works" as the same ordered sequence in prose,
      with file:line references.
- [x] 1.3 State the framing explicitly, once, in the overview: each tool Gemini
      sees is a verb; behind each verb is a full Claude Code agent (Agent SDK
      `query()`) with its own lifetime, model, skills, and tool bounds; Gemini
      picks the verb; the review gate is the human barrier in front of
      privileged work.
- [x] 1.4 "Gemini Tools" section: the real surface — 7 verbs (from the
      registry), control tools (`check_claude_status`, `get_workspace_info`,
      `get_project_state`, `get_claude_task_status`, `stop_claude_task`,
      `start_new_claude_session`, `answer_claude_question`, `set_verb_model`,
      `respond_to_task_review`), always-tools (`get_ui_context`, `control_ui`,
      `go_to_sleep`), the four worker-free tools, and `submit_claude_task`
      mentioned only as deprecated. Delete `answer_po_question` and
      `set_agent_model`.
- [x] 1.5 Add `run-queue.mjs` to the module list, with both lanes: the single
      global slot and the per-conversation resident lane.
- [x] 1.6 Registry field list (currently at :132) gains the missing fields:
      `speakWhileWorking`, `spokenResult`, `vault`, `structuredOutput`,
      `disallowedTools`, `guardOpenNoteWrites`.
- [x] 1.7 Apply design.md D3: drop or date the module/line counts (:113-114,
      :119).

## 2. docs/PIPELINE_INTERNALS.md

- [x] 2.1 Verb table (:30-40): add the missing `work_on_note` row (stateful,
      per-note session key, Opus, vault, verbatim read-out, write guard).
      Also repaired the table's broken row/prose interleaving, and corrected
      "Both stateful verbs share one resident session" → the two *shaping*
      verbs (the same missing-`work_on_note` error, one paragraph down).
- [x] 2.2 Four "eight verbs" → seven (:130, :135-136, :168, :650).
- [x] 2.3 :158-162 and :229: the single-slot story gains the resident lane —
      match what the canvas section of the same file already says. :229's
      "only one can ask because only one run exists" reasoning is retired
      rather than restated: the relay's single slot is its own property.
- [x] 2.4 :213: drop `review` from the never-parks list (it is `investigate`
      `depth: judge`).
- [x] 2.5 :662: "Stateless verbs never ask" → the `effectiveDisallowedTools`
      truth the same doc states at :224 (execute with no open change may ask).
      The same falsehood in the "Two run shapes" bullet list is corrected too.

## 3. README.md and docs/PIPELINE_GUIDE.md

- [x] 3.1 README.md:9 — labels without `review` (Shape, Canvas, Note, Build,
      Finish, Look, Notes), three stateful, four stateless.
- [x] 3.2 PIPELINE_GUIDE.md — one framing paragraph per design.md D4; verify
      its seven-tool list names the right seven. It named **Review** and
      omitted **Note**: the row is replaced, judging folds into Look, and the
      live/headless split and the approval paragraph follow the same fix.

## 4. Code comments (no behavior, no assertions)

- [x] 4.1 `electron/gemini-tools.mjs:25,39` — eight → seven.
- [x] 4.2 `electron/run-exec.mjs:320,498` — eight → seven.
- [x] 4.3 `electron/verbs.test.mjs:300` — test TITLE eight → seven. Title only
      (design.md D5). Its `:266` *comment* also said eight; corrected, since
      5.1 requires zero hits. No assertion or structure touched.
- [x] 4.4 `electron/run-skills.mjs:16` — date the token measurement and its
      bundle size instead of asserting today's count.
- [x] 4.5 `electron/run-skills.mjs:83` — REVIEW_SKILLS header comment: the
      dead `review` verb → `investigate` depth `judge`.

## 5. Verify

- [x] 5.1 `grep -rn "eight verb" electron/ docs/` → 0 hits.
- [x] 5.2 `grep -rn "answer_po_question\|set_agent_model" docs/ electron/` → 0
      hits; `grep -rn "submit_claude_task" docs/` → only deprecation mentions.
- [x] 5.3 All five gates green (`/gates`) — this change must not move any of
      them, including the retitled test. Verified: build ✓, vitest 1859/1859 ✓,
      oxlint ✓, gitleaks ✓, spec:check ✓.
- [x] 5.4 Read the new ARCHITECTURE.md flow against `electron/run-dispatch.mjs`
      and `electron/run-exec.mjs` once, end to end — the check is that a
      reader can follow a tool call to a `query()` without hitting a name that
      does not exist in the tree. Every identifier named in the new prose was
      grep-confirmed in a non-test module, and all 16 cited `file:line`
      references were checked to land on the line they claim. The new mermaid
      block was additionally parsed with the repo's own `mermaid` under jsdom.

## 6. Close out

- [x] 6.1 Archive the change. It carries no delta specs (design.md D1), so
      archiving records history only.
