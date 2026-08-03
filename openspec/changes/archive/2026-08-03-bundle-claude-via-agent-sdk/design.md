## Context

Everything here rests on facts verified against the installed SDK rather than documentation, because the original architecture was built on a plausible-sounding assumption that turned out to be false. The spikes are recorded below so a future reader can tell what was measured from what was inferred.

## Verified facts

1. **The SDK ships its own Claude Code binary.** `@anthropic-ai/claude-agent-sdk@0.3.210` declares 8 platform packages in `optionalDependencies`. `@anthropic-ai/claude-agent-sdk-darwin-x64` contains a 251 MB Mach-O x86_64 executable — `claude 2.1.210`, `TeamIdentifier=Q6L2SF6YDW`, hardened runtime. With `env.PATH=/nonexistent` (so any fallback to a host CLI fails loudly) and no `pathToClaudeCodeExecutable`, `query()` completed a run and returned a session id.
2. **The binary is fully self-contained.** Hardlinked into a bare temp directory with no sibling files at all and addressed by explicit path, it ran identically. It does not read `manifest.json` or anything else relative to itself. This is what makes the `app.asar.unpacked` rewrite safe.
3. **`claude setup-token` requires a TTY.** Spawned with piped stdio it emitted *nothing* on stdout or stderr in 12 s. An in-app OAuth flow driven from the main process is therefore not possible without a PTY.
4. **`bypassPermissions` requires `allowDangerouslySkipPermissions`.** Stated in the SDK's own type docs; DEV must pass both, as PO already did.
5. **`npm install --os/--cpu` does not bypass the platform check.** npm 11 still fails `EBADPLATFORM` for a foreign-arch package. `npm pack` + manual unpack does work.
6. **`require.resolve('<pkg>/package.json')` is unreliable.** Fine for packages with no `exports` map (the binary packages) but a hard `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@fission-ai/openspec`, which has one.

## Decisions

### D1: Rewrite `app.asar` → `app.asar.unpacked` in one module

Electron's patched `require.resolve` returns paths inside `app.asar`, and a subprocess cannot be exec'd from there. `bundled-binaries.mjs` is the only module that knows this, so every other caller just receives an absolute path. It falls back to the packed path when the unpacked twin is missing, so a misconfigured `asarUnpack` produces an error naming the app rather than an ENOENT on a path the user has never seen.

