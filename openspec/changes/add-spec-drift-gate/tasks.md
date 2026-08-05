## 0. Confirm the prerequisites — this change applies LAST

- [x] 0.1 Confirm `cut-run-shape-capability-boundaries` has landed. It retitles
  `run-execution-queue`'s "Both roles cancel through one path" and relocates two
  requirements; running Phase 1 first would reword text that change then moves, and
  the same duplicate would be hunted twice.
- [x] 0.2 Confirm `purge-role-vocabulary-from-prompts` and
  `remove-dead-role-era-styles` have landed, so their ADDED requirements are in the
  living spec before the gate is pointed at it.

## 1. Phase 1 — reconcile the remaining role vocabulary (before any gate exists)

- [x] 1.1 Enumerate the `role`/`persona` occurrences across the capability specs.
  The baseline measured 2026-08-04 was 72 across 16 files; re-count after the
  prerequisite changes land, since they both reduce and add occurrences.
  **Corrected count**: the original enumeration (and this task's own regex) missed
  plural forms (`\brole\b` does not match "roles"); re-run with `\brole[s]?\b` found
  17 files (not 16), several only in plural form (`glass-hud-mode`,
  `openspec-native-pipeline`, `pipeline-setup-install`, `setup-panel`,
  `stateful-verb-session` were missing entirely from the first pass).
- [x] 1.2 Classify each: **dead concept** (rewrite to verb vocabulary), **legitimate
  English** (a verb's role in the pipeline — keep), or **dead behavior** (the
  requirement mandates something removed — fix in place, do not reword).
  **Design correction, found during apply**: `persona` was in design.md D3's retired
  seed list, but it is live, load-bearing vocabulary (`electron/agent-definitions.mjs`,
  `electron/pipeline-install.mjs`, `electron/verbs.mjs`,
  `resources/personas/{stateful,stateless}.md`) naming *who the worker is*, kept
  deliberately distinct from the retired role concept by the verb migration. Per
  user decision, removed from the seed list in design.md; all `persona`/`personas`
  occurrences across 6 files (`global-agent-runtime`, `per-verb-model-selection`,
  `openspec-native-pipeline`, `pipeline-setup-install`, `stateful-verb-session`,
  `setup-panel`) are legitimate as-is, no rewrite, no allowance needed.
- [x] 1.3 Rewrite the dead-concept occurrences. Highest-density files first:
  `agent-subscription-auth` (25 — full rewrite to verb vocabulary),
  `global-agent-runtime` (2 dead-concept rewrites: "the roles operate there" → "the
  run operates there"; "configurable per role" → "configurable per verb"),
  `per-verb-model-selection` (2 rewrites: "role-named variables" → `` `PO`/`DEV`-named
  variables `` , citing the real legitimate identifiers directly instead of the
  retired generic noun), `workstream-switcher` (3 rewrites: "per-role" → "per-verb"),
  `glass-hud-mode` (1 rewrite: "pipeline roles" → "the pipeline bar", verified against
  the real UI element name).
- [x] 1.4 `global-agent-runtime` needs care: "A role that must not ask is prevented
  from asking" appears to duplicate `voice-decision-relay`'s "A stateful verb may
  ask; a stateless verb cannot". Per task 0.1 the boundary-cut change has already
  landed, so first check whether it resolved this. **If a third verbatim duplicate
  is still there, stop and put it through the boundary-cut change's mechanism rather
  than rewording it here** — a vocabulary sweep that silently de-duplicates is how
  the surviving copy changes meaning unnoticed.
  **Confirmed**: the boundary-cut change did not touch this pair (it only
  de-duplicated the cancellation rule between `stateful-verb-session` and
  `run-execution-queue`). Per explicit user decision, de-duplicated now using the
  same drop/keep/pointer mechanism: dropped the duplicate requirement (and its two
  scenarios) from `global-agent-runtime`, added a one-sentence pointer to
  `voice-decision-relay`'s surviving copy (left unchanged) in the nearby
  system-prompt-policy requirement.
- [x] 1.5 For every **dead behavior** found, record it explicitly in this change. The
  last sweep found four; treat a count of zero as a signal the classification was
  too shallow, not as good news.
  **Zero dead-behavior findings.** Spot-verified rather than assumed: the rewritten
  `agent-subscription-auth` requirements were checked against `electron/worker-env.mjs`
  (GEMINI_API_KEY always excluded; ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN excluded
  only when a subscription token is present — matches the spec exactly), and
  `global-agent-runtime`'s "remove persona files ... named for the retired roles" was
  checked against `electron/pipeline-install.mjs`'s `removeLegacyClaudeArtifacts` /
  `retiredAgents` — both still real, current, implemented behavior, not dead.
- [x] 1.6 `openspec validate --specs --strict` — 45 passed, 0 failed (43 baseline plus
  `ambient-session-capture` and `second-brain-focus`, landed by concurrent unrelated
  work in this working tree since the proposal was written).
- [x] 1.7 Confirm remaining occurrences are only the ones classified legitimate, each
  reviewed rather than assumed.
  **Final count of legitimate occurrences remaining, each individually reviewed**:
  17 `role`/`roles` occurrences across 8 files (`context-supplement-composer` 1,
  `global-agent-runtime` 1 ["retired roles", real cleanup feature], `talk-and-build-modes`
  2, `wake-sleep-voice` 1 [Electron Menu `role` API, different namespace],
  `session-announcements` 1, `verb-tool-surface` 9, `voice-decision-relay` 1,
  `two-hand-gestures` 1 [`[role="button"]` ARIA attribute, different namespace]) — all
  either prohibitions that must name what they forbid, ordinary English unrelated to
  the retired concept, or a distinct technical namespace (ARIA/Electron). Plus 6
  `Hermes` occurrences (`workstream-switcher`, `task-step-timeline`,
  `renderer-structure`, `setup-panel`, `voice-ui-control`, `deepspace-skin`) — all
  "SHALL NOT port Hermes-derived IPC" prohibitions or (`deepspace-skin`) the
  historical rationale for the check itself. This is materially more than task
  2.7a's original estimate of 9 total allowances (it undercounted Hermes at 1 instead
  of 7 — `workstream-switcher` alone has 2 — and did not anticipate
  `global-agent-runtime`'s "retired roles"); the actual count carried into task 2.7a
  is 24 (17 role + 7 Hermes).

## 2. Phase 2 — the check itself

- [x] 2.1 Add `scripts/check-spec-drift.mjs` and a `spec:check` npm script.
  Structured to match this repo's existing gate convention rather than self-running:
  `check-spec-drift.mjs` exports the pure check (as `dead-claude-css.mjs` does),
  `gates.mjs` gains `runSpecDrift()` carrying the bypass handling (as `runLint()`
  does), and `scripts/spec-check.mjs` is the thin CLI entry (as `lint.mjs` is).
  `npm run spec:check` → `node scripts/spec-check.mjs`. This is what satisfies the
  living spec's "One definition, two callers" requirement for the new gate.
- [x] 2.2 Implement the retired-term list with **per-term matching rules**. Seed:
  `PO` and `DEV` case-sensitive with word boundaries; `role`, `persona`, `Hermes`
  case-insensitive. Verify `IRIS_PO_QUESTION_TIMEOUT_MS` and
  `SYSTEM_EVENT_PO_QUESTION` pass — an underscore is a word character, so `\bPO\b`
  must not match inside them. Assert this with a fixture, not by reasoning.
  **Fixture-verified** (temp tree, not the real specs): a spec citing both
  identifiers passes; bare `PO`/`DEV` fail. `persona` is **not** in the list — see
  the correction recorded under 1.2 and in design.md D3. The `role` pattern matches
  the plural (`\brole(?:s)?\b`), which the previous sweep's own regex did not.
- [x] 2.3 Implement the placeholder check: `TBD`, `TODO`, `FIXME`, and
  "after archive"-style notes to a future reader.
  **Fixture-verified**: all four shapes fail, each naming file, line, and cause.
- [x] 2.4 Implement the contradiction check in its narrow form: a requirement whose
  body prohibits something that one of its own scenarios then asserts as expected.
  Use the shipped defect as the fixture — requirement forbids "offering an install
  command", scenario mandates "one-click install action" — so the check is verified
  against the real case rather than a synthetic one.
  **Narrowed further than the design anticipated, and measured rather than assumed.**
  A bare `SHALL NOT <phrase>` trigger was implemented first and run against the real
  tree: it produced dozens of findings, none of them a real contradiction — nearly
  every prohibition's neighboring prose shares vocabulary with its own *compliant*
  scenario. Two corrections were needed for the check to be worth having:
  (a) trigger only on `SHALL NOT offer/provide/present <phrase>` — the exact shape of
  the shipped defect — not on any prohibition; (b) skip a THEN line that itself
  negates the overlap ("offers **no** install action"), which is compliance, not
  contradiction. Also requires ≥2 overlapping significant words **and** ≥50% overlap
  with the prohibited phrase. Fixture-verified against the real
  `pipeline-availability` defect text: caught. This is a stronger version of the
  design's own admission that this check "is the weakest and will not catch every
  case" — it is narrower than designed, deliberately, because the wider form was
  measured to be noise.
- [x] 2.5 Implement the emptiness checks: a capability with no requirements, a
  requirement with no scenarios.
  **Fixture-verified**: both shapes fail with a naming message.
- [x] 2.6 Exclude `openspec/changes/archive/` and `openspec/changes/`. Add a fixture
  proving the archive's retired vocabulary does not fail the gate.
  Structural rather than a filter: the walk is rooted at `openspec/specs/`, so
  `openspec/changes/` is never entered at all. Fixture-verified with an archive
  directory full of `PO`/`DEV`/`role` — zero findings from it.
- [x] 2.7 Implement the per-occurrence allowance mechanism, requiring a stated reason.
  Matched on (file, term, anchor) where the anchor is a short substring of the
  occurrence's line, not the whole line — so incidental rewrapping elsewhere on the
  line does not break it, but a wording change that drops the anchor re-flags the
  occurrence for re-review. A second, separate allowance list exists for the
  contradiction check (`CONTRADICTION_ALLOWANCES`), keyed by (file, requirement),
  since design D5 applies to any check and not only to vocabulary.
- [x] 2.7a Allow the occurrences the three prerequisite changes legitimately
  introduce — measured 2026-08-04 as **9**: seven `role`/`roles` in
  `verb-tool-surface` and `session-announcements` (the prose that *states the
  prohibition*, plus "a verb's role in the pipeline" as the explicit
  counter-example), one `Hermes` in `deepspace-skin` (historical rationale for why
  the check exists), and one `role` in this change's own delta. Each allowance states
  which of those it is. **A requirement forbidding a term has to be able to name it**,
  and a gate that cannot express that would be uninstallable by its own rule.
  **The estimate of 9 was wrong; the real count is 25 vocabulary allowances.** It
  undercounted `Hermes` at 1 when there are 7 across 6 files (every "SHALL NOT port
  Hermes-derived IPC" prohibition), and did not anticipate `global-agent-runtime`'s
  "the retired roles" (naming them to describe real, current cleanup behavior),
  `wake-sleep-voice`'s Electron-Menu `role` API, `two-hand-gestures`'s ARIA
  `[role="button"]`, `talk-and-build-modes`'s two user-facing-role prohibitions, or
  the four `PO`/`DEV` citations this change itself introduced into
  `per-verb-model-selection` (task 1.3 replaced the vague "role-named variables" with
  the real identifier names, which is more honest and needs an allowance). Plus 1
  contradiction allowance (`talk-and-build-modes`, a conditional prohibition the
  lexical check cannot see the condition of). Every allowance carries its reason.
- [x] 2.8 Fail closed: exit non-zero on any finding and on the check's own failure. No
  warn-only mode, no environment flag that downgrades it to a warning.
  Verified: an unreadable specs root returns `ok: false` with the error, a thrown
  exception inside the check is caught and returned as a failure (never a pass), and
  the checker itself contains no warn path. `IRIS_SKIP_HOOKS=1` is honoured at the
  `gates.mjs` layer only — the repo's uniform, announced escape hatch (it prints
  `BYPASSED`), which is a deliberate bypass and not a warn-only mode.

## 3. Wire it into the chain

- [ ] 3.1 Keep it independently runnable and **out of** `npm run build`, matching how
  `lint` and `scan:secrets` are kept out.
- [ ] 3.2 Bind it to editing events in `.claude/settings.json` alongside the other
  four.
- [ ] 3.3 Confirm `IRIS_SKIP_HOOKS=1` still works as the documented one-off bypass, so
  the escape hatch stays uniform across gates.

## 4. Update the documents that state the count

- [ ] 4.1 `CLAUDE.md` — "four independent gates" becomes five, in the Commands section
  and the router table row.
- [ ] 4.2 `docs/TESTING.md` — same, including its "four gates" heading.
- [ ] 4.3 `openspec/specs/test-harness/spec.md` — check whether it references the gate
  count; reconcile if so.
- [ ] 4.4 `README.md` — check the Prerequisites and setup sections for the count.

## 5. Verify

- [ ] 5.1 `npm run spec:check` — passes on the cleaned tree.
- [ ] 5.2 Reintroduce, one at a time and then revert: a `PO` occurrence, a `TBD`
  Purpose, and a requirement/scenario contradiction. Each must fail with a message
  naming file, line, and cause.
- [ ] 5.3 Confirm a spec citing `IRIS_PO_QUESTION_TIMEOUT_MS` still passes.
- [ ] 5.4 All five gates green: `npm test`, `npm run build`, `npm run lint`,
  `npm run scan:secrets`, `npm run spec:check`.
- [ ] 5.5 Trigger an edit event and confirm the new gate actually runs, rather than
  being configured but never invoked — a gate bound incorrectly is indistinguishable
  from a gate that passes.

## 6. Close out

- [ ] 6.1 Re-read `openspec/specs/workflow-quality-gates/spec.md` against the landed
  script; the delta must be true before archiving.
- [ ] 6.2 Record the honest limitation in the change: the term list has nothing
  forcing it to be updated when a concept is deleted. Design D3 makes it visible in
  review; it does not make it automatic.
