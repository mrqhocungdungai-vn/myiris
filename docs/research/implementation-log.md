# Implementation log — line-limit optimization

All work below is **behavior-preserving** and was verified with all five gates
green after each step. Nothing is committed to git.

## Result

| Metric | Before | After |
|---|---|---|
| `src/App.tsx` | 2226 | **1981** (−245) |
| `electron/verbs.mjs` | 666 | **204** (−462, now **under** the ceiling) |
| `electron/capabilities/second-brain.mjs` | 1318 | **1203** (−115) |
| `src/components/VaultGalaxy.tsx` | 1106 | **978** (−128) |
| Tests | 1908 | **2020** (+112) |
| Test files | 106 | 115 |
| Files over the 450-line ceiling | 25, unguarded | **24**, ratcheted |

## What was extracted (each pure, tested under the existing `.ts` glob)

| Module | Tests | Replaces |
|---|---|---|
| `src/lib/preferences.ts` | 13 | 9 copy-pasted loaders + 15 `try/catch` blocks in App.tsx and VaultGalaxy |
| `src/lib/tasks.ts` (`applyTaskUpdate`, `applyStepPhase`) | 12 | the 56-line untested task-card reducer |
| `src/lib/gesture-label.ts` | 18 | the 58-line inline gesture decision table |
| `src/lib/pointer-dwell.ts` | 9 | the HUD dwell state machine |
| `src/lib/claude-answers.ts` | 11 | the AskUserQuestion pick/submit rules |
| `src/lib/orb-thinking.ts` | 8 | the "thinking" detector and its 4 magic constants |
| `src/lib/caption.ts` | 12 | the caption precedence chain + the audio-dot ternary |
| `electron/capabilities/second-brain-declarations.mjs` | — | 122 lines of pure tool-declaration data |
| `electron/verb-table.mjs` + `verb-constants.mjs` | (existing) | the verb records, split from the resolution engine |
| `src/lib/galaxy-colors.ts` (extended) | 15 | the galaxy's highlight/dim precedence rules |
| `electron/run-dispatch.pipeline-tools.test.mjs` | 4 | pins `PIPELINE_ONLY_TOOLS` to the declarations |

Each followed the repo's own established shape (`webgl-quality.ts`): the **parse
is pure** and takes already-read input, the impure edge stays at the call site.

## The durable part — a file-size ratchet

`scripts/check-file-size.mjs`, wired into the lint gate beside the dead-CSS
sweep, with `scripts/file-size-baseline.json` as the checked-in record and 7
tests over the comparison logic.

It requires **no file to be split today**. It fails when:

- a baselined file **grows** past its recorded size (proven: exit 1),
- a **new** file lands over the 450-line ceiling,
- a file **shrinks** without the gain being banked — so progress cannot silently
  reverse. (This fired for real during this work, on `second-brain.mjs`.)

This replaces the prose list in `docs/TESTING.md`, which had rotted in *both*
directions: App.tsx recorded at 1738 when it was 2226, SetupPanel at 1023 after
it had shrunk to 858, second-brain.mjs (1317) missing entirely.

## Two real defects found — pinned by test, deliberately not fixed

Both are behavior changes and belong in their own OpenSpec change, not in a
refactor:

1. **`gesture-label`** promises `"Closed_Fist · turn the view"` unconditionally,
   but `galaxy-nav.driveFor(hand, locked)` binds a fist to `orbit` **only once a
   note is locked**. With nothing locked the indicator names a gesture that does
   nothing. Pinned by a test that documents the gap and says to update rather
   than delete it if the gap is ever closed.
2. **`pointer-dwell`** diverges from `galaxy-nav.dwellStep`: `> 300` vs
   `>= holdMs`, and no 120 ms pending-hold dead-band, so HUD dwell targets can
   flicker where galaxy nodes do not. Recorded in the module header.

## What remains

25 files are still over the ceiling; `App.tsx` at 1981 is still 4.4× it. The
next targets, in order of ratio: `VaultGalaxy.tsx` (1100), `SetupPanel.tsx`
(859), `useGalaxyCameraDrive.ts` (812, self-declared untested), and App.tsx's
209-line `handleSidecarEvent` — which was examined and **deliberately left
alone**: it is a 19-branch event router whose branches are almost entirely
`setState` calls, so extracting it would relocate the coupling rather than
reduce it.

