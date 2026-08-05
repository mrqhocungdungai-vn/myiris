## Context

See proposal.md — Why. What matters for the approach:

- `openNote` is renderer-only React state (`src/App.tsx:187`). `preload.cjs` has no channel for it; `secondbrain:read-note` is a stateless read by id and records nothing.
- `electron/capabilities/second-brain.mjs` already owns the analogous thing for the focus: `focusState` held in main, `resolveFocus()` late-resolved against `latestGraph`, `promptFragment()` for the connect-time description, `announceFocusUpdate()` for the mid-session push, and `resolveVaultNotePath()` as the one place an identity becomes a vault-checked file path. The open note follows every one of those grooves.
- `electron/verbs.mjs` is the single registry. `capture_learning` is `stateful: false`, `sessionKey: "capture_learning"`, `model: CHEAPEST`, `budget: "light"`, `skills: NOTE_SKILLS`, `vault: true`. The two stateful verbs share `STATEFUL_SESSION_KEY` and take `THIN_PARAMS` (`said` verbatim + `reading`).
- `run-exec.mjs:278` reads `workstream.agent_sessions[sessionKeyFor(verb)]` — a **map** of session key → resumable session id. `live-session.mjs:65` holds exactly **one** resident session (`let liveSession = null`), not a map.
- `announcements.mjs:188` tells the voice layer to summarize a completed run in 1–3 sentences.
- `second-brain-focus` sends the focus to runs at a single composition point (`run-context.mjs`), explicitly *not* as a per-verb schema parameter.

## Goals / Non-Goals

**Goals:**

- One authority on what is being worked on, reused by the voice layer, the direct-write tools, and runs.
- A follow-up like "drop the second paragraph" that resolves correctly, by construction rather than by prompt wording.
- Add the capability without relaxing existing safety invariants: no note bodies in per-turn context, no caller-supplied paths, no arbitrary-content write primitive.

**Non-Goals:**

- Changing `capture_learning` in any way.
- Multiple simultaneously resident sessions. `live-session.mjs`'s single-resident invariant is preserved.
- A new direct-write primitive for note content. Conversational editing is worker work with the vault granted — which is what keeps `personal-knowledge-notes`' enumerated-operations rule intact rather than needing an exception.
- Anything about the galaxy's gesture surface (that is `two-palm-galaxy-zoom`).

## Decisions

### D1. The open note replaces the focus as the described referent; it does not merge with it

Both exist at once — a note can only be opened while the galaxy is active, and `second-brain-focus` requires that reading a focused note keeps the focus. Describing both would leave "this one" and "these two" ambiguous at the exact moment the model is about to write to the vault.

Precedence, not merging. `promptFragment()` and the mid-session push emit the open note's line when one is open, and the focus's line otherwise. The focus stays in main untouched, so closing the note restores it with nothing to rebuild.

*Alternative considered:* describe both, marked. Rejected — the failure is silent and lands in the user's files.

*Alternative considered:* clear the focus on open. Rejected — it contradicts a shipped requirement and throws away a selection the user built.

### D2. A new stateful verb with a per-note session key

`capture_learning` cannot absorb this. Making it stateful would turn "what do my notes say about X" into a resident session and force its cheapest-model/light-budget declaration to change for every notes call.

The new verb does **not** share `STATEFUL_SESSION_KEY`. That key exists because shaping-by-voice and shaping-on-canvas are one conversation in two media; editing a note is not that conversation, and sharing would bind both to one model and one context window.

Its session key is derived per note (`note:<id>`-shaped). Because `agent_sessions` is a map of key → resumable id while only one session is *resident*, this buys per-note continuity at the cost of a resident-slot handoff on switch, not at the cost of multiple live processes. Returning to a note resumes its stored id.

*Alternative considered:* one key for the verb, reset on note switch. Cheaper, but moving between two notes — ordinary behavior — discards context each time.

*Alternative considered:* one key, never reset. One window accumulates several notes, which is precisely the confusion this change exists to remove.

