# Renderer improvement research — `src/`

**Scope:** the renderer only (`src/`). No code was changed; nothing was installed.
**Method:** read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`,
`openspec/specs/renderer-structure/spec.md`, `openspec/specs/test-harness/spec.md`,
`openspec/specs/setup-panel/spec.md`, `openspec/specs/main-thread-budget/spec.md`,
then read `src/App.tsx`, `src/components/{VaultGalaxy,SetupPanel,HudShell,DrawingCanvas}.tsx`
and `src/hooks/*` end to end, plus `electron/preload.cjs` where the renderer's
IPC contract is defined.

**Two constraints shape every recommendation below.**

1. The repo's file-size convention is **250–450 lines, one responsibility per file**
   (`CLAUDE.md`, "Conventions"). Current renderer sizes:
   `App.tsx` **2226**, `VaultGalaxy.tsx` **1106**, `SetupPanel.tsx` **858**,
   `useGalaxyCameraDrive.ts` **811**, `HudShell.tsx` **667**, `DrawingCanvas.tsx` **653**,
   `EyeReadout.tsx` **555**, `galaxy-nav.ts` **547**, `eye-hud.ts` **538**,
   `useAudioPipeline.ts` **531**, `PermissionsStep.tsx` **531**.
2. The test harness runs `src/**/*.test.ts` in a **`node` environment**
   (`vitest.config.ts`, the `unit` project) with no jsdom bootstrap, no
   `@testing-library/react`, and no React renderer in `devDependencies`. **A component
   cannot be mounted in a test in this repo.** Therefore "what test would pin it" always
   means: *extract the decision as a pure function under `src/lib/` and table-test it* —
   which is exactly the pattern `src/lib/tasks.ts`, `src/lib/galaxy-nav.ts`,
   `src/lib/hud-interactivity.ts` and `DrawingCanvas.tsx`'s exported helpers already
   follow. `DrawingCanvas.tsx` is the model in this tree: 653 lines, but ~230 of them are
   **exported pure helpers** (`echoGuard`, `stagePush`, `rebasePush`, `mergeElementsById`,
   `elementsBounds`, `viewportSceneRect`, `boundsVisible` — `DrawingCanvas.tsx:52-257`)
   pinned by two test files. Every seam proposed here is that shape.

---

## Ranked findings

Impact = how much correctness/navigability/perf is bought. Risk = chance the change
breaks shipped behavior. Ordered by impact ÷ risk.

| # | Finding | Evidence | Impact | Risk | Ratio |
|---|---|---|---|---|---|
| 1 | **Dead feature contradicting a `SHALL`**: "Load demo / test data" is offered, persisted, and consumed by nothing | `SetupPanel.tsx:642-658`, `electron/user-config.mjs:163,251`, `src/vite-env.d.ts:170`; **zero** consumers anywhere | High | Very low | ★★★★★ |
| 2 | **Task-card reduction is 135 lines of untested logic inside a component** | `App.tsx:1260-1314` inside `handleSidecarEvent` (`:1179-1413`) | High | Low | ★★★★★ |
| 3 | **8 copy-pasted localStorage loaders + 6 copy-pasted writers** | `App.tsx:72-136`, `345-391`, `397-405`, `469-489`, `724-730`; ninth copy in `VaultGalaxy.tsx:147-152` | Med-High | Very low | ★★★★★ |
| 4 | **`App.tsx` is a God component**: 2226 lines, 55 `useState`, ~30 `useEffect`, 45 `window.iris` calls, 3 rAF loops | whole file; ~5× the stated convention | High | Med | ★★★★ |
| 5 | **Three rAF loops run unconditionally, even with hand control off and the window blurred** | `App.tsx:1495-1556`, `1560-1594`, `1608-1650` vs. the WebGL pause discipline at `:533-551`, `:1005-1008` | Med-High | Low | ★★★★ |
| 6 | **The gesture-label matrix is an inline 57-line decision table that must mirror `galaxy-nav.ts` and cannot be tested** | `App.tsx:1665-1721`; the code says so itself at `:1679-1685` | Med-High | Very low | ★★★★ |
| 7 | **`useGalaxyCameraDrive` — 811 lines, one 360-line rAF `loop()`, self-declared untestable** | `useGalaxyCameraDrive.ts:339-700`; the comment at `:429-431` states "There is no test over this hook" | High | Med-High | ★★★ |
| 8 | **`hasBridge` guard applied inconsistently — 6 unguarded `window.iris` call sites** | guard defined `App.tsx:311`; unguarded at `:438`, `:453-458`, `:466`, `:883`, `:902-906`, `:1910` | Med | Very low | ★★★★ |
| 9 | **`VaultGalaxy.GalaxyCanvas` holds five unrelated responsibilities in one 630-line component** | `VaultGalaxy.tsx:343-977` | Med-High | Med | ★★★ |
| 10 | **Voice `control_ui` dispatch resubscribes an IPC listener on every task-stream event** | `App.tsx:1810-1861` (deps include `tasks`, `sortedTasks`) vs. the ref-dispatch pattern already used at `:612-615` | Med | Very low | ★★★★ |
| 11 | **`AskUserQuestion` pick/submit rules (multi-select) are untested renderer logic on a spec'd path** | `App.tsx:1120-1150` | Med | Very low | ★★★★ |
| 12 | **65-prop `HudShell`; 23 props duplicated verbatim into `CenterStage`, 12 into `CameraDock`** | `App.tsx:1930-2007` / `2057-2088` / `2040-2053`; `HudShell.tsx:161-340` | Med | Med | ★★★ |
| 13 | **`SetupPanel` = 5 inline section blobs + credential I/O + two layouts in one file** | `SetupPanel.tsx:274-324`, `325-487`, `488-627`, `633-640`, `642-658`, `661-705`, `707-800` | Med | Low | ★★★ |
| 14 | **Zero memoization in the renderer; per-frame dwell state re-renders the whole app** | `grep React.memo\|useCallback` in `components/` = 0 hits, `App.tsx` `useCallback` = 0; `App.tsx:1497-1500` | Med | Med | ★★ |
| 15 | **8 of 10 hooks and 51 of 52 components have no test at all** | only `useAudioPipeline.test.ts`, `DrawingCanvas.{echo,merge}.test.ts` exist | Med | Low | ★★★ |
| 16 | **Spec text vs. code: `renderer-structure` names `App.tsx` as the IPC wiring point; 6 components + 3 hooks call `window.iris` directly** | spec `renderer-structure/spec.md` "Requirement: Modular renderer layout"; `DrawingCanvas(13)`, `SetupPanel(10)`, `PermissionsStep(8)`, `VaultGalaxy(5)`, `NoteReader(2)`, `HudShell(1)`, `useSystemTelemetry(3)`, `useTokenLedger(2)`, `useAudioPipeline(1)` | Low-Med | Low | ★★ |
| 17 | **`HudShell` defines a presentational sub-component inline and owns three pieces of local state** | `HudShell.tsx:43-154` (`HudCamera`), `:349`, `:356`, `:364-372` | Low-Med | Low | ★★ |

---

## 1. Dead feature that a living spec still promises — `IRIS_LOAD_TEST_DATA`

**Evidence.** `SetupPanel.tsx:642-658` renders an "Advanced → Load demo / test data"
control whose note reads *"Fills the Work Stream with sample task cards for exploring the
UI."* The value is persisted (`electron/user-config.mjs:163` allow-list, `:251`
`loadTestData: envFlag("IRIS_LOAD_TEST_DATA", false)`) and typed
(`src/vite-env.d.ts:170`). A whole-tree grep for `loadTestData` / `IRIS_LOAD_TEST_DATA`
returns **only those five lines** — no consumer in `electron/`, none in `src/`. There is
no task seeding anywhere: grep for `sample task`, `seedTasks`, `demo` finds nothing but
the panel's own copy.

`openspec/specs/setup-panel/spec.md:3,7` requires the panel to offer "toggles for wake
word, interface sounds, **demo test data**, and Google Search". So the spec is satisfied
by the letter (a toggle exists) and violated in substance (it fills nothing). This is
precisely the failure mode `docs/TESTING.md` describes for `pipeline-availability`: a
requirement whose scenarios and whose implementation drifted apart with no gate to notice.

**Seam.** Two honest resolutions, both through an OpenSpec change, never a silent edit:
(a) delete the control, the `Draft` field (`SetupPanel.tsx:16,82,648-653`), the config
key and the `IrisConfig` field, and remove "demo test data" from the spec's requirement
sentence; or (b) implement the seeding — a `src/lib/demo-tasks.ts` exporting
`demoTasks(): TaskCard[]`, mounted by `App.tsx` when `fullConfig.loadTestData`.

**Test that pins it.** For (a) nothing — the deletion *is* the fix, and
`npm run spec:check` plus the updated requirement carry it. For (b),
`src/lib/demo-tasks.test.ts`: every produced card satisfies the invariants the real
reducer produces (unique `id`, `status` in the known set, `updatedAt` monotone), so a
demo card cannot be a shape the Work Stream has never seen.

---

## 2. The sidecar task reducer belongs in `src/lib/tasks.ts`

**Evidence.** `handleSidecarEvent` (`App.tsx:1179-1413`) is a 235-line if-chain over 16
event types writing 15 different `useState` setters. Its `claude_task_update` branch
(`:1260-1314`) is the interesting part and the only genuinely *algorithmic* one: it opens
a step on `phase === "tool_start"` keyed by Claude's `tool_id`, closes it on `tool_end`,
merges `output`/`error` through `resolveMergedString`, preserves `verb`/`model`/
`claudeSessionId`/`usage` from the existing card, caps steps at 40 and cards at 20, and
de-duplicates against the `taskKeyFor(task)` placeholder id (`:1280`, `:1311`). Every one
of those rules is a correctness rule (the comment at `:1273-1275` records that a `usage`
figure "must never overwrite a figure already recorded"), and **none of them is tested** —
`src/lib/tasks.test.ts` covers the small helpers this branch calls, not the merge itself.
The same file also holds the completion sweep at `:1386-1395` that force-closes running
steps, which must agree with the merge rules and today only does so by inspection.

**Seam.** `src/lib/task-stream.ts`:

```ts
export function applyTaskUpdate(tasks: TaskCard[], event: SidecarEvent): TaskCard[];
export function closeRunningSteps(tasks: TaskCard[], runId: string): TaskCard[];
```

Both pure `(state, event) -> state`. `App.tsx` becomes
`setTasks((current) => applyTaskUpdate(current, event))`.

**Test that pins it** — `src/lib/task-stream.test.ts`, node env, no React:
a `tool_start` then `tool_end` pair closes exactly the matching step and leaves siblings
untouched; an `error: true` `tool_end` yields `status: "error"`; a late update with no
`usage` does not erase a recorded `usage`; a real `run_id` arriving after a
`taskKeyFor`-placeholder card replaces it rather than duplicating; the 40-step and
20-card caps hold; `closeRunningSteps` is a no-op for an unknown `run_id`.

**Risk: low.** Pure move of an existing expression; the call site shrinks to one line.

---

## 3. Nine copies of "read a flag from localStorage, fall back safely"

**Evidence.** `App.tsx:72-136` defines eight loaders that differ only in key and default:
`loadSoundsEnabled` (`!== "off"`), `loadHandEnabled`, `loadCameraDeviceId`,
`loadMicDeviceId`, `loadWebglHighFidelity`, `loadAmbientCaptureEnabled`,
`loadHudCameraEnlarged`, `loadListenOnlyConsentSeen` — each with its own `try/catch`
returning a hand-written default. The write side repeats the same block five more times:
`toggleSounds` (`:345-355`), `toggleHand` (`:357-367`), `toggleHudCameraSize`
(`:369-379`), `toggleWebglQuality` (`:381-391`), `setAmbientCapturePreference`
(`:397-405`), plus `setCameraDeviceId` (`:469-476`), `applyMicDeviceId` (`:482-489`) and
the consent write at `:724-730`. `VaultGalaxy.tsx:147-152` is a ninth copy of the read
half. Each carries an identical "Best-effort persistence" comment; the defaults are the
only thing that varies, and the defaults are exactly what the specs care about
(`AMBIENT_CAPTURE_STORAGE_KEY` at `:58-60` and `HUD_CAMERA_SIZE_STORAGE_KEY` at `:61-65`
both carry paragraph-long comments explaining why *their* default differs).

**Seam.** `src/lib/preferences.ts` — a declared table plus two pure functions and one hook:

```ts
export const PREFS = {
  sounds:        { key: "iris.soundsEnabled",        default: true  },
  hand:          { key: "iris.handControlEnabled",   default: false },
  hudCameraBig:  { key: "iris.hudCameraEnlarged",    default: false },
  ambient:       { key: "iris.ambientCaptureEnabled",default: false },
  listenConsent: { key: "iris.listenOnlyConsentSeen",default: false },
} as const;
export function readFlag(storage: Pick<Storage,"getItem">|null, pref: PrefName): boolean;
export function writeFlag(storage: Pick<Storage,"setItem">|null, pref: PrefName, on: boolean): void;
// src/hooks/usePersistedFlag.ts — thin wrapper returning [value, toggle]
```

Device ids keep their own `readDeviceId`/`writeDeviceId` pair (string-valued, defaults
`SYSTEM_DEFAULT_*`), and `webglHighFidelity` keeps delegating to the already-tested
`readWebglHighFidelity`.

**Test that pins it** — `src/lib/preferences.test.ts` with a fake storage object:
absent key ⇒ documented default **per preference** (this is the whole point: `sounds`
defaults *on*, everything else *off*); `"off"`/`"on"`/garbage each map correctly;
a `getItem` that throws ⇒ default, not a crash; a `setItem` that throws ⇒ no throw and
the in-memory value still flips; `null` storage (no `window`) ⇒ defaults. Roughly 120
lines of `App.tsx` disappear and every spec'd default becomes an assertion instead of a
comment.

---

## 4. `App.tsx` — the God component, and the order to dismantle it

**Evidence.** 2226 lines against a 250–450 convention. 55 `useState` declarations
(`:162-303`), ~30 `useEffect`s, 45 `window.iris.*` call sites, 3 rAF loops, one 235-line
event handler, one 300-line JSX return. The `renderer-structure` spec's requirement —
"`src/App.tsx` acting solely as the orchestrator (state, IPC wiring, and composition — no
inlined presentational components)" — is *literally* satisfied (there are no inlined
presentational components; every one named in the spec's scenario is its own file), but
the requirement's own word "orchestrator" no longer describes a file that owns the dwell
state machine, the palm-scroll physics (`:1579-1587`), the orb rotation integrator
(`:1622-1644`), the thinking detector's threshold constants (`:589-598`) and the
gesture-label matrix.

**Seam — extract in this order, each independently shippable:**

| Order | Module | Interface | Lines removed from `App.tsx` |
|---|---|---|---|
| 1 | `lib/task-stream.ts` (finding 2) | `applyTaskUpdate`, `closeRunningSteps` | ~60 |
| 2 | `lib/preferences.ts` + `hooks/usePersistedFlag.ts` (finding 3) | table + `readFlag`/`writeFlag` | ~120 |
| 3 | `lib/hand-action-label.ts` (finding 6) | `handActionLabel(ctx, hand, dwellActive)` | ~60 |
| 4 | `hooks/useDwellClick.ts`, `hooks/usePalmScroll.ts`, `hooks/useOrbGesture.ts` (finding 5) | see below | ~170 |
| 5 | `hooks/useListenOnlyMode.ts` | `{ engaged, deadlineAt, notice, heardLive, toggle, dismiss }` from `:264-276`, `:704-757`, `:1235-1244` | ~110 |
| 6 | `hooks/useAmbientCapture.ts` | `{ enabled, live, forcedOff, setEnabled, stop }` from `:300-303`, `:397-416`, `:763-774` | ~50 |
| 7 | `hooks/useHudMode.ts` | `{ uiMode, modeTransition, exitHud }` from `:235-237`, `:667-697`, `:776-778`, `:800-872` | ~110 |
| 8 | `hooks/useClaudeSessions.ts` | `{ sessions, activeSessionId, activeSession, verbs, choose, create, chooseProjectFolder, setVerbModel }` from `:200-202`, `:1025-1112` | ~110 |
| 9 | `lib/ui-action.ts` + `hooks/useVoiceUiControl.ts` (finding 10) | `resolveUiAction(...)` | ~90 |
| 10 | `lib/claude-answers.ts` (finding 11) | `nextPicks`, `isComplete` | ~30 |

That is ~900 lines, landing `App.tsx` near 1200-1300 — still over convention, with the
remaining bulk being the 300-line composition JSX (`:1927-2226`), which is what an
orchestrator legitimately is. A further split of the JSX into `<DeckLayout/>` and the
overlay stack would take it under 900.

**Risk: medium overall, low per step** — each row above is a pure move with an unchanged
call site; the risk is cumulative churn in the single most-edited file in the tree
(62 commits touching `App.tsx` in six months, the highest in `src/`).

---

## 5. Three rAF loops that never stop

**Evidence.** `App.tsx:1495-1556` (dwell-to-click), `:1560-1594` (palm hold-to-scroll)
and `:1608-1650` (orb rotate/scale) each start `requestAnimationFrame(loop)`
**unconditionally** at the end of their effect body and test their gate *inside* the
frame (`if (!handControl || ...) { …; raf = requestAnimationFrame(loop); return; }`,
`:1507-1512`). With hand control off — the default (`loadHandEnabled` returns `false`
unless the key is `"on"`, `:80-86`) — the app still runs three rAF callbacks per frame
forever, two of which call `document.elementFromPoint` when the gate passes
(`:1514`, `:1573`), which forces layout.

That sits against the discipline the same file establishes for WebGL: `windowFocused`
(`:165`, `:533-551`) exists so the backdrop and orb loops pause at **0 GPU** when the
window is blurred (`surfaceActivity`, `:1005-1008`, consumed via `surfaceAdvancesFrames`).
The gesture loops honour neither `windowFocused` nor `handControl`. `main-thread-budget`
is explicitly about keeping "the renderer's main/UI thread free of avoidable per-frame
work … so garbage-collection pauses and audio-processing callbacks don't jitter the
24 kHz Gemini audio playback schedule" — this is avoidable per-frame work on the main
thread, and the HUD's own click-through loop already demonstrates the right shape
(`:800-836` returns early and registers nothing when `uiMode !== "hud"`).

A second, smaller defect lives inside them: the "a fullscreen layer owns the point under
the hand" predicate is written twice, differently —
`(drawingActive || secondBrainActive) && !isHudChrome(actionable)` at `:1529` and
`(drawingActive || secondBrainActive) && !isHudChrome(el)` at `:1576`. One reads the
resolved actionable ancestor, the other the raw hit element. They are meant to be the
same rule.

**Seam.**
- `src/hooks/useDwellClick.ts` — `useDwellClick({ enabled, handRef, suppressed, onFocusTask }) => { dwellActive, dwellFired }`, where `enabled = handControl && windowFocused` short-circuits **before** the first `requestAnimationFrame`.
- `src/hooks/usePalmScroll.ts` — same gate, same shape.
- `src/hooks/useOrbGesture.ts` — writes `orbRotationRef`/`orbScaleRef`, gate = `orbGestureEngaged(...)` (already a tested lib function, `lib/gestureContext.ts`).
- `src/lib/layer-ownership.ts` — `layerOwnsPoint({ drawingActive, secondBrainActive }, el)`, the one predicate both loops call.
- `src/lib/dwell.ts` — `stepDwell(state, { target, now, holdMs }) => { state, fire }`, the 300 ms machine at `:1541-1551` as data.
- `src/lib/palm-scroll.ts` — `scrollDelta({ pointerY, rect, deadZoneRatio, step })`, the physics at `:1579-1587`.

**Tests that pin it** — `dwell.test.ts`: re-entering the same element does not re-fire
until it is left; a target change resets `startedAt`; nothing fires before `holdMs`.
`palm-scroll.test.ts`: inside the dead zone ⇒ 0; the `max(24, height*0.12)` floor holds
for a short container; the normalized delta clamps to ±1 at the edges; sign is preserved.
`layer-ownership.test.ts`: chrome above an open layer keeps its bindings; the layer's own
surface is suppressed; no layer open ⇒ never suppressed.

**Risk: low** — the gates are additive and the extracted maths is copied verbatim; the
observable change is that a machine with hand control off stops scheduling three
callbacks a frame.

---

## 6. The gesture-label matrix

**Evidence.** `App.tsx:1665-1721` is a 57-line `useMemo` returning `{ label, tone }`
across three contexts (reader / galaxy / deck) and six poses. Its own comment
(`:1679-1685`) states the requirement: *"Mirrors `driveFor`'s pose partition
(src/lib/galaxy-nav.ts) so the indicator names the binding actually live"* — and then
records a bug this exact structure already caused (reading `pinchDistance`, which
`semanticEquals` excludes from republishing, so the label froze). `driveFor` is tested
(`lib/galaxy-nav.test.ts`, 588 lines). Its mirror is not, and the two live in different
files with no mechanism keeping them aligned.

**Seam.** `src/lib/hand-action-label.ts`:

```ts
export type HandAction = { label: string; tone: "idle" | "open" | "fist" | "move" };
export function handActionLabel(
  context: GestureContext,                       // from lib/gestureContext.ts
  hand: Pick<HandState, "present"|"hands"|"fist"|"openPalm"|"pointing"|"gesture">,
  ui: { dwellActive: boolean; drawingActive: boolean; uiMode: UiMode },
): HandAction;
```

**Test that pins it** — `hand-action-label.test.ts`: a table over
(context × pose) asserting the label; and the alignment test that matters —
for every hand fixture in the galaxy context, `handActionLabel(...).label` names the same
binding `driveFor(hand, …)` returns, so a change to one partition fails the other's test
instead of silently mislabelling the HUD.

**Risk: very low** — pure function, single call site, and it buys a regression test for a
bug class that has already shipped once.

---

## 7. `useGalaxyCameraDrive` — 811 lines and a documented testability gap

**Evidence.** One `useEffect` (`:161-810`) containing a 360-line `loop()` (`:339-700`)
plus six helpers, holding 14 refs of drive state (`:112-152`). It already delegates its
*decisions* to tested libs (`driveFor`, `pickZoomTarget`, `zoomLockStep`,
`aimPoint`, `hudChromeAtPoint` in `galaxy-nav.ts`/`hudChrome.ts`) — which is why the file
is coherent at all — but the **sequencing** between them is not extracted, and the code
says so at `:429-431`: *"There is no test over this hook (it needs a live force-graph and
a camera), so the invariant has to hold structurally or not at all."* That is an accurate
statement of a real gap, not an excuse: the invariant in question (the fist drive exists
iff there is a pivot to work around) is exactly the kind of thing a table test settles.

**Seam.** Separate *decide* from *do*:

```ts
// src/lib/galaxy-drive-step.ts
export type DriveFrame = { now, dt, hand, aim, rect, cameraPos, anchor, candidateId, lock };
export type DriveCommand =
  | { kind: "camera"; position: Vec3; target: Vec3 }
  | { kind: "anchor"; anchor: GalaxyAnchor; ease: boolean }
  | { kind: "handTarget"; id: string | null }
  | { kind: "rings"; engaged: boolean; acquiringId: string | null; progress: number }
  | { kind: "openNote"; id: string } | { kind: "forceClose" };
