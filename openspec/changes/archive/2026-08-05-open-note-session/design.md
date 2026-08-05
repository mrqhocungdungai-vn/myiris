## Context

See proposal.md — Why. What matters for the approach:

- `openNote` is renderer-only React state (`src/App.tsx:187`). `preload.cjs` has no channel for it; `secondbrain:read-note` is a stateless read by id and records nothing.
- `electron/capabilities/second-brain.mjs` already owns the analogous thing for the focus: `focusState` held in main, `resolveFocus()` late-resolved against `latestGraph`, `promptFragment()` for the connect-time description, `announceFocusUpdate()` for the mid-session push, and `resolveVaultNotePath()` as the one place an identity becomes a vault-checked file path. The open note follows every one of those grooves.
- `electron/verbs.mjs` is the single registry. `capture_learning` is `stateful: false`, `sessionKey: "capture_learning"`, `model: CHEAPEST`, `budget: "light"`, `skills: NOTE_SKILLS`, `vault: true`. The two stateful verbs share `STATEFUL_SESSION_KEY` and take `THIN_PARAMS` (`said` verbatim + `reading`).
- `run-exec.mjs:278` reads `workstream.agent_sessions[sessionKeyFor(verb)]` — a **map** of session key → resumable session id. `po-session.mjs:85` holds the resident sessions in `const sessions = new Map()` keyed by **`workstream.id`**, and `getOrCreatePoSession` returns the incumbent whenever `existing && !existing.ended` — **without ever comparing `sessionKey`** (`po-session.mjs:232`). So one workstream has exactly one resident session today, and which conversation it belongs to is not checked. (`live-session.mjs` is the *Gemini Live* connection and `run-sessions.mjs` is only `isSessionAlive`/`nameSession`; neither holds a Claude session.)
- The voice question relay a stateful verb pauses on already exists end to end: `po-session.mjs`'s `canUseTool` intercepts `AskUserQuestion` → `run-stream.mjs:241`'s `askUserQuestionViaVoice` → `SYSTEM_EVENT_PO_QUESTION` → `answer_claude_question`. Its unanswered default is **the first-listed option** (`run-stream.mjs:221` `defaultPoAnswers`, `q.options?.[0]?.label`), after `IRIS_PO_QUESTION_TIMEOUT_MS` (default 5 minutes).
- `run-dispatch.mjs:237`'s `shouldPark` short-circuits to `false` when review mode is `never` — the pre-dispatch gate is switchable off in its entirety, so nothing that must hold can be built on it.
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

The verb is **`work_on_note`**, label **"Note"** — singular against `capture_learning`'s plural "Notes", which is the distinction: one open note versus everything that accumulated. `park: PARK.ON_OPEN` and `model: STRONGEST`, matching the two existing stateful verbs; see D6 for why the park level is *not* what makes this verb safe.

### D2a. The resident slot is keyed by conversation, not only by workstream

Resolved, and it is a defect rather than an open question. `po-session.mjs`'s `sessions` map is keyed by `workstream.id` alone, and `getOrCreatePoSession` returns the incumbent without comparing `sessionKey`. Left as-is, the first `work_on_note` turn in a workstream whose shaping session is resident would be delivered **into the shaping session**: the note conversation would run on shaping's context, shaping's scoped skills, and be recorded against shaping's stored session id. Nothing in the current code prevents this, because until now every stateful verb resolved to the same key.

`getOrCreatePoSession` therefore treats a `sessionKey` mismatch as "this is not the session you asked for": it closes the incumbent through the existing `closePoSession` — which ends residency and leaves `agent_sessions` untouched, so the outgoing conversation stays resumable — and opens the requested one, resuming its own stored id.

This is teardown-and-resume with existing precedent, not new lifecycle handling: `session-store.mjs` already calls `closePoSession` on a workstream switch and on a project-folder change (lines 335/355/375), for the same reason — nothing will deliver that session another turn, so holding the subprocess open is waste.

It also makes the handoff **symmetric and content-free**: whichever conversation is asked for next takes the slot, and the outgoing one loses residency only. Note→note, note→shaping, and shaping→note are one mechanism, not three cases.

`stateful-verb-session` **does** need a delta as a consequence. Its living requirement says the resident session "SHALL NOT be torn down automatically between turns" and that "Reset SHALL occur only on the existing triggers" — three user actions, none of which is this. The handoff is not a *reset* (the conversation survives, resumable), but residency genuinely does end on a trigger that requirement does not admit, so the requirement becomes false unless it distinguishes losing residency from losing the conversation.

