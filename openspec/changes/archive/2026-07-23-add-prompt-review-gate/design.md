## Context

`submitClaudeTask` (`main.mjs:1766`) resolves `activeWorkstream()` and the role, builds a `run`, and calls `runQueue.submit(run)` synchronously — a queued/started/terminal result is returned to Gemini in the same Live function call (Live calls are synchronous). There is no gate between "Gemini authored a brief" and "Claude starts working," so a wrong brief costs tokens before the user can see it.

The `PendingQuestion` singleton (`main.mjs:132-187`) is the closest existing machinery: a single in-flight item resolvable by voice (`answer_po_question`) or UI (`window.iris.answerPoQuestion`), settle-once, timeout-to-default, cancelled on reset. **But `PendingQuestion.raise()` calls `runQueue.suspend()` and `settle()` calls `runQueue.resume()`** — correct for a PO question (the asking run holds the slot; its idle watchdog must pause) and **wrong for a parked review**, which holds no slot. The flag pattern to copy for the mode is `pipelineAvailable`: a module-level value, a getter IPC + a sidecar event, a single mutation choke point (like `setAgentModel`). Persistence goes through `writeUserConfig` into `~/.iris/.env`, whose `ALLOWED_CONFIG_KEYS` allowlist silently drops unknown keys (`main.mjs:~1012`). Reset paths that abandon a pending PO question are `createWorkstream`/`selectWorkstream`/`setWorkstreamCwd` (~`:500-580`).

This design and its decisions were reviewed by a desktop/Electron engineer; findings #1–#10 from that review are folded in below.

## Goals / Non-Goals

**Goals:**
- Zero Claude tokens on an unreviewed brief when review mode is on; byte-identical behavior when off.
- Reuse the voice/UI settle-once relay *pattern* without inheriting its slot coupling.
- Keep the queue and the resident PO session untouched — the gate is entirely pre-dispatch.

**Non-Goals:**
- Changing `run-execution-queue`, the resident PO session lifecycle, or DEV spawn.
- A per-role review flag (one shared flag — decided).
- Reading the full brief aloud (summary + on-screen — decided).

## Decisions

### D1 — Split `submitClaudeTask` into `buildRun` + `dispatch`; park between them (review #4)
`buildRun(params)` produces the `run` object from `{ task, urgency, agent }` + the resolved workstream; `dispatch(run)` does today's `runQueue.submit` + result-shaping. Auto mode calls `dispatch(buildRun(params))` inline — **byte-identical** to today. Review mode parks `{ task, urgency, agent, workstream_id }` (not a full run — no `run_id` until approve) and returns `parked_for_review`. Approve calls `dispatch(buildRun(parked))`, so the DEV no-open-change terminal rejection (raised inside `startClaudeRun`) is surfaced through the *approve* channel with the same `queued`/`started`/terminal contract, not a false "started."

### D2 — A separate `PendingReview` singleton that never touches the slot (review #1)
`PendingReview` mirrors `PendingQuestion`'s settle-once + timeout + `abandon`, but its `raise`/`settle` do **not** call `runQueue.suspend/resume`. Rationale: a parked review holds no slot; suspending the queue's idle bound would silently disable the watchdog on whatever unrelated run (typically a DEV run) currently holds the slot, for the whole review window. This is the concrete reason a *new capability* is correct rather than overloading `pendingPoQuestion`.

### D3 — Coexistence with a pending PO question: both live, PO question wins precedence (review #2)
Because the gate is pre-dispatch, a review can be parked while a PO turn is mid-`AskUserQuestion`. Both `pendingReview` and `pendingPoQuestion` may be non-null simultaneously. Resolution:
- The PO question keeps visual + voice precedence (it blocks a running, token-burning turn); the review banner stacks beneath it in both deck and HUD.
- The renderer keyboard guard becomes `if (pendingPoQuestion || pendingReview) return`.
- The system prompt names both tools distinctly so Gemini does not conflate `answer_po_question` (answers a blocking PO question) with `respond_to_task_review` (approves/cancels a parked brief).

### D4 — Approve dispatches against the parked workstream; reset-cancel is load-bearing (review #3)
`dispatch(buildRun(parked))` uses `parked.workstream_id`, never `activeWorkstream()` (which would auto-create/misroute if the user switched away). To keep the parked workstream valid, a pending review is cancelled on reset — wired into the same three functions that call `PendingQuestion.abandon`. Defense-in-depth: if the parked workstream no longer exists at approve, refuse rather than fall through to `activeWorkstream()`.

