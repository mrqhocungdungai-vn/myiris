# Tasks

## 0. Spike (verify before building)

- [x] 0.1 `query()` with no `pathToClaudeCodeExecutable` and `PATH=/nonexistent` completes a run
- [x] 0.2 The native binary works from a bare directory addressed by explicit path (the `app.asar.unpacked` shape)
- [x] 0.3 Characterize `claude setup-token` under piped stdio — **requires a TTY**, so an in-app OAuth flow is not possible

## 1. Bundled binary resolution + auth gate

- [x] 1.1 Add `electron/bundled-binaries.mjs` with the `app.asar` → `app.asar.unpacked` rewrite and a package-root resolver that survives an `exports` map
- [x] 1.2 `claudeBinary()` returns the bundled binary; delete the host PATH probe and bare-name fallback (`IRIS_CLAUDE_BIN` kept as a dev override)
- [x] 1.3 Add `claudeCredentialStatus()`; make `pipelineAvailable` = binary reachable AND credential present
- [x] 1.4 Split `reachable` from `pipelineAvailable` in the health payload; update the install hints that told users to install a CLI
- [x] 1.5 Tests: asar rewriting (dev + packaged + misconfigured), both credential kinds and neither, mid-session credential add

## 2. DEV onto `query()`

- [x] 2.1 Rewrite `startDevRun` on the SDK, preserving the system-prompt, model-resolution, session-resume and dead-resume-recovery logic verbatim
- [x] 2.2 Use `systemPrompt: { type: "preset", preset: "claude_code", append }` and pair `bypassPermissions` with `allowDangerouslySkipPermissions`
- [x] 2.3 Delete the 0600 temp mcp-config file — pass `mcpServers` in-process
- [x] 2.4 Delete the newline-delimited stdout buffer; `handleClaudeStreamEvent(run, line)` becomes `handleClaudeStreamMessage(run, message)`
- [x] 2.5 Replace `killChild`/process-group kill with a per-run `AbortController`; make `run-queue` cancellation transport-agnostic
- [x] 2.6 Keep the idle watchdog finalizing **immediately** (regression caught by existing tests when it was routed through the grace timer)
- [x] 2.7 Tests: fake `query` driving the whole DEV lifecycle — options, success, error subtype, no-result, dead resume, abort-vs-error

## 3. One env policy

- [x] 3.1 Add `computeClaudeWorkerEnv`; route both roles through it; `computePoSessionEnv` becomes a thin alias
- [x] 3.2 Widen `poBillingStatus` to accept an API key, so it cannot refuse a run the availability gate already allowed
- [x] 3.3 Remove the `IRIS_PO_LIVE_SESSION` rollback switch and its dead fallback path
- [x] 3.4 Tests: the three env branches

## 4. Bundle OpenSpec

- [x] 4.1 Add `@fission-ai/openspec` as a dependency
- [x] 4.2 `openspecBinary()` → `openspecCommand()` returning a command spec run through Electron's Node (`ELECTRON_RUN_AS_NODE`)
- [x] 4.3 Update `ensureProjectScaffold` and the `--version` probe to use it
- [x] 4.4 Verified: `openspec init` scaffolds with `PATH=/nonexistent`

## 5. Personas by value

- [x] 5.1 Add `electron/agent-definitions.mjs` (front-matter parser + `AgentDefinition` builder)
- [x] 5.2 `resolveAgentDefinition(agent, cwd)` — project-local override, else bundled
- [x] 5.3 Pass `agents` to both `query()` call sites; verified by value with a distinctive-codeword persona
- [x] 5.4 Delete `installIrisAgents`, `checkAgentsStatus`, the `agents:install` channel, the "Install agents" UI, and the "not installed" run gate
- [x] 5.5 Add `cleanupLegacyAgents()` so an older Iris's persona copies cannot shadow the shipped ones
- [x] 5.6 Tests: parser, override precedence, real shipped personas parse to non-empty prompts, cleanup leaves foreign agents alone

## 6. Auth UX

- [x] 6.1 Allow `ANTHROPIC_API_KEY` in the config allowlist and the keep-on-empty set
- [x] 6.2 Generalize `savePoToken` to take a credential key; reject any key that is not a Claude credential
- [x] 6.3 Re-probe availability after a credential is saved or removed
- [x] 6.4 Report `poTokenSet` / `anthropicApiKeySet` separately (presence only — values never cross IPC)
- [x] 6.5 SetupPanel: API-key field, and a `setup-token` command pointed at the app's own bundled binary
- [x] 6.6 Tests: per-key write/remove, rejected key, re-probe on change

## 7. Packaging

