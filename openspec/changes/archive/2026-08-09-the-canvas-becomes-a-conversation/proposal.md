## Why

Iris can already draw on the canvas when asked. What she cannot do is **think
at the canvas with you** — and the distance between those two is not a missing
feature, it is five specific properties of the current pipeline.

The parts needed for a live drawing conversation already exist, which is the
surprising part. `po-session.mjs` holds a **resident Agent SDK session**: a
`query()` kept alive by a pull-based user-message channel, so a second turn is
a `channel.push`, not a new process (`po-session.mjs:40-56,401-421`). Residency
has no idle timeout by design (`stateful-verb-session`: "time passing SHALL NOT
end residency"). The canvas MCP server survives across runs and is attached
lazily to a live session (`po-session.mjs:390` ← `run-exec.mjs:833`). Gemini
Live transcribes the user verbatim (`live-config.mjs:32`), and that transcript
is already fenced into every prompt (`run-context.mjs:149-192`).

So the transport is right. What is wrong is **policy and wiring**, in five
places:

**1. Opening the canvas opens nothing to talk to.** `canvas:activate` starts the
MCP server and sets a sticky `canvasEngaged` flag (`canvas.mjs:110,154`) — and
that is all. No Claude session exists until Gemini decides to call
`shape_on_canvas`. The user opens a board, starts talking, and the first
sentence pays for a cold session open, an `openspec init` scaffold
(`run-exec.mjs:340-348`), and a review-gate park (`PARK.ON_OPEN`).

**2. Every canvas turn queues behind whatever else Claude is doing.** There is
one global execution slot (`run-queue.mjs:142,231-233`). A five-second "make
that box blue" waits behind a twenty-minute `execute`. In a brainstorm, a reply
that arrives after the thought has passed is not a slow reply — it is a wrong
one.

**3. The user hears nothing until the turn ends.** In-flight activity and tool
calls go to the renderer only; no `notifyIris` sits on that path
(`run-stream.mjs:207-274`). Then Gemini is told to compress the result into
"1-3 sentences" (`announcements.mjs:188`). For a brainstorm this is the wrong
shape twice over: silence while she works, then a summary of work the user
watched happen.

**4. Claude gets Gemini's account of what was said, with the verbatim record
demoted underneath it.** The thin schema asks Gemini for the user's words "as
close to verbatim as you can manage" (`verbs.mjs:123-137`) — a promise in a
schema with nothing checking it. The real transcript is attached, but as
background that "never overrides the instruction" (`run-context.mjs:187`).
Worse, the tool call is handled before the transcript flush
(`live-messages.mjs:197-207` vs `:260-263`), so **the sentence that triggered
the turn may not be in the transcript at all**.

**5. The ceiling is on the conversation, not on the turn.** `stateful` is 150
turns and $6 (`run-budget.mjs:35`) applied to the whole `query()` lifetime
(`po-session.mjs:334-339`). A long brainstorm does not get slower as it
approaches that; it gets **finalized as `limited`**, the stream ends, and the
next utterance silently opens a new session.

## What Changes

**Opening the canvas opens the conversation.** While the drawing surface is
open, the shaping session is *resident and warm*: the session, its scaffold and
its canvas tools are ready before the user's first sentence, not after it. The
review gate is asked once, when the conversation opens — which is what
`PARK.ON_OPEN` already means — rather than being skipped or repeated.

**A canvas turn does not wait behind unrelated work.** Turns delivered into an
already-resident conversation get their own lane: they are a `push` into a live
context, not a new run competing for the execution slot. Long-running work
keeps the slot it has; the conversation keeps its own.

**The user hears Iris thinking, not just Iris finishing.** Turns in this mode
stream: what she is about to do, what she just drew, and the answer as it forms
— spoken as it happens rather than summarized afterwards. Barge-in ends the
current turn without ending the conversation (`interrupt()`, not `abort` —
`po-session.mjs:434-456`).

**The user's own words reach Claude, first-hand.** For this conversation the
verbatim utterance is the instruction, not the background: the transcript is
flushed before the turn is composed, so the sentence that caused the turn is in
it, and Gemini's reading travels alongside it rather than in front of it.

**A ceiling ends a turn, never the conversation.** Per-turn and per-session
limits are separated. Reaching a turn's ceiling finalizes that turn as
`limited` and leaves the conversation live; reaching the session's says so out
loud and asks, instead of quietly starting a new session under the same name.

## Impact

- Specs: `canvas-claude-mcp`, `stateful-verb-session`, `run-execution-queue`, `voice-decision-relay` (all MODIFIED)
- Main: `electron/capabilities/canvas.mjs`, `po-session.mjs`, `run-exec.mjs`, `run-queue.mjs`, `run-stream.mjs`, `run-budget.mjs`, `run-context.mjs`, `announcements.mjs`, `live-messages.mjs`, `verbs.mjs`
- Renderer: `src/components/DrawingCanvas.tsx` (open/close signals a conversation, not just a panel)
- Evidence: `.audit/voice-to-claude-path.md` (12 information-loss points), `.audit/claude-session-lifetime.md`
