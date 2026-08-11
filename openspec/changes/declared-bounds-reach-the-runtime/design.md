## Context

Every constraint below was verified on the installed tree (2026-08-11), most by
reading the exact line, two by executing code. The implementing machine should
treat this as the fact sheet.

- `shape_on_canvas` declares the bound; `shape_requirements` declares `[]`;
  both share `STATEFUL_SESSION_KEY` (`verbs.mjs:163/:185`).
- Session options are supplied once, at open (`statefulSessionOptions`,
  `run-exec.mjs:740-783`); the comment at :762-767 already documents the
  consequence for the system prompt ("the clause baked in here is whichever
  verb opened it") — skills and bounds have no per-turn repair.
- `sdk.d.ts:2252-2498`: `Query` exposes `setModel`, `setMcpServers`,
  `setPermissionMode`, `setMcpPermissionModeOverride`. **No
  `setDisallowedTools`.**
- All six `SHAPING_SKILLS` skills declare `allowed-tools: Bash(openspec:*)` —
  a session-wide Bash block breaks the voice turns of the same conversation.
- The per-turn seam exists and is idiomatic: `buildCanUseTool`
  (`po-session.mjs:87-129`) already intercepts `AskUserQuestion` (relay) and
  `Edit`/`Write` (injected `confirmWrite`); other per-turn seams route through
  `state.currentTurn`, "null between turns".
- The stateless shape already enforces this policy twice over:
  `options.disallowedTools = [...verb.disallowedTools]` (`run-exec.mjs:553`)
  and the mirror check in its `canUseTool` (:586-591) with the message
  `"${verb.verb} runs cannot use ${toolName}"`.
- Pinned assertions: `sdk-options.test.mjs` asserts resident options have NO
  `disallowedTools` key (both the shaping and note shapes). These stay true.

## Decisions

### D1 — Enforce per turn in `canUseTool`, not per session, not in hooks

Per session is impossible to get right (two verbs, two bounds, one option set,
no setter). Hooks are the wrong home twice over: `run-hooks.mjs:20-22` declares
PreToolUse "stays a guard and never accumulates product telemetry", and the
stateless path already enforces the same policy in `canUseTool` — one
enforcement channel, two shapes, is the property to preserve.

Mechanism:

1. `po-session.mjs` — `deliverPoTurn(state, taskText, callbacks)` accepts two
   new per-turn fields stored on `state.currentTurn`:
   `disallowedTools: string[]` and optional `denyToolMessage(toolName)`.
   po-session stays verb-ignorant — it takes the policy exactly as it takes
   `confirmWrite`, and never imports the registry.
2. `buildCanUseTool` gains one check, **ordered first**: if the current turn's
   `disallowedTools` contains the tool, deny with the caller's message (default
   `"This turn cannot use ${toolName}."`). Order matters twice:
   - before the `AskUserQuestion` relay, so a stateful verb that ever withholds
     asking is denied rather than relayed to a voice layer expecting no
     question;
   - before `confirmWrite`, so a denied `Edit` never triggers a confirmation
     prompt for a write that cannot happen.
3. `run-exec.mjs` — the stateful `deliverPoTurn` call site (~:885) passes
   `disallowedTools: verb.disallowedTools` and a message in the stateless
   wording plus the way forward the canvas clause already primes:
   `"shape_on_canvas runs cannot use Write — say what needs building or
   writing down, and let the user start that work."`
4. `verbs.mjs:211-219` — the comment's "enforced by configuration" becomes
   "enforced per turn at the tool gate (canUseTool); the shared session's
   option set cannot carry a per-verb value".

### D2 — The pinned assertions stay, and say why

`expect(options).not.toHaveProperty("disallowedTools")` remains **correct**:
resident options never carry the key, before or after this change. What changes
is the comment beside it — from "this is the shape that IS allowed to ask, so
it must not be locked out" to "the bound travels with the turn, not the
session" — plus sibling assertions exercising the turn behavior. A change that
flips a pinned assertion is evidence of the wrong design here; this one flips
none.

### D3 — The honest limit is a spec statement, not a caveat in a comment

A session-level `disallowedTools` removes the tool from the model's listing; a
per-turn gate can only refuse a call the model already composed. On a canvas
turn, Write/Edit/Bash remain visible and return refusals. The spec delta states
this asymmetry as a requirement clause ("the surface SHALL NOT be described as
hidden") because the difference is observable in cost — a refused call still
spends a turn — and in behavior — the model may retry. Bounded by: the refusal
message carrying the alternative (the clause already tells the model to hand
work back to the user), and the run's existing ceilings (`maxTurns`,
`maxBudgetUsd`) as the hard stop.

### D4 — Scope boundary with change B

Change B (`every-verb-earns-its-skills`) may add a `SlashCommand` branch to
both shapes' `canUseTool` if its spike lands. That branch *attaches to* the
turn-policy seam this change builds (the stateful side needs
`state.currentTurn` to know the verb's skill surface). The two changes stay
independently implementable: C without B leaves commands unscoped (B's
concern); B without C can land its stateless branch and defer the stateful one.
If B's spike fails, nothing in C changes.

### D5 — Test plan, red first

1. `po-session.test.mjs`:
   - a turn delivered with `disallowedTools: ["Bash"]` denies Bash with the
     caller's message and allows Read;
   - the **next** turn on the same session with `[]` allows Bash — per-turn,
     not sticky;
   - a denied `Edit` never invokes `confirmWrite`;
   - a turn with `["AskUserQuestion"]` denies without invoking the relay.
2. run-exec wiring test: a `shape_on_canvas` turn hands `deliverPoTurn`
   exactly `resolveVerb("shape_on_canvas").disallowedTools`;
   `shape_requirements` and `work_on_note` turns hand `[]`.
3. `sdk-options.test.mjs`: comments updated per D2; sibling assertions added;
   existing key-set assertions untouched.

## Risks

- **Refusal churn** (model retries a visible-but-refused tool): mitigated by
  message content (policy + alternative), asserted in tests; ceilings bound the
  worst case. If churn is observed in real runs, the next lever is prompt-side
  (the clause), not a session-level block that would break the sibling verb.
- **A future stateful verb with a bound that includes `AskUserQuestion`**:
  the ordered check makes this safe-by-default (deny before relay), and the
  po-session test pins that order.
- **Someone "simplifies" the seam by moving the bound into session options**:
  the pinned assertions plus their rewritten comments are the tripwire; the
  spec requirement ("enforced at use because the listing is fixed at open")
  states the reason a session-level value cannot exist.