## Correction: the ratchet was measuring the wrong thing

After building the ratchet I measured what the 24 flagged files actually
contain. **18 of them are already inside the 250-450 convention on code lines.**

| File | Raw | Code | Comment |
|---|---|---|---|
| `src/hooks/useGalaxyCameraDrive.ts` | 812 | **405** | 46% |
| `src/lib/galaxy-nav.ts` | 548 | **204** | 55% |
| `electron/stateless-session.mjs` | 499 | **238** | 48% |
| `electron/run-stream.mjs` | 584 | **316** | 40% |

`useGalaxyCameraDrive` is the clearest case. Its header says *"There is no test
over this hook (it needs a live force-graph and a camera), so the invariant has
to hold structurally or not at all."* That reads like the worst test debt in the
repo — until you look at what it imports: **20+ pure functions from
`galaxy-nav.ts` and `galaxy-anchor.ts`, both thoroughly tested.** The extraction
already happened. What is left is genuinely imperative glue (THREE, force-graph,
refs, DOM) plus a great deal of explanation of why it is shaped that way.

So a raw-line ratchet would have pushed authors to **delete comments to get
under a number** — actively hostile to the discipline this codebase runs on, and
the exact opposite of the convention's purpose.

`countCodeLines` now excludes comments and blanks. The gate went from flagging
24 files (mostly false) to **6 real ones**, and I verified both directions:
adding 3 comment lines to `App.tsx` keeps lint green; adding 2 code lines turns
it red.

### The six that are genuinely oversized

| File | Code | Comment | Note |
|---|---|---|---|
| `src/App.tsx` | 1422 | 21% | still the main target |
| `src/components/SetupPanel.tsx` | 759 | **8%** | large *and* under-documented |
| `electron/capabilities/second-brain.mjs` | 604 | 42% | |
| `electron/canvas-mcp.mjs` | 585 | 19% | recorded pre-existing exception |
| `src/components/VaultGalaxy.tsx` | 552 | 39% | |
| `src/components/HudShell.tsx` | 479 | 11% | was 580; `HudCamera` extracted |

`SetupPanel.tsx` is the notable one: it is the second-largest by code and the
*least* commented in the repo. That combination — not raw length — is what
actually signals a file needing attention.

## A loophole I walked into myself

Extracting the listen-only consent decision made `App.tsx` **grow** by 5 code
lines (1422 → 1427): the extraction bought a tested consent rule, not brevity.

I did not notice, because my own workflow was:

```
node scripts/update-file-size-baseline.mjs && npm run lint    # always green
```

Rebaselining *before* running the gate makes the ratchet unconditionally pass —
it records whatever the file now measures, growth included. **A ratchet you can
bypass by running the tool that maintains it is not a ratchet.**

`update-file-size-baseline.mjs` now refuses to raise any entry without an
explicit `--allow-growth`. Lowering an entry, or dropping one for a deleted
file, still needs no flag: those are the directions the ratchet exists to
encourage. Verified both layers now object:

```
[file-size] the 450-line convention ratchet moved the wrong way:
  src/App.tsx: 1427 lines, over its recorded 1422

[file-size] refusing to raise the baseline for a file that grew:
  src/App.tsx: 1422 -> 1427
```

I then honoured it rather than passing the flag — tightening the call site
brought `App.tsx` to **1421**, one line under where it started.

The general lesson, and the reason this is worth recording: a guard has to
account for the workflow around it, not just the condition it checks. This one
was correct and still bypassable by the most natural sequence of commands.

## Why `App.tsx` stops here, and what the next step actually is

`App.tsx` is now **1391 code lines** (from 1422). The remaining reduction is not
another extraction — I checked, and the obvious move is a trap.

The file's bulk is its render surface: the `uiMode === "hud"` branch renders
`HudShell`, and the deck branch is ~140 lines of inline JSX. Extracting a
`DeckShell` component to mirror `HudShell` looks like the natural next step.