- [x] 7.1 `asarUnpack` the SDK binary packages and the OpenSpec CLI
- [x] 7.2 Per-arch mac targets; fix `extraResources` (`resources/skills` was missing, `project-seed` does not exist)
- [x] 7.3 `scripts/prepare-mac-binaries.mjs` — fetch both darwin binaries via `npm pack` (npm's `--os/--cpu` does not bypass its platform check)
- [x] 7.4 `scripts/prune-foreign-arch.mjs` as an **afterPack** hook (beforePack has nothing to prune yet); fails the build if the kept arch is missing
- [x] 7.5 Verified: both `.app`s build, each carries only its own binary, and the packaged app runs a real query with `PATH=/nonexistent`

## 8. Docs + spec

- [x] 8.1 `CLAUDE.md`, `README.md`, `.env.example`, `docs/PIPELINE_INTERNALS.md`, `docs/REFERENCE.md`
- [x] 8.2 This OpenSpec change (proposal / design / delta specs / tasks)
- [x] 8.3 `docs/PIPELINE_GUIDE.md` + `docs/PIPELINE_GUIDE.vi.md` — setup walkthrough and troubleshooting rewritten for the bundled model
- [ ] 8.4 Archive the change once reviewed, syncing the delta specs into `openspec/specs/`

## 8b. Regression fix: Settings panel crash

Removing `agentsOk` / `missingAgents` from the health payload, and changing
`installPipelinePrereqs().agents` from an install result to a cleanup result,
broke the renderer: `src/vite-env.d.ts` still declared the old fields, so `tsc`
saw nothing, and SetupPanel dereferenced `pipelinePrereqs.missingAgents.join()`
during render — a TypeError that unmounted the whole UI, so opening Settings
appeared to close the app.

- [x] 8b.1 Remove the "Iris agents" prereq row (personas ship in the app; nothing can be missing)
- [x] 8b.2 Drop `agentsOk`/`missingAgents` from the renderer's `ClaudeHealth`, and retype `agents` in the install report as `LegacyAgentsCleanupResult` — with the types corrected, `tsc` flags all six real call sites
- [x] 8b.3 Report legacy-persona cleanup in the install summary instead of a nonexistent install count
- [x] 8b.4 Guard: pin the exact `checkClaudeHealth()` key set and the install-report shape in tests, so dropping a field the renderer reads fails a gate
- [x] 8b.5 Verified the full health contract now matches `ClaudeHealth` in both directions, and every unguarded deref on the Settings render path evaluates without throwing

## 8c. Settings panel brought in line with the bundled model

The crash fix stopped the panel from throwing, but it still described the old
architecture: it reported a "Ready" CLI while the pipeline was off, offered an
install hint for a component that ships in the app, and hid the credential
fields behind the very probe a broken bundle would fail.

- [x] 8c.1 Credential fields always render — they were gated on `pipelinePrereqs?.reachable`, so they did not exist until the probe returned, and would never appear on the one machine whose probe fails
- [x] 8c.2 Badge reflects *pipeline* state, not binary state: no credential no longer shows "Ready" directly above "Pipeline off"
- [x] 8c.3 Billing line names the credential actually in use (subscription vs API key) instead of assuming a token
- [x] 8c.4 New `BundledRow` for Claude Code and OpenSpec — reports "Bundled"/"Damaged" with no install hint, because no user command can fix a damaged bundle
- [x] 8c.5 "Install missing" no longer claims to fix OpenSpec; it covers only the on-disk skills it can actually install
- [x] 8c.6 Copy: token placeholder, wizard welcome, and the mount-probe comment no longer reference a host CLI install
- [x] 8c.7 Strip the `(Claude Code)` suffix from the version string, and stop telling the user to go to the setup panel while they are in it
- [x] 8c.8 Verified all three states (no credential / API key / subscription token) render coherently against real payloads

## 8d. Sever the last ties to the system Claude Code

The pipeline still wrote skills/commands into the user's `~/.claude` and read
their user-scope config, and still let `IRIS_CLAUDE_BIN` point at a host binary.
The Agent SDK's `plugins` option removes the need for all of it.

- [x] 8d.1 Restructure `resources/skills/` into `resources/iris-plugin/` — a real Claude Code plugin (`.claude-plugin/plugin.json`, `skills/`, `commands/opsx/`)
- [x] 8d.2 Pass it to both `query()` sites via `plugins: [{ type: "local", path, skipMcpDiscovery: true }]`
- [x] 8d.3 `settingSources: ["project"]` — the user's `~/.claude` is no longer read; the working repo's `.claude/` still is
- [x] 8d.4 Update the personas to the namespaced identifiers the runtime actually exposes (`iris:grilling`, `/iris:opsx:apply`)
- [x] 8d.5 Delete `installPipelinePrereqs` and every write into `~/.claude`; the skills/notes probes now check the app bundle
- [x] 8d.6 Replace the "Install missing" action with "Remove leftovers": reports what older versions wrote there, removes only those paths, only on an explicit click
- [x] 8d.7 Remove `IRIS_CLAUDE_BIN` / `IRIS_OPENSPEC_BIN` — an override pointing at a host install would restore the coupling and run someone else's binary under bypassPermissions
- [x] 8d.8 Verified: a real run loads 16 `iris:*` skills and 6 `/iris:opsx:*` commands from the bundle with `PATH=/nonexistent`, and `~/.claude/skills` is unchanged

## 9. Verification

- [x] 9.1 `npm run build && npm test && npm run lint` all green
- [x] 9.2 End-to-end DEV run through the real `createRunExec` against the real bundled binary
- [x] 9.3 Settings panel opens without throwing (verified by evaluating its dereferences against the real payload)
- [x] 9.4 Packaged build carries the plugin and loads it from Resources
- [ ] 9.5 Launch the packaged `.app` on a machine that never had Claude Code installed
