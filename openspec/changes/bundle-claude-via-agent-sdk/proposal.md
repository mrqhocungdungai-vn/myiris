## Why

Iris was built on the assumption that the Claude Agent SDK is a thin wrapper that needs a separately-installed `claude` CLI to drive. That assumption is wrong, and it has shaped the architecture in ways that cost users a working app.

Verified against the installed SDK (`@anthropic-ai/claude-agent-sdk@0.3.210`): the SDK declares one native Claude Code binary per platform in its own `optionalDependencies`, and `@anthropic-ai/claude-agent-sdk-darwin-x64` is a 251 MB Mach-O executable — Claude Code `2.1.210`, code-signed by Anthropic — already sitting in `node_modules`. When `pathToClaudeCodeExecutable` is omitted, the SDK resolves that binary itself. Nothing about it requires a host install.

The cost of the wrong assumption is spread across the app:

- **Two transports for one job.** DEV spawns `claude -p --output-format stream-json` and hand-parses newline-delimited JSON off stdout; PO uses `query()`. They share a stream parser and nothing else — two error paths, two cancellation mechanisms, two env policies.
- **The pipeline is gated on something that is about to be always true.** `pipelineAvailable` probes the host for a `claude` binary at `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`. Once the binary ships with the app, that question has one answer and the flag stops carrying information — while the thing a user *can* actually lack, a credential, isn't checked at all.
- **A second, undeclared host prerequisite.** `openspec` is probed the same way and is required for `openspec init` and the DEV run gate, but it is not even a dependency of this project — it has to be `npm install -g`'d.
- **Personas are installed into `~/.claude/agents`** purely so the CLI can find them by name, adding a provisioning step ("Install agents") that can be skipped, leaving a run to fail on a missing file.
- **DEV withholds `CLAUDE_CODE_OAUTH_TOKEN`** on the documented grounds that `claude -p` authenticates through its own `/login` credential store. That is true of a *host* CLI and false of a bundled one, which has no such store — so the current policy would leave a packaged DEV with no way to authenticate at all.

The result is an app that cannot be handed to anyone. "Install Claude Code, log in, then `npm i -g @fission-ai/openspec`, then click Install agents" is not a download.

## What Changes

- **Both roles run on the Agent SDK's `query()`.** DEV's `claude -p` subprocess is replaced by a one-shot `query()`; PO is unchanged. The two now differ in *lifetime* (one-shot vs resident session), not in mechanism.
- **Claude Code and OpenSpec ship inside the app.** A new `electron/bundled-binaries.mjs` resolves both out of `node_modules`, rewriting `app.asar` → `app.asar.unpacked` because a subprocess cannot be exec'd from inside an asar archive. The host PATH probes are deleted, and no setting is left that could point either back at a host install.
- **BREAKING (gating semantics)**: `pipelineAvailable` becomes "the bundled binary launches **AND** a usable Claude credential exists" instead of "a `claude` binary was found on this machine". Chat-only mode is unchanged in behavior but now means *no credential* rather than *no install* — which is the state a brand-new user is actually in.
- **`ANTHROPIC_API_KEY` becomes a first-class credential**, settable from the Setup panel alongside the subscription token. Either enables the pipeline; the subscription token wins when both are set. `poBillingStatus` accepts either, so an API-key-only user is not left with a live pipeline whose PO turns all fail.
- **One env policy for both roles.** `computeClaudeWorkerEnv` replaces the split policy: `GEMINI_API_KEY` always withheld; the metered `ANTHROPIC_*` keys stripped only when a subscription token is present. The old "DEV must not see the OAuth token" rule is removed along with the `/login`-store rationale that no longer holds.
- **Personas are passed to the SDK by value.** `electron/agent-definitions.mjs` parses `resources/personas/*.md` into the SDK's `AgentDefinition`. The `~/.claude/agents` install, the "Install agents" action and its IPC channel, and the "agent is not installed" run gate are all removed; a project-local `.claude/agents/iris-<role>.md` override still wins. A Settings action offers to remove persona copies an older Iris installed.
- **Per-arch macOS builds.** `asarUnpack` keeps the native binary exec'able; `scripts/prepare-mac-binaries.mjs` fetches both darwin binaries (via `npm pack` — `npm install --os/--cpu` does not bypass npm's platform check) and `scripts/prune-foreign-arch.mjs` removes the non-target one from each `.app`, so a build carries ~250 MB rather than ~500 MB.
- **Skills and commands ship as a Claude Code plugin** (`resources/iris-plugin/`), passed per run via the SDK's `plugins` option and namespaced `iris:*`. Combined with `settingSources: ["project"]`, this means Iris **never reads or writes the user's `~/.claude`** — the previous design copied skills, commands, and personas into it. A Settings action offers to remove what older versions left there, scoped to exactly those paths.
- **Removed**: `IRIS_CLAUDE_BIN` / `IRIS_OPENSPEC_BIN`. An override pointing at a host install would restore the coupling this change removes, and would run a possibly-different binary under `bypassPermissions`.
- **Removed**: the `IRIS_PO_LIVE_SESSION` rollback switch, whose fallback path (PO as a one-shot `claude -p --resume`) no longer exists.
- Packaging fix along the way: the bundled skills were missing from `extraResources` while `bundledResourceDir` looked for them (now shipped as `resources/iris-plugin`), and `resources/project-seed` was listed but does not exist.

## Impact

- Affected specs: `pipeline-availability` (gate redefined), `agent-subscription-auth` (second credential; env policy), `global-agent-runtime` (transport, persona delivery), `pipeline-setup-install` (no agent install), `run-execution-queue` (transport-agnostic cancellation), `openspec-native-pipeline` (bundled CLI), `setup-panel` (API-key field).
- Affected code: `electron/{bundled-binaries,agent-definitions}.mjs` (new); `run-exec.mjs`, `run-queue.mjs`, `run-stream.mjs`, `pipeline-probes.mjs`, `pipeline-install.mjs`, `worker-env.mjs`, `po-session.mjs`, `user-config.mjs`, `ipc.mjs`, `preload.cjs`, `main.mjs`, `wiring*.mjs`; `src/App.tsx`, `src/components/{SetupPanel,PipelineBar}.tsx`, `src/vite-env.d.ts`; `package.json` build config; `scripts/{prepare-mac-binaries,prune-foreign-arch}.mjs` (new).
- **User-visible**: users who already have a host `claude` no longer use it (the app uses its own); a user with no credential moves from "pipeline on, every run fails" to honest chat-only mode; the "Install agents" button is gone.
- **Download size**: each `.app` grows by ~250 MB. Unavoidable — the binary is the thing being shipped.
- **Not addressed**: code signing / notarization of the nested Mach-O (the `dir` target is unsigned today); the pre-existing ~700 MB asar of renderer dependencies (onnxruntime-web, mermaid, excalidraw, three) that are bundled by Vite *and* shipped raw.
