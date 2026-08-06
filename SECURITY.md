# Security Policy

Iris runs a coding agent with `bypassPermissions` in your project directory, and
the channel that drives it is a microphone. That is a deliberate design, not an
oversight — but it means the boundaries are worth stating plainly, so a reporter
knows which side of the line a finding falls on before spending time on it.

This document links to the authoritative capability specs rather than restating
them. Where this file and a spec disagree, the spec is correct and this file is
a bug.

## Supported versions

`main` is the only supported line. There are no tags and no releases; fixes land
on `main` and there is no backport target.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

**https://github.com/mrqhocungdungai-vn/myiris/security/advisories/new**

GitHub Issues is disabled on this repository, so that link is the reporting
channel — please do not open a public discussion for a vulnerability.

What to expect:

- Iris is maintained by one person, in the open, as a side project. Reports are
  read on a best-effort basis; the aim is to acknowledge within **7 days**, and
  that is an intention rather than an SLA.
- There is **no bounty programme** and no payment of any kind.
- Please include what you did, what happened, and what you expected — a
  reproduction beats a description.

## Security boundaries

### Permission posture: the denylist is a guard, not a sandbox

`bypassPermissions` is the intentional default for the headless worker, because
no interactive approval prompt exists on that path. Runs execute tool calls
without asking.

The only thing standing in front of that is a `PreToolUse` denylist in
[`electron/run-hooks.mjs`](electron/run-hooks.mjs). It is three regular
expressions, applied **only to `Bash`**:

1. a recursive `rm -f`/`-rf` rooted at `/`, `~`, `$HOME`, or `/*` — relative
   paths are deliberately **not** matched, because a run cleaning up its own
   build output is ordinary work;
2. `git push … --force` / `-f`;
3. `git reset --hard … origin/…`.

Nothing constrains `Write`, `Edit`, `Read`, `WebFetch`, or any other tool. Every
non-`Bash` tool call passes straight through the hook.

**A determined or confused model can reach the same effect by other means — a
script, a renamed binary, a different tool.** Iris does not claim otherwise
anywhere in its interface or its documentation, and this document is covered by
that sentence. Treat the denylist as accident-catching, never as containment.

### The review gate parks some dispatches, not all of them

Whether a request is parked for your approval before any tokens are spent is a
**declared property of the verb** — the `park` field on the verb's record in
[`electron/verbs.mjs`](electron/verbs.mjs). It is never derived from the wording
of the request, and the decision is made in the main process at dispatch, never
by asking the voice layer to honour an instruction. (`label` is a separate field
— the short display name — and the gate does not read it.)

The shape matters, because "there is a review gate" on its own reads as
stronger than it is. Of the eight verbs, in the default `verb` mode:

| `park` | Verbs | Behaviour |
| --- | --- | --- |
| `always` (2) | `execute`, `finish` | every dispatch is parked |
| `on_open` (3) | `shape_requirements`, `shape_on_canvas`, `work_on_note` | only the call that **opens** the resident session is parked; every steering turn afterwards dispatches directly |
| `never` (3) | `investigate`, `review`, `capture_learning` | never parked |

The three that never park still run under `bypassPermissions` with `Bash`
available. `investigate` additionally withholds `Write`, `Edit`, and
`NotebookEdit`; `review` and `capture_learning` do **not** — they withhold only
`AskUserQuestion`. So a `never`-parked verb can write files.

### The gate is configurable, and can be switched off

`IRIS_PROMPT_REVIEW` selects the mode: `never` (park nothing), `always` (park
everything), or `verb` (the default — park what the registry declares). The
setting is also a UI control and persists to the user config. It must therefore
not be read as unconditional.

The guarantee that *is* strong: **the voice model has no tool that reaches this
flag.** No declaration for mutating review mode is offered in any availability
state, such a call is refused at execution time, and asking to turn review off
by voice is answered rather than executed. An unrecognised value falls back to
the default rather than disabling the gate — the failure mode of a typo is more
review, not less.

One thing the gate does *not* do: a parked review can be resolved by voice.
`respond_to_task_review` exists so the voice layer can relay your spoken
approve/cancel to the main process (the deck UI can resolve it too, whichever
settles first). The gate guarantees a **decision** is required before privileged
work dispatches; it does not guarantee that decision arrives over a channel
other than audio.

Authoritative: [`openspec/specs/prompt-review-gate/spec.md`](openspec/specs/prompt-review-gate/spec.md),
[`openspec/specs/verb-tool-surface/spec.md`](openspec/specs/verb-tool-surface/spec.md).

### Spoken audio is untrusted input, and it reaches an agent that executes tools

Anything audible to the microphone can influence what the voice model asks
Claude to do — a bystander, a video playing nearby, a speakerphone. There is no
speaker verification. Combined with the section above, that means audio can
reach a `bypassPermissions` run directly for the three verbs that never park,
and after one approval for the three that park on open.

### Credentials and process separation

The worker's environment is derived from the parent **by subtraction**, in
[`electron/worker-env.mjs`](electron/worker-env.mjs) — never passed through
unchanged:

- `GEMINI_API_KEY` is **always** withheld from the worker. It is the voice
  credential and no verb has any use for it.
- When `CLAUDE_CODE_OAUTH_TOKEN` is present, `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN` are removed, so a stray key cannot silently switch you
  onto metered billing.
- With no subscription token, `ANTHROPIC_API_KEY` is left in place — it is the
  only credential an API-key-only user has, and it means **metered billing**.

