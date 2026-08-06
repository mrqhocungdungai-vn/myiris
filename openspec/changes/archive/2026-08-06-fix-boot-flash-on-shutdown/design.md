## Context

See proposal.md — Why, for the defect and its two manifestations.

Two facts about the current renderer shape the approach:

- `BootSequence` is purely `visible`-driven (`src/components/BootSequence.tsx:13`).
  It has no minimum hold and no self-dismissal; it mounts and unmounts exactly with
  the prop. So *when the intro is on screen* is decided entirely by the caller.
- `booting` is a derived expression, not state. Everything downstream — the
  `<BootSequence>` mount at `src/App.tsx:1856` and the boot-done edge effect at
  `src/App.tsx:829-835` — reads that one expression, which is why a single wrong
  derivation produces both symptoms at once.

`sidecarRunning` and `geminiStatus` arrive as separate IPC messages
(`src/App.tsx:1024-1033`), so the renderer sees intermediate combinations of the two.
Any predicate over both will observe states that no single main-process moment
intended.

## Goals / Non-Goals

**Goals:**

- Make intro visibility depend on an *event* (the session started) rather than on a
  *combination of states*, so intermediate IPC orderings become unobservable.
- Keep the fix inside the renderer.

**Non-Goals:**

- No minimum hold time for the intro. Gemini connects fast, so a genuine start can
  still show a brief intro — that is today's behavior and this change preserves it
  rather than redesigning the intro's timing. If it should read as a deliberate
  animation, that is its own change.
- No change to `GreetGate`, to the `iris:boot-done` channel, or to the emit order in
  `live-session.mjs`.

## Decisions

**Edge-triggered state in the renderer, not a repaired predicate.**

The intro becomes state set on the rising edge of `sidecarRunning` (tracked with a
ref holding its previous value) and cleared when the session reports `connected`.
The start edge is a real event with exactly one occurrence per start; no ordering of
`gemini_status` relative to `sidecar_status` can manufacture one.

*Alternative — keep `booting` derived, but also require a "was not running" guard
inline.* Rejected: it re-derives an event from states at every render and stays
sensitive to whatever signals get added later. The bug is that a start was inferred
rather than observed; inferring it more carefully leaves the same class of defect
open.

*Alternative — fix the emit ordering in `live-session.mjs` so `sidecar_status`
precedes `gemini_status` on stop.* Rejected on two counts. It does not touch the
reconnect case at all — `scheduleReconnect` correctly does not emit `sidecar_status`,
because the session really is still running — and that is the more visible symptom.
And it would make renderer correctness depend on main emitting two independent facts
in a particular order, which is a constraint no spec states and nothing enforces.

**The decision itself lives in `src/lib/`, not inside the component.**

The repo's testability convention is that pure logic goes to `src/lib/*.ts` with a
colocated test rather than being exercised through the UI (docs/TESTING.md —
Conventions; the `src` vitest project runs in the `node` environment with no DOM and
no React testing library, so a component-mounting test is not an available option).

So the transition rule becomes a pure reducer in `src/lib/boot-gate.ts` — previous
running flag plus the incoming `(running, connected)` pair in, `{ introVisible,
reportBootDone }` out — sitting alongside the existing `wake-gate.ts`, which solves
the structurally identical problem for wake-word firing. `App.tsx` keeps only the
ref and the call. Every scenario in the delta spec is then a table row in
`boot-gate.test.ts`, including the IPC orderings that are awkward to stage in a live
app.

**Skip the intro when a start comes up already connected.**

Checked at the start edge. Without it, an instant resume mounts the intro and
unmounts it a frame later, which is a flicker rather than an intro. This is the one
behavior addition beyond the bug fix, and it exists because the edge-triggered model
makes "started" and "needs covering" two separate questions for the first time.

**Boot-done follows the intro, not the predicate.**

`iris:boot-done` fires on the falling edge of *the intro having been shown*. An
intro that never played has no completion to report, which is what keeps shutdown
and reconnect from releasing the greeting gate.

## Risks / Trade-offs

- **A start edge that the renderer never observes leaves the intro unplayed** →
  Cosmetic only, and strictly better than the current failure. `GreetGate` already
  carries an 8-second fallback timer (`electron/live-session.mjs:146`), so the
  greeting is not gated on the intro being seen.
- **The renderer now holds boot state across renders rather than deriving it** →
  Slightly more state to reason about; contained to two values in `App.tsx`, and
  covered by the tests this change adds.
- **A start that is already connected shows nothing where it previously showed a
  flicker** → Intended; recorded here because it is a visible difference on fast
  resumes, not a pure bug fix.
