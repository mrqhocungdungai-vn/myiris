# Codebase Improvement Research — Hotspot & Testability Analysis

*Independent analysis (churn x size, test-coverage shape). Companion reports:
`renderer-findings.md`, `main-process-findings.md`, `harness-findings.md`.*

## Baseline

All five gates are **green** as of `59111ec`. This is not a repo in distress; the
findings below are about *leverage*, not breakage. 310 commits, 58,658 lines
across `electron/` + `src/`.

## Finding 1 — `src/App.tsx` is the repo's single dominant hotspot

Churn x size ranks every source file. The top of that list is not close:

| Score | Churn | LOC | File |
|---|---|---|---|
| **138,012** | 62 | **2,226** | `src/App.tsx` |
| 26,544 | 24 | 1,106 | `src/components/VaultGalaxy.tsx` |
| 23,391 | 69 | 339 | `electron/main.mjs` |
| 23,280 | 40 | 582 | `src/vite-env.d.ts` |
| 19,755 | 15 | 1,317 | `electron/capabilities/second-brain.mjs` |

`App.tsx` scores **5.2x** the next file. It is both the most-edited *and* the
largest module: the two multiply. CLAUDE.md sets a 250-450 line convention;
App.tsx is **5-9x** over it.

Its internals, measured:

- **55** `useState` calls
- **30** `useEffect` calls
- **15** `useRef`, **11** `useMemo`
- **0** `useCallback` — every handler passed to a child is reallocated per render
- **61** `window.<bridge>.*` preload calls made directly from the component

Note the last two together. 61 IPC touchpoints inlined into the same function
that holds 55 pieces of state means the preload surface has no seam in the
renderer: there is no module you can read to learn what the renderer asks the
main process for, and no place to stub it.

## Finding 2 — the component layer has *zero* tests, and the config makes that unfixable in place

`vitest.config.mjs` `include` for the unit project is:

```
["electron/**/*.test.mjs", "src/**/*.test.ts", "scripts/**/*.test.mjs"]
```

`src/**/*.test.ts` does **not** match `.tsx`. Confirmed by search: **no
`*.test.tsx` file exists anywhere in the repo.** Every one of the 30 `src/`
test files is `.ts`, and all but three sit in `src/lib/`.

So a component test cannot be added today without also editing the glob. `jsdom`
is a declared devDependency (`^29.1.1`) but no `environment: "jsdom"` project
consumes it, and no testing-library package is installed. The capability is
half-wired.

**This is not simply a hole.** The pattern the repo actually follows is sound:
push logic out of components into pure `src/lib/*.ts` modules, then test those
hard. `galaxy-nav`, `eye-hud`, `wake-gate`, `webgl-quality`, `hud-interactivity`
are all real extractions with real tests. The problem is that **App.tsx is the
part that never got the treatment** — its 55 states and 30 effects are the
largest body of untested logic in the renderer, and the convention that would
cover it (extract to lib, test the lib) has simply not been applied there.

Two coherent routes, and they should not be mixed:

- **(A) Continue the existing pattern.** Extract App.tsx's logic into
  `src/lib/` and `src/hooks/` modules and test them as `.ts`. No config change.
  Consistent with 27 existing lib tests. Lower risk.
- **(B) Add a component-test capability.** Add a jsdom project + testing-library,
  widen the glob to `.tsx`. New dependency surface and a second testing idiom.

(A) is the better default here precisely *because* the repo already proves it
works. (B) should be justified by something (A) cannot reach, not adopted by
reflex.

## Finding 3 — a concrete, low-risk first extraction

Lines 53-136 of App.tsx are eight near-identical persisted-setting readers:

```ts
const SOUNDS_STORAGE_KEY = "iris.soundsEnabled";
function loadSoundsEnabled(): boolean {
  try { return window.localStorage.getItem(SOUNDS_STORAGE_KEY) !== "off"; }
  catch { return true; }
}
```