export function stepDrive(state: DriveState, frame: DriveFrame): { state: DriveState; commands: DriveCommand[] };
```

The hook keeps `fgRef`/THREE/DOM writes and becomes a thin executor of `commands`
(target ≈ 250 lines), while `stepDrive` is pure over plain numbers.

**Test that pins it** — `galaxy-drive-step.test.ts`: a lowered hand emits
`handTarget:null` + `rings:{engaged:false}` and no `camera` command; a reader-open frame
emits nothing but the restore commands; the fist-drive-implies-pivot invariant the
comment describes becomes an assertion over a frame sequence; a zoom lock survives the
second palm coming up (the `candidateId:null ⇒ keep the lock` rule at `:392-396`).

**Risk: medium-high** — this is the most intricate code in the renderer and the change is
a genuine restructure, not a move. It ranks below the cheap wins for that reason, but it
is the single highest-value test debt in `src/`.

---

## 8. `hasBridge` is declared once and honoured most of the time

**Evidence.** `App.tsx:311` defines `const hasBridge = typeof window.iris !== "undefined"`,
and roughly 35 call sites guard on it. Six do not:

- `:438` `closeNoteReader()` → `window.iris.reportNoteClosed()`
- `:453-458` `openNoteFromGalaxy()` → `readSecondBrainNote` / `reportNoteOpened`
- `:466` `exitHud()` → `window.iris.toggleHud()`
- `:883` the `secondBrainActive` cleanup effect — and note this effect's body runs **on mount**, when `secondBrainActive` is already `false`, so it fires an unconditional `reportNoteClosed()` at startup
- `:902-906` the `onSecondBrainOpenNote` subscription (`[]` deps, no guard)
- `:1910` `openTask()` → `window.iris.reportNoteClosed()`

In the packaged app the bridge always exists, so this is not a live crash — it is an
inconsistency that makes the guard unreliable as a signal and breaks the browser-only
Vite path.

**Seam.** `src/lib/bridge.ts`:

```ts
export function bridge(): IrisBridge | null;      // null when window.iris is absent
export function withBridge<T>(fn: (api: IrisBridge) => T): T | undefined;
```

`App.tsx` calls `withBridge((api) => api.reportNoteClosed())`, and `hasBridge` becomes
`bridge() !== null`. Optionally add an oxlint restriction so `window.iris` is only
reachable through it.

**Test that pins it** — `bridge.test.ts`: `withBridge` is a no-op returning `undefined`
when `globalThis.window.iris` is unset, and forwards the return value when set. The
mount-time `reportNoteClosed` (`:880-885`) should additionally gain a "skip the first
run" guard; pin that as a pure `shouldReportClosed(prev, next)` helper if it is kept.

---

## 9. `VaultGalaxy.GalaxyCanvas` — five responsibilities, 630 lines

**Evidence.** `VaultGalaxy.tsx:343-977` holds, in one component:
(a) the 3d-force-graph instance lifecycle and disposal (`:633-746`);
(b) graph reconciliation and pin/cooldown policy (`applyGraph`, `:545-581`, over the
module-level `reconcile`, `:309-341`);
(c) the highlight/declutter painter (`repaintHighlight`, `:594-631`, plus the pure
`makeNodeColor`/`makeLinkColor` at `:233-279`);
(d) the proximity-label rAF loop (`:777-830`);
(e) the note-name search rail: state, IPC debounce, late-reply cancellation and the
voice-answered-query dedupe (`:449-519`, `:893-938`, `:944-951`).

(e) in particular has nothing to do with WebGL: it is a debounced request/response with an
ordering rule ("a late reply for a query the user has already moved past must not
overwrite the current one", `:506-508`) and a dedupe rule (`voiceAnsweredQueryRef`,
`:472-500`) — both correctness rules, both untested. The outer `VaultGalaxy` (`:1004-1106`)
additionally owns graph fetch + watcher activation and the focus rehydrate.

**Seam.**
- `src/hooks/useNoteNameSearch.ts` — `{ query, setQuery, matches }`, owning the debounce, the cancellation flag and the voice-answered dedupe.
- `src/lib/note-search-state.ts` — the pure part: `nextSearchState(state, event)` over events `typed | voiceAnswered | replied(query, matches) | cleared`.
- `src/hooks/useVaultGraph.ts` — the outer component's fetch/watch/focus effect (`:1034-1072`).
- `src/lib/galaxy-highlight.ts` — move `makeNodeColor` / `makeLinkColor` / the precedence rule (`pointedAt ?? focus`, `:609-620`) out as pure functions; `galaxy-colors.ts` currently has **no** test file at all.

**Test that pins it** — `note-search-state.test.ts`: a reply for a stale query is
discarded; a voice-answered query does not trigger a second IPC round trip; clearing the
field clears matches. `galaxy-highlight.test.ts`: pointing overrides the focus dimming
rather than adding a second bright island (`:610-617`); releasing restores the focus
dimming; no focus and nothing pointed at ⇒ nothing dims.

**Risk: medium** — (e) and the outer hook are clean lifts; the painter extraction touches
the render hot path and should land separately.

---

## 10. `control_ui` — listener churn plus untestable dispatch

**Evidence.** `App.tsx:1810-1861` subscribes `window.iris.onUiAction(...)` with a
dependency array containing `tasks` and `sortedTasks`. `electron/preload.cjs:120-124`
adds an `ipcRenderer.on` listener and returns a remover, so **every task-stream event**
(every `tool_start`/`tool_end`, i.e. many per run) tears down and re-registers the
listener. The file already knows the fix: `sidecarHandlerRef` at `:612-615` exists
precisely so the sidecar subscription can be mounted once and still see fresh state.

Second: the dispatch body is a nine-branch resolver over
`taskById || byQuery || currentTask || focusedTask || activeTask || latestResultTask`
(`:1813-1859`) implementing the `voice-ui-control` spec's precedence rules. It is
untestable where it sits, and `openTaskByQuery` (`:1747-1763`) carries a further rule
with a spec citation — the `best.score - second.score >= 3` clear-winner margin, and
"a pending question or parked review outranks disambiguation" (`:1758-1762`,
`design.md D2`, `prompt-review-gate D3`).

**Seam.** `src/lib/ui-action.ts`:

```ts
export type UiCommand =
  | { kind: "openTask"; id: string } | { kind: "chooser"; query: string; matches: TaskCard[] }
  | { kind: "closeReader" } | { kind: "showHistory"; open: boolean }
  | { kind: "setSteps"; id: string; open: boolean } | { kind: "closeAll" } | { kind: "none" };