**Alternative rejected**: extracting the binary to a temp dir at first run (the SDK's `extractFromBunfs` pattern). It duplicates 250 MB per machine and adds a first-run delay, to solve a problem `asarUnpack` already solves.

### D2: Gate on binary **and** credential, not binary alone

Once the binary ships, "is Claude installed" is a constant and the flag stops carrying information. The honest replacement is the question a user can still answer wrongly: do we have something to authenticate with. `reachable` and `pipelineAvailable` become separate fields in the health payload so the SetupPanel can tell a packaging failure ("the bundled binary won't launch") apart from a new user who simply hasn't logged in.

**Alternative rejected**: dropping the gate entirely. It would replace a clean chat-only mode with runtime auth failures on every delegated task.

### D3: Accept either credential, subscription first

`ANTHROPIC_API_KEY` is the only credential a user without a Claude plan can obtain, and refusing it would make the pipeline unreachable for them. But a stray API key must never silently move a subscription user onto metered billing — so when a subscription token is present the metered keys are *stripped from the worker environment*, which is stronger than relying on the SDK's auth precedence. `poBillingStatus` had to widen to match, otherwise the gate would report the pipeline available while every PO turn failed on a token check.

### D4: One env policy, replacing two

DEV's `CLAUDE_CODE_OAUTH_TOKEN` exclusion was correct for a host CLI (which authenticates via its own `/login` store) and is wrong for a bundled one (which has no such store). Rather than invert one rule and leave two policies to drift, both roles now route through `computeClaudeWorkerEnv`. The part of the old rationale that survives is the part that was about least privilege rather than mechanism: a worker running `bypassPermissions` over untrusted content gets only the credentials it needs, so `GEMINI_API_KEY` is still withheld from both.

### D5: Cancellation becomes transport-agnostic

With no subprocess on either side, `killChild` and the SIGTERM→SIGKILL escalation have nothing to signal. `run-queue` now ends any active run through the injected `cancelRun`; a DEV run carries its own `cancel` (an `AbortController`), a PO turn is ended through its session.

The grace timer is kept but its meaning narrowed, and the two callers were deliberately split after a regression: `stop()` waits `STOP_GRACE_MS` so the transport can report its own terminal status first, while the **idle watchdog finalizes immediately** — the spec says a silent run loses the slot at expiry, and routing both through one graced path delayed that by five seconds and broke four existing tests. Hence `graceMs` is a parameter, not a constant.

### D6: `systemPrompt` preset+append, not `appendSystemPrompt`

The CLI's `--append-system-prompt` means "Claude Code's own prompt, plus this". The SDK honours an `appendSystemPrompt` option at runtime but does not declare it on `Options` (it appears only on an internal control-protocol type). DEV therefore uses the documented, typed equivalent — `systemPrompt: { type: "preset", preset: "claude_code", append: … }` — so the base prompt is stated explicitly rather than left to a default that could change. PO's existing `appendSystemPrompt` is deliberately left alone: it works, and changing it would alter PO's behavior for no benefit to this change.

### D7: Personas by value; project-local override survives

Passing `agents: { "iris-dev": definition }` removes the install step and the class of failure where a run dies because provisioning was skipped. Verified empirically with a distinctive codeword persona that the by-value definition is what the model actually receives. `~/.claude/agents` is still a settings source, so an older Iris's persona copies are removed on install rather than left to shadow or drift from the shipped ones. Skills stay on disk because the SDK's `skills` option takes *names*, not definitions — and that install is app-driven, so it costs the user nothing.

### D8: Per-arch builds via fetch-both-then-prune

npm installs only the host-matching optional dependency, so an arm64 build from an Intel machine would ship with no Claude binary at all — and `--os/--cpu` does not help (fact 5). `prepare-mac-binaries.mjs` fetches both with `npm pack`; `prune-foreign-arch.mjs` removes the wrong one per `.app`. It must be `afterPack`, not `beforePack`: before packing there is nothing in `appOutDir` to prune. The hook throws if the arch it was supposed to keep is missing, because shipping a Claude-less `.app` fails confusingly at runtime.

**Alternative rejected**: a universal build carrying both (~500 MB). Simpler to distribute, twice the download, and half of it can never run.

### D9: The renderer's `ClaudeHealth` is an unchecked mirror — treat main-process payload fields as public API

`src/vite-env.d.ts` hand-declares the shape `checkClaudeHealth()` returns, and the two-project typecheck cannot see across the IPC boundary: `tsc -p tsconfig.electron.json` checks the producer, `tsc --noEmit` checks the consumer, and nothing checks that they agree. Deleting a field from the producer therefore type-checks cleanly while leaving the consumer dereferencing `undefined` — which in a React render is a TypeError that unmounts the tree, so the app looks like it closed.

This actually happened in this change (see tasks 8b). The rule it produces: **removing a field from a main-process payload is a renderer-visible breaking change**, and the renderer type must be updated in the same commit — at which point `tsc` does find every call site. The key-set assertions added to `pipeline-probes.test.mjs` and `pipeline-install.test.mjs` make the omission fail a gate rather than fail at runtime.

## Risks

- **App size**: +~250 MB per build. Inherent to the goal.
- **Code signing**: the nested `claude` is Anthropic-signed with a hardened runtime. The current `dir` target is unsigned so nothing breaks today, but a notarized `.dmg` will need entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`) and correct nested re-signing order. Explicitly out of scope, recorded so it is not a surprise.
- **SDK/CLI version coupling**: bumping the SDK also bumps the shipped Claude Code and changes a ~250 MB asset. Recorded in `docs/REFERENCE.md`.
- **Subscription login still needs a terminal** (fact 3). Mitigated rather than solved: the SetupPanel shows the exact `setup-token` command pointed at the app's *own* bundled binary, so the user still installs nothing.
