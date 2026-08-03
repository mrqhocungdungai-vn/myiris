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

2. **Global skills** — still in **Settings → Claude pipeline**, click
   **"Install missing"**. This copies the required skills (`grilling`, `tdd`,
   `code-review`, `diagnosing-bugs`, plus the three core OpenSpec skills) into
   `~/.claude/skills/` and the `/opsx` commands into `~/.claude/commands/opsx/`.
   These have to live on disk because Claude Code loads skills by name.

   It only fills in what's missing — anything you've already installed yourself
   (via `skills.sh`, `openspec init`, or manually) is left untouched.

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

Once installed (step 4 above), the personas work like any other Claude Code agent — useful if you want to drive them from a terminal instead of by voice:

```bash
claude --agent iris-po -p "Grill this feature request and propose the next OpenSpec change"
claude --agent iris-dev -p "Implement the remaining unchecked tasks for the current OpenSpec change"
```

Or interactively inside a Claude Code session in a project that has `openspec/`: `/opsx:propose`, `/opsx:apply`, `/opsx:archive` work directly as slash commands once the OpenSpec skills are installed.

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Settings says the pipeline is off, chat-only | No Claude credential configured | Add a subscription token or an API key in Settings → Claude pipeline. This is the normal state for a fresh install |
| Settings says the bundled Claude binary won't launch | Broken app bundle (a packaging fault, not something you can install around) | Reinstall Iris |
| Runs fail with a credential error | Token or key rejected/expired | Re-mint the token with the `setup-token` command the panel shows, or replace the API key |
| "openspec CLI" row stays red | Broken app bundle — OpenSpec ships with Iris | Reinstall Iris |
| "Global skills" row stays red | Skills not installed at user level yet | Click "Install missing", or run the copyable command shown next to the row |
| DEV run fails with "no open change with remaining tasks" | PO hasn't proposed anything yet | Switch to PO and ask it to grill and propose first — DEV never free-codes without a spec |
