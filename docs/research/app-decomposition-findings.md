# App.tsx Decomposition — effect clusters and one concrete duplicated contract

*Makes `hotspot-findings.md` Finding 1 actionable. All 30 `useEffect` blocks in
`src/App.tsx` were located and grouped by dependency array.*

## The 30 effects form four clusters, not thirty problems

| Cluster | Effects | Lines | Dependency signature |
|---|---|---|---|
| **Bridge/IPC subscriptions** | ~14 | L507-L1087 | `[hasBridge]`, `[hasBridge, sidecarRunning]` |
| **Hand/gesture control** | 3 | **L1495-L1649** (137) | `[handControl, readerOpen, drawingActive, secondBrainActive]` |
| **Task focus & selection** | 2 | L1768-L1860 (76) | `[hasBridge, tasks, sortedTasks, expandedTaskId, focusedTaskId, …]` |
| **Small UI/preference syncs** | ~11 | scattered | 1-6 lines each, single dep |

The largest single effect is **61 lines** (L1495-1556); the second is 51
(L1810-1860). The two task-focus effects share seven dependencies between them,
which is the usual signature of one responsibility split across two effects.

## Finding — the 300ms dwell contract is implemented twice, and only one copy is tested

This is the most concrete defect the decomposition surfaced.

**Copy 1 — extracted, pure, tested.** `src/lib/galaxy-nav.ts:137-181`:

```ts
/** The 300ms-dwell-to-open contract (design.md D2): `candidate` must be held
 *  for `holdMs` before firing once; the same target cannot fire again until it
 *  is left … and re-acquired. */
export function dwellStep(state, candidate, now, holdMs)
  : { state: DwellState; target: string | null; fire: boolean }
```

State is threaded through as a plain object, `now` and `holdMs` are injected,
and there is no DOM or rAF inside it. `src/lib/galaxy-nav.test.ts` (588 lines)
exercises it hard. It even carries a second-order rule the inline copy has no
equivalent of — `PENDING_HOLD_MS = 120`, a spatial/temporal dead-band that stops
the target flickering between neighbours.

**Copy 2 — inline, impure, untested.** `src/App.tsx:1495-1556`, the main HUD's
dwell-to-click, reimplements the same contract by hand:

```ts
} else if (!dwellRef.current.fired && now - dwellRef.current.startedAt > 300) {
  dwellRef.current.fired = true;
  syncDwell(true, true);
  actionable.click();
}
```

The `300` is a bare literal — not `holdMs`, not a named constant, and not the
one `galaxy-nav` documents. The two copies also differ in ways nothing records
as deliberate:

- galaxy-nav uses `>= holdMs`; App.tsx uses `> 300`.
- galaxy-nav has a 120 ms pending-hold dead-band; App.tsx promotes a new target
  on the very first frame (`dwellRef.current?.el !== actionable`).
- galaxy-nav's re-fire rule is explicit and asserted; App.tsx's is implied by
  mutating `.fired` on a ref.

**Why this matters more than a tidy-up:** these are the same user-facing
contract ("hold to activate") behaving differently in two parts of one HUD, and
only one behavior is pinned. Tuning the dwell in the tested copy leaves the
untested copy silently divergent.

## The same partial-extraction pattern, a third time

The effect at L1529 already calls `isHudChrome(...)` from
`src/lib/hud-interactivity.ts` — a module extracted precisely so the
"who owns the pointer" decision could be reasoned about with "no DOM and no IPC
in it" (its own header). So within **one 61-line effect**:

- the *ownership predicate* is extracted, pure, and tested;
- the *dwell state machine* around it is inline, impure, and untested.

This is the third instance of the same shape found in this research
(`webgl-quality.ts` vs. seven sibling readers; `galaxy-nav.dwellStep` vs. the
inline dwell; `hud-interactivity` vs. its surrounding loop). The repo's
convention is not absent — **it is applied inconsistently, and App.tsx is where
it stops being applied.** That is a much more tractable problem than "App.tsx is
too big", and it is the framing I'd recommend adopting.

## Proposed seam

Reuse rather than re-extract. `dwellStep` is already the right shape; it is
generic over a candidate with an `id`. Either:

- **(a)** generalize `dwellStep` to accept an opaque candidate key so the HUD
  loop can pass `actionable` (identity or a data attribute), or
- **(b)** add a sibling `src/lib/pointer-dwell.ts` with the same contract and
  the same `holdMs`/`PENDING_HOLD_MS` constants, if coupling the galaxy's node
  type to the HUD's DOM elements is judged worse than one duplicated 20-line
  state machine.

Either way the effect at L1495 keeps only: rAF, `elementFromPoint`, the
`closest()` selector, and `actionable.click()` — the genuinely impure parts.

Tests it would pin (none exist today): fires exactly once per acquisition;
does not re-fire without leaving; a new target resets the clock; `readerOpen`
suspends without corrupting state; the shared-mode rule suppresses a non-chrome
target while a fullscreen layer is open.

## Ranked

| # | Finding | Impact | Risk | Action |
|---|---|---|---|---|
| C1 | 300ms dwell contract duplicated; one copy untested, and they differ | **High** | Low | Reuse `dwellStep` |
| C2 | 30 effects reduce to 4 clusters; gesture cluster (137 lines) is most self-contained | High | Medium | Extract cluster-wise, not file-wise |
| C3 | Two task-focus effects share 7 deps — one responsibility split in two | Medium | Medium | Merge, then extract |

No code was changed.
