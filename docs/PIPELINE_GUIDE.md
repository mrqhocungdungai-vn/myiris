# Iris Claude Pipeline Guide

[Tiếng Việt →](./PIPELINE_GUIDE.vi.md)

This guide covers the optional, second layer of Iris: the **PO → DEV** build pipeline that lets you delegate real work — coding, research, files, terminal, automation — by voice. If you only want to talk to Iris, you don't need any of this; see the main [README](../README.md) quickstart instead.

## 1. What the pipeline is

Iris drives Claude Code through two roles that hand work to each other through an [OpenSpec](https://github.com/Fission-AI/OpenSpec) change on disk — never a shared conversation:

```
You (voice) ──▶ PO (grills the request, proposes an OpenSpec change)
                     │
                     ▼  openspec/changes/<name>/  (proposal, design, specs, tasks)
                     │
                     ▼
                DEV (implements the remaining tasks, verifies, archives)
                     │
                     ▼  openspec/specs/  (the living spec, updated)
```

- **PO** is a live, stateful session — it can pause mid-turn to ask you something by voice.
- **DEV** is headless and stateless — it never asks; it implements, tests, verifies itself, and reports back.
- Under the hood, PO runs the `grilling` skill then the OpenSpec **propose** flow (`/opsx:propose`); DEV runs the OpenSpec **apply** flow (`/opsx:apply`) then **archive** (`/opsx:archive`). You never type these commands yourself — Iris's voice layer tells the agents to run them.

## 2. Setup

**Claude Code and the `openspec` CLI ship inside Iris.** You do not install either
one, and the agent personas are built in too. The pipeline turns on as soon as a
Claude credential is configured — there's no separate flag to flip.

1. **A Claude credential** — open Iris → **Settings → Claude pipeline** and fill in
   *one* of:

   - **Subscription token** (`CLAUDE_CODE_OAUTH_TOKEN`) — bills against your Claude
     plan. To mint one, run the command the panel shows you in Terminal; it points
     at Iris's *own* bundled binary, so you still install nothing:
     ```bash
     "/Applications/Iris.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" setup-token
     ```
     (The panel prints the exact path for your build — architecture and install
     location differ.) Paste the result into the Subscription token field. It
     applies immediately, no restart.
   - **Anthropic API key** (`ANTHROPIC_API_KEY`) — the metered alternative from
     console.anthropic.com, for users without a Claude plan.

   Either one enables the pipeline. If both are set, the subscription token wins.

That is the whole setup. There is no second step: the skills the agents use
(`grilling`, `tdd`, `code-review`, `diagnosing-bugs`, the OpenSpec workflow
skills) and the `/opsx` commands ship **inside the app** and are loaded per run,
so nothing is copied onto your machine and nothing can be left half-installed.
Settings shows them as a single **Bundled** row.

Iris also keeps its own Claude state in `~/.iris/claude-home` rather than
`~/.claude`, so its runs never mix into your own Claude Code history, settings,
or memory. The flip side is that Iris cannot use your terminal Claude Code
login — it needs its own credential, which is what you set above.

Once every row in Settings is green, wake Iris and switch to the PO role from the pipeline bar (or ask by voice).

## 3. The voice walkthrough

**Starting a new feature — PO grills you.**
Say what you want, e.g. *"I want to add dark mode to the settings screen."* Iris forwards this to PO with a short instruction to start grilling. PO pauses and asks you real questions by voice — answer naturally; Iris reads each one aloud and relays your answer back. Keep going until PO has enough.

**Telling PO you're done.**
Say *"That's enough, go ahead and propose it"* (or similar). PO writes the OpenSpec change — proposal, design, specs, and a task list — under `openspec/changes/<name>/`. This is the `/opsx:propose` flow running underneath; you never see or type that command.

**Handing off to DEV.**
Switch the active role to DEV (pipeline bar, or say *"switch to DEV"*), then say *"implement the remaining tasks."* DEV works headlessly: it implements test-first, runs the test suite and build, verifies every acceptance scenario for real, and — once every task is checked and verification passes — archives the change, syncing the result into `openspec/specs/` (the project's living spec). This is `/opsx:apply` then `/opsx:archive` running underneath.

**Checking progress.**
Ask *"are there tasks left?"* while PO is active, or check the Work Stream panel — it shows DEV's live tool calls and the gate checkmarks (PO proposed ✓ / DEV implemented ✓) per feature.

**Decisions along the way.**
DEV never blocks — if it hits a real product decision, it applies its recommended default and reports it under "Decisions needed" at the end; Iris reads these aloud and you can send a follow-up with your choice. PO, being live, may instead pause mid-task and ask you directly.

## 4. Appendix: using the agents directly in Claude Code

The personas and skills live inside Iris and are handed to each run in memory, so
they are **not** registered with a Claude Code you have installed yourself — that
is deliberate, so Iris never alters your setup. Driving them from a terminal is
therefore a copy job, not a command you can just run:

```bash
# Personas: copy into the project you want to use them in
cp /Applications/Iris.app/Contents/Resources/personas/iris-*.md .claude/agents/

# Skills and /opsx commands: point Claude Code at Iris's plugin directory
claude --plugin-dir /Applications/Iris.app/Contents/Resources/iris-plugin
```

Inside the app the same skills are namespaced `iris:grilling`, `iris:tdd`, … and
the commands are `/iris:opsx:propose`, `/iris:opsx:apply`, `/iris:opsx:archive`.

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Settings says the pipeline is off, chat-only | No Claude credential configured | Add a subscription token or an API key in Settings → Claude pipeline. This is the normal state for a fresh install |
| Settings says the bundled Claude binary won't launch | Broken app bundle (a packaging fault, not something you can install around) | Reinstall Iris |
| Runs fail with a credential error | Token or key rejected/expired | Re-mint the token with the `setup-token` command the panel shows, or replace the API key |
| "openspec CLI" row stays red | Broken app bundle — OpenSpec ships with Iris | Reinstall Iris |
| Skills row says "Damaged" | Broken app bundle — the skills ship with Iris | Reinstall Iris |
| Runs work in your terminal Claude Code but not in Iris | Iris uses its own state dir and cannot see your terminal login | Add a credential in Settings → Claude pipeline |
| DEV run fails with "no open change with remaining tasks" | PO hasn't proposed anything yet | Switch to PO and ask it to grill and propose first — DEV never free-codes without a spec |
