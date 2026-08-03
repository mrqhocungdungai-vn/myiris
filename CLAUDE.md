# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

This file is deliberately a **short router**, not a manual: it holds only what
applies to *every* task. Deep detail lives in `docs/` and `openspec/specs/` —
read the relevant one on demand instead of assuming.

## What Iris is

A desktop voice companion (Electron + React + Vite + TypeScript), **macOS only**.
**Gemini Live** handles realtime voice conversation — by default that's the whole
app, and chat needs only `GEMINI_API_KEY`. When the `claude` binary is detected,
Iris additionally unlocks a **PO → DEV** build pipeline: Gemini delegates real
work to Claude as a background worker. PO is a **stateful** Agent SDK session
that can pause mid-turn to ask a voice question; DEV is a **stateless** one-shot
`claude -p --resume` subprocess that never asks.

## Where to read more

| Topic | Read |
| --- | --- |
| Pipeline internals: availability gating, delegation flow, voice relay, sessions/context ownership, PO→DEV pipeline, PO subscription auth | **[docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md)** |
| End-to-end audio + delegation flow, component responsibilities, Gemini tool surface | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Test harness: the two gates, what vitest picks up, testability conventions | **[docs/TESTING.md](docs/TESTING.md)** + `openspec/specs/test-harness/spec.md` |
| Pinned exact identifiers (models, SDKs, assets) + full footgun rationale | [docs/REFERENCE.md](docs/REFERENCE.md) |
| Using the pipeline as a user (setup, voice walkthrough, troubleshooting) | [docs/PIPELINE_GUIDE.md](docs/PIPELINE_GUIDE.md) |
| Gesture/hand control (MediaPipe config, gesture→action mapping) | [docs/GESTURES.md](docs/GESTURES.md) |
| Listening mode (chunked monologue capture, boundary sequence, control surfaces) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#listening-mode) + `openspec/specs/listening-mode/spec.md` |
| Env vars, packaging, setup from source | [README.md](README.md) |
| **Authoritative behavior of any capability** | `openspec/specs/<capability>/spec.md` |

## Commands

```bash
npm ci                 # install deps
npm run dev            # Vite + Electron with hot reload (dev)
npm run build          # tsc --noEmit (src) + tsc -p tsconfig.electron.json (electron) + vite build
npm test               # vitest run (behavioral gate)
npm start              # build then launch Electron from dist/ (production-like)
npm run start:prod     # launch prod build without rebuilding
npm run package:mac    # build + electron-builder --mac --dir (unpacked .app)
npm run dist:mac       # build + full macOS distributable
```

```bash
npm run lint           # oxlint, zero-warning (whole-tree)
npm run scan:secrets   # gitleaks over the staged changes
```

`npm run build` and `npm test` are **independent** checks — run both to verify a
change. `lint` and `scan:secrets` are two more, deliberately kept out of `build`
so a typecheck stays runnable on its own. All four are also bound to editing
events by `.claude/settings.json`: per-file checks fire per edit, whole-tree
checks at the end of a turn. `gitleaks` must be installed separately
(`brew install gitleaks`) and the gates **fail closed** without it —
`IRIS_SKIP_HOOKS=1` is the one-off bypass. Details and test conventions:
[docs/TESTING.md](docs/TESTING.md); gate behavior: the `workflow-quality-gates`
capability spec.

**Build toolchain requires Node.js `>=24.0.0`**, enforced by `engines.node` +
`.npmrc`'s `engine-strict=true` (`npm ci` fails `EBADENGINE` below it; `nvm use`
reads `.nvmrc`). This is separate from the app's runtime prerequisites below — a
packaged Iris ships Electron's own Node. Relatedly, `@types/node`'s major tracks
the Node **Electron** embeds rather than this floor, guarded at build time by
`scripts/check-types-node.mjs`; see [docs/REFERENCE.md](docs/REFERENCE.md).

## Runtime prerequisites

