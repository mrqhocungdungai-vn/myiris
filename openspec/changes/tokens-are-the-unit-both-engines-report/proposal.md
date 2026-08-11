## Why

Iris runs two paid models and keeps no account of what either one consumes.

The Claude side is half-wired. `runUsageFrom` (`electron/claude-stream.mjs:88`)
already lifts `usage` and `modelUsage` off every terminal result, `toUpdateEvent`
already carries them to the renderer on every `claude_task_update`, and then
`src/lib/tasks.ts:132` throws all of it away except `cost_usd` and `num_turns`.
The token figures travel the whole pipeline and are discarded at the last step.

The Gemini side is not wired at all. `LiveServerMessage.usageMetadata` —
`promptTokenCount`, `responseTokenCount`, `thoughtsTokenCount`,
`totalTokenCount`, plus a per-modality breakdown — arrives on the live socket
every session, and `electron/live-messages.mjs` contains not one reference to
it. The engine that runs continuously, all day, on audio in both directions, is
the one nothing counts.

**Tokens rather than cost, and not merely as a preference.** Gemini Live reports
tokens and never a price. Showing a dollar figure for it would mean Iris holding
a price table and multiplying — an estimate, which this repo already forbids in
as many words ("Cost is recorded from the runtime, never estimated"), and one
that would go quietly wrong the next time Google repriced. Tokens are the only
unit *both* engines actually report. Cost stays exactly where a runtime hands it
over: the per-run figure on the work card, untouched by this change.

**And in the camera frame, beside CPU and GPU**, because that panel is already
the app's instrument surface: it reports what the machine is spending, measured
and unembellished, and what the models are spending belongs in the same reading.
A second dial somewhere else in the UI would be a second answer to "what is this
costing me".

The camera frame also already carries the distinction this feature needs. The
capability divides its two instruments explicitly — *"the ring is the alerting
instrument and the panel is the reporting one"* — so a running total belongs to
the panel, and **a unit of work finishing is an event, which belongs to the
ring.** Both halves of the reading follow from a division the spec already made.

## What Changes

- **A new capability counts both engines' tokens, separately.** Gemini's
  `usageMetadata` is read where it already arrives; Claude's per-run usage is
  recorded once per run at the queue's existing `onFinalized` seam. Neither
  figure is derived, scaled, or summed into the other.
- **The eye readout panel gains a token block**: one row per engine showing the
  session total and what the most recent call added, plus Claude's cache-read
  figure on its own line. Labelled as the app's spend, distinct from the host
  rows above it.
- **A finished run announces itself beside the ring eye.** A connector draws
  outward from that eye, a badge unfolds at its end carrying what that run
  consumed, it holds, and both resolve away — around three and a half seconds,
  then nothing. It reuses the arrival the tether and panel already stage, so no
  element of the ring itself changes and the ring's own lock beat keeps its single
  meaning.
- **The alert fires for a completed run and for nothing else.** The voice engine
  reports usage several times a second with no unit boundary that would not be
  invented, and its figure is already on the panel continuously; flashing it
  would be a strobe beside the user's face. One alert at a time, newest wins, and
  a run that finished while nothing was rendering is not announced afterwards —
  an alert is a notification, not a record.
- **Counting is not gated on the camera; only the display is.** Host probes are
  camera-gated because sampling costs CPU. Reading a number out of a message the
  app already received costs nothing, and a counter that only starts when the
  camera comes on would under-report every session and read as broken.
- **A cumulative counter is treated as one.** The displayed total never
  decreases, including across a Live reconnect, and a Gemini usage report is
  never double-counted regardless of whether the API's figure is per-message or
  session-cumulative.
- **Nothing downstream reads the counts** — no prompt, no verb, no spoken
  answer, no note. The diagnostic log records them, because the panel exists
  only while the camera is on and otherwise a session's consumption would be
  unrecoverable after the fact.
- One panel meter is retired to pay for the new rows. The GPU meter duplicates
  the GPU percentage directly above it; the log-scaled network meter, which
  spans decades a rate row cannot show at a glance, stays.

## Capabilities

### New Capabilities

- `token-accounting`: the app keeps an account, per app session, of the tokens
  each engine reports consuming, from what the engine itself reports and never
  from an estimate; the two accounts stay separate; the account is independent of
  whether anything is displaying it; and nothing in the app acts on it.

### Modified Capabilities

- `eye-tracking-hud`: the readout panel reports the host **and** the app's token
  consumption, each labelled as which it is. Three of its rules gain the counter
  case: what the panel's header declares, what "absent, never zero" means for a
  count of zero (a real value, unlike an unavailable measurement), and that the
  camera gate governs host measurement rather than everything the panel shows. A
  counter steps and never eases, and never wears the panel's warning accent.
  The ring's eye gains a **transient** announcement when a unit of work
  completes — bounded, self-dismissing, tracking its eye while visible, and
  explicitly not a second panel: the rule fixing one persistent element per eye
  is restated so a momentary alert cannot be read as breaking it, and cannot
  drift into a second continuous readout.

## Impact

**New**: `electron/token-ledger.mjs` (the pure accumulator),
`electron/capabilities/token-usage.mjs` (lifecycle and the renderer channel),
`src/hooks/useTokenLedger.ts`, `src/components/EyeTokenAlert.tsx` (the badge).

**Modified**: `electron/live-messages.mjs` (one branch, above the
`serverContent` early return), `electron/wiring.mjs` (`onFinalized`),
`electron/wiring-capabilities.mjs` + `electron/wiring-live.mjs` (construction and
one injected recorder), `electron/preload.cjs` + `src/vite-env.d.ts` (the
channel), `src/components/EyeReadout.tsx`, `src/components/EyeReticle.tsx` (the
connector and the alert's per-frame layout), `src/lib/telemetry-format.ts`,
`src/lib/eye-hud.ts` (the height budget, the alert geometry and its envelope),
`src/styles/claude.css`, `src/App.tsx`.

**Unchanged**: the work card's cost figure and `formatCost` — a runtime-reported
price stays where it is. `run-budget`'s ceilings, which remain the only
mechanism that acts on spend. Every host-telemetry path: `system-telemetry.mjs`,
`hud-telemetry.mjs`, and the sample channel are not touched, and the rule that
nothing outside the overlays reads a host measurement is unaffected. Every
element of the ring: its rotation rules, its graduated dial, its acquire
convergence and its lock beat are untouched, which is what keeps that beat
meaning exactly one thing.
