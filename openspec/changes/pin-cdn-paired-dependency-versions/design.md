## Context

Two npm packages are also referenced by a hardcoded CDN URL that embeds their version:

- `src/hooks/useHandControl.ts:36` — `WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"`, with a comment at line 34 saying to keep it in sync with `package.json`.
- `src/hooks/useWakeWord.ts:25` — `ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/"`, with a comment saying "Match the installed package version."

`package.json` declares both with carets (`^0.10.35`, `^1.27.0`). `package-lock.json` is committed and resolves both to the exact versions the URLs name, and `CLAUDE.md` documents `npm ci` as the install command, which installs strictly from the lockfile. So today the two sides agree and the caret is inert.

The hazard is entirely prospective: any operation that rewrites the lockfile — `npm update`, `npm install <pkg>@latest`, an automated bump — can move the package without touching the string literal. The resulting mismatch is invisible to `npm run build` (the URL is an opaque string, and `tsc` has no opinion about it) and to `npm test` (no test loads either runtime). It surfaces as gesture control or wake word failing at runtime, which `CLAUDE.md` already characterises as "silently breaks voice or gestures".

Both comments say "keep this in sync". A comment is a request to remember something at the exact moment attention is elsewhere — which is the failure mode, not the fix.

## Goals / Non-Goals

**Goals:**

- A divergence between a package version and the CDN URL that names it fails an automated check, rather than waiting to be noticed at runtime.
- The declarations in `package.json` stop permitting movement that the URLs cannot follow.
- The `wake-sleep-voice` spec describes what the code actually fetches.
- No dependency is upgraded or downgraded; this is a correctness-of-declaration change.

**Non-Goals:**

- Vendoring the WASM runtimes into `public/` to drop the CDN entirely. That is a real option with genuine benefits (offline first run, no third-party availability risk) and real costs (bundle size, an update ritual), and it deserves its own proposal rather than being smuggled in behind a pinning fix.
- Touching `GESTURE_MODEL_URL` (`storage.googleapis.com/mediapipe-tasks/…`), which carries no version in its path and therefore cannot skew.
- Introducing a linter, a new CI service, or any tool the repo does not already run.

## Decisions

### D1: Exact versions, not carets

`"@mediapipe/tasks-vision": "0.10.35"` and `"onnxruntime-web": "1.27.0"`.

The alternative — keeping carets and relying on the check in D2 to catch divergence — is worse in a specific way: it makes the check fire on a routine `npm update`, turning a maintenance command into a failure the developer must then reconcile. Pinning exactly means `npm update` simply does not move these two, and moving them becomes an explicit act that naturally includes the URL.

This is consistent with how `CLAUDE.md` already frames the project's exact identifiers (Gemini Live model, voice, MediaPipe version) as things that "do not drift".

### D2: The check runs in the existing test suite, not a new tool

The repo's automated surface is exactly two commands: `npm run build` (`tsc --noEmit && vite build`) and `npm test` (vitest, `environment: "node"`, including `electron/**/*.test.mjs` and `src/**/*.test.ts`). The check belongs in the second as an ordinary test: read `package.json`, read the version embedded in each URL, assert equality.

Why a test rather than a build step or a git hook: the test-harness spec requires tests to run with no runtime prerequisites — no Electron, no network, no API keys — and this check needs only two file reads, so it fits that contract exactly. It also means a contributor who breaks the pairing sees a named failing assertion rather than a build error pointing at a bundler.

**The version must be extractable.** Parsing a version back out of a URL string with a regex works but is brittle and reads badly. The cleaner shape is to derive the URL from a named constant, so the test asserts against a value rather than reverse-engineering one:

```ts
const ORT_VERSION = "1.27.0"; // must equal package.json's onnxruntime-web
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
```

Whether the constants are exported from the hooks or lifted into a tiny shared module is left to implementation; the requirement is only that a node-environment test can read them without importing a hook that pulls in Web Audio or MediaPipe.

### D3: The spec's CDN sentence is corrected, not deleted

The current `wake-sleep-voice` requirement reads: *"model assets bundled under `public/wakeword/` — no runtime CDN fetch"*. Read strictly, the parenthetical scopes "no runtime CDN fetch" to the model assets, and that reading is true. Read quickly — the way a future implementer will read it — it says the wake word makes no CDN request at all, which is false: the ORT WASM runtime is fetched from jsDelivr on first load, so the first wake-word arm on a fresh machine needs network.

The fix is to state both halves explicitly rather than to remove the guarantee, because the bundled-models half is a real and deliberate property worth keeping normative.

## Risks / Trade-offs

- **Exact pinning means security patches for these two packages require a manual bump.** → Accepted: both are large WASM runtimes paired with a hardcoded URL, so a bump was never going to be safely automatic. The pin makes the manual step visible instead of implied.
- **The check is a no-op on the day it ships**, so it proves nothing at review time. → Unavoidable for any regression guard. It can be validated by deliberately editing one version and confirming the test fails before reverting — worth doing once during implementation rather than trusting it blind.
- **Restructuring a URL into a constant touches two working files for no runtime benefit.** → Kept minimal and justified by D2: without a readable constant the test has to regex a string literal, which is the kind of test that quietly stops matching after an innocent edit.
- **The spec correction slightly weakens an existing guarantee** by admitting a CDN dependency. → It does not weaken the *system*; it removes a false belief about it. A future change that vendors the WASM can strengthen the requirement honestly.

## Migration Plan

No migration. Versions are unchanged, so `npm ci` produces an identical `node_modules`; only the declared range narrows to what was already installed. Rollback is reverting the `package.json` edit.

## Open Questions

- Whether to eventually vendor both WASM runtimes into `public/` and drop the CDN entirely. Deliberately deferred (see Non-Goals) — it changes first-run offline behaviour and bundle size, which deserves its own weighing rather than riding along with a pinning fix.
