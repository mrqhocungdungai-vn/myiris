# Iris Claude Pipeline Guide

[Tiếng Việt →](./PIPELINE_GUIDE.vi.md)

This guide covers the optional, second layer of Iris: the build pipeline that lets you delegate real work — coding, research, files, terminal, automation — by voice. If you only want to talk to Iris, you don't need any of this; see the main [README](../README.md) quickstart instead.

## 1. What the pipeline is

**You do not operate this pipeline. You talk, and Iris picks the right kind of work.** There is no role to choose, no mode to be in, and no vocabulary you have to learn — "build me X" starts the work.

Underneath, Iris reaches Claude Code through seven named tools, each with its own job, its own model, and its own bounded set of skills:

| What you say | What runs | What it does |
| --- | --- | --- |
| "I want to add dark mode" | **Shape** | Grills you to settle the requirements, then writes an [OpenSpec](https://github.com/Fission-AI/OpenSpec) change |
| "draw that out", "what's on my diagram?" | **Canvas** | The same conversation, on the drawing canvas — it can read and draw on it |
| "build it", "fix this bug", "rename that file" | **Build** | Does the work. With an open change it implements its tasks; without one it just does what you asked |
| "wrap that change up", "archive it" | **Finish** | Verifies the tasks are done and folds the change into the living spec |
| "what's left?", "how does X work?" | **Look** | Reads the project and answers. It cannot change anything |
| "review what it just did" | **Review** | Judges the work and reports findings |
| "save what we learned" | **Notes** | Weaves what has happened into your second brain |

Work that goes through the full process still flows the same way — shaping produces a change on disk, and building implements it — but **the ordering follows from the project's own state, not from you enforcing it**:

```
You (voice) ──▶ Shape (grills you, proposes an OpenSpec change)
                     │
                     ▼  openspec/changes/<name>/  (proposal, design, specs, tasks)
                     │
                     ▼
                Build (implements the remaining tasks, verifies)
                     │
                     ▼
                Finish (archives it) ──▶ openspec/specs/  (the living spec, updated)
```

- **Shape and Canvas are live** — they can pause mid-turn to ask you something by voice, and they share one conversation, so moving to the canvas continues what you were already discussing.
- **The other five are headless** — they never ask; they do the work, verify themselves, and report back.
- You never type the underlying `/opsx:propose`, `/opsx:apply`, or `/opsx:archive` commands. Iris invokes them.

### Which requests stop for your approval

Two of these write to your project — **Build** and **Finish** — so by default each one is **parked for your review** before anything starts: you see the full brief on screen and approve, edit, or cancel it, and nothing has been sent to Claude until you do. Opening a new shaping conversation is parked once, at the start; steering that conversation afterwards is not, because you already agreed to it. Look, Review, and Notes change nothing, so they run straight away.

The control is on the pipeline bar and cycles through three settings: **Risky** (the default, above), **All**, and **Off**. It is deliberately not something Iris can change for you.

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

Once every row in Settings is green, wake Iris and just say what you want.

## 3. The voice walkthrough

**Starting a new feature.**
Say what you want, e.g. *"I want to add dark mode to the settings screen."* Iris recognizes this as something to settle first, tells you so, and starts a shaping conversation — you don't ask for one. It pauses and asks you real questions by voice; answer naturally, and Iris reads each one aloud and relays your answer back. Keep going until it has enough.

**Saying you're done.**
Say *"That's enough, go ahead and propose it"* (or similar). It writes the OpenSpec change — proposal, design, specs, and a task list — under `openspec/changes/<name>/`.

**Building it.**
Say *"implement the remaining tasks"* or just *"go build it."* Iris parks the brief for your approval first; approve it (optionally after editing on screen) and the run starts. It works headlessly: implements test-first, runs the test suite and build, verifies every acceptance scenario for real, and reports back. When you're satisfied, say *"wrap it up"* to archive the change and sync the result into `openspec/specs/`.

**Small things stay small.**
*"Rename that file"*, *"write me a script that renames these"*, *"look up when the invoice is due"* — these do **not** go through shaping, and they no longer fail for lack of a spec. Iris just does them.

**Checking progress.**
Ask *"are there tasks left?"* at any point, or check the Work Stream panel — it shows live tool calls and how far the current change has got.

**Decisions along the way.**
A headless run never blocks — if it hits a real product decision, it applies its recommended default and reports it under "Decisions needed" at the end; Iris reads these aloud and you can answer by voice. A shaping conversation, being live, may instead pause mid-task and ask you directly.

**Switching models.**
Ask, e.g. *"put the builder on the stronger model to debug this."* Note that the two shaping tools share one conversation, so changing either one's model changes both — Iris will say so.

## 4. Appendix: using the agents directly in Claude Code

The personas and skills live inside Iris and are handed to each run in memory, so
they are **not** registered with a Claude Code you have installed yourself — that
is deliberate, so Iris never alters your setup. Driving them from a terminal is
therefore a copy job, not a command you can just run:

```bash
# Personas: copy into the project you want to use them in (note the iris- prefix
# the project-local location expects)
cp /Applications/Iris.app/Contents/Resources/personas/stateful.md .claude/agents/iris-stateful.md
cp /Applications/Iris.app/Contents/Resources/personas/stateless.md .claude/agents/iris-stateless.md

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
| Iris keeps starting a shaping conversation for something small | It read the request as a new feature | Say plainly that you just want it done, e.g. "no need to spec this, just do it" |
| A build ran without a spec you expected it to follow | With no open change, Build simply does the work rather than refusing | Shape it first if the work needs a spec; the approval prompt before each build is where to catch this |