I measured what that component would need first: **67 distinct values.**

That is the same shape the renderer research already flagged as a defect —
`HudShell` takes 65 props and forwards 23 of them verbatim to `CenterStage`.
Extracting `DeckShell` would not fix that problem, it would **duplicate** it, and
`App.tsx` would shed lines while the codebase got worse. So the honest reading
is:

> `App.tsx`'s size is a *symptom*. The cause is that ~67 loosely-related values
> are live in one scope, and no amount of moving JSX changes that number.

Reducing it means reducing the number of values — grouping related state behind
cohesive objects (a context, or hooks that return a domain object rather than
loose tuples). `usePersistedPreference` is one step in that direction: eight
preferences that were sixteen loose bindings plus a helper are now eight paired
ones.

That is an **architectural decision**, not a mechanical refactor: context has
real re-render implications for a component tree already doing per-frame work
with zero memoization. It should be a deliberate choice, ideally routed through
OpenSpec, rather than something imposed by whoever happened to be reducing line
counts.

### One subtlety worth recording

`usePersistedFlag` returns a fourth slot, `setTransient`, which deliberately
does **not** write to storage. Stopping the voice session sets `handControl`
false, and the original code used a plain `setState` for it. Routing that
through the persisting setter would have been a silent behavior change: the user
still *asked* for hand control, and would have found it off on the next launch.

Some of these flags are a stored *preference* and a live *enabled* state at
once, and the two are allowed to diverge. The hook now names that distinction
instead of leaving it to whichever setter a caller happens to reach for.

## `VaultGalaxy.tsx`: 552 → 502, and why it stops there

Four extractions, each with tests:

| Module | Tests | What moved |
|---|---|---|
| `src/lib/galaxy-colors.ts` (earlier) | 15 | highlight/dim precedence rules |
| `src/lib/galaxy-graph.ts` | 17 | `escapeHtml`, `reconcile`, `stepFlightTarget`, tuning constants |
| `src/lib/galaxy-scene.ts` | — | `addStarfield`, `addBloom` |

Two of these were worth extracting for reasons that have nothing to do with
line count:

- **`escapeHtml` is an XSS boundary.** 3d-force-graph assigns `.nodeLabel()`'s
  return value to `innerHTML`, so an ingested note titled
  `<img src=x onerror=…>` would execute in the privileged renderer. It now has
  a test asserting the script is neutralized — including that `&` is escaped
  first, or `&lt;` would become `&amp;lt;`.
- **`stepFlightTarget` has a NaN trap.** When the camera sits exactly on its own
  target, normalizing a zero-length direction yields `NaN` for every component,
  which reaches `cameraPosition()` and puts the camera nowhere **with no error
  at all**. The fallback to +Z is now pinned.

`reconcile` got the subtlest tests: it returns the *same* node objects across
calls (so positions survive), refreshes metadata in place, and reports
`topologyChanged` only for real topology changes — a title edit must not reheat
the physics simulation, and node ordering must not be mistaken for a change.

Removing `THREE` entirely from the component was the incidental win: the
galaxy view no longer imports a 3D library directly.

### Why not to 450

What remains is 502 code lines of **10 `useEffect`s, 22 refs and 39 force-graph
API calls** — imperative WebGL wiring. This is the same position
`useGalaxyCameraDrive.ts` is in, and the same conclusion applies: the pure parts
have been extracted and tested, and what is left is glue that only means
anything against a live canvas.

Getting under 450 from here means splitting `GalaxyCanvas` itself, which would
hand the pieces a large shared ref surface — the prop-drilling trade again.
Not worth it for 52 lines.

### One honest note

`stepFlightTarget` made the file *grow* by 3 lines before the other extractions
brought it down: the call site with named arguments is longer than the inline
vector math it replaced. That extraction bought a tested NaN guard, not brevity,
and it was worth doing on those terms — but it is a reminder that "extract to
shrink the file" and "extract to make it testable" are different goals that
happen to coincide more often than not.

## `SetupPanel.tsx`: 703 → 425, and off the list

The second file to come fully under the ceiling (after `verbs.mjs`).

