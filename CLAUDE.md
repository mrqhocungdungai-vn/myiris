# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

This file is deliberately a **short router**, not a manual: it holds only what
applies to *every* task. Deep detail lives in `docs/` and `openspec/specs/` —
read the relevant one on demand instead of assuming. Anything here that grows
past a line or two belongs in a doc, with a pointer left behind.

## What Iris is

A desktop voice companion (Electron + React + Vite + TypeScript), **macOS only**.
**Gemini Live** handles realtime voice conversation — by default that's the whole
app, and chat needs only `GEMINI_API_KEY`. Iris **ships Claude Code inside the
app** (the Agent SDK's native binary — nothing to install), so adding a Claude
credential unlocks the build pipeline: Gemini delegates real work to Claude
through **eight named verbs**, each with its own parameter schema, scoped skills,
model, and ceilings — all declared in one registry, `electron/verbs.mjs`. **Iris
picks the verb per request**; the user never names a role or operates a control.

Every verb runs on the **Agent SDK's `query()`**. They differ in lifetime, not
transport: a **stateful** verb is a resident session, a **stateless** one is a
one-shot `query()` per run. Statefulness means *only* that — every verb,
stateless included, resumes its own prior conversation, and **whether a run may
ask is a separate declared property**, resolved per verb against project state
(`execute` may ask when there is no open change; the settled-task-list path
cannot). See the `verb-tool-surface` and `voice-decision-relay` specs.

## Where to read more

| Topic | Read |
| --- | --- |
| **Authoritative behavior of any capability** | `openspec/specs/<capability>/spec.md` |
| **What each verb is, and everything that follows from it** | `electron/verbs.mjs` — the single registry the tool declarations, the review gate, and the run configuration all derive from |
| Module/file map, end-to-end audio + delegation flow, component responsibilities, Gemini tool surface | **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** |
| Pipeline internals: availability gating, the verb registry and dispatch, voice relay, sessions/context ownership, subscription auth, prompt/budget policy, hooks, skill scoping, the run inbox | **[docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md)** |
| Test harness: the five gates, what vitest picks up, the SDK options test, typecheck projects, testability conventions | **[docs/TESTING.md](docs/TESTING.md)** + `openspec/specs/test-harness/spec.md` |
| **Pinned exact identifiers** (Gemini Live model + voice, audio rates, SDK/CLI coupling, vendored WASM assets), **the diagnostic log** (`~/.myiris/logs/iris.log` — what is in it, how to read it, and why it records everything while the on-screen strip does not), the footgun list, and the Agent SDK `Options` audit — what Iris sets and every option deliberately declined | **[docs/REFERENCE.md](docs/REFERENCE.md)** |
| Using the pipeline as a user (setup, voice walkthrough, troubleshooting) | [docs/PIPELINE_GUIDE.md](docs/PIPELINE_GUIDE.md) |
| Gesture/hand control (MediaPipe config, gesture→action mapping), the eye HUD sharing that camera session — **its readout reports the real host** (CPU/GPU/network, sampled only while the camera is on) — the **activity strip** along the frame's bottom and why its depth is decided by the build mode alone, and HUD mode's camera-zoom toggle | [docs/GESTURES.md](docs/GESTURES.md) |
| **The drawing canvas, and why it is a conversation rather than an errand** — the fullscreen surface and its escape routes, the session warmed when the board opens, why a turn into an open conversation does not queue behind unrelated work, what Iris says while the work happens, and the two predicates (consent vs. mechanics) that must not be conflated | [docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md#the-canvas-is-a-conversation-not-an-errand) + `openspec/specs/hud-drawing-canvas/spec.md` + `openspec/specs/canvas-claude-mcp/spec.md` |
| **Listen-only mode — Iris's meeting mode** (complete silence, system-audio capture mixed with the mic, `inbox/meetings/` retention, main-process ownership) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#listen-only-mode--iriss-meeting-mode) + `openspec/specs/listen-only-mode/spec.md` |
| **App identity** — why this fork installs as `MyIris` / `app.myiris.voice` / `~/.myiris` and must never share an identifier with upstream `ASHR12/iris`; there is no migration from `~/.iris`, and the one `.iris` literal left in the code is frozen history | `openspec/specs/app-identity/spec.md` + `electron/app-identity.mjs` (the single declaration) |
| Env vars, packaging, setup from source | [README.md](README.md) + `.env.example` |
| How the Claude Agent SDK itself works — hooks, subagents, MCP, permissions, sessions, plugins, skills, structured outputs, hosting, cost tracking, TS/Python reference | NotebookLM notebook **`claude-agent-sdk`**, id `b7301ab8-69c2-4cdf-bd28-19931d678aed` — ask it via the `notebooklm` MCP (`notebook_ask`). A **reference library of the upstream SDK docs**, consulted while developing; it holds nothing about Iris and never describes Iris's behavior. **Maintainer-local, not a repo prerequisite** — this repo ships no `.mcp.json`, so a fork will not have this server and should read the upstream SDK docs directly instead. |
| **What Claude Code itself is handed when working on this repo** — what a subagent must declare, why installed config must be config in use, how vendored config is provenance-locked and checked, the destructive-command guard | `openspec/specs/claude-code-config/spec.md` |

## Commands

```bash
npm ci                 # install deps
npm run dev            # Vite + Electron with hot reload (dev)
npm run build          # tsc --noEmit (src) + tsc -p tsconfig.electron.json (electron) + vite build
npm test               # vitest run (behavioral gate)
npm run test:gate      # same suite via the gate definition the Stop hook calls
npm run lint           # oxlint, zero-warning (whole-tree)
npm run scan:secrets   # gitleaks over the staged changes
npm run spec:check     # drift check over openspec/specs/ (the living spec)
npm start              # build then launch Electron from dist/ (production-like)
npm run start:prod     # launch prod build without rebuilding
npm run install:mac    # build + package (host arch) + install into /Applications + launch
npm run package:mac    # build + both mac arches (x64 + arm64) as unpacked .app under release/
npm run package:mac:host # build + host arch only (skips the ~250 MB foreign-arch fetch)
npm run dist:mac       # identical to package:mac today — see below
```

`mac.target` is `dir`, so **none** of the packaging scripts produce a dmg or a
zip — they emit an unpacked `.app` under `release/`. `dist:mac` is currently
character-for-character identical to `package:mac`; it is kept as the name a
real distributable target would take if signing and notarization are ever added,
and until then it is a duplicate, deliberately. `package:mac:host` builds the
host arch only because `mac.target` declares no `arch` array — when it did, the
config won over the silent CLI and `:host` built both, then failed on the
foreign-arch Claude binary `npm ci` never installed.

`build`, `test`, `lint`, `scan:secrets`, and `spec:check` are **five independent
gates** — run all of them to verify a change; the last three are deliberately kept
out of `build` so a typecheck stays runnable on its own. They are also bound to
editing events by `.claude/settings.json`, and **fail closed** if `gitleaks` is
missing (`brew install gitleaks`; `IRIS_SKIP_HOOKS=1` is the one-off bypass — with one
deliberate exception: it does **not** disable the destructive-command guard on
`PreToolUse`, which is a guard against accident and not a quality check. `/gates` runs
all five and reports which are red).
`spec:check` is the only one that checks something other than code: the living
spec, which is otherwise the source of truth with nothing checking it.
Details: [docs/TESTING.md](docs/TESTING.md) and the `workflow-quality-gates` spec.

**The build toolchain requires Node.js `>=24.0.0`** (`engines.node` +
`.npmrc`'s `engine-strict=true`; `nvm use` reads `.nvmrc`). Separate from the
app's runtime — a packaged Iris ships Electron's own Node, and `@types/node`
tracks *that*, guarded by `scripts/check-types-node.mjs`.

## Runtime prerequisites

- **macOS only** — Iris refuses to launch elsewhere (`IRIS_ALLOW_ANY_PLATFORM=1` is the developer escape hatch).
- **`GEMINI_API_KEY`** in `.env` (repo `.env` in dev, `~/.myiris/.env` when packaged). Enough on its own for chat-only mode.
- **Optional, for the pipeline:** a Claude credential — `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` (metered). Claude Code and OpenSpec themselves are **bundled, not host prerequisites**, and there is deliberately no override pointing at a host install. See [docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md).

## Living spec (OpenSpec)

- **`openspec/specs/` is the living spec** — the source of truth for system behavior, one capability per folder. Before changing behavior, read the relevant capability spec; **after your change lands, the spec must still be true.**
- Behavior changes flow through OpenSpec: propose under `openspec/changes/<name>/`, implement (`/opsx:apply`), then archive — archiving syncs the change's delta specs into `openspec/specs/`. `openspec/changes/archive/` is history; the living spec is the merged truth.
- If code and a living spec disagree, reconcile through a change (or an explicit spec sync) — **never silently edit either side.**

## Conventions

- **Iris never reads or writes the user's `~/.claude`.** This takes *two* mechanisms — `settingSources` excluding the `user` scope, **and** pinning `CLAUDE_CONFIG_DIR` to `~/.myiris/claude-home`, because transcripts, `.claude.json`, and auto-memory are read/written regardless of `settingSources`. Both live in `worker-env.mjs`; the reasoning and its consequences are in [docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md).
- **Configure a run only through options the Agent SDK declares.** An undeclared option is silently dropped — `appendSystemPrompt` was, for months, and the resident session ran with no base prompt while the tests claimed otherwise. `electron/sdk-options.test.mjs` asserts each run shape's complete options key set; add a field ⇒ add it there. Full audit in [docs/REFERENCE.md](docs/REFERENCE.md).
- **Every run carries a turn and spend ceiling**, and a run that hits one finalizes as `limited` — its own terminal status, never `failed`. Same rule for a run whose question went unanswered: `unanswered`, and nothing downstream may report it as a decision. Cost is recorded from the runtime, never estimated.
- **A verb is defined in exactly one place.** `gemini-tools.mjs` derives its declarations from the registry, `run-dispatch.mjs` derives the park label, `run-exec.mjs` derives the `query()` options. Adding a verb means adding a record — three hand-wired copies is the mechanism that produced the silently-dropped `appendSystemPrompt`.
- **`skills` is scoped per verb, and that scoping is the substance.** Without it, eight verbs would be eight names for one agent.
- **The review gate reads the verb's declared label, never the brief's text**, and it is enforced in the main process at dispatch — never by asking the voice layer to honour an instruction.
- `bypassPermissions` is the intentional default for the headless worker. The `PreToolUse` denylist is a **guard against accidents, not a sandbox** — never describe it as containment.
- Config is env-driven with `IRIS_*` / `GEMINI_*` prefixes; add new options the same way and **document them in `.env.example`**, which is the authoritative list.
- **Never commit real keys.** `.env` is gitignored. Setting `ANTHROPIC_API_KEY` means metered billing; it is used only when no subscription token is present.
- The renderer executes only code shipped inside the app (CSP blocks remote script/WASM, no off-origin navigation, scoped device permissions). See the `renderer-content-security` spec.
- Electron API access is confined to four modules (`main.mjs`, `ipc.mjs`, `window.mjs`, `renderer-security.mjs`); **every other module under `electron/` is Electron-free and importable in a plain vitest file.** Keep it that way — see the `main-process-structure` spec.
- File-size convention: one responsibility per file, target **250–450 lines**; `*.test.*` files are exempt. Convention-only by deliberate decision — no guard script.
- **Docs discipline: keep this file a router.** New deep detail goes to `docs/` or a capability spec, with a one-line pointer here.
