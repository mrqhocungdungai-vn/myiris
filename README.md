# Iris

> **Experimental personal build.** This repository is the personal experimental version of Iris by **MRQ Học Ứng Dụng AI**. It is being used to actively test ideas, workflows, and product directions, and was published to GitHub in response to audience requests. The project still contains many bugs that MRQ has not had time to fix yet, so please treat it as an actively evolving experiment rather than a polished product. It is shared under the **MIT License** to help the community study it, modify it, and continue developing it further. This version has been tested by MRQ on a **Mac mini M4 with 16 GB RAM running macOS 26**. It is also a fork of the original [`ASHR12/iris`](https://github.com/ASHR12/iris) project — many thanks to **Ashutosh Shrivastava** for the original work.

A desktop voice companion built on **Gemini Live** for natural realtime conversation, with an optional **Claude Code** build pipeline for real work.

**Out of the box, Iris just talks to you** — add a Gemini API key and start speaking; no other setup required. If you also have the [Claude Code](https://code.claude.com/docs/en/headless) CLI installed, Iris automatically unlocks a second layer: a **PO → DEV** build pipeline that lets you delegate real work (coding, research, files, terminal, automation) by voice. The two roles run on deliberately different mechanisms: **PO** is a **stateful** module — a persistent Agent SDK session that stays open across turns and can pause mid-turn to ask you something — while **DEV** is a **stateless** module — a one-shot headless `claude -p` run per issue. The pipeline uses [mattpocock/skills](https://github.com/mattpocock/skills), especially **Grill Me** on the PO side, and [Fission-AI/openspec](https://github.com/Fission-AI/openspec) for **SDD (spec-driven development)**. PO grills and shapes the request into a proper spec first; once the spec is complete, DEV implements it using **`opsx:apply`**. See "Claude pipeline (PO → DEV)" below for how it's detected and enabled.

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
optional layer described under "Claude pipeline (PO → DEV)" below; skip it
entirely if you only want a voice companion.

## What This App Does

- Captures your microphone through Electron/Chromium with WebRTC audio cleanup.
- Streams cleaned audio to Gemini Live as 16 kHz PCM.
- Plays Gemini Live audio responses through the app using browser `AudioContext`.
- Lets Gemini use built-in Google Search for quick current facts.
- When the Claude Code CLI is installed, lets Gemini hand serious work to Claude, which spawns a headless Claude Code run (`claude -p`) — optional, auto-detected, off by default.
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

## Claude pipeline (PO → DEV) — optional, advanced

This entire section is optional. Skip it if you only want to talk to Iris. It
covers the second layer: delegating real work to [Claude Code](https://code.claude.com/docs/en/headless)
through a Product Owner → Developer pipeline.

**Full setup steps and a voice-first walkthrough of using it live in the
[Pipeline Guide](docs/PIPELINE_GUIDE.md) ([Tiếng Việt](docs/PIPELINE_GUIDE.vi.md))** —
this section just summarizes how it turns on.

Iris probes for the `claude` binary at startup and before every Gemini
(re)connection — **the binary's presence is the only switch**. No config flag,
no toggle: install the Claude CLI and Iris detects it automatically. When
detected, the pipeline's Gemini tools are declared, the Work Stream / PipelineBar
/ session-switcher UI appears, and PO/DEV become selectable. When not detected,
Iris stays in chat-only mode.

```bash
claude --version
```

If that works, **DEV works immediately**. **PO** additionally needs a
subscription token (`claude setup-token`, then paste it into Settings →
Claude pipeline → Subscription token, or set `CLAUDE_CODE_OAUTH_TOKEN` in
`.env` yourself), since it's a stateful Agent SDK session that doesn't inherit
your interactive `claude` login. Beyond that, the pipeline needs the `openspec`
CLI and a set of global Claude Code skills + the `iris-po`/`iris-dev` agent
personas — Settings → **"Claude pipeline"** checks all of these and offers a
one-click **"Install missing"** action that provisions whatever's absent
(never overwriting anything you've already installed yourself). See the
guide for the full walkthrough, troubleshooting, and using the agents
directly from Claude Code.

## Roles & modes

Iris presents exactly **three roles**, split across **two co-equal modes**:

- **Talk mode** — the conversation you're having right now: interface/HUD control, wake/sleep, note-taking to your second brain (below), and Google Search when you've turned it on. This is **Iris**, always available with just a Gemini key.
- **Build mode** — the PO → DEV pipeline, once the Claude Code CLI is detected (see "Claude pipeline (PO → DEV)" above). **PO** grills your request and proposes an OpenSpec change (decides WHAT gets built); **DEV** implements it headlessly (decides HOW). Ask Iris "what can you do" or "how do I build software with you" any time and it explains this model by voice — it never volunteers the explanation unprompted.

Ask to start a new project or feature while chatting, and Iris tells you it's Build-mode work and forwards it to PO automatically — no need to switch roles yourself first. Quick tasks (lookups, checks, small automations, notes) stay decisive and are handled directly.

**Second brain (notes).** When the Claude CLI is installed, Iris can also capture and retrieve personal notes by voice into a plain-markdown Obsidian vault at `~/iris-second-brain`, independent of whatever project you're working in. After a research exchange or a worked-out decision, Iris may offer once to save it — it never saves without you agreeing, and you can always ask directly to save or recall a note.

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
# IRIS_CLAUDE_BIN=/Users/you/.local/bin/claude
# IRIS_PO_QUESTION_TIMEOUT_MS=300000
# IRIS_PO_LIVE_SESSION=1
# IRIS_ALLOW_ANY_PLATFORM=1
```

The `IRIS_CLAUDE_*` values are optional. Set `IRIS_CLAUDE_BIN` only if the
packaged GUI app cannot find the `claude` binary on PATH. `CLAUDE_CODE_OAUTH_TOKEN`
is required for the **PO** module specifically (generate it with `claude setup-token`) —
DEV keeps working without it via your interactive `claude` login. You can set or
clear it from Settings → Claude pipeline instead of editing this file; that path
also works in a packaged build, where the file lives at `~/.iris/.env`.

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

- Node.js 20+ (LTS recommended).
- npm.
- A Gemini API key for the Live model (`GEMINI_API_KEY`).
- macOS with microphone permission available. Iris refuses to launch on other platforms; set `IRIS_ALLOW_ANY_PLATFORM=1` to bypass this as a developer escape hatch.
- *Optional, for the Claude pipeline:* Claude Code installed and authenticated (`claude --version` works) — see "Claude pipeline (PO → DEV)" above.

### 1. Install dependencies

```bash
npm ci
```

Use `npm ci` for a clean, reproducible install from `package-lock.json`. See "Quickstart (chat only)" above for the shortest path to a running app.

### 2. Configure Gemini and Iris

Create `.env` from `.env.example` and set at least `GEMINI_API_KEY`.

### 3. (Optional) Verify Claude Code for the pipeline

Skip this if you only want chat. To use the PO/DEV pipeline, make sure the Claude Code CLI is installed and logged in:

```bash
claude --version
claude -p "Reply with exactly: PONG" --output-format json
```

The second command should print a JSON object with `"result":"PONG"` and a `session_id`. Iris detects the CLI automatically on next launch/reconnect — no separate enable step.

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

The app always boots into deck mode (booting straight into a click-through
overlay with no visible affordance would be a lockout risk). Management
surfaces — pipeline role, model choice, sessions, project folder, setup — are
deck-only; the HUD's exit control (⌥Space, the HUD button, or the tray) takes
you back. A pending PO question stays answerable while the HUD is up: it
surfaces as a lit banner island, answerable by voice, click, or gesture
dwell-click exactly as in the deck.

**Known macOS quirks:** the HUD sits above other windows on the current
Space (`visibleOnAllWorkspaces` with `visibleOnFullScreen: true`); switching
Spaces while the HUD is up should keep it visible, but if you notice it get
left behind on a specific Space, toggle it off and back on to re-attach it to
the one you're on.

## Notes

- The app now uses Electron/Chromium microphone capture instead of Python `pyaudio` for the main Gemini Live path. This gives better echo cancellation on laptop speakers.
- Gemini Live model: `gemini-3.1-flash-live-preview`.
- Gemini 3.1 Live function calls are synchronous, so Claude tasks return a `run_id` immediately and finish in the background.
- The background worker is Claude Code running headless (`claude -p`).
- Hand tracking uses `@mediapipe/tasks-vision` (`GestureRecognizer`) entirely on-device and starts only after wake unless manually enabled.

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