The earlier turn rejected splitting `SetupPanel` on the grounds that its
sections "close over ~15 state vars each" and extracting them would prop-drill.
**That was right about the symptom and wrong about the cure.** Measuring the
sections properly:

| Section | Lines | Value refs |
|---|---|---|
| gemini | 40 | 4 |
| **claude** | **163** | **14** |
| you | 106 | 9 |
| permissions | 9 | 4 |
| advanced | 12 | 1 |

Fourteen references is not the same problem as `App.tsx`'s 67 — and more
importantly, I checked **where those fourteen are used**. Every one of the
eleven state variables and four handlers behind the Claude section
(`claude`, `pipelinePrereqs`, `claudeToken`, `claudeTokenSet`,
`claudeTokenBusy`, `claudeTokenError`, `apiKey`, `apiKeySet`, `legacyArtifacts`,
`legacyReport`, `removingLegacy`, `checkClaude`, `applyCredential`,
`applyClaudeToken`, `removeLegacyArtifacts`) is used **only** inside it.

So the state moved *with* the UI that owns it, and `ClaudeSection` takes **two
props** — `config` and `onSaved` — rather than fourteen. That is the difference
between decomposing a component and merely relocating its JSX:

> If the state a section uses is used nowhere else, extracting it removes props.
> If it is shared, extracting it creates them. Count the *uses*, not the
> references.

`App.tsx` fails that test (its values genuinely feed many consumers), which is
why the `DeckShell` extraction was rejected and this one was not.

`TestBadge`, `BundledRow` and `TestState` also moved to `SetupControls.tsx`,
where the other shared presentational pieces already live — `TestBadge` is used
by both the Gemini and Claude steps, so it belonged there rather than in either.

### A gate caught me being sloppy

Removing `Check` and `X` from `SetupPanel`'s imports looked safe — lint said
they were unused. They were unused in **`ClaudeSection.tsx`**; `SetupPanel`
still uses both in its wizard summary. `tsc` caught it (`Cannot find name 'X'`)
while lint was reporting the *other* file, and the two read as contradictory
until I checked which file each was talking about. Another instance of the
earlier lesson: `npm test` alone would have missed it entirely.

# Final audit — where the 450-line convention stands

## The numbers

| | Start | Now |
|---|---|---|
| Files over the ceiling (**raw** lines) | 25 | 22 |
| Files over the ceiling (**code** lines — the real measure) | 6 | **5** |
| Tests | 1908 | **2095** |
| Test files | 106 | 121 |
| Gates | 5 green | 5 green |

Two files came off the list entirely: `electron/verbs.mjs` (666 → 204) and
`src/components/SetupPanel.tsx` (703 → 425).

Reductions on the rest: `App.tsx` 2226 → 1391 raw / **1422 → 1391 code**;
`second-brain.mjs` 1318 → 525 code; `VaultGalaxy.tsx` 1106 → 502;
`HudShell.tsx` 668 → 479.

## The five that remain, and why each stops here

| File | Code | Comment | Shape |
|---|---|---|---|
| `src/App.tsx` | 1391 | 22% | 48 state, 30 effects, 15 refs |
| `electron/canvas-mcp.mjs` | 585 | 19% | recorded pre-existing exception |
| `electron/capabilities/second-brain.mjs` | 525 | **43%** | capability factory over shared state |
| `src/components/VaultGalaxy.tsx` | 502 | 36% | 10 effects, 22 refs, force-graph wiring |
| `src/components/HudShell.tsx` | 479 | 11% | one render surface, 1 effect |

Each was tested against the rule this work produced:

> **Count uses, not references.** If the state a section uses is used nowhere
> else, extracting it *removes* props. If it is shared, extraction *creates*
> them.

- **`SetupPanel` passed** — the Claude step's 11 state variables and 4 handlers
  were used only there, so `ClaudeSection` takes 2 props, not 14. Done.
- **`App.tsx` fails** — a `DeckShell` would need **67** props, duplicating the
  65-prop `HudShell` problem the research already flagged as a defect.
- **`second-brain.mjs` fails** — the remaining clusters need 6 injected
  dependencies (two of them mutable), and `ipcHandlers` alone references 21
  closure functions.
