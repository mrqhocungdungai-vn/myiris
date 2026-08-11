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
| "work on this note with me", "tidy this up" | **Note** | Works on the note you have open, in conversation, and asks before it changes your words |
| "build it", "fix this bug", "rename that file" | **Build** | Does the work. With an open change it implements its tasks; without one it just does what you asked |
| "wrap that change up", "archive it" | **Finish** | Verifies the tasks are done and folds the change into the living spec |
| "what's left?", "how does X work?", "review what it just did" | **Look** | Reads the project and answers — explaining, or judging work that already exists when you ask for a verdict. It cannot change anything |
| "save what we learned" | **Notes** | Weaves what has happened into your second brain |

**What is actually behind one of these names.** Not a function and not a preset
prompt: a **full Claude Code agent**, running in the app on the bundled Claude
Code, with its own model, its own skills, its own bounds on what it may touch,
and its own spend ceiling. Iris chooses which one runs, from what you said and
what your project looks like — there is nothing for you to set. The one place
*you* stand in the path is the approval below, which happens before any token is
spent. "Talk mode" and "Build mode" are just how Iris *describes* the two halves
when you ask what she can do; they are not settings, and there is no switch.

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

- **Shape, Canvas and Note are live** — each can pause mid-turn to ask you something by voice. Shape and Canvas share one conversation, so moving to the canvas continues what you were already discussing; Note keeps its own conversation per note, so coming back to a note picks that note up rather than the last one.
- **The other four are headless** — they do the work, verify themselves, and report back, normally listing any decisions at the end rather than stopping to ask. The one exception is **Build with no open change**: nothing was settled up front, so it may ask you once instead of guessing.
- You never type the underlying `/opsx:propose`, `/opsx:apply`, or `/opsx:archive` commands. Iris invokes them.

### Which requests stop for your approval

Two of these write to your project — **Build** and **Finish** — so by default each one is **parked for your review** before anything starts: you see the full brief on screen and approve, edit, or cancel it, and nothing has been sent to Claude until you do. Opening a live conversation (Shape, Canvas, or Note) is parked once, at the start; steering that conversation afterwards is not, because you already agreed to it. Look changes nothing at all and Notes writes only into your second brain, never your project, so both run straight away.

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
     "/Applications/MyIris.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" setup-token
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

Iris also keeps its own Claude state in `~/.myiris/claude-home` rather than
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

## 3b. Listen-only mode

The headphone control — also a tray item, and the `IRIS_LISTEN_HOTKEY` global
shortcut — silences Iris so she can take something in. Two things happen at
once:

- **Iris goes completely silent.** Nothing she produces reaches you, as sound or
  as text, until you turn the mode off. Turning it off buys you at most one short
  line — and only if she found an answer you had already prepared (see 3c below).
  Otherwise she volunteers nothing and waits until you next speak to her.
- **She hears your machine as well as the room.** The audio your Mac is playing
  is captured and mixed into the same stream, so a remote participant on a call
  reaches her rather than only your own side of it.

What it's for: you are presenting, or on a call, and someone asks you a
question. Engage the mode, let them ask it, disengage — then ask Iris what they
wanted. She answers from the conversation itself, from the audio she actually
received, so nothing has to be written down and nothing is.

**The mode ends on its own.** Engaging opens a listening window of five minutes
by default (`IRIS_LISTEN_MAX_MINUTES` in `.env`, clamped to 15), and at that
deadline the mode turns itself off exactly as if you had toggled it. The
deadline is fixed at the moment you engage: talking through it does not extend
it. The time remaining is shown on screen for as long as the window is open,
because Iris is silent and cannot warn you by voice. Toggling it off yourself
before then cancels the deadline; nothing fires later.

That length is also why nothing needs saving — five minutes of audio sits well
inside what the voice session holds, so the whole engagement is still there when
you ask about it. The first time you engage the mode, Iris says what she hears
widens to whatever your machine plays, which may include other people.

Muting the microphone is independent: with the mic muted and the mode engaged,
Iris still hears your machine.

**What to expect:**

- **macOS 14.2 or later** is required for system-audio capture. macOS prompts
  once for its own system-audio consent; the grant sticks, and Iris does **not**
  need Screen Recording permission and does **not** need to be relaunched.
- **macOS shows its screen-recording indicator for the whole engagement**, even
  though Iris captures no video at all — no screen, no window, audio only. This
  is how the underlying capture works and cannot be turned off.
- **Wear headphones if you can.** On speakers, every remote voice reaches Iris
  twice — once captured, once back through the microphone. She will still work;
  the transcript is just cleaner. Iris advises this when it applies, and never
  blocks on it.
- **If the capture goes silent or dies**, Iris drops to the microphone only,
  shows a persistent warning on the headphone control, and **stays silent**. She
  never starts talking mid-engagement because something failed.

Set `IRIS_SYSTEM_AUDIO=0` in `.env` to turn the system-audio half off entirely:
the mode then only silences her, captures nothing, and triggers no recording
indicator. The listening window still bounds the engagement — the bound belongs
to the mode, not to the capture.

## 3c. Prepared answers — point the session's folder at your prep material

Before the talk, put the answers you expect to need in a folder — one markdown
file of questions and answers is enough — and **pick that folder as the session's
project folder** from the UI, the same way you would for a coding session. That
is the folder Iris looks in; there is no separate setting.

Then the flow is short. Someone asks you a question, you engage listen-only mode,
they finish, you disengage. Iris immediately reads that folder looking for an
answer, and:

- **If she finds one**, she says one short line — that she has an answer ready —
  and **stops**. She does not start reading. Say "go ahead" and she reads your
  wording **as you wrote it**, not a summary of it. Answer the question yourself
  instead and she stays quiet; nothing is left hanging.
- **If she finds nothing**, she says nothing at all. Ask her about it when you
  have the floor back and she will tell you nothing was prepared for it, and
  offer the two routes that do cost something — searching the folder properly
  with Claude, or retrieving from your notes. She offers; she does not start
  either until you pick one.

This costs nothing: no Claude run, no tokens, no credential, and it works in
chat-only mode. Only `.md` and `.txt` files count as prepared material, and
`node_modules`, `dist`, `build` and dotted directories are skipped — so if you
point the session at a code repository by mistake, you get an unhelpful "nothing
prepared", never a wall of source code read aloud. With **no** folder selected she
says so rather than searching the default workspace. If your folder is larger than
fits in one look, she uses the part most likely to be relevant **and says that she
narrowed** — so "nothing prepared for that" never quietly means "I only looked at
some of it".

## 4. Appendix: using the agents directly in Claude Code

The personas and skills live inside Iris and are handed to each run in memory, so
they are **not** registered with a Claude Code you have installed yourself — that
is deliberate, so Iris never alters your setup. Driving them from a terminal is
therefore a copy job, not a command you can just run:

```bash
# Personas: copy into the project you want to use them in (note the iris- prefix
# the project-local location expects)
cp /Applications/MyIris.app/Contents/Resources/personas/stateful.md .claude/agents/iris-stateful.md
cp /Applications/MyIris.app/Contents/Resources/personas/stateless.md .claude/agents/iris-stateless.md

# Skills and /opsx commands: point Claude Code at Iris's plugin directory
claude --plugin-dir /Applications/MyIris.app/Contents/Resources/iris-plugin
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