export function resolveUiAction(
  state: { tasks: TaskCard[]; sortedTasks: TaskCard[]; expandedTaskId: string|null;
           focusedTaskId: string|null; latestResultTaskId: string|null;
           questionPending: boolean; reviewPending: boolean },
  action: { action: string; target_id?: string; query?: string },
): UiCommand;
```

plus `useVoiceUiControl(resolve, apply)` holding the subscription behind a ref, mounted once.

**Test that pins it** — `ui-action.test.ts`: `open_current_claude_result` falls back
expanded → focused → latest, in that order; an ambiguous `open_task_by_query` under a
pending question yields `{kind:"none"}` and **never** `chooser`; the 3-point clear-winner
margin opens directly; `show_task_steps` with no target at all is a no-op.

**Risk: very low.** The listener-churn fix alone is a two-line change with an existing
in-file precedent.

---

## 11. The `AskUserQuestion` pick rules

**Evidence.** `pickClaudeAnswer` (`App.tsx:1120-1139`) implements: multi-select toggles
within a list, single-select replaces, and **auto-submit is suppressed entirely when any
question in the call is multi-select** (`:1136`) — "the user has to be able to say when
they are done choosing". `submitClaudeAnswers` (`:1141-1150`) re-checks completeness
before sending. The comments cite the voice path's batching, and `voice-decision-relay` is
the spec that governs what may be reported as a decision. Untested.

**Seam.** `src/lib/claude-answers.ts`:

```ts
export function nextPicks(current: Record<string,string[]>, questions: ClaudeQuestion[],
                          question: string, choice: string): Record<string,string[]>;