- **`VaultGalaxy` fails** — what is left is 10 effects, 22 refs and force-graph
  API calls; the pure parts are already extracted and tested.

`second-brain.mjs` is worth a second look: it is **43% comment**. Its 525 code
lines carry 432 lines of recorded reasoning. That is the file behaving exactly
as the repo intends, not a file that got away.

## What the remaining work actually is

`App.tsx` is the only one where a real path exists, and it is architectural:
~67 loosely-related values live in one scope, and no amount of moving JSX
changes that number. Reducing it means grouping state behind cohesive objects —
a context, or hooks returning domain objects instead of loose tuples.

That is a design decision with real consequences (context re-renders in a tree
doing per-frame work with **zero memoization**), and it should be chosen
deliberately rather than imposed by whoever is reducing line counts. It is the
right candidate for an OpenSpec change.

## What was actually bought

The line counts are the least of it. Four guards now exist, and **each was
proven to fail correctly before being trusted**:

1. **File-size ratchet** (`check-file-size.mjs`, in the lint gate) — counts
   *code* lines. Verified: +3 comment lines green, +2 code lines red.
2. **Baseline updater** refuses to raise an entry without `--allow-growth` —
   closing a loophole I walked into myself, where rebaselining before linting
   made the ratchet unconditionally green.
3. **`harness-globs.test.mjs`** — a `.tsx` test file, previously invisible and
   silently uncollected, now fails the suite by name.
4. **`PIPELINE_ONLY_TOOLS` set-equality** — verified by deleting a tool and
   watching it go red.

And ~190 new tests, several of which pin things no type or lint check can see:
the `escapeHtml` XSS boundary, prompt-injection fencing of untrusted vault
titles, the listen-only **consent** rule, the ambient-capture live gates, and a
`NaN` guard that would otherwise put the camera nowhere with no error at all.

Two real defects were found and **pinned by test rather than fixed**, because
fixing them changes behavior and belongs in its own change: the gesture label
that promises `"Closed_Fist · turn the view"` when `driveFor` binds nothing, and
the HUD dwell that diverges from `galaxy-nav`'s.

## Where I stopped, and why it was a choice

`HudShell.tsx` sits at **462** — twelve lines over the ceiling.

I could have crossed it. The `hud-camera-controls` block (the size toggle and
the REC-stamp toggle) is a coherent island of roughly the right size, and
extracting it would have landed the file at ~449.

I did not, and the reason matters more than the twelve lines: **I would have
been extracting it to cross a threshold, not because the code asked for it.**
`stampOn` is shared between those controls and `HudCamera`, so by this work's
own rule — count uses, not references — pulling the controls out *creates*
props rather than removing them. It is a defensible split on its own merits and
a bad one if the number is the reason.

That is the same failure mode I criticised the raw-line ratchet for: a gate that
makes people do the wrong thing to satisfy it. Having changed the measure
specifically so it would stop pushing authors to delete comments, it would be
incoherent to then let it push me into a split I would not otherwise make.

`HudReviewStack` (extracted just before this) is the contrast: `claudeQuestion`
and `taskReview` were used **nowhere else** in the shell, so it takes two props,
removes them from the parent, and carries its own precedence rule — a pending
question outranks a parked review because it blocks a token-burning run. That
one earns its existence independently of any line count.

**Final: five files over the ceiling, all documented, none of them a surprise.**

## An incident, and what it cost

Partway through I ran `git checkout -- src/App.tsx` intending to revert **one**
just-made extraction. `App.tsx` is a tracked file, so that reverted it to HEAD
and destroyed **every** change made to it this session — 1422 → 891 became 1630,
55 state bindings came back, and all fifteen hook/router wirings vanished.

**What saved it:** the extractions had produced *separate files*. All 14 hooks,
all the `src/lib/` modules and all their tests were untracked-new and untouched
by a checkout of `App.tsx`. Only the wiring was lost. Recovery was:

1. restore from a staging snapshot left in `/tmp` (12 hooks already wired),
2. re-apply the task-4.2 renames,
3. re-apply tasks 4.4, 4.5 and 4.6 from the notes in this log.

