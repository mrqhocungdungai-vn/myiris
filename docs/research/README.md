# Codebase Improvement Research — Consolidated Findings & Plan

**Repo:** `myiris` @ `59111ec` · **Date of research:** this session
**Baseline:** all five gates green (`build`, `test`, `lint`, `scan:secrets`, `spec:check`);
`npm test` = 106 files / 1908 tests / 4.4s. **No code was changed.**

Five reports back this summary:

| Report | Scope |
|---|---|
| `hotspot-findings.md` | churn x size ranking, testability shape |
| `app-decomposition-findings.md` | all 30 `useEffect`s in App.tsx, clustered |
| `cross-process-findings.md` | the verb registry across both processes |
| `renderer-findings.md` | `src/` — 17 findings |
| `main-process-findings.md` | `electron/` — 12 findings |
| `harness-findings.md` | gates, coverage, dependencies — 11 findings |

Every finding below was **independently re-verified against source** before
being listed here; three sub-agent claims were corrected in the process (noted
inline).

---

## The single most important sentence

> **The rule with an automated guard has not drifted. Every rule enforced only
> by prose has.**

This is not an impression; it is the measured result, and three reports reached
it independently from different directions:

- The **Electron-free constraint** is pinned by `electron-graph.supply.test.mjs`.
  Verified still clean — only `main/ipc/window/renderer-security` (+`preload.cjs`)
  import Electron.
- The **250-450 line convention** has no guard. It is exceeded by **11 of 12**
  main-process modules in scope and by 25 files repo-wide.
- The **prose record of that convention** (`docs/TESTING.md:411-413`) has rotted
  in *both* directions — App.tsx listed 1738 (actually **2226**), canvas-mcp 557
  (actually **804**), SetupPanel 1023 (actually **858**), second-brain.mjs
  (1317) absent entirely. A reader cannot tell a live constraint from a fossil.
- The **cross-process verb mirror** *is* pinned (`src/lib/verbs.test.ts` imports
  `electron/verbs.mjs` and asserts equality) — and has **not** drifted.

The lesson generalizes to every recommendation here: prefer a cheap executable
guard over a documentation fix.

---

## Tier 0 — Correctness defects (fix regardless of appetite for refactoring)

### 0.1 Concurrent `AskUserQuestion` drops a run and can kill another
`run-stream.mjs:104-117` · **verified, and worse than first reported**

`PendingQuestion.raise` overwrites `this.current` with no `clear()`/`settle()`.
Its sibling `PendingReview.raise` (`run-dispatch.mjs:92`) deliberately does the
opposite: `this.clear(); // a new submit supersedes silently`.

