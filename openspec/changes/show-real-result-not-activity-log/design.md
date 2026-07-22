## Context

The card reducer merges each update field with `X || existing?.X`:

```js
// src/App.tsx:664-675
const output = readString(event.output);        // readString → "" for BOTH absent and empty
...
output: output || existing?.output,             // 668 — "" is falsy → keeps existing (the activity log)
error:  error  || existing?.error,               // 669 — identical latent bug
```

The events that reach this reducer (via `toUpdateEvent`, `run-queue.mjs:87-98`) only carry `output` when a caller passes it in `extra`:

- `pushActivity` → `RUNNING` with `output: run.activity.join("\n")` — always non-empty (it early-returns on a blank line).
- `finalize` → terminal with `output: <result>` — possibly `""`.
- `queued` / `starting` → no `output` field at all.

So the only update that carries `output === ""` is a terminal one, and the `||` sends it back to the activity buffer. `readString` (`src/lib/tasks.ts:103`) returns `""` for both an absent field and an empty string, so the reducer as written cannot tell them apart — which is the crux.

## Goals / Non-Goals

**Goals:**

- An empty terminal result replaces the shown text with empty, not the activity log.
- An update with no result field leaves the running card's text alone (today's behavior for mid-run updates).
- The fix is a pure, unit-tested function, robust to the coming Wave 3 reducer rewrite.
- The same fix covers the twin latent bug on `error`.

**Non-Goals:**

- Removing the activity log from the running card (still shown during the run).
- Reworking the reducer or the step timeline (Wave 3).
- Testing the full `setTasks` reducer or any React rendering — only the pure merge decision.

## Decisions

### D1 — A pure `resolveMergedString(raw, existing)` that keys on presence, not truthiness

**Chosen:** in `src/lib/tasks.ts`, beside `readString`:

```ts
// Merge an incoming event field over the card's existing value: take the
// event's value whenever the event carried a string (even ""), otherwise keep
// what's there. Presence — not truthiness — so an empty terminal result
// replaces the activity log instead of falling back to it (BUG D).
export function resolveMergedString(raw: unknown, existing: string | undefined): string {
  return typeof raw === "string" ? raw : (existing ?? "");
}
```

`App.tsx:668-669` become `output: resolveMergedString(event.output, existing?.output)` and `error: resolveMergedString(event.error, existing?.error)`. Note it takes the **raw** `event.output` (not the `readString`-collapsed value), because presence is the whole signal.

*A local `event.output !== undefined ? output : existing` in the reducer considered and rejected:* correct but untestable in place (buried in a `setTasks` callback) and duplicated for `error`. A named pure helper is testable and self-documents the empty-vs-absent intent — the exact thing a future refactor needs spelled out.

### D2 — Extend the test harness to pure `src/` helpers

**Chosen:** `vitest.config.mjs` `include` gains `"src/**/*.test.ts"` alongside the electron glob, keeping `environment: "node"` — `resolveMergedString` is pure and needs no DOM. A DOM/React test would need a jsdom environment (via `environmentMatchGlobs`); that is out of scope, so the include is deliberately `.ts` only, not `.tsx`.

`tsconfig.json` (`"include": ["src"]`) currently sweeps test files into `tsc --noEmit`; add `"exclude": ["src/**/*.test.ts"]` so the app typecheck ignores them (Vitest transforms and runs them itself), keeping `npm run build` a clean app-only typecheck — the same separation electron `.mjs` tests already have.

Vite bundles only imported modules, so the unimported `*.test.ts` never lands in `dist/`; no `build.files` (electron-builder) entry is needed, since that field globs electron files only.

### D3 — Fix `error` with the same helper

`App.tsx:669` has the identical `error || existing?.error` idiom and the identical latent bug (an empty error string would keep a stale prior error). Routing both fields through `resolveMergedString` fixes the pair in one idiom rather than leaving a known twin defect behind.

## Risks / Trade-offs

**Extending Vitest to `src/` pulls renderer code into the runner** → contained: only pure `.ts` helpers under node env are included; nothing imports React or the DOM. The first genuinely DOM-dependent test will have to add a jsdom project/glob, but that decision is deferred until one exists.

**An empty completed card looks like nothing happened** → intended and specified: the step timeline still shows what the run did; the *result* line is simply empty when the run produced no result text, which is more honest than showing tool chatter as an answer. Manual check confirms the placeholder reads sensibly.

**`tsconfig` exclude hides a real type error in a test** → Vitest still type-transforms and runs the test; a type mistake surfaces as a test failure. The app build simply stops carrying test files, which is the intent.

**Coverage boundary** → the reducer wiring in `App.tsx` (the `setTasks` callback) remains untested (it is React state plumbing); the decision that was actually wrong — empty-vs-absent — is now a pure tested unit, which is where the defect lived.
