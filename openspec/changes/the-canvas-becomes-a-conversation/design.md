# Design

## D1. Residency is tied to the canvas being open, not to a verb being called

Today the resident session is created lazily by the first `shape_on_canvas`
call (`run-exec.mjs:765` → `po-session.mjs:227`). The canvas being open is
already a signal the main process receives (`canvas:activate`,
`canvas.mjs:154`) and already uses for one thing — starting the MCP server.

**Decision:** `canvas:activate` also *warms* the shaping session: scaffold,
session open, canvas MCP attached. `canvas:deactivate` (new) marks the
conversation idle but does **not** close it — residency surviving the panel is
consistent with `stateful-verb-session`, and reopening the panel two minutes
later should not cost a cold start or a second review park.

**Rejected:** opening the session on the first *utterance* instead. It moves the
cold start from "when I opened the board" to "when I said my first sentence",
which is exactly the moment the latency is most visible.

**Cost, stated:** warming on open spends a session (and the review park) for a
user who opens the canvas and draws in silence. Mitigation: warm on open only
when the pipeline is available and a Claude credential exists — the same gate
the MCP server already passes (`canvas.mjs:110`) — and treat the warm session
as ordinary residency, so the existing close reasons still apply.

## D2. A resident turn is not a queued run

`run-queue.mjs` guards one thing: that Claude does one *job* at a time, because
two concurrent jobs writing a repository is the hazard. A turn pushed into an
already-open conversation is not that. It shares a context window with the
previous turn and cannot start a second worker.

**Decision:** turns delivered by `deliverPoTurn` into a live session bypass the
execution slot, and are serialized *per session* instead (one turn at a time
within a conversation, which the channel already enforces). Opening a session
still goes through the slot — that is the moment a new job begins.

**Rejected:** a second global slot. Two slots is one number pretending to be a
policy; the real distinction is "new job" vs "next turn of an open one".

**Risk:** a canvas turn can now run while `execute` runs. They share the
filesystem. The canvas conversation is `vault: false` and its skills are
shaping skills, but nothing structurally prevents a write. This is the change's
main hazard and is written into the spec as a bounded one: a resident canvas
turn runs with the canvas tools and the shaping skills, and a turn that would
start repository work is refused rather than run beside `execute`.

## D3. Streaming out: what the user hears while Iris works

Three candidate sources, in increasing fidelity:

1. tool-start/tool-end events already on the stream (`run-stream.mjs:220-256`)
2. `agentProgressSummaries` (declared by the SDK, currently unused)
3. `includePartialMessages` — token-level partials, previously declined on the
   grounds that "voice only speaks at the end of a run" (`docs/REFERENCE.md`)

**Decision:** (1) for *acts* and (3) for *words*, and only in this mode. The
reason to revisit the old refusal is that its premise is exactly what this
change removes. Partial text is spoken as it forms; tool calls become short
spoken acts ("adding three boxes"), not a transcript of tool names.

**Constraint:** Gemini currently re-narrates in 1-3 sentences
(`announcements.mjs:188`). Re-summarizing a stream produces lag and paraphrase
on top of paraphrase. This mode therefore uses the **verbatim relay** path that
already exists for `work_on_note` ("EXACTLY AS WRITTEN", `announcements.mjs:267`)
rather than the summarizing one.

**Cost:** more tokens into Gemini, more speech. Bounded by speaking only
sentence-completed partials and by dropping to acts-only when speech falls
behind the stream.

## D4. Verbatim in: fix the ordering, then change the standing

Two separate defects, deliberately fixed separately:

- **Ordering (a bug):** `handleToolCall` runs before `flushTranscripts`
  (`live-messages.mjs:197-207` vs `:260-263`), so the triggering sentence can be
  absent from the ring the prompt is built from. Flush before dispatching a
  tool call. This is correct regardless of this change.
- **Standing (a policy):** `run-context.mjs:187` says the transcript "never
  overrides the instruction". For a *brainstorm* that is backwards: the
  instruction is a reading produced by a third party, and the words are the
  primary source. In this mode the utterance leads and Gemini's reading follows
  it, labelled as a reading.

**Not changed:** the fence. Untrusted-text fencing stays exactly as it is; this
changes which fenced block leads, not whether input is fenced.

## D5. Ceilings: separate the turn from the conversation

`maxTurns: 150` currently governs a whole `query()` lifetime. A brainstorm is
many cheap turns; a single runaway turn is the thing worth stopping.

**Decision:** a per-turn ceiling (small) and a per-session ceiling (large, and
about spend rather than turns). A per-turn ceiling finalizes that turn as
`limited` and leaves the conversation open. The session ceiling is the one that
ends residency, and when it does, Iris says so and asks — never a silent
re-open under the same name, which is today's behaviour
(`po-session.mjs:178` → next turn opens a new session).

**Open question for the user:** what the session ceiling should be in money.
$6 is the current whole-session figure and was set for a working session, not a
conversation.

## D6. Barge-in

`interrupt()` already exists and is preferred over `abort` precisely because it
keeps the context (`po-session.mjs:434-456`). Gemini Live's own interruption
signal is already handled (`live-messages.mjs:260-263`). Wire the two: the user
speaking over Iris ends the current turn, keeps the conversation, and the
interrupted turn's partial work stays on the canvas (it was applied through
MCP as it happened).

## D7. What this change deliberately does NOT do

- It does not make Claude *watch* the canvas. Claude reads it when a turn asks
  him to. A push-on-every-stroke design would spend a turn per stroke.
- It does not give the canvas conversation repository write access (D2's risk).
- It does not touch the other verbs' latency, park policy, or ceilings.
- It does not address the Gemini Live reconnect gap
  (`.audit/realtime-audit.md` section B), which is a separate change.