The invariant this rests on (`run-stream.mjs:84-91`, "at most one
AskUserQuestion can be pending across the whole app") is **dead**: the resident
lane (`run-queue.mjs:151-172`) exists precisely so a turn runs beside a slot
job, and `verbs.mjs:319` grants `execute` the ask tool when no change is open.

Four consequences, the last found during verification:
1. Run A's `resolve` is dropped — its `canUseTool` never settles.
2. A's stale timer later expires **B** under **A's** policy — a `DENY`-policy
   question can be answered on the user's behalf, which `voice-decision-relay`
   explicitly forbids.
3. Ordinal answer-matching (`run-stream.mjs:532-569`) routes a voice answer to
   the wrong question list.
4. **`suspend`/`resume` are booleans, not refcounts** (`run-queue.mjs:477-495`).
   Two raises + one settle re-arms every watchdog *while a question is still
   pending*, exposing the surviving run to the watchdog meant to protect it.
   `run-queue.mjs:481` even restates the dead invariant as justification — the
   stale assumption has propagated into a second module.

*Fix:* key pending questions per run; make suspend/resume a refcount. This also
requires an **OpenSpec change** — `voice-decision-relay/spec.md:20` still
asserts the dead invariant and now contradicts `run-execution-queue`. Per
CLAUDE.md, reconcile through a change, never silently.

### 0.2 `unanswered` is unreachable on the stateful path
`run-exec.mjs:505-549` vs `stateless-session.mjs:456-494`

Result→terminal-status interpretation exists **twice**, and `unanswered` on only
one. A stateful turn whose question went unanswered reports as `error`. CLAUDE.md
is explicit: it must be "`unanswered`, and nothing downstream may report it as a
decision." Code-vs-documented-invariant conflict.

*Fix:* one `finalizeRunResult()` in `run-outcome.mjs`, used by both paths.

### 0.3 The 300 ms dwell contract is implemented twice and the copies disagree
`galaxy-nav.ts:145` vs `App.tsx:1545` · *found only by this analysis*

- **Tested copy:** `dwellStep(state, candidate, now, holdMs)` — pure, state
  threaded as a plain object, 588-line test, plus a `PENDING_HOLD_MS = 120`
  dead-band that stops targets flickering between neighbours.
- **Untested copy:** `now - dwellRef.current.startedAt > 300`, a bare literal
  driving `actionable.click()`.

They differ with nothing recording it as deliberate: `>= holdMs` vs `> 300`, and
the inline copy has **no dead-band** — it promotes a new target on the first
frame. One user-facing "hold to activate" contract, two behaviours, one pinned.

*Fix:* reuse `dwellStep` (generalize its candidate key) rather than re-extract.

---

## Tier 1 — Cheap guards that stop the drift (highest ratio in the whole study)

### 1.1 There is no CI at all
**No `.github/`**, no GitLab/Circle/Jenkins config — verified. All five gates run
*only* in the maintainer's Claude Code hooks. A commit made from a terminal, or
by any other tool, is **completely ungated**. This is the highest-leverage gap
found: it does not add a check, it makes the excellent checks that already exist
actually binding. ~40-line workflow.

### 1.2 A test file with the wrong extension is silently ignored
**Proven empirically, not inferred.** I planted a deliberately failing
`src/lib/__globprobe.test.tsx`:

```
Test Files 104 passed (104) / Tests 1836 passed (1836)   exit 0
```

It was never collected. A `.tsx` test can be written, committed and reviewed as
coverage while asserting nothing. This is a *live* silent-failure mode, and it is
the exact mechanism that would defeat any attempt to fix the renderer's test gap.
*Fix:* a ~25-line test asserting every `*.test.*` on disk matches a vitest include.

### 1.3 The gate guarding the living spec has no test
`scripts/check-spec-drift.mjs` — 574 lines, **0 tests**. A bug returning
`ok: true` passes all five gates and silently disables the fifth. *Fix:* a
fixture-driven test (~80 lines).

### 1.4 A file-size ratchet
Given the Tier-0 lesson, the answer to 25 oversized files is not a refactor
mandate but a **checked-in baseline that may shrink and never grow**, folded
into the lint gate (the dead-CSS sweep is the precedent). It makes the existing
convention binding without demanding any immediate rewrite.

### 1.5 Pin `PIPELINE_ONLY_TOOLS` to the declarations — *corrected*
The sub-agent implied this list had already drifted. **I diffed both sets: they
agree today.** The three declared-but-unguarded tools (`get_ui_context`,
`control_ui`, `go_to_sleep`) are *correctly* excluded — they must work in
chat-only mode, exactly as `find_prepared_answer` is deliberately outside the
set. So this is a **preventive** guard, not a bug fix — which raises its appeal
(~10 lines, zero behavior change), but the test must encode those three
exclusions as named exceptions or it fails the moment it is written.

---

## Tier 2 — Structural work, sequenced smallest-first

The renderer's 73%-untested LOC (34 of 35 components, 8 of 9 hooks) is real, but
the framing that matters is this:

> **The repo's convention is not missing — it is applied inconsistently, and
> App.tsx is where it stops.**

Four instances of the identical shape were found, each with the pure part
already extracted and tested and the impure part left inline and untested:

| Extracted & tested | Left inline & untested |
|---|---|
| `webgl-quality.ts` `readWebglHighFidelity` | 7 sibling localStorage readers (`App.tsx:72-136`) |
| `galaxy-nav.ts` `dwellStep` | the HUD dwell loop (`App.tsx:1495-1556`) |
| `hud-interactivity.ts` `isHudChrome` | the loop that calls it, same effect |
| `DrawingCanvas`'s 7 pure helpers | the 135-line task reducer (`App.tsx:1260-1314`) |

So the work is **continuing an established pattern**, not importing a new one.
App.tsx's 30 effects reduce to **four clusters**, not thirty problems:
~14 bridge/IPC subscriptions, 3 gesture effects (137 lines), 2 task-focus effects
(76 lines, sharing 7 dependencies — one responsibility split in two), ~11 trivial syncs.

Recommended order, each step independently shippable and testable under the
**existing** `.ts` glob:

1. `src/lib/preferences.ts` — 9 loaders + 6 writers (one copy is in
   `VaultGalaxy.tsx:147-152`). Follow `webgl-quality.ts`'s split: pure parse
   takes `string | null`, the `try/catch` stays at the call site.
   **Caution:** `App.tsx:58-70,132-134` carry deliberate, differing defaults in
   comments (ambient-capture OFF "unlike sounds above"; HUD camera must never be
   "stuck enlarged"; unreadable consent fails *open*). A mechanical merge into
   one generic helper flattens exactly what the duplication protects — carry
   each comment, and assert the *documented* default.
2. `src/lib/task-stream.ts` — the 135-line reducer.
3. Reuse `dwellStep` for the HUD loop (Tier 0.3).
4. `finalizeRunResult()` (Tier 0.2); split `second-brain.mjs` (1317 lines,
   6 responsibilities) on its existing internal boundaries.
5. Only then, if invariants like *"this component renders no verb selector"*
   remain unassertable, add a jsdom project + testing-library. That case is
   real — `src/lib/verbs.test.ts:80-105` currently asserts it by **grepping
   component source text**, including one regex matching a source *comment*.
   Scope check: of 19 `readFileSync` test files, **16 legitimately read output
   artifacts**; this anti-pattern is confined to **one file, ~8 assertions**.

---

## Tier 3 — Recorded, low urgency

- **Dead feature contradicting a `SHALL`:** `IRIS_LOAD_TEST_DATA` is offered in
  the UI, persisted, and typed — with **zero consumers** (verified by whole-tree
  grep). `setup-panel/spec.md:3,7` still promises "demo test data". Either build
  it or retire it **through an OpenSpec change**, never silently.
- **Three gesture rAF loops never stop** (`App.tsx:1495-1650`) — they
  re-schedule on every early-return path, so they spin at 60fps with hand
  control off and the window blurred, contradicting the file's own
  `surfaceAdvancesFrames` pause discipline used for the orb and backdrop.
- **`useGalaxyCameraDrive.ts`** — 811 lines with a 360-line rAF loop and a
  comment at `:429-431` admitting *"There is no test over this hook."*
- **19 production advisories (6 high).** Only one is clearly reachable:
  `js-yaml@3.15.0` under `gray-matter@4.0.3` (a production dep), reached at
  `vault-write.mjs:222` parsing user vault frontmatter. `gray-matter` declares
  `^3.13.1`, so an override to js-yaml 4 violates its range — **accept with a
  recorded reason.** Note the existing `try/catch` at `vault-write.mjs:220-224`
  is *not* cover: the advisory is quadratic CPU consumption, a hang rather than
  an exception, so `catch` never runs. Say so explicitly in the acceptance note.
- **Zero memoization** renderer-wide (0 `React.memo`, 0 `useCallback` in
  App.tsx) while per-frame dwell state re-renders the tree; 65-prop `HudShell`
  with 23 props duplicated verbatim into `CenterStage`.
- **Confirmed strengths, worth not disturbing:** the cross-process verb mirror
  is correctly pinned; `electron/` coverage is 65/71 modules; 1908 tests with
  zero `skip`/`todo`/snapshots, most named for the defect they prevent.

---

## Suggested first pull request

Tier 1.1 + 1.2 together — a CI workflow plus the glob-completeness test. Neither
touches product code, both are ~65 lines total, and together they convert the
existing gates from *locally advisory* into *binding*, and close the
silent-failure mode that would otherwise undermine every later test added.
