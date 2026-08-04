# Iris

> **Experimental personal build.** This repository is the personal experimental version of Iris by **MRQ Học Ứng Dụng AI**. It is being used to actively test ideas, workflows, and product directions, and was published to GitHub in response to audience requests. The project still contains many bugs that MRQ has not had time to fix yet, so please treat it as an actively evolving experiment rather than a polished product. It is shared under the **MIT License** to help the community study it, modify it, and continue developing it further. This version has been tested by MRQ on a **Mac mini M4 with 16 GB RAM running macOS 26**. It is also a fork of the original [`ASHR12/iris`](https://github.com/ASHR12/iris) project — many thanks to **Ashutosh Shrivastava** for the original work.

A desktop voice companion built on **Gemini Live** for natural realtime conversation, with an optional **Claude Code** build pipeline for real work.

**Out of the box, Iris just talks to you** — add a Gemini API key and start speaking; no other setup required. Add a **Claude credential** and Iris unlocks a second layer: a build pipeline that lets you delegate real work (coding, research, files, terminal, automation) by voice. [Claude Code](https://code.claude.com/docs/en/agent-sdk/overview) itself **ships inside Iris** — there is no CLI to install.

**You never pick a mode or a role.** Iris reaches Claude through seven named tools — shape, canvas, build, finish, look, review, notes — and chooses one per request from what you said and what your project looks like. Each has its own model, its own bounded set of skills, and its own ceilings. Two of them are **stateful** (a resident session that can pause mid-turn to ask you something by voice); the other five are **stateless** (one `query()` per run that never asks). The pipeline uses [mattpocock/skills](https://github.com/mattpocock/skills), especially **Grill Me** when shaping a request, and [Fission-AI/openspec](https://github.com/Fission-AI/openspec) for **SDD (spec-driven development)**: shaping grills the request into a proper spec, and building implements it via **`opsx:apply`**. See "Claude pipeline" below for how it's detected and enabled.

**Iris supports macOS only.** It refuses to launch on other platforms; see
"App Environment" below for the `IRIS_ALLOW_ANY_PLATFORM` developer escape
hatch.

## Quickstart (chat only)

```bash
npm ci
cp .env.example .env
# edit .env and set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey)
npm start
```

That's it — Iris wakes up and talks to you. The Claude pipeline is a separate,
optional layer described under "Claude pipeline" below; skip it
entirely if you only want a voice companion.

## What This App Does

- Captures your microphone through Electron/Chromium with WebRTC audio cleanup.
- Streams cleaned audio to Gemini Live as 16 kHz PCM.
- Plays Gemini Live audio responses through the app using browser `AudioContext`.
- Lets Gemini use built-in Google Search for quick current facts.
- With a Claude credential configured, lets Gemini hand serious work to Claude, running headless through the bundled Agent SDK — optional, off by default.
- Shows conversation in the Comms panel and Claude jobs in the Claude Tasks panel.
- Proactively announces Claude results when a background task finishes.
- Supports interruption/barge-in: when you speak over Gemini, playback is flushed.
- Uses a dark-only "Orbital Deck" UI with an animated voice orb, keyboard shortcuts, Comms, Camera/Gesture, and Work Stream columns.
- Adds **camera hand-gesture control** (MediaPipe) after wake so you can drive the UI in the air: point to move a cursor, dwell to open a task, open-palm to scroll, and make a fist to dismiss.
- Uses a simple polished reader open/close animation for expanded Claude results.

## Architecture

Electron main owns the Gemini Live session and bridges Gemini's tool calls to
headless Claude Code runs; the React renderer handles audio capture/playback
and the UI. **Full architecture diagram, the request/response flow,
component responsibilities, and the exact Gemini tool surface: see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).**

Iris also supports camera-driven hand-gesture control (MediaPipe, fully
on-device, starts only after wake) — see
[docs/GESTURES.md](docs/GESTURES.md) for how it's configured and the
gesture → action mapping.

Working on the bridge itself? **[docs/PIPELINE_INTERNALS.md](docs/PIPELINE_INTERNALS.md)**
is the implementation-level reference for pipeline availability gating, the
delegation flow, the verb registry, the voice question relay, session/context
ownership, and subscription auth. Test harness and the two verification gates:
**[docs/TESTING.md](docs/TESTING.md)**.

## Claude pipeline — optional, advanced

This entire section is optional. Skip it if you only want to talk to Iris. It
covers the second layer: delegating real work to [Claude Code](https://code.claude.com/docs/en/headless)
by voice.

**Full setup steps and a voice-first walkthrough of using it live in the
[Pipeline Guide](docs/PIPELINE_GUIDE.md) ([Tiếng Việt](docs/PIPELINE_GUIDE.vi.md))** —
this section just summarizes how it turns on.

Iris probes for the `claude` binary at startup and before every Gemini
(re)connection — **the binary's presence is the only switch**. No config flag,
no toggle: install the Claude CLI and Iris detects it automatically. When
detected, the pipeline's Gemini tools are declared and the Work Stream /
PipelineBar / session-switcher UI appears. When not detected, Iris stays in
chat-only mode.

Claude Code and the `openspec` CLI both ship **inside** Iris, so there is
nothing to install. All the pipeline needs is a credential, set from
Settings → **"Claude pipeline"**:

- **Subscription token** (`CLAUDE_CODE_OAUTH_TOKEN`) — bills against your Claude
  plan. Iris shows the exact command to mint one, pointed at its own bundled
  binary, so you can run it in Terminal without installing the CLI.
- **Anthropic API key** (`ANTHROPIC_API_KEY`) — metered alternative from
  console.anthropic.com, for users without a Claude plan.

Either one enables the pipeline; the subscription token wins if both are set.
Nothing else has to be installed: the skills and `/opsx` commands the personas
invoke ship inside the app and are loaded per run, and Iris keeps its own Claude
state in `~/.iris/claude-home`, so it never reads or writes your own `~/.claude`.
That isolation also means Iris can't use your terminal Claude Code login — the
credential above is what it authenticates with. See the guide for the full
walkthrough and troubleshooting.

## Modes

Iris runs as **two co-equal modes**:

- **Talk mode** — the conversation you're having right now: interface/HUD control, wake/sleep, note-taking to your second brain (below), and Google Search when you've turned it on. Always available with just a Gemini key.
- **Build mode** — settling what to build, then building it, once a Claude credential is configured (see "Claude pipeline" above). Ask Iris "what can you do" or "how do I build software with you" any time and it explains how this works by voice — it never volunteers the explanation unprompted.

**This is explanatory, not operational.** You do not have to hold this model to get work done: ask to start a new project or feature while chatting and Iris says it will settle the requirements first, then does so. Quick tasks (lookups, checks, small automations, notes) stay decisive and are handled directly. Requests that write to your project stop for your approval first — see the [Pipeline Guide](docs/PIPELINE_GUIDE.md).

**Second brain (notes).** With the pipeline enabled, Iris can also capture and retrieve personal notes by voice into a plain-markdown Obsidian vault at `~/iris-second-brain`, independent of whatever project you're working in. After a research exchange or a worked-out decision, Iris may offer once to save it — it never saves without you agreeing, and you can always ask directly to save or recall a note.

**Google Search** is optional and off by default — it's a billed Gemini feature that disconnects a free-tier key with a quota error the moment it's enabled. Turn it on from Settings → Gemini API key, once you have a paid key.

## App Environment

Iris reads environment values from:

1. `.env` in this repo (development and `npm start`).
2. `~/.iris/.env` (packaged app).
3. `.env` bundled next to app resources (optional packaging flow).

Copy the example file:

```bash
cp .env.example .env
```

Minimum required (chat only — this alone is enough to talk to Iris):

```bash
GEMINI_API_KEY=your_google_ai_studio_key
```

Recommended example (adds the optional Claude pipeline settings):

```bash
GEMINI_API_KEY=your_google_ai_studio_key
IRIS_USER_NAME=there
GEMINI_LIVE_MODEL=models/gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Zephyr
# CLAUDE_CODE_OAUTH_TOKEN=your_setup_token_value
# IRIS_CLAUDE_CWD=/Users/you/.iris/workspace
# IRIS_CLAUDE_PERMISSION_MODE=bypassPermissions
# IRIS_PO_QUESTION_TIMEOUT_MS=300000
# IRIS_ALLOW_ANY_PLATFORM=1
```

The `IRIS_CLAUDE_*` values are optional. A Claude credential — either
`CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` (metered) — is
what enables the pipeline; both roles use it. Set or clear either from
Settings → Claude pipeline instead of editing this file; that path also works in
a packaged build, where the file lives at `~/.iris/.env`. There is no setting for
the Claude or OpenSpec binary: both ship inside the app.

`IRIS_ALLOW_ANY_PLATFORM` is a developer escape hatch: Iris refuses to launch
on anything other than macOS by default, and setting this to `1` bypasses that
check for deliberate non-macOS runs (e.g. Linux).

## Reference

Pinned exact identifiers for every Google/third-party model, SDK, and asset
Iris depends on, plus the footguns to avoid when touching them (Live model
naming, MediaPipe/onnxruntime WASM version pinning, audio sample rates,
synchronous function calls): see **[docs/REFERENCE.md](docs/REFERENCE.md)**.

## Setup From Source

### Prerequisites

- Node.js **24 LTS or newer**. This is enforced, not advisory: `package.json`
  declares `engines.node: ">=24.0.0"` and `.npmrc` sets `engine-strict=true`, so
  `npm ci` fails outright with `EBADENGINE` on anything older. Run `nvm use` —
  `.nvmrc` pins the line. For a deliberate one-off, `npm ci --engine-strict=false`
  bypasses the check.
- npm.
- **`gitleaks`** (`brew install gitleaks` — 8.30.1 at time of writing), for the
  secret-scanning gate. Unlike every other tool in the check chain, this one is
  **not pinned by `package-lock.json`** — it is installed outside npm, so its
  version can move without the lockfile recording it. The gate fails closed when
  it is missing rather than skipping silently; `IRIS_SKIP_HOOKS=1` is the
  deliberate one-off bypass. Do not try to "properly pin" it by installing the
  `gitleaks` package from npm — that is an unrelated abandoned package, not this
  tool. See [docs/REFERENCE.md](docs/REFERENCE.md).
- A Gemini API key for the Live model (`GEMINI_API_KEY`).
- macOS with microphone permission available. Iris refuses to launch on other platforms; set `IRIS_ALLOW_ANY_PLATFORM=1` to bypass this as a developer escape hatch.
- *Optional, for the Claude pipeline:* a Claude credential — see "Claude pipeline" above. Claude Code itself ships inside the app.

### 1. Install dependencies

```bash
npm ci
```

Use `npm ci` for a clean, reproducible install from `package-lock.json`. See "Quickstart (chat only)" above for the shortest path to a running app.

### 2. Configure Gemini and Iris

Create `.env` from `.env.example` and set at least `GEMINI_API_KEY`.

### 3. (Optional) Add a Claude credential for the pipeline

Skip this if you only want chat. Claude Code ships inside Iris, so you do **not**
need to install anything — open Settings → **"Claude pipeline"** and add either a
subscription token or an Anthropic API key. The pipeline turns on as soon as one
is saved; no restart, no separate enable step.

### 4. Run in development mode

```bash
npm run dev
```

This starts Vite and Electron with hot reload. In dev mode the macOS Dock may
show the generic Electron app name, but the packaged app is named Iris.

### 5. Run a production build without packaging

```bash
npm start
```

This builds `dist/` and launches Electron from the built files.

If you already built once:

```bash
npm run start:prod
```

### 6. Build/check only

```bash
npm run build
```

## Packaging

### macOS

```bash
npm run package:mac
open release/mac-arm64/Iris.app
```

The app is unsigned by default. If macOS blocks it, right-click the app and choose
**Open** once.

## Controls

- **W**: Wake
- **S**: Sleep
- Top-right signal icon: live connection indicator
- Top-right hand icon: manually enables/disables camera gesture tracking

Camera/gesture behavior:

- App boot: camera is off.
- Wake (`W`): Gemini Live starts, mic capture starts, then camera/gesture control starts automatically.
- Sleep (`S`): Gemini, mic, and camera/gesture control stop.

### Hand gestures (when camera control is enabled)

- **Point (index up)**: move the cursor; hold over a task card briefly to open it
- **Open palm**: hold-to-scroll inside Comms, Work Stream, and the open reader (high = up, low = down)
- **Closed fist**: close the reader

> The first launch will prompt for camera permission. Frames are processed
> on-device by MediaPipe and never uploaded.

## Glass HUD Mode

Iris can float over your whole desktop as a transparent, click-through
overlay — the orb, tasks column, comms, and camera dock stay visible while
you keep working in the app underneath. Everything on the glass is
pointer-transparent except the "islands" (task cards, toggles, the orb
controls) — the window only accepts clicks where you're actually hovering an
island.

**Three ways to toggle it**, all equivalent:

- The picture-in-picture icon in the deck's top bar.
- The global hotkey, `⌥Space` by default (`IRIS_HUD_HOTKEY` to change it) —
  works even when a different app has focus.
- The tray (menu-bar) icon, which also offers Wake/Sleep without switching to
  the deck first.

**Speaker mute** — silencing Iris's voice on the spot without ending the
session — has the same three-surface pattern: a button beside the mic-mute
control (deck and HUD), a tray item, and a global hotkey, `⌥M` by default
(`IRIS_MUTE_HOTKEY` to change it). It's independent of the mic and resets to
unmuted on every wake. If you've changed `IRIS_HUD_HOTKEY` to something that
collides with `⌥M` (or vice versa), pick different combos for each — a
conflicting `globalShortcut` registration fails silently in the OS and Iris
just logs it and keeps going, so the control remains reachable via the UI/tray
even if the hotkey itself doesn't fire.

The app always boots into deck mode (booting straight into a click-through
overlay with no visible affordance would be a lockout risk). Management
surfaces — pipeline role, model choice, sessions, project folder, setup — are
deck-only; the HUD's exit control (⌥Space, the HUD button, or the tray) takes
you back. A pending question stays answerable while the HUD is up: it
surfaces as a lit banner island, answerable by voice, click, or gesture
dwell-click exactly as in the deck.

**Known macOS quirks:** the HUD sits above other windows on the current
Space (`visibleOnAllWorkspaces` with `visibleOnFullScreen: true`); switching
Spaces while the HUD is up should keep it visible, but if you notice it get
left behind on a specific Space, toggle it off and back on to re-attach it to
the one you're on.

**Drawing panel** — a bounded excalidraw whiteboard, toggled from the pen icon
in the orb control cluster. Hidden by default; while open, its region (and,
while active, the whole HUD) accepts clicks so you can draw, use the color
picker, and reach excalidraw's own Open/Save/Export-image menu. The working
board auto-persists to `~/.iris/canvas.json` and survives toggles, HUD/deck
switches, and restarts. Works without Claude — it's a plain whiteboard today.

## Notes

- The app now uses Electron/Chromium microphone capture instead of Python `pyaudio` for the main Gemini Live path. This gives better echo cancellation on laptop speakers.
- Gemini Live model: `gemini-3.1-flash-live-preview`.
- Gemini 3.1 Live function calls are synchronous, so Claude tasks return a `run_id` immediately and finish in the background.
- The background worker is Claude Code running headless through the bundled Agent SDK.
- Hand tracking uses `@mediapipe/tasks-vision` (`GestureRecognizer`) entirely on-device and starts only after wake unless manually enabled.
- The HUD drawing panel embeds `@excalidraw/excalidraw` `0.18.1` (MIT, exact-pinned — its asset path and `appState` schema are version-coupled), lazy-loaded on first activation, with fonts vendored into `public/excalidraw-assets` for offline `file://` use.
- The canvas MCP (Claude reads/draws on the whiteboard) hosts `@modelcontextprotocol/sdk` `1.29.0` (exact-pinned) over Streamable HTTP; its tool schemas use `zod` `4.4.3` and its element z-ordering uses `fractional-indexing` `3.2.0` (both exact-pinned, direct dependencies rather than relying on the SDK's own transitive copies).
- The second-brain galaxy view (toggle a network icon in the HUD orb cluster) renders the `~/iris-second-brain` vault with `3d-force-graph` `1.80.0` (exact-pinned, vanilla Three.js, deduped against the app's own `three` via `overrides.three` + Vite's `resolve.dedupe`) and parses note frontmatter with `gray-matter` `4.0.3` (exact-pinned).

## Open-Source Notes

- `.env` is ignored. Do not commit real Gemini keys.
- The packaged app is unsigned unless you add your own Apple signing
  certificates.
- Licensed under the MIT License. See `LICENSE`.

## Support / Contact

If this project helps you and you want to support my work:

- Visit my website: [www.mrqhocungdungai.io.vn](https://www.mrqhocungdungai.io.vn)
- Buy me a coffee: [buymeacoffee.com/mrqhocungdungai](https://buymeacoffee.com/mrqhocungdungai)
- DM me on TikTok: [@mr.q.hoc.ung.dung.ai](https://www.tiktok.com/@mr.q.hoc.ung.dung.ai)