### D3. The session that reads the note is the session that edits it

If the voice layer renders the note and the worker edits it, each has divided the text independently and "the second paragraph" is resolved against two different divisions. Having one session do both makes the referent correct by construction.

The consequence is a new announcement path: the existing completion instruction (`announcements.mjs:188`) explicitly asks for a 1–3 sentence summary, which destroys a reading. This verb's result is spoken as written.

*Alternative considered:* a direct read tool giving the voice layer the body. Instant and run-free, but reintroduces the split, and puts note bodies into the layer that `second-brain-focus` deliberately keeps them out of.

*Alternative considered:* reuse the `SYSTEM_EVENT_PO_QUESTION` relay, which already says "read each one aloud right then". Rejected **for the reading** — it bends a channel for questions-with-options into a text-reading channel, and leaves the run blocked awaiting an answer to a question that was never asked. This is not in tension with D6, which sends the destructive-edit confirmation down that same relay: that is a genuine question with options, awaiting a genuine answer, which is precisely what the channel is for. Reading is not a question; confirming is.

### D4. The open note reaches runs at the existing composition point

Not as a verb schema parameter. `second-brain-focus` established this: per-verb delivery makes every verb that ever wants a referent re-declare it. The open note joins the focus and the transcript in `run-context.mjs`, fenced as untrusted on the same terms.

The block carries identity, title, tags, and the vault-relative path — the path because the verb has the vault granted and must open the file, unlike the renderer, which never sees paths.

### D5. The new capability, not a second delta on `second-brain-focus`

`two-palm-galaxy-zoom` already holds a `MODIFIED` on `second-brain-focus`'s "One authoritative focus…" requirement. A concurrent second delta on the same requirement would have to match a main spec that has not absorbed the first — a known-fragile ordering.

Independently of that, the referent-precedence rule is *about the work object*, not about the focus, so a new capability is where it belongs. `personal-knowledge-notes` still takes a delta, because its "no second notes verb" rule genuinely has to be narrowed for this verb to be legitimate rather than tolerated.

### D6. Destructive edits confirm in-conversation; additions do not

The user's stated reason for this change is that notes written for them by a model come back wrong. The thing that makes a wrong note *tolerable* is not a better model — it is that a wrong edit is either visible or recoverable. In a vault of plain files with no history, a removal is neither: nothing records what the paragraph said, so recovery means the user noticing and dictating it back. An addition is both. So the two do not get the same treatment.

**Add** → apply, then report what was added. **Remove or replace** → name the text that is about to go, wait for an answer, then write.

Naming has to be the *text*, not its position. "Shall I drop the second paragraph?" is unverifiable by the person being asked — it echoes back the very reference that may have resolved wrongly. "Shall I drop the part about the project deadline?" is checkable without looking at the screen, which is the only place a voice confirmation is worth anything.

Three things about *where* this lives:

**Not the review gate.** The obvious place to put a confirmation is the pre-dispatch review, and it is the wrong place twice over. It fires before the session has decided on any edit, so it cannot describe one; and `shouldPark` returns `false` outright when review mode is `never`, so a user who has switched review off — the case that motivated this decision — would have no confirmation at all. `PARK.ON_OPEN` stays for consistency with the other stateful verbs, but it is explicitly *not* the mechanism protecting the note.

**Not the instruction alone.** The verb's clause tells it to confirm, and because the verb is stateful the ask is genuinely available (`AskUserQuestion` is absent from `disallowedTools`) and genuinely wired (the `canUseTool` → voice relay already exists). But this repo has already established that an instruction the runtime does not enforce is worth nothing — `appendSystemPrompt` was silently dropped for months, and "DEV never asks" was a prompt promise until it became a `disallowedTools` entry. So the clause is backed by a main-process guard: the resident session's `canUseTool` holds a write aimed at the open note until the confirmation is answered, unless main can determine for itself that the write removes nothing.

Main can determine that without trusting the session's account of it: for an `Edit`, the write removes nothing when `new_string` contains `old_string`; for a `Write`, when the proposed content contains the file's current content. Anything main cannot decide falls to "confirm" — the safe direction, so incompleteness costs a question rather than a paragraph. This is a **guard against the step being skipped, not containment**, and is to be described that way everywhere: the session has the vault granted under `bypassPermissions` and can reach the file through `Bash`, which this guard does not inspect. That is the same honesty the `PreToolUse` denylist is already documented with.