export function isComplete(picks: Record<string,string[]>, questions: ClaudeQuestion[]): boolean;
export function shouldAutoSubmit(picks, questions): boolean;
```

**Test that pins it** — a second click on the same multi-select choice removes it; a
single-select click replaces; `shouldAutoSubmit` is false whenever any question is
multi-select, even when every question has a pick; true only when all single-select
questions are answered.

**Risk: very low.**

---

## 12. Prop drilling: 65 props into `HudShell`, 23 of them duplicated into `CenterStage`

**Evidence.** `HudShell.tsx:161-340` destructures **65** props; the call site spans
`App.tsx:1930-2007`. Comparing call sites, `CenterStage` (`:2057-2088`, 30 props) shares
**23** names verbatim with `HudShell`: `reactorState`, `inputLevelRef`, `outputLevelRef`,
`thinking`, `wakeKey`, `rippleKey`, `orbRotationRef`, `orbScaleRef`, `orbStageRef`,
`orbFlash`, `onOrbFlashEnd`, `awake`, `caption`, `captionDim`, `muted`, `onToggleMute`,
`listenOnlyEngaged`, `systemAudioState`, `onToggleListenOnly`, `ambientCaptureLive`,
`onStopAmbientCapture`, `onSleep`, `webglHighFidelity`. `CameraDock` (`:2040-2053`) shares
12 with `HudShell`'s camera block: `hand`, `handRef`, `eye`, `eyeRef`, `telemetryRef`,
`ledgerRef`, `alertSeenRef`, `logs`, `stream`, `handControl`, `actionLabel`, `actionTone`.
The deck and the HUD are two presentations of one state, and the duplication is where they
will drift.

**Seam.** Three named prop bundles in `src/types.ts`, built once in `App.tsx` with
`useMemo`, passed as single props:

```ts
export type OrbSurface   = { state, inputLevelRef, outputLevelRef, thinking, wakeKey, rippleKey,
                             rotationRef, scaleRef, stageRef, flash, onFlashEnd, running };
