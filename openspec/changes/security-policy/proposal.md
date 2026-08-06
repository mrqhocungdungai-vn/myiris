## Why

The repository is public and has no `SECURITY.md`, so someone who finds a
vulnerability has no channel at all. GitHub Issues is **disabled** on this repo, and
private vulnerability reporting is **not enabled** either — so the only options today
are silence or finding the maintainer some other way. `package.json` compounds it by
declaring a `bugs.url` that points at the disabled issue tracker, so a reporter
following the manifest lands nowhere.

For most desktop apps that would be boilerplate. It is not here, for three reasons
that are specific to Iris:

- **Iris runs an agent with `bypassPermissions` by default.** The headless worker
  executes tool calls without an approval prompt, in the user's project directory.
  CLAUDE.md is explicit that the `PreToolUse` denylist is "a guard against accidents,
  not a sandbox" and must never be described as containment. That distinction is
  exactly the kind of thing a reporter needs stated up front, and exactly the kind of
  thing that gets misread from the outside.
- **Spoken audio is untrusted input that reaches a code-executing agent.** Anything
  audible to the microphone can influence what Gemini asks Claude to do. The review
  gate answers part of this: the park decision is a **declared property of the verb**,
  read from the registry in the main process at dispatch — never derived from the
  wording of the request, and never by asking the voice layer to honour an instruction.
  (CLAUDE.md's shorthand calls this the verb's "declared label"; `label` is actually the
  short display name — `"Shape"`, `"Build"` — and the park decision reads a separate
  `park` property. The policy must use the precise term.)

  **It answers only part of it, and the policy has to say which part.** Of the eight
  verbs, three park on **every** dispatch, three park only on the call that **opens**
  the session — every steering turn afterwards dispatches directly — and three
  **never** park. The three that never park still run with `bypassPermissions` and
  Bash available. Anyone reading a security policy that describes "the review gate"
  without that shape will conclude every audio-driven dispatch is user-confirmed, and
  it is not, deliberately.
- **Iris holds credentials.** A Gemini key, and optionally a Claude subscription token
  or API key, with a deliberate separation between which processes see them
  (`worker-env.mjs`) and a hard rule that Iris never reads or writes the user's
  `~/.claude`.

These are real security boundaries with real reasoning behind them, currently
discoverable only by reading CLAUDE.md, `docs/PIPELINE_INTERNALS.md`, and several
capability specs. Upstream reached the same conclusion when they wrote theirs
(`ASHR12/iris@8fe2f1b`), and their argument applies with more force here, because
their dispatch went to an external gateway while ours runs an agent in-process.

## What Changes

- Adds `SECURITY.md` with a private disclosure channel and expected response
  expectations.
- States the security boundaries as boundaries rather than as UX details: the dispatch
  and review gate, the permission posture and what the denylist is and is not,
  credential handling and process separation, spoken audio as untrusted input, and the
  renderer's shipped-code rule.
- States **non-goals** explicitly — what Iris does not defend against — so the
  boundary is legible from outside. An agent running with `bypassPermissions` in the
  user's own project is a deliberate design point, not a vulnerability, and a security
  policy that leaves that ambiguous wastes a reporter's time and the maintainer's.
- Links to the authoritative specs rather than restating them, so the policy cannot
  drift from the behaviour it describes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — `skip_specs: true`.

This documents boundaries that existing capabilities already specify; it does not
change any of them. `renderer-content-security`, `prompt-review-gate`,
`agent-subscription-auth`, and `global-agent-runtime` remain the authoritative
statements, and `SECURITY.md` points at them.

## Impact

- **Docs**: a new `SECURITY.md`, plus a pointer from README.
- **Code**: none — except `package.json`'s `bugs.url`, which currently points at a
  disabled issue tracker.
- **Repo settings, and this is a blocker rather than a doc task**: private vulnerability
  reporting must be enabled before `SECURITY.md` links to it, or the policy ships with a
  "Report a vulnerability" path that 404s — worse than the status quo.
- **Dependencies**: none.
- **`spec:check` proves nothing here.** The fifth gate scans only `openspec/specs/`, so
  it passes trivially for a change that touches neither code nor specs. The verification
  that matters is re-reading each claim against the source it cites.
- **Risk**: the real one is a policy that overstates the guarantees. Claiming
  containment Iris does not provide is worse than having no policy — it invites
  reliance on a boundary that is explicitly not one. The tasks require the denylist
  and the permission posture to be described in the terms CLAUDE.md already fixes.
- **Ongoing cost**: a disclosure channel implies someone reads it. The contact must be
  one the maintainer actually monitors.