### D5 — Mode flag modeled on `pipelineAvailable`, persisted via the one env key (review #6)
Module-level `promptReviewMode`, init `envFlag("IRIS_PROMPT_REVIEW", true)`; single `setPromptReviewMode(enabled)` choke point for both the voice tool and the UI toggle; `prompt:status` getter IPC read at mount; `prompt_review_mode` sidecar on change. The toggle persists by writing `IRIS_PROMPT_REVIEW` (`0`/`1`) via `writeUserConfig` — one key is both default and override. **`IRIS_PROMPT_REVIEW` MUST be added to `ALLOWED_CONFIG_KEYS`** or the write is silently dropped. Dev-vs-packaged path is already handled by `userConfigPath()`.

### D6 — Voice-layer coherence: narrate-summary, no status query, resolve-event (review #5)
On park, Gemini speaks a 1-2 sentence summary + "full brief on screen" and waits; the `submit_claude_task` description and system prompt forbid calling `get_claude_task_status` on a parked brief (no `run_id`). On any resolution the voice layer did not initiate (UI approve/cancel, timeout), main injects `SYSTEM_EVENT_TASK_REVIEW_RESOLVED` so Gemini announces the correct outcome. (This also fixes the latent gap where a UI-answered PO question emits only the `po_question` sidecar and never notifies Gemini — the review gate establishes the resolve-event pattern.)

### D7 — Edit is deck-only; HUD is Approve/Cancel/revise-by-voice (review #7)
The HUD window is `setIgnoreMouseEvents(true, {forward})` and only becomes interactive while the pointer is over a `.hud-hit` island, which is incompatible with sustained textarea focus. So the editable textarea is deck-only; the HUD banner offers Approve / Cancel and relies on revise-by-voice (Gemini re-submits → supersede). The review banner and its controls are wrapped in `.hud-hit` and kept small so they don't blanket the click-through overlay.

### D8 — Keep the voice mode-toggle tool despite its per-connect prompt cost (review #10, decision 7)
`set_prompt_review_mode` is a permanently-declared gated tool, adding a little per-session prompt overhead for a rarely-flipped toggle. The user explicitly chose voice + UI for the toggle (hands-free/HUD priority), so it stays. Considered and rejected: UI-only toggle (would strand HUD users who have no keyboard-free way to flip modes). The `IRIS_PROMPT_REVIEW=0` rollback is documented in `.env.example`.

## Risks / Trade-offs

- **Default-on changes upgrade behavior** (auto→gated) for existing users. Intended; `IRIS_PROMPT_REVIEW=0` restores auto and is documented.
- **Reset-during-approve**: if approve already dispatched, the run exists and reset does not stop in-flight runs (existing behavior for any run); the gate widens the window slightly — documented, not new.
- **Editable brief to a `bypassPermissions` agent** adds no privilege (the user can already submit arbitrary briefs by voice); hygiene only — validate `editedTask` is non-empty trimmed (reuse the `!task.trim()` guard on the approve path), cap length, and do not log it (may contain pasted secrets) (review #9).
- **Concurrency** (review #8): Node's single thread + `settle()`'s `if (!current) return` + `clearTimeout` make voice/UI simultaneous approve, timeout-vs-supersede, and double-settle safe; the review's timeout timer is `unref`'d.

## Verification / Coverage

The gate spans `main.mjs` (out of the Vitest harness) and the renderer (R3F/DOM, out of harness), so verification is manual: (1) review-on, submit by voice → nothing runs, banner + spoken summary, Approve → run starts; (2) Edit in deck then Approve dispatches edited text; (3) Cancel and timeout never send; (4) park a PO review while a DEV run is active → DEV keeps slot and watchdog; (5) approve after switching workstream is prevented by reset-cancel; (6) a PO question and a parked review coexist with PO precedence; (7) `IRIS_PROMPT_REVIEW=0` reproduces today's auto behavior byte-for-byte; (8) toggle persists across restart; (9) `npm run build` and `npm run package:mac` load the banner/toggle. Pure helpers extracted where practical (e.g. an `editedTask` validator) get a unit test.
