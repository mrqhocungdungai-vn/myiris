## Why

`shape_on_canvas` declares `disallowedTools: ["Write", "Edit", "NotebookEdit",
"Bash"]`, and the comment above the declaration says the confinement is
"enforced by configuration, never promised in a prompt" (`verbs.mjs:211-219`).

On the run shape this verb actually uses, neither half is true. The stateful
path never passes `disallowedTools` to the SDK: `statefulSessionOptions`
(`run-exec.mjs:740-783`) omits it, and the omission is *pinned* —
`sdk-options.test.mjs` asserts
`expect(options).not.toHaveProperty("disallowedTools")` on both resident
shapes. A canvas conversation can write files and run commands today; the
registry's declaration is a statement with nothing behind it.

The omission is not an oversight one flag fixes. The resident session is
**shared** between `shape_requirements` (`disallowedTools: []`) and
`shape_on_canvas`, session options are fixed when the session opens, and the
two verbs declare different bounds — so no session-level value is correct for
both. Blocking Bash session-wide would also break the voice-shaping turns:
all six OpenSpec skills in `SHAPING_SKILLS` declare
`allowed-tools: Bash(openspec:*)`. And the installed SDK offers no per-turn
repair: `Query` has `setModel`, `setMcpServers`, `setPermissionMode` — no
`setDisallowedTools` (verified in `sdk.d.ts:2252-2498`).

This is the same defect family as the silently-dropped `appendSystemPrompt`
that CLAUDE.md memorializes: a declaration that one run shape honors and the
other silently drops, with a test asserting the dropped state is correct. The
hazard is concrete — the canvas conversation runs beside unrelated jobs on the
resident lane, and "two writers touching one working tree" is exactly what the
verb's own comment says the bound exists to prevent.

## What Changes

- The bound is enforced **per turn, at the tool gate**: `canUseTool` — the one
  channel both run shapes already use for permission decisions — learns the
  current turn's `disallowedTools` and refuses those tools for that turn, with
  a message that names the verb and points at the way forward the verb's
  clause already primes.
- The stateless shape is untouched (it already sets `options.disallowedTools`
  and mirrors it in `canUseTool`, `run-exec.mjs:548-591`).
- The session options stay exactly as pinned: no `disallowedTools` key on
  resident options — the existing assertions remain true and gain a sibling
  asserting the per-turn behavior.
- The spec states the honest limit: a session-level withholding *hides* a tool
  from the model's listing; a per-turn gate can only *refuse* it. On a canvas
  turn the model still sees Write/Edit/Bash and receives a refusal — declared,
  not papered over.
- The registry comment stops claiming a mechanism that does not exist for this
  shape.

## Impact

- **Affected specs:** `verb-tool-surface` (ADDED: declared tool bounds bind on
  every run shape — ADDED rather than MODIFIED deliberately, because the
  sibling change `every-verb-earns-its-skills` modifies the neighbouring
  capability requirement and two changes rewriting one requirement would
  overwrite each other at archive time), `stateful-verb-session` (ADDED: a
  shared conversation enforces each turn's verb's bounds at use).
- **Affected code:** `electron/po-session.mjs` (two per-turn fields on
  `deliverPoTurn`, one ordered check in `buildCanUseTool`),
  `electron/run-exec.mjs` (the stateful turn passes the verb's bounds),
  `electron/verbs.mjs` (one comment), `electron/po-session.test.mjs`,
  `electron/sdk-options.test.mjs` (comments plus sibling assertions — no pinned
  assertion flips).
- **Not affected:** the stateless path, the review gate, the queue,
  `statefulSessionOptions`'s key set, and every skill list (change
  `every-verb-earns-its-skills` owns those). Change B's `SlashCommand` branch,
  if its spike lands, rides the same turn policy this change introduces —
  sequencing: B's spike may land before or after C, but C's turn-policy seam is
  what B's stateful branch attaches to.
- **Behavioral risk, stated:** a canvas turn's model may retry a refused tool.
  The refusal message carries the policy and the alternative; the run's
  existing turn/budget ceilings bound the worst case.