Verified complete by the suite: **2169 tests, all five gates green**, 7 state
bindings, all fifteen wirings present.

Two things are worth taking from it:

- **The decomposition is what made recovery possible.** Had this work been one
  large edit to a single file, the checkout would have been unrecoverable. The
  file that was destroyed was the one holding the least of the actual work.
- **`git checkout -- <tracked file>` is not a scoped undo.** It reverts to HEAD,
  not to a previous edit. With ~100 uncommitted files in the tree, that is a
  destructive command wearing an ordinary name. The repo's own `PreToolUse`
  destructive-command guard covers this class of mistake for Claude Code; it did
  not apply here because the command ran from a different tool.

The recovered file measures **893** rather than the 891 recorded before the
incident — a two-line difference from the staging snapshot, in real code, not
comments. I banked it with `--allow-growth` rather than quietly editing the
baseline, since that is exactly the case the flag exists to make visible.

## Final audit — the five files still over the ceiling

Measured in **code lines** (comments and blanks excluded), all five gates green,
2188 tests.

| File | Now | Was | Verdict |
|---|---|---|---|
| `src/App.tsx` | 747 | 1422 | −47%. 286 lines are JSX composition — the composition root's actual job. Reaching 450 needs logic 461 → 164, i.e. splitting the JSX; measured and rejected (a `DeckShell` would take 46 props, 32 of them still loose). |
| `electron/canvas-mcp.mjs` | 585 | 585 | **Recorded pre-existing exception** in `main-process-structure/spec.md`; its split is an explicit non-goal tracked as a follow-up. Untouched deliberately. |
| `src/components/VaultGalaxy.tsx` | 502 | 1106 | −55%. What remains is 10 effects, 22 refs and 39 force-graph calls — imperative WebGL wiring. The pure parts are extracted and tested. |
| `electron/capabilities/second-brain.mjs` | 478 | 1318 | −64%, and **43% comment**. Remaining clusters share the capability's core mutable state: `promptFragment` needs 11 outer dependencies, `ipcHandlers` references 21 closures. Extraction would *create* an interface, not remove one. |
| `src/components/HudShell.tsx` | 462 | 668 | −31%. Twelve lines over, deliberately: the only candidate shares `stampOn` with `HudCamera`, so extracting it creates props. A threshold-driven split was refused. |

Two files came off the list entirely: `electron/verbs.mjs` (666 → 204) and
`src/components/SetupPanel.tsx` (703 → 425).

**The honest summary:** every remaining file is either a recorded exception or
has been measured against the same rule — *count uses, not references; extract
only to shrink the file or to make something testable* — and found to be at a
floor where further splitting would make the codebase worse. That is a
different claim from "the work is finished", and it is the one the evidence
supports.

## Closing three coverage gaps the research found and the refactor never touched

The line-count work reached measured floors, so this addresses the *other* half
of the original research: modules with no test at all. All three were named in
`harness-findings.md` and none had been acted on.

- **`electron/untrusted-text.mjs`** — a **prompt-injection boundary** that was
  exercised only *through* its callers, so a weakening would have surfaced as
  someone else's test failing, or not at all. 11 tests now cover both layers
  separately: neutralising a forged `SYSTEM_EVENT_` marker or region delimiter
  **without destroying it** (a run reviewing this repo legitimately contains the
  string `SYSTEM_EVENT_CLAUDE_COMPLETE`), and the per-call random fence token
  that stops a payload closing the fence early and continuing as instructions.

- **`electron/hotkeys.mjs`** — **zero coverage, direct or indirect.** Its header
  states the defect it exists to prevent: the accelerator is registered by
  `main.mjs` and reported to the renderer by `user-config.mjs`, and a default
  that drifted between them means "a prompt telling the user to press a key that
  does nothing". 8 tests pin that neither reader hardcodes its own copy, and
  that wake/sleep stay modifier-qualified — a bare letter would be swallowed
  OS-wide, and `Alt+W`/`Alt+S` are the character-entry chords for ∑ and ß.