**Open implementation question for the implementer:** the resident-slot handoff on note switch is the one piece with no existing precedent. Verify against `live-session.mjs` and `run-sessions.mjs` whether yielding the slot is a clean teardown-and-resume or needs new lifecycle handling, and whether `stateful-verb-session`'s "reset only on user triggers" requirement needs a delta to describe a handoff (a handoff retains the outgoing session id, so it is not a reset — but the spec may still need to say so).

### D3. The session that reads the note is the session that edits it

If the voice layer renders the note and the worker edits it, each has divided the text independently and "the second paragraph" is resolved against two different divisions. Having one session do both makes the referent correct by construction.

The consequence is a new announcement path: the existing completion instruction (`announcements.mjs:188`) explicitly asks for a 1–3 sentence summary, which destroys a reading. This verb's result is spoken as written.

*Alternative considered:* a direct read tool giving the voice layer the body. Instant and run-free, but reintroduces the split, and puts note bodies into the layer that `second-brain-focus` deliberately keeps them out of.

*Alternative considered:* reuse the `SYSTEM_EVENT_PO_QUESTION` relay, which already says "read each one aloud right then". Rejected — it bends a channel for questions-with-options into a text-reading channel, and leaves the run blocked awaiting an answer to a question that was never asked.

### D4. The open note reaches runs at the existing composition point

Not as a verb schema parameter. `second-brain-focus` established this: per-verb delivery makes every verb that ever wants a referent re-declare it. The open note joins the focus and the transcript in `run-context.mjs`, fenced as untrusted on the same terms.

The block carries identity, title, tags, and the vault-relative path — the path because the verb has the vault granted and must open the file, unlike the renderer, which never sees paths.

### D5. The new capability, not a second delta on `second-brain-focus`

`two-palm-galaxy-zoom` already holds a `MODIFIED` on `second-brain-focus`'s "One authoritative focus…" requirement. A concurrent second delta on the same requirement would have to match a main spec that has not absorbed the first — a known-fragile ordering.

Independently of that, the referent-precedence rule is *about the work object*, not about the focus, so a new capability is where it belongs. `personal-knowledge-notes` still takes a delta, because its "no second notes verb" rule genuinely has to be narrowed for this verb to be legitimate rather than tolerated.

## Risks / Trade-offs

- **Switching notes costs a resident-session handoff** → Accepted deliberately (D2). The alternative is either lost context or multiple live Claude processes.
- **An eighth verb dilutes the selection surface** — `docs/PIPELINE_INTERNALS.md:166` already notes that seven verbs create more ways to select wrongly than one general tool → Mitigated by a description that draws a hard line against `capture_learning` ("this is for the note currently open on screen"), in the way `capture_note`'s description already draws one against `capture_learning`.
- **The verb writes note content, which the enumerated-write rule does not cover** → It is not covered because it is not Iris writing: it is a worker with the vault granted, which `personal-knowledge-notes` already routes judgement work to. The `PreToolUse` denylist remains a guard against accidents, not containment — unchanged, and not to be described otherwise.
- **A note deleted or renamed mid-session** → The open note is stored as an identity and late-resolved, so it drops out rather than becoming a phantom. The resident session may still hold stale content in context; the verb re-reads before editing.
- **The verbatim announcement path could be reused for other verbs and lose the summarization default** → Scope it to this verb rather than adding a general "don't summarize" switch.

## Open Questions

- **Should ambient session capture record which note was open?** Not decided with the user. The mechanism is cheap — `session-capture.mjs`'s `renderSessionBlock` writes a `## Verbatim microphone record · start – end` header per flush, so a line naming the open note would fit — but a flush spans ~30s and can straddle a note opening or closing, so doing it honestly also means forcing a flush at those boundaries so each block belongs to one context. The options weighed were: (a) leave the spool unchanged and defer; (b) name the open note in the block header and force a flush on open/close/switch; (c) a per-note spool directory, rejected in discussion because a machine-written log should not mirror note names that can be renamed. **This does not block the rest of the change** — it adds nothing to the capability's requirements and can be decided and added separately.