...repeated for `hand`, `camera`, `mic`, `webgl`, `ambientCapture`,
`hudCamera`, `listenOnlyConsent`. Same try/catch-to-default shape eight times,
with three different defaulting rules (`!== "off"`, `=== "on"`, `|| DEFAULT`)
that are easy to get backwards and that nothing tests.

`grep localStorage src/lib/*.ts` returns **nothing** — there is no existing
persisted-settings module this belongs to.

### The repo already contains the right pattern — and it corrects my first proposal

My initial instinct was a `persistedSetting.ts` that does the reading:
`persistedFlag(key, whenUnset)`. **Reading `src/lib/webgl-quality.ts` shows
that would be the wrong shape**, and the repo has already solved this better:

```ts
export const WEBGL_QUALITY_STORAGE_KEY = "iris.webglHighFidelity";
export function readWebglHighFidelity(stored: string | null): boolean {
  return stored === "on";
}
```

The split is the point. The **pure parse** takes an *already-read* `string |
null`; the **impure read** (the `try/catch` around `window.localStorage`) stays
at the call site in App.tsx. That is why `webgl-quality.test.ts` needs no
storage mock at all — it just calls the parser with `null`, `"garbage"`,
`"true"`, `""`, `"on"`, `"off"`.

Note that App.tsx's `loadWebglHighFidelity` (line 104) **already consumes this
module**. The precedent is not hypothetical; it is one of the eight readers,
and it is the only one that is tested. The other seven simply never followed it.

Proposed seam, matching the established shape rather than inventing one:

```ts
// src/lib/persisted-settings.ts
export const SOUNDS_STORAGE_KEY = "iris.soundsEnabled";
// ...the other six keys

export function readSoundsEnabled(stored: string | null): boolean   // !== "off"  -> default ON
export function readHandEnabled(stored: string | null): boolean     // === "on"   -> default OFF
export function readAmbientCapture(stored: string | null): boolean  // === "on"   -> default OFF
export function readHudCameraEnlarged(stored: string | null): boolean
export function readListenOnlyConsentSeen(stored: string | null): boolean
export function readCameraDeviceId(stored: string | null): string   // || SYSTEM_DEFAULT_CAMERA
export function readMicDeviceId(stored: string | null): string      // || SYSTEM_DEFAULT_MIC
```

Why this is the right first commit: it is pure, needs no React, is testable as
`.ts` under the **existing** glob (no config change), removes ~65 lines from the
worst hotspot, and turns three easily-inverted defaulting rules into named,
asserted behavior.

**A caution that matters more than the refactor.** Lines 58-70 and 132-134 carry
deliberate design intent in comments — ambient-capture defaults OFF "unlike
sounds above"; the HUD camera must fail toward "reverts to standard, never stuck
enlarged with no way back"; unreadable consent storage deliberately fails *open*
and re-shows the notice. A mechanical de-duplication into one generic helper
would flatten exactly these distinctions, which is the thing the duplication is
currently protecting. Each extracted function must carry its comment, and the
tests should assert the *documented* default rather than the observed one.

## Finding 4 — `src/vite-env.d.ts` at 582 lines with 40 commits

Ranked 4th. A `.d.ts` this large and this frequently edited is the preload/IPC
contract in disguise — which corroborates Finding 1: the bridge surface is
declared in one enormous ambient type file and consumed ad hoc at 61 call sites,
rather than being a module with an interface.

## Ranked summary

| # | Finding | Impact | Risk to fix | Note |
|---|---|---|---|---|
| 1 | App.tsx hotspot: 2,226 LOC, 55 state, 30 effects, 61 IPC calls | **High** | High if done wholesale | Attack incrementally |
| 2 | No component tests; `.tsx` outside the vitest glob | **High** | Low | Prefer route (A) |
| 3 | 7 of 8 localStorage readers untested; the 8th shows the fix | Medium | **Very low** | Best first commit |
| 4 | `vite-env.d.ts` 582 LOC / 40 commits = unseamed IPC contract | Medium | Medium | Follows from #1 |

## What I did not do

No code was changed. All findings are read-only observations against `59111ec`
with all gates green.