**The unanswered default must write nothing.** This is the trap. The existing relay resolves an unanswered question to the **first-listed option** (`defaultPoAnswers`), so a confirmation whose first option is "yes, remove it" deletes the paragraph of a user who walked away for five minutes. The first option is therefore the one that changes nothing — which also lines up with the relay's own "first option = recommended" convention and with what Iris says when asked what it would pick.

*Alternative considered:* confirm every edit, additions included. Rejected — it puts a round trip between the user and each dictated sentence, and a confirmation that fires constantly is one the user learns to say yes to without listening, which is exactly how the review gate stopped working for them.

*Alternative considered:* apply everything immediately and rely on the conversation to undo a mistake ("no, put that back"). Rejected — it only works while the removed text is still in the session's context, and it silently converts "your note is intact" into "your note is intact provided you noticed in time".

*Alternative considered:* snapshot the note before each write so any edit is undoable, and confirm nothing. Rejected as a *substitute* — it is a different feature (version history for the vault), it is not what was asked for, and it would answer the recoverability problem while leaving the user with no idea what Iris just did.

## Risks / Trade-offs

- **Switching notes costs a resident-session handoff** → Accepted deliberately (D2). The alternative is either lost context or multiple live Claude processes.
- **An eighth verb dilutes the selection surface** — `docs/PIPELINE_INTERNALS.md:166` already notes that seven verbs create more ways to select wrongly than one general tool → Mitigated by a description that draws a hard line against `capture_learning` ("this is for the note currently open on screen"), in the way `capture_note`'s description already draws one against `capture_learning`.
- **The verb writes note content, which the enumerated-write rule does not cover** → It is not covered because it is not Iris writing: it is a worker with the vault granted, which `personal-knowledge-notes` already routes judgement work to. The `PreToolUse` denylist remains a guard against accidents, not containment — unchanged, and not to be described otherwise.
- **A note deleted or renamed mid-session** → The open note is stored as an identity and late-resolved, so it drops out rather than becoming a phantom. The resident session may still hold stale content in context; the verb re-reads before editing.
- **The verbatim announcement path could be reused for other verbs and lose the summarization default** → Scope it to this verb rather than adding a general "don't summarize" switch.
- **The write guard is incomplete by construction** — it inspects the SDK's file tools and not `Bash` → Accepted and documented as a guard, never as containment (D6). The unknown case confirms rather than proceeds, so the gap costs an extra question, not an unannounced deletion.
- **A confirmation on every removal slows down a long editing pass** → Accepted. It is the case where being slow is correct, and additions — the bulk of dictating into a note — are unaffected.
- **The eighth verb makes the voice layer's prose about live questions inaccurate.** `gemini-prompts.mjs:68` and `gemini-tools.mjs:129` both describe `SYSTEM_EVENT_PO_QUESTION` as coming from "a shaping run" / "the live shaping session" → Widen the wording. The relay itself is verb-agnostic, but a destructive-edit confirmation is the worst possible question for the voice layer to mis-frame or defer.

## Open Questions

- **Should ambient session capture record which note was open? — deferred, deliberately.** Decided with the user to leave the spool exactly as it is (option (a) below). It adds nothing to this capability's requirements, and the user's position was that this is not a distinction they want to reason about. Recorded for whoever revisits it: the mechanism is cheap — `session-capture.mjs`'s `renderSessionBlock` writes a `## Verbatim microphone record · start – end` header per flush, so a line naming the open note would fit — but a flush spans ~30s and can straddle a note opening or closing, so doing it honestly also means forcing a flush at those boundaries so each block belongs to one context. The options weighed were: (a) leave the spool unchanged and defer — **chosen**; (b) name the open note in the block header and force a flush on open/close/switch; (c) a per-note spool directory, rejected in discussion because a machine-written log should not mirror note names that can be renamed.

## Noted, out of scope

- **`capture_learning` writing poor notes from a long spoken passage** is the user's original complaint, and this change deliberately does not address it. It is a one-shot verb that cannot ask and does not read anything back before writing, so nothing here improves it; the scope decision was explicit. What this change does give is the repair path — open the note it wrote badly and fix it by conversation, with the read-back and the confirmation above.
- **Nothing ever empties `inbox/`.** The three spools (`inbox/runs`, `inbox/captures`, `inbox/sessions`) are append-only, one file per day, and nothing deletes, moves, or watermarks them once `capture_learning` has read them — the six wiki skills contain no mention of `inbox/` at all, so "since they were last processed" in that verb's clause is prose with no mechanism behind it. Surfaced while investigating this change; it belongs to `ambient-session-capture`/`personal-knowledge-notes`, not here.