export type VoiceControls= { awake, caption, captionDim, muted, onToggleMute, listenOnlyEngaged,
                             systemAudioState, onToggleListenOnly, ambientCaptureLive,
                             onStopAmbientCapture, onSleep };
export type PerceptionRefs = { handControl, hand, handRef, eye, eyeRef, telemetryRef,
                               ledgerRef, alertSeenRef, stream, actionLabel, actionTone, logs };
```

`HudShell` drops from 65 props to roughly 30; the deck/HUD pair cannot diverge on a field
without a type error.

**Test that pins it** — this one is pinned by `tsc` rather than vitest (the honest answer
in a repo with no component renderer): the bundles are constructed once, so a field added
for one surface is present in both by construction. Pair it with a `src/lib/orb-surface.ts`
holding any derivation that moves with the bundle (e.g. `reactorState`, `App.tsx:1010-1023`,
whose precedence — listen-mode above speaking above listening above working — is a genuine
rule worth a table test).

**Risk: medium** — wide but mechanical; best done after findings 2–6 shrink the file.

---

## 13. `SetupPanel` — sections as inline blobs

**Evidence.** Five section JSX values are assigned to `const`s inside the component body:
`geminiSection` (`:274-324`), `claudeSection` (`:325-487` — 163 lines), `youSection`
(`:488-627` — 140 lines), `permissionsSection` (`:633-640`), `advancedSection`
(`:642-658`); then two full layouts consume them (settings `:661-705`, wizard `:707-800`).
Alongside them the component holds 16 `useState`s (`:74-112`) spanning three unrelated
concerns — the `.env` draft, the Claude credential/health machine (`checkClaude`,
`applyCredential`, `removeLegacyArtifacts`, `:145-230`), and the wizard step cursor.

There is also a fourfold duplicated idiom: a two-option `ThemedSelect` whose `onChange`
calls a toggle callback only if the value actually changed —
`if ((value === "true") !== soundsEnabled) onToggleSounds();` at `:578-580`, and again at
`:595-597` (WebGL) and `:614-616` (ambient); the wake-word/demo selects
(`:537-545`, `:646-653`) are the same shape writing to the draft instead.

**Seam.** `src/components/setup/GeminiSection.tsx`, `ClaudeSection.tsx`, `YouSection.tsx`,
`AdvancedSection.tsx` (each taking `draft`, `set`, and its own callbacks);
`src/hooks/useClaudeCredentials.ts` returning
`{ claude, pipelinePrereqs, legacyArtifacts, save, remove, recheck, removeLegacy }`;
and `src/components/SetupControls.tsx` gains `<BooleanSelect label value onChange/>`.
`SetupPanel.tsx` retains the draft, the step cursor and the two layouts — ~250 lines.

**Test that pins it** — `src/lib/setup-draft.ts` extracted alongside, holding the pure
bits the spec actually constrains: `wakeThresholdOptions(current)` (the "custom value
shows as Custom and is never silently rewritten" rule at `:556-560`, a `setup-panel`
`SHALL`), and `claudeStatusFrom(health)` (the four-way mapping at `:145-177`: unreachable ⇒
error, `pipelineAvailable` ⇒ ok with the `(Claude Code)` suffix stripped, reachable without
credential ⇒ **idle, not ok**, plus the three billing lines). Both are pure and both
encode requirements that currently live only in comments.

**Risk: low** — presentational moves plus one already-cohesive hook.

---

## 14. Re-render hazards

**Evidence.** `grep -r "React.memo\|memo("` across `src/components` and `src/hooks`
returns **zero** hits; `App.tsx` contains **zero** `useCallback`. Every handler passed
down (`toggleHand`, `openTask`, `toggleTaskSteps`, `onToggleComms`, …) is a fresh identity
each render, so even adding `React.memo` later would not help without them. Consequences:

- `setDwellActive`/`setDwellFired` are written from inside a rAF loop (`App.tsx:1497-1500`). They are transition-guarded, but a hand sweeping across a 20-card Work Stream produces a stream of transitions, each re-rendering the entire app tree — including `HudShell`'s 65 props, every `WorkCard`, and the galaxy's props.
- `heardLive` (`:275`, written per `heard_live` event at `:1241-1244`) and `transcript` (`:1246-1258`) re-render the whole tree per utterance.
- `logs` (`:173`, capped at 80) re-renders everything on every log line although only `CameraLog` reads it.

The codebase is clearly *aware* of the pattern — audio levels, hand state, eye state,
telemetry and the token ledger are all passed as **refs** read per-frame
(`:1932-1933`, `:1971-1976`) precisely to avoid this. `dwellActive` is the one per-frame
value that was made state instead, and `HandReticles` (`:2214-2216`) already takes
`handRef` and could take dwell the same way.

**Seam.** (a) `dwellActive`/`dwellFired` become a `dwellRef` published to `HandReticles`
and to the label derivation — matching the file's own established pattern;
(b) `logs` moves into `useActivityLog()` consumed only by `CameraLog`/`CameraDock`;
(c) once handlers come from hooks (findings 4–10) they are stable by construction, at
which point `React.memo` on `WorkCard` and the comms bubble row is worth adding.

**Test that pins it** — no runtime test is available in this harness; pin it instead by
making the extracted hooks return stable identities and asserting the *decision* purity
(`stepDwell`), and record the measurement in `docs/REFERENCE.md` the way the repo already
records timing figures.

**Risk: medium** — behavior-preserving but touching the hot path; do it after 4–6.

---

## 15/16. Test coverage and the spec's IPC sentence

**Coverage.** Hooks with no test: `useEyeTracking` (214), `useGalaxyAnchor` (191),
`useGalaxyCameraDrive` (811), `useHandControl` (399), `useHandoffFx` (145),
`useSystemTelemetry` (53), `useTokenLedger` (90), `useWakeWord` (344) — 8 of 10.
Libs with no test: `galaxy-anchor-rings.ts` (217), `galaxy-label-sprites.ts` (156),
`galaxy-colors.ts` (28), `sounds.ts` (110), `galaxy-types.ts`. Components with tests:
`DrawingCanvas` only. The pattern is consistent and diagnostic: **anything pure got a
test; anything welded to a component or a rAF loop did not.** That is the argument for
every seam above, not a separate finding.

**Spec sentence.** `renderer-structure/spec.md` requires "`src/App.tsx` acting solely as
the orchestrator (state, IPC wiring, and composition)". In practice IPC wiring is
distributed by design — `DrawingCanvas` (13 `window.iris` calls), `SetupPanel` (10),
`PermissionsStep` (8), `VaultGalaxy` (5), `NoteReader` (2), `HudShell` (1),
`useSystemTelemetry` (3), `useTokenLedger` (2), `useAudioPipeline` (1) — and the
distribution is *deliberate and documented* at each site (e.g. `HudShell.tsx:358-363`
records why the second-brain focus is owned there and not lifted; `VaultGalaxy.tsx:1046-1049`
records that the watcher must start after the first scan, which only the mounting
component knows). The spec's own note already concedes the analogous point for gestures:
"This requirement governs **where shared renderer modules live**, not that every
interaction must be one."

**Recommendation:** reconcile the *spec text*, through an OpenSpec change, not the code —
state that a component owns the IPC of the capability it is the only mount point for, and
that `App.tsx` owns the app-scoped channels (sidecar events, hud mode, listen-only,
sessions, ui-context/ui-action). Per `CLAUDE.md`: "If code and a living spec disagree,
reconcile through a change — never silently edit either side."

---

## 17. `HudShell` housekeeping

`HudShell.tsx:43-154` defines `HudCamera` inline (112 lines, its own `useRef`s, a 1 Hz
`setInterval` stamp at `:96`) inside a 667-line file — the same shape the
`renderer-structure` spec removed from `App.tsx`. It also owns three pieces of state:
`workOpen` (`:349`), `stampOn` (`:356`, with a documented reason not to lift or persist
it) and `secondBrainFocus` (`:364-372`, likewise documented). The state ownership is
justified in place and should stay; only `HudCamera` should move to
`src/components/HudCamera.tsx`, taking `HudShell` to roughly 550 — still above
convention, which the finding-12 prop bundles then address.

---

## Suggested sequencing

**Wave 1 (cheap, high ratio, independent):** findings 1, 3, 2, 11, 8, and the two-line
listener fix from 10.
**Wave 2 (structural, still low risk):** 6, 5, 13, 17, then the remaining hook
extractions from finding 4's table.
**Wave 3 (deep):** 9, 12, 14, and finally 7.

Every wave-1 item removes lines from `App.tsx`/`SetupPanel.tsx` while adding a node-env
test file, so the two things the repo measures — file size against the 250–450 convention,
and behavior under `npm test` — both move in the right direction on each landing.
