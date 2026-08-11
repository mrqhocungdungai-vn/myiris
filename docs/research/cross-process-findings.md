# Cross-Process Findings — the verb registry and the render-harness gap

*Fills a gap between the renderer-only and main-process-only reports: the verb
registry spans **both** processes, so neither scope alone would have examined it.*

## Finding A — the cross-process verb mirror is pinned, and pinned well

CLAUDE.md states "a verb is defined in exactly one place." In fact the renderer
keeps its **own** copy in `src/lib/verbs.ts`: `ALL_VERBS`, `VERB_LABELS`,
`MODEL_CHOICES`, and `sessionKeyForVerb` all mirror `electron/verbs.mjs`.

I expected this to be an unguarded duplication. **It is not.**
`src/lib/verbs.test.ts:9-13` imports the main-process registry directly into a
renderer test and asserts equality:

```ts
import { MODEL_CHOICES as MAIN_MODEL_CHOICES, VERB_NAMES, resolveVerb }
  from "../../electron/verbs.mjs";

expect(ALL_VERBS).toEqual(VERB_NAMES);                              // same verbs, same order
expect(VERB_LABELS[name]).toBe(resolveVerb(name).label);            // per-verb label
expect(MODEL_CHOICES).toEqual(MAIN_MODEL_CHOICES);                  // model menu
expect(sessionKeyForVerb(name)).toBe(resolveVerb(name).sessionKey); // conversation resumed
```

The test's own comment states the intent exactly: *"a renderer copy that could
silently disagree with it is exactly the duplication the registry exists to
prevent."* The renderer copy also deliberately **omits** what it must not
decide (effective model, park behavior, skills) — those arrive via the
`listVerbs()` snapshot. `src/lib/verbs.ts:1-9` documents this.

**This is a strength worth recording, not a defect.** Adding an eighth verb
fails this test until the renderer is updated. No action needed.

One residual gap: `VERB_COLORS` is asserted only for *shape* (matches
`var(--…-rgb)`, and the two shaping verbs share a hue) — a verb added to the
registry with no colour entry is caught by TypeScript's `Record<Verb, string>`,
not by the test. That is adequate.

## Finding B — the absent render harness forces source-text assertions

`src/lib/verbs.test.ts:80-82` says plainly:

> *"There is no render harness in this project, so these read the components
> themselves."*

Its second `describe` block therefore asserts against component **source text**:

```ts
const pipelineBar = read("src/components/PipelineBar.tsx");
expect(pipelineBar).not.toMatch(/onChooseAgent|onChooseVerb|onSelectVerb/);
expect(pipelineBar).toContain("lastVerb");
expect(pipelineBar).toMatch(/what ran most recently, not a mode/);   // asserts a COMMENT
expect(workCard).toContain("verb={task.verb}");                       // asserts JSX source
```

These have inverted failure modes:

- **False red** — renaming a local, reformatting JSX across lines, or rewording
  a comment breaks the test while behavior is unchanged. The regex above
  asserts the wording of a *source comment*.
- **False green** — the substring can be present while the feature is broken.
  `toContain("lastVerb")` passes if `lastVerb` is computed and never rendered.
  `not.toContain("agents:select")` on `preload.cjs` passes if the channel is
  reintroduced under any other name.

The intent behind them is legitimate and even important: *"the interface offers
no way to choose a verb"* is a real architectural invariant, and there is
currently no other way to express it.

### Scope check — I verified this is narrow, not endemic

19 test files call `readFileSync`. I checked what each one reads:

| Category | Files | Verdict |
|---|---|---|
| Read **output artifacts** the code wrote (notes, config, inbox, sessions) | 16 | **Correct behavioral testing.** Not an anti-pattern. |
| Read **manifests / declared config** (`sdk-options`, `plugin-skills`, `agent-definitions`) | 2 | Legitimate — the file *is* the artifact under test. |
| Read **component source code as text** | **1** (`src/lib/verbs.test.ts`) | The only instance. 3 files grepped: `PipelineBar.tsx`, `WorkCard.tsx`, `preload.cjs`. |

So the pattern is confined to **one file and roughly eight assertions**, not
spread through the suite. That matters for prioritization: this is a small,
contained consequence, not a systemic testing failure.

## The two findings share one root cause

Finding B here and Finding 2 in `hotspot-findings.md` are the **same fact seen
twice**: `.tsx` is outside the vitest glob, no jsdom project exists, and no
testing-library is installed. Where a real invariant about a component must be
asserted, source-text grep is the only tool available, so it gets used.

This sharpens the earlier recommendation. In `hotspot-findings.md` I argued
route (A) — keep extracting logic to `src/lib/` — should be the default, and for
App.tsx's 55 states and 30 effects it still is. But Finding B is precisely the
case route (A) **cannot** reach: "this component renders no verb selector" is a
statement about rendered output, not about extractable logic. It is the concrete
justification for a component-test capability that I said should be required
before adopting one.

Recommended sequencing, smallest first:

1. Extract App.tsx's persisted-setting readers to `src/lib/` (no config change,
   follows the proven `webgl-quality.ts` split). Immediate, zero-risk.
2. Continue extracting App.tsx effect clusters into hooks/lib modules.
3. **Only then**, if the "no verb selector" class of invariant is still
   unassertable, add a jsdom vitest project + testing-library and convert those
   ~8 source-text assertions into render assertions.

Step 3 is now justified by evidence rather than by reflex — which was the bar I
set for it.

## Ranked summary

| # | Finding | Impact | Risk | Action |
|---|---|---|---|---|
| A | Cross-process verb mirror is correctly pinned by test | — | — | **None — record as a strength** |
| B | ~8 source-text assertions in 1 file; both failure modes inverted | Medium | Low | Defer to step 3 above |
| B2 | Scope verified narrow: 16/19 `readFileSync` tests are correct | — | — | No sweep needed |

No code was changed.
