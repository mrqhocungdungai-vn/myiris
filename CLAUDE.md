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
credential unlocks a **PO → DEV** build pipeline: Gemini delegates real work to
Claude as a background worker. Both roles run on the **Agent SDK's `query()`**;
they differ in lifetime, not transport. PO is a **stateful** resident session
that can pause mid-turn to ask a voice question; DEV is a **stateless** one-shot
`query()` per run that never asks.

## Where to read more

| Topic | Read |
| --- | --- |
| **Authoritative behavior of any capability** | `openspec/specs/<capability>/spec.md` |
| Module/file map, end-to-end audio + delegation flow, component responsibilities, Gemini tool surface | **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** |
| Pipeline internals: availability gating, delegation flow, voice relay, sessions/context ownership, PO→DEV pipeline, PO subscription auth, prompt/budget policy, hooks, skill scoping | **[docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md)** |
| Test harness: the four gates, what vitest picks up, the SDK options test, typecheck projects, testability conventions | **[docs/TESTING.md](docs/TESTING.md)** + `openspec/specs/test-harness/spec.md` |
| **Pinned exact identifiers** (Gemini Live model + voice, audio rates, SDK/CLI coupling, vendored WASM assets), the footgun list, and the Agent SDK `Options` audit — what Iris sets and every option deliberately declined | **[docs/REFERENCE.md](docs/REFERENCE.md)** |
| Using the pipeline as a user (setup, voice walkthrough, troubleshooting) | [docs/PIPELINE_GUIDE.md](docs/PIPELINE_GUIDE.md) |
| Gesture/hand control (MediaPipe config, gesture→action mapping) | [docs/GESTURES.md](docs/GESTURES.md) |
| Listening mode (chunked monologue capture, boundary sequence, control surfaces) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#listening-mode) + `openspec/specs/listening-mode/spec.md` |
| Env vars, packaging, setup from source | [README.md](README.md) + `.env.example` |
| How the Claude Agent SDK itself works — hooks, subagents, MCP, permissions, sessions, plugins, skills, structured outputs, hosting, cost tracking, TS/Python reference | NotebookLM notebook **`claude-agent-sdk`**, id `b7301ab8-69c2-4cdf-bd28-19931d678aed` — ask it via the `notebooklm` MCP (`notebook_ask`). A **reference library of the upstream SDK docs**, consulted while developing; it holds nothing about Iris and never describes Iris's behavior. |

## Commands

```bash
npm ci                 # install deps
npm run dev            # Vite + Electron with hot reload (dev)
npm run build          # tsc --noEmit (src) + tsc -p tsconfig.electron.json (electron) + vite build
npm test               # vitest run (behavioral gate)
npm run lint           # oxlint, zero-warning (whole-tree)
npm run scan:secrets   # gitleaks over the staged changes
npm start              # build then launch Electron from dist/ (production-like)
npm run start:prod     # launch prod build without rebuilding
npm run package:mac    # build + both mac arches (x64 + arm64) as unpacked .app
npm run package:mac:host # build + host arch only (skips the ~250 MB arm64 fetch)
npm run dist:mac       # build + full macOS distributable
```

The first four are **four independent gates** — run all of them to verify a
change; `lint` and `scan:secrets` are deliberately kept out of `build` so a
typecheck stays runnable on its own. They are also bound to editing events by
`.claude/settings.json`, and **fail closed** if `gitleaks` is missing
(`brew install gitleaks`; `IRIS_SKIP_HOOKS=1` is the one-off bypass).
Details: [docs/TESTING.md](docs/TESTING.md) and the `workflow-quality-gates` spec.

**The build toolchain requires Node.js `>=24.0.0`** (`engines.node` +
`.npmrc`'s `engine-strict=true`; `nvm use` reads `.nvmrc`). Separate from the
app's runtime — a packaged Iris ships Electron's own Node, and `@types/node`
tracks *that*, guarded by `scripts/check-types-node.mjs`.

## Runtime prerequisites

- **macOS only** — Iris refuses to launch elsewhere (`IRIS_ALLOW_ANY_PLATFORM=1` is the developer escape hatch).
- **`GEMINI_API_KEY`** in `.env` (repo `.env` in dev, `~/.iris/.env` when packaged). Enough on its own for chat-only mode.
- **Optional, for the pipeline:** a Claude credential — `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` (metered). Claude Code and OpenSpec themselves are **bundled, not host prerequisites**, and there is deliberately no override pointing at a host install. See [docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md).

## Living spec (OpenSpec)

- **`openspec/specs/` is the living spec** — the source of truth for system behavior, one capability per folder. Before changing behavior, read the relevant capability spec; **after your change lands, the spec must still be true.**
- Behavior changes flow through OpenSpec: propose under `openspec/changes/<name>/`, implement (`/opsx:apply`), then archive — archiving syncs the change's delta specs into `openspec/specs/`. `openspec/changes/archive/` is history; the living spec is the merged truth.
- If code and a living spec disagree, reconcile through a change (or an explicit spec sync) — **never silently edit either side.**

## Conventions

- **Iris never reads or writes the user's `~/.claude`.** This takes *two* mechanisms — `settingSources` excluding the `user` scope, **and** pinning `CLAUDE_CONFIG_DIR` to `~/.iris/claude-home`, because transcripts, `.claude.json`, and auto-memory are read/written regardless of `settingSources`. Both live in `worker-env.mjs`; the reasoning and its consequences are in [docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md).
- **Configure a run only through options the Agent SDK declares.** An undeclared option is silently dropped — `appendSystemPrompt` was, for months, and PO ran with no base prompt while the tests claimed otherwise. `electron/sdk-options.test.mjs` asserts each role's complete options key set; add a field ⇒ add it there. Full audit in [docs/REFERENCE.md](docs/REFERENCE.md).
- **Every run carries a turn and spend ceiling**, and a run that hits one finalizes as `limited` — its own terminal status, never `failed`. Cost is recorded from the runtime, never estimated.
- `bypassPermissions` is the intentional default for the headless worker. The `PreToolUse` denylist is a **guard against accidents, not a sandbox** — never describe it as containment.
- Config is env-driven with `IRIS_*` / `GEMINI_*` prefixes; add new options the same way and **document them in `.env.example`**, which is the authoritative list.
- **Never commit real keys.** `.env` is gitignored. Setting `ANTHROPIC_API_KEY` means metered billing; it is used only when no subscription token is present.
- The renderer executes only code shipped inside the app (CSP blocks remote script/WASM, no off-origin navigation, scoped device permissions). See the `renderer-content-security` spec.
- Electron API access is confined to four modules (`main.mjs`, `ipc.mjs`, `window.mjs`, `renderer-security.mjs`); **every other module under `electron/` is Electron-free and importable in a plain vitest file.** Keep it that way — see the `main-process-structure` spec.
- File-size convention: one responsibility per file, target **250–450 lines**; `*.test.*` files are exempt. Convention-only by deliberate decision — no guard script.
- **Docs discipline: keep this file a router.** New deep detail goes to `docs/` or a capability spec, with a one-line pointer here.