- **`electron/preload.cjs`** — the entire renderer↔main contract, and **no gate
  read it**: both import-graph tests are `.mjs`-only and `tsc` does not cover
  it, so a renamed channel was caught by nothing. The test loads it for real
  with a stubbed `electron` rather than grepping the source, so the assertions
  are about the surface actually exposed. **Verified by breaking it**: renaming
  `"sidecar:start"` to `"sidecar:START"` turns the suite red.

It also asserts two things the repo cares about independently: the bridge
exposes *only functions* (no object to reach through, no Electron internals),
and every `on*` subscription returns an unsubscribe.

Both gates then caught an unused import in the new test file itself — `tsc` via
`npm run build` and oxlint via the zero-warning rule. Worth noting because it is
the fourth time this session that `npm test` alone would have passed.

## The research's #1 finding, finally acted on

`harness-findings.md` ranked **"there is no CI"** as the single highest-impact
gap — Critical, High likelihood — and it stayed true through all of the
refactoring above. All five gates ran **only** in the maintainer's Claude Code
hooks, so a commit made from a terminal, another editor, or any other tool was
completely ungated.

`.github/workflows/gates.yml` adds no new check. It makes the excellent checks
that already existed apply to every push and pull request.

Three details are deliberate and should survive later tidying:

- **`npm run scan:secrets` is not used.** It supports only `--staged`, and CI
  has nothing staged — it would scan zero bytes and pass. The gitleaks action
  scans the checkout with `fetch-depth: 0` so it sees history instead. (The
  research also noted the `gitleaks` npm package is an impostor; the official
  action is what this uses.)
- **`public/runtime/` is cached.** `npm run build` vendors ~49 MB of WASM and
  model assets, two of them fetched over the network. The key is the lockfile
  plus `scripts/vendor-runtime-assets.mjs`, so a dependency bump or a change to
  what is vendored re-fetches and nothing else does.
- **Node comes from `.nvmrc`,** not a number repeated in the workflow that could
  drift from `engines.node` (`>=24`, with `engine-strict=true`).

It runs on `macos-latest` because Iris is macOS-only and refuses to launch
elsewhere; gating on Linux would test a platform the app does not support.

Verified: the YAML parses, all five gate commands are present, `.nvmrc` exists
and reads `24`, `public/runtime/` is the real vendor destination (49 MB,
gitignored, so caching it is meaningful rather than redundant), and every gate
passes locally as written.

## `HudShell` comes off the list — a deferred judgment expiring for the third time

`HudShell` sat at 462 for many turns, twelve lines over, and I twice declined to
split it. The stated reason was that its only extraction candidate — the
camera controls — shares `stampOn` with `HudCamera`, so pulling the controls out
would **create** props rather than remove them. That was correct.

What I had not checked was **where those two things actually live**. Both the
controls and `HudCamera` are inside the same `hud-left` column, and `stampOn`'s
only uses are its declaration and four references inside it.

So the right cut was never "extract the controls" — it was **extract the
column**, and let the state go with it. `HudLeftColumn` now owns `stampOn`, and
the comment that always justified its placement finally describes where it
actually is:

> owned here because the control sits in this column beside the camera-size
> button while the stamp it drives renders inside the frame

**462 → 385.** Under the ceiling, and the fourth file to come off the list.

This is the third time in this work that a "do not extract" judgment expired
once its premise changed (`handleSidecarEvent` was the first, `SetupPanel` the
second). The pattern is consistent enough to state plainly:

> A deferral is a claim about the code *as it is now*. After the surrounding
> shape changes, re-measure it rather than inheriting the conclusion.

The measurement that mattered here took one command — listing every use of
`stampOn` and checking which fell inside the region — and it overturned a
decision I had repeated twice.

## `VaultGalaxy` comes off the list too — the same check, the same result

Having just been wrong about `HudShell`, I applied the identical measurement to
`VaultGalaxy` (502) instead of inheriting my earlier conclusion that what
remained was "irreducible imperative WebGL wiring".

It was wrong in the same way. Four bindings — `railQuery`, `railMatches`,
`railCentreId`, `railLocked` — plus a debounced search effect, a voice/typed
reconciliation, and three memoised derivations form **the step rail**, a
complete domain that had nothing to do with the WebGL wiring it was interleaved
with. `useGalaxyRail` now owns all of it.