- macOS only — Iris refuses to launch elsewhere (`electron/platform.mjs`'s `shouldRefuseLaunch`; `IRIS_ALLOW_ANY_PLATFORM=1` is the developer escape hatch).
- `GEMINI_API_KEY` in `.env` (repo `.env` in dev, `~/.iris/.env` when packaged). Enough on its own for chat-only mode.
- Optional, for the pipeline: Claude Code CLI installed and authenticated. A packaged GUI app may not inherit shell PATH — `main.mjs` probes `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, or set `IRIS_CLAUDE_BIN`. Presence of this binary is the **sole** switch that enables the pipeline.

## File map

Two-process Electron app. The Gemini↔Claude bridge used to live almost entirely
in `electron/main.mjs`; it's now ~20 single-responsibility modules under
`electron/`, with Electron API access confined to four of them (`main.mjs`,
`ipc.mjs`, `window.mjs`, `renderer-security.mjs`) — every other module is
Electron-free and importable in a plain vitest file with no harness. See the
`main-process-structure` capability spec for the full discipline.

- **`electron/main.mjs`** (~240 lines) — the composition root: imports every module, wires dependency injection via `wiring.mjs`, and runs the `app.whenReady()` startup sequence, `shutdownTeardown`, and quit handlers. No domain logic.
- **`electron/wiring.mjs`** (+ **`wiring-capabilities.mjs`**, **`wiring-live.mjs`**) — the composition root's dependency-injection wiring, split across three files purely because the block exceeded the 450-line file-size convention once every module existed. `wiring-capabilities.mjs` wires the canvas/second-brain capabilities, run-exec, and the Gemini tool/prompt modules; `wiring-live.mjs` wires the Live session, listening mode, and window/HUD/tray (a genuine three-way mutual dependency).
- **`electron/ipc.mjs`** — every `ipcMain.handle`/`on` registration (the renderer↔main channel surface), diffable against `preload.cjs`. Marshals arguments and delegates only.
- **`electron/window.mjs`** — the main window, the Glass HUD shape-morph (`enterHud`/`exitHud`/`toggleHud`), and the Tray.
- **`electron/renderer-security.mjs`** — navigation containment and device-permission scoping (`renderer-content-security` capability); installed before the first window is created.
- **`electron/live-session.mjs`** (+ **`live-messages.mjs`**) — the Gemini Live session (`@google/genai`): connect/reconnect lifecycle in the former, server-message/tool-call handling in the latter.
- **`electron/listen-mode.mjs`** — listening mode's enter/exit/rotation sequences and engagement state; drives `live-session.mjs` via named transitions, never raw field writes.
- **`electron/gemini-tools.mjs`** / **`gemini-prompts.mjs`** — Gemini's function-declaration schemas and system-instruction prose; both compose contributions from registered capabilities rather than hardcoding them.
- **`electron/session-store.mjs`** — workstreams, the agent roster, and per-role model selection.
- **`electron/run-dispatch.mjs`** (+ **`run-stream.mjs`**, **`run-exec.mjs`**) — the pre-dispatch review gate and tool-execution surface; run activity/tool-step streaming and the PO live-question relay; spawning/driving DEV and PO runs.
- **`electron/announcements.mjs`** — voice announcements to the Live session, buffered while offline.
- **`electron/pipeline-probes.mjs`** / **`pipeline-install.mjs`** — Claude/OpenSpec availability probing and agent/skill installation.
- **`electron/user-config.mjs`** — env/user config, the prompt-review-mode flag, and API-key/token handling.
- **`electron/capabilities/canvas.mjs`** / **`capabilities/second-brain.mjs`** — the canvas-claude-mcp and personal-knowledge-notes/second-brain capabilities, each owning its own state, IPC handlers, teardown, and Gemini prompt fragment end to end (`electron/capabilities/` is where a new capability's main-process code should live).
- **`electron/live-config.mjs`** — `buildLiveConfig()`, extracted so the Live session config (converse vs. listening) is testable without booting Electron.
- **`electron/listen-boundary.mjs`** — the measured chunk-boundary sequence (`runBoundary()`) listening mode's rotations and exit run through; takes an injected session-like driver so it's testable without a live connection.
- **`electron/po-session.mjs`** — the stateful PO module: Agent SDK session lifecycle, streaming user-message channel, and the `canUseTool` callback intercepting `AskUserQuestion`. Isolated so DEV's one-shot path never has to know it exists.
- **`electron/preload.cjs`** — the `window.iris` IPC bridge. Any new renderer↔main channel must be exposed here.
- **`src/App.tsx`** (1738 lines) — renderer: mic capture (WebRTC AEC → 16 kHz PCM), Gemini playback (24 kHz PCM), the "Orbital Deck" UI, keyboard shortcuts, gestures, and the `uiMode` (`deck` | `hud`) switch.
- **`src/components/HudShell.tsx`** + **`src/styles/hud.css`** — the Glass HUD overlay; pointer-transparent except `.hud-hit` islands (App.tsx reports pointer-over-island via `hud:interactive`; main toggles `setIgnoreMouseEvents`).
- **`src/hooks/useHandControl.ts`** — MediaPipe `GestureRecognizer` hook (on-device, starts only after wake).
- **`src/ReactorCore.tsx`, `src/BootSequence.tsx`, `src/deck.css`, `src/App.css`** — UI/animation.
- **`scripts/run-electron.mjs`** — launcher; clears `ELECTRON_RUN_AS_NODE`, supports `--prod`.

## Pinned external identifiers — do not drift

Load-bearing; a wrong value silently breaks voice or gestures. Full table and
rationale in [docs/REFERENCE.md](docs/REFERENCE.md) — check it before touching
any of these.

- Gemini Live model **`models/gemini-3.1-flash-live-preview`** (Live is a distinct model family; keep the `models/` prefix), voice `Zephyr`.
- Audio is asymmetric: **send 16 kHz PCM, receive 24 kHz PCM**.
- Use `sendRealtimeInput`, not the deprecated `media_chunks` path.
- Gemini Live function calls are **synchronous** — never block a tool call on long Claude work; return a `run_id` and track completion separately.
- `@mediapipe/tasks-vision` and `onnxruntime-web`'s WASM runtimes are **vendored**, not CDN-fetched — `scripts/vendor-runtime-assets.mjs` copies them from the installed npm package into `public/runtime/` (wired into `npm run build`/`postinstall`), so they can't drift from the installed version the way a hand-typed CDN URL could. Exactly one `three` copy must stay resolved.

## Living spec (OpenSpec)

- **`openspec/specs/` is the living spec** — the source of truth for system behavior, one capability per folder (e.g. `voice-decision-relay`, `two-hand-gestures`, `per-role-model-selection`). Before changing behavior, read the relevant capability spec; after your change lands, the spec must still be true.
- Behavior changes flow through OpenSpec: propose under `openspec/changes/<name>/` (proposal / design / specs / tasks), implement (`/opsx:apply`), then archive — archiving syncs the change's delta specs into `openspec/specs/`. `openspec/changes/archive/` is history; the living spec is the merged truth.
- If code and a living spec disagree, reconcile through a change (or an explicit spec sync) — never silently edit either side.

## Conventions

- Config is env-driven with `IRIS_*` / `GEMINI_*` prefixes and sensible fallbacks; add new options the same way and document them in `.env.example`. PO-specific: `CLAUDE_CODE_OAUTH_TOKEN` (auth), `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000), `IRIS_PO_LIVE_SESSION` (rollback switch). Wake-word-specific: `IRIS_WAKE_THRESHOLD` (default 0.15, also settable from Settings as Strict/Balanced/Sensitive), `IRIS_WAKE_CONSECUTIVE` (default 2, env-only), `IRIS_WAKE_DEBUG` (default off — emits score diagnostics to the renderer console and opens DevTools).
- `bypassPermissions` is the intentional default for the headless worker (no interactive approval exists in headless mode). `IRIS_CLAUDE_PERMISSION_MODE=acceptEdits|plan` restricts it. PO keeps `bypassPermissions` too (hardcoded in `po-session.mjs`) — only `AskUserQuestion` pauses it.
- Never commit real keys; `.env` is gitignored, including `CLAUDE_CODE_OAUTH_TOKEN`. Never set `ANTHROPIC_API_KEY` unless you intend PO to bill per-token (`computePoSessionEnv` strips it from the PO session regardless).
- Role workers get their environment by **subtraction, not `process.env` passed through** — `electron/worker-env.mjs`'s `computeWorkerEnv` is the shared helper both `startClaudeRun`'s DEV spawn and `computePoSessionEnv` route through, so the two paths can't drift. `GEMINI_API_KEY` is withheld from both roles (no role has a use for the voice credential); `CLAUDE_CODE_OAUTH_TOKEN` is additionally withheld from DEV, confirmed empirically to authenticate via its own `/login` session, never that env var.
- The renderer executes only code shipped inside the app: a Content-Security-Policy (`vite.config.ts`'s `transformIndexHtml`) blocks remote script/WASM execution, the privileged window can't navigate off-origin, and device permissions are scoped to the app's own document. See the `renderer-content-security` capability spec.
- `@anthropic-ai/claude-agent-sdk` is a real npm dependency (drives the same `claude` binary DEV spawns directly) — keep its version pinned like the other exact identifiers in [docs/REFERENCE.md](docs/REFERENCE.md).
- `electron/` is typechecked by `tsconfig.electron.json` (a second `tsc -p` in `npm run build`), covering every `.mjs`/`.cjs` under it automatically — no per-file opt-in. Coverage is raised by enabling a compiler flag, not by annotating files; the three currently-deferred flags and their measured error-count cost: `useUnknownInCatchVariables` +26, `strictNullChecks` +88, `noImplicitAny` +792. These counts move with `@types/node` and `lib` — they were re-measured against `@types/node@24.13.3` at `lib: ES2025`, so re-measure rather than trust them after either changes. Two-project typecheck setup and rationale: [docs/TESTING.md](docs/TESTING.md).
- File-size convention: one responsibility per file, graspable in a few minutes, target 250–450 lines; `*.test.*` files are exempt (append-only case lists, not read start-to-end). Enforcement is convention-only by deliberate decision — no guard script — so don't mistake the absence of a check for an oversight.
- Docs discipline: keep this file a router. New deep detail goes to `docs/` or a capability spec, with a one-line pointer here.