Note the scope of the permission override: `IRIS_CLAUDE_PERMISSION_MODE` applies
to **one-shot runs only**. The resident stateful session hardcodes
`bypassPermissions` and reads no override.

Authoritative: [`openspec/specs/agent-subscription-auth/spec.md`](openspec/specs/agent-subscription-auth/spec.md).

### Iris never reads or writes your `~/.claude`

This takes **two** mechanisms, not one:

1. `settingSources` excludes the `user` scope (`["project"]` on both run
   shapes), and
2. `CLAUDE_CONFIG_DIR` is pinned to `~/.iris/claude-home`.

The second is not redundant. Session transcripts, the always-read
`.claude.json`, and auto-memory are read and written **regardless of**
`settingSources` — before the pin existed, a single run left a 57 KB transcript
of the user's project inside their own `~/.claude/projects/`. Auto-memory is
additionally disabled (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), because it is
written back with ordinary `Write`/`Edit` calls, which under `bypassPermissions`
are unprompted.

See the non-goals below for what this is *not*.

### The renderer executes only code shipped inside the app

The production Content-Security-Policy, in full:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self';
worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

`'unsafe-inline'` appears **only** in the development policy, where Vite's React
refresh preamble and injected component styles require it; the production
`index.html` contains no inline scripts.

`connect-src 'self'` is the strong claim here and it is worth being explicit
about: the renderer opens **no** network connections at all. The Gemini Live SDK
runs in the Electron main process, not the renderer, so nothing in the renderer
talks to `generativelanguage.googleapis.com` or anywhere else.

Alongside the CSP, navigation is contained app-wide (any URL that is not the
app's own document is handed to the OS browser instead of loaded in a window
carrying the preload bridge), and microphone/camera permissions are granted only
to the app's own document.

**Honest limitation:** the policy is delivered as a `<meta http-equiv>` in the
document, not as a response header, because the packaged app loads over `file://`
and a header-based policy would protect dev and silently vanish in production.
`frame-ancestors` and `sandbox` are not enforceable through a `<meta>` policy and
are therefore not in effect.

Authoritative: [`openspec/specs/renderer-content-security/spec.md`](openspec/specs/renderer-content-security/spec.md).

### Secret scanning fails closed

`npm run scan:secrets` runs `gitleaks` over the staged changes and is one of the
five quality gates, bound to editing events. If `gitleaks` is not installed the
gate **fails** rather than passing silently (`brew install gitleaks`).
`IRIS_SKIP_HOOKS=1` is the announced one-off bypass. `.env` is gitignored and
must never contain a committed key.

Authoritative: [`openspec/specs/workflow-quality-gates/spec.md`](openspec/specs/workflow-quality-gates/spec.md).

## Non-goals — what Iris does not defend against

Reporting one of these is not a vulnerability. They are design points, stated
here so a reporter does not spend time on them.

- **An agent running with `bypassPermissions` in your own project.** That is the
  product. A run can read, write, delete, and execute in the working directory
  and anywhere else the user's own account can reach.
- **The `PreToolUse` denylist being bypassable.** It is a guard against
  accidents. Demonstrating a way around it (a script, a renamed binary, a
  different tool) demonstrates something already documented above.
- **`~/.claude` isolation being reachable anyway.** Excluding the `user` setting
  scope and pinning `CLAUDE_CONFIG_DIR` is **configuration scoping, not
  containment** — a run under `bypassPermissions` can still read or write those
  paths through `Bash` like any other directory. The mechanisms stop Claude Code
  *itself* from using the user's config and history; they are not a filesystem
  boundary.
- **Prompt injection from non-audio sources.** File content, tool output, and
  web results all re-enter the agent's context, and no filtering is applied. The
  verbs that read that material (`investigate`, `review`) are among the ones that
  never park. This is a known and accepted limitation of the design, not a bug to
  report — it is the same class of exposure as spoken audio, which is documented
  above as in scope by design.
- **An unsigned application bundle.** The packaged app is unsigned unless you add
  your own Apple signing certificates.
- **`IRIS_ALLOW_ANY_PLATFORM=1`.** Iris refuses to launch on anything other than
  macOS; this variable bypasses that admission check and puts the app in
  deliberately untested territory. Behaviour there is not supported.
- **A local user who already has the machine.** Anyone with your account can read
  `~/.iris/.env` and run the agent themselves without going through Iris.

## What *would* be a vulnerability

Please do report:

- A path that **dispatches work without passing the review gate** when the gate
  says it should park — a verb declared `always` or `on_open` reaching a run
  unparked, or the registry being bypassed at dispatch.
- The **review mode being changed by anything other than the UI control** or the
  startup environment default — in particular, any route by which the voice model
  or a run can alter `IRIS_PROMPT_REVIEW`.
- A **credential reaching a process that should not see it** — `GEMINI_API_KEY`
  in a worker environment, a subscription token reaching the renderer, or any
  key appearing in a log, event, or transcript.
- **Renderer code loading from a network origin**, a CSP bypass, or navigation
  escaping the app's own document while carrying the preload bridge.
- Anything that writes into the user's `~/.claude` through Claude Code's own
  configuration, transcript, or memory mechanisms.

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — the repository's own standing rules, including the
  denylist and `~/.claude` conventions above.
- [`docs/PIPELINE_INTERNALS.md`](docs/PIPELINE_INTERNALS.md) — availability
  gating, the verb registry and dispatch, subscription auth, hooks, skill
  scoping.
- [`openspec/specs/`](openspec/specs/) — the living spec, one capability per
  folder, and the authoritative statement of every behaviour described here.