Two properties travelled with it that were easy to lose in that interleaving:

- **Matching happens in main, not in the renderer.** One local IPC round trip
  per debounced keystroke instead of a synchronous array filter, bought with the
  guarantee that what the user *hears* from Iris and what they *see* in the rail
  cannot disagree. If it ever reads as laggy the answer is a shorter debounce,
  never a second matcher.
- **A spoken answer must not re-ask.** When Iris answers a lookup by voice the
  result is mirrored into the field; without the claim flag that would trip the
  debounce and spend a second vault scan — a filesystem walk, not a cache read —
  to be told what Iris just said.

`GalaxyErrorBoundary` also moved to its own file. It is a **safety mechanism,
not error cosmetics**: the galaxy is a fullscreen layer that disables
click-through, so a crashed layer left mounted would sit over the whole desktop
trapping every click with no way out.

**502 → 438.** Fifth file off the list, and the violator count is now **3**,
one of which is the recorded exception.

### The scoreboard on my own deferrals

Four "do not extract" judgments, re-measured after the surrounding shape
changed: `handleSidecarEvent`, `SetupPanel`, `HudShell`, `VaultGalaxy` — **all
four were overturned**. Every one of them cost a single measurement to check.
The lesson is not that the original calls were careless; each was correct when
made. It is that a deferral silently becomes a claim about code that no longer
exists.

## `second-brain.mjs`: the path guard comes out — and gets a real test

Re-measured rather than inherited, per the lesson. This one **partly** confirmed
the earlier conclusion: `focusState` (13 uses), `latestGraph` (12) and
`openNoteId` (10) really are spread across the resolvers *and* the 229-line IPC
handler list, so the note/focus state is genuinely shared here in a way
`HudShell`'s `stampOn` was not.

But the same re-measurement found something better than a line saving.

`resolveVaultNotePath` is a **security boundary** — the guard behind the spec's
"SHALL NOT accept a filesystem path from the renderer or from a model". It takes
only an id, resolves it through the graph, and re-checks the result against the
vault **after** `realpath` on both sides so a symlink cannot be followed out. It
had **two dependencies** and **no test**, because it was a closure inside a
1300-line capability.

`second-brain-note-path.mjs` + 8 tests, run against a **real temp vault with a
real symlink** — the point is what the filesystem does, not what a mock says it
does:

- rejects a non-string, an empty string, and an over-long id before touching disk
- rejects a ghost node, an unknown id and a since-removed file
- **refuses a symlink inside the vault that points out of it**
- refuses a sibling directory whose name merely starts with the vault's name
- still resolves notes when the *vault itself* is reached through a symlink —
  `realpath` must be applied to **both** sides, or a symlinked vault rejects
  every one of its own notes

Verified by breaking it: comparing before resolving symlinks (the classic
version of this mistake) turns the suite red.

One detail worth noting — the extraction initially used `"/"` where the original
used `path.sep`. Caught by diffing against the original rather than by a test,
which is the same discipline that caught the `open_current_claude_result`
fallback change earlier.

**478 → 468.** Ten lines; the test is the point.

## `second-brain.mjs` again: handlers beside their state, and one bound in one place

Two more cuts, both from the same rule rather than from hunting lines.

**The ambient IPC channels moved into `ambient-capture.mjs`.** They only ever
touch `ambient.*`, so declaring them beside the state they mutate means a
handler and its state cannot drift apart — the same reasoning that moved
`chooseSession`/`createSession` into `useSessions`. The capability now spreads
them into its own list. Four tests came with them, including that a malformed
payload coerces to *off* rather than enabling retention.

**The note-id check became one function.** `typeof id !== "string" ||
id.length === 0 || id.length > 512` appeared **three times** — in the path
resolver and at both the `set-focus` and `note-opened` entry points. Every one
of those is a place where a renderer XSS or a model can pass anything, and three
copies of a bound is how one of them ends up different. It is now `isNoteId`,
next to `MAX_NOTE_ID_LENGTH`, with a test for the boundary itself.

**468 → 457.** Seven lines over the ceiling, and both changes are worth more
than the count: one removes a class of drift, the other puts a guard where its
state is.
