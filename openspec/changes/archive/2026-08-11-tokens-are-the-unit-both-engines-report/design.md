# Design

## D1 — Tokens, not cost, is forced by what the engines report

Claude reports both a token breakdown and `total_cost_usd`. Gemini Live reports
tokens only: `UsageMetadata` carries `promptTokenCount`, `responseTokenCount`,
`thoughtsTokenCount`, `toolUsePromptTokenCount`, `totalTokenCount` and modality
breakdowns, and no price field of any kind.

So a single common unit across both engines can only be tokens. Cost as the
common unit would require a Gemini price table inside Iris, multiplied per
modality (audio in, audio out, and text are priced differently), maintained
against Google's pricing page. That is an estimate, and the repo's standing
convention is explicit: *cost is recorded from the runtime, never estimated.*

Consequence, stated so nobody "fixes" it later: **the work card keeps showing
dollars** (`src/lib/tasks.ts:142` `formatCost`). That figure comes from the
runtime and is correct. This change adds a second, different reading — volume,
live, both engines — and does not replace it.

## D2 — Two accounts, never one number

`GEM 412k` and `CLD 1.8M` are not addable. They are different models at
different prices per token, and Gemini's figure is dominated by audio frames
while Claude's is dominated by file contents. A combined "tokens used" would be
a number whose movement tells the user nothing about anything they could act on.

Two rows, each labelled with its engine. If a total is ever wanted, it belongs
in the diagnostic log, not on a four-word-wide panel row.

## D3 — The Gemini counter must be correct under both regimes

The Live API's `usageMetadata` is documented as "usage metadata about model
response(s)" and does not state whether `totalTokenCount` is per-message or
cumulative for the session. Observed behaviour also differs across model
versions, and this repo pins one model (`docs/REFERENCE.md`) but must not break
when that pin moves.

So the accumulator does not assume. Per session it keeps `lastTotal` and a
`carried` base:

- a reading `>= lastTotal` is treated as **cumulative**: session total becomes
  `carried + reading`, `lastTotal = reading`.
- a reading `< lastTotal` means the counter restarted or the figures are
  **per-message**: `carried += lastTotal`, then the reading becomes the new
  `lastTotal` and the total becomes `carried + reading`.

Both regimes come out right, and the total is monotone by construction. A Live
reconnect (new socket, counter back to zero) hits the same restart path — which
is the case that matters most, because Live sessions rotate on a connection
lifetime limit during ordinary use and a total that dropped to zero mid-
conversation would read as a bug in the panel rather than as a new socket.

Reconnect is not signalled by a dedicated hook here; the restart detection
above covers it without one, so no new coupling to `live-session.mjs`'s
reconnect path is introduced.

**One account, no exceptions.** `electron/user-config.mjs:435` opens a second,
short-lived Live session to preview a voice. It spends real tokens, so it is
counted through the same recorder. A capability that quietly excludes one caller
is a capability whose number cannot be trusted.

## D4 — Claude is counted once per run, at `onFinalized`

`run.usage` is assigned at two places — `run-stream.mjs:403` (one-shot verbs)
and `run-exec.mjs:909` (the resident PO session). Hooking both invites
divergence, and hooking `toUpdateEvent` would double-count, since that
projection re-emits `run.usage` on every subsequent event.

`runQueue`'s `onFinalized` (`run-queue.mjs:372`, wired at `wiring.mjs:122`) is
already documented as firing **once per run, after a terminal update**, and by
then `run.usage` is set on both paths. It is already where "every finished run
is recorded in the second brain" happens, for the same once-per-run reason.

Recorded **whatever the terminal status is** — `limited`, `unanswered` and
`failed` runs spent tokens too, and a ledger that only counts successes
understates exactly the runs a user most wants to see. The ledger is still
idempotent by `run_id` so a future second caller cannot double-count.

A run cancelled while queued never started and has no usage; `onFinalized` is
already gated against it upstream.

## D5 — Cache-read is its own figure

Claude's usage carries four counts: `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`. Cache reads routinely
exceed the rest by an order of magnitude while costing about a tenth per token.

Headline = `input + output + cache_creation`. Cache read = its own line, marked
`↺`. Folding them together would make the number grow roughly ten times faster
than consumption actually rises, which defeats the reason tokens were chosen
over dollars in the first place: that the figure should track reality.

Field names are read defensively — the SDK's result `usage` is a passthrough of
the API shape, and a missing key contributes zero rather than `NaN`.

## D6 — Counting is never gated; display is

`eye-tracking-hud` gates host sampling on the camera because each probe spawns a
subprocess. That reasoning does not transfer: the token figures arrive inside
messages the app has already received and parsed, so counting them costs a
field read and an addition.

- **Counting**: from app start, unconditionally, in the main process.
- **Emitting to the renderer**: only while something is subscribed, throttled
  through `createTrailingThrottle` (`electron/coalesce.mjs`) so a burst of Live
  messages cannot turn into a burst of IPC.
- **On subscribe**: an immediate snapshot, so a panel opened after an hour of
  conversation shows the hour, not a fresh zero.

The snapshot is what makes the gate harmless, and it is why the channel is a
`handle` (snapshot) plus an `on` (push) rather than push alone.

Per app session, not persisted. A restart is a new account. Persisting would
create a durable record of usage on disk that nothing in the app needs, and
would raise a "since when?" question the panel has no room to answer.

## D7 — A counter is a third kind of row

`EyeReadout.tsx` has a taxonomy that carries real meaning: a **level** eases
between samples (the machine genuinely passed through the intermediate values);
a **rate** steps (a value between two window-averages is the average of
nothing).

A cumulative counter is a third kind. It **steps**, and it never decreases.
Easing it would draw counts that were never reached, and — worse — an ease
toward a lower value would render a decrease that cannot happen. It also never
wears the panel's warning accent: the accent marks a host load condition, and
there is no threshold at which a token count is a warning. Spend ceilings are
already enforced by `run-budget` and reported as the `limited` status; a
decorative panel must not imply a second, softer version of that.

Staleness is per source. The host rows go absent when the sampler stops
(`STALE_MS`); the token rows do not, because they arrive on a different channel
whose silence means "nothing has been spent since", not "the reading is stale".

Formatting: `412k`, `1.8M`, tabular figures, fixed width — the panel's
no-reflow rule already applies and a counter crossing a magnitude must not
change the row's width.

## D8 — The layout budget, and what pays for it

`src/lib/eye-hud.ts` carries the measured arithmetic: at `height: 0.62` the box
is 15.0em holding 13.83em of content, leaving 1.16em of slack, and it states
that **any new row costs ~1.56em and must be paid for there**.

The token block is a rule, two engine rows and a smaller cache line — about
4.5em. The slack covers a quarter of it. Payment:

- **Retire the GPU meter** (+1.56em). It is a segmented bar restating the GPU
  percentage printed directly above it. The network meter stays: it is log-scaled
  across decades, which is a reading the two rate rows genuinely do not give at a
  glance. The spec requires *a* graduated segmented meter, singular — one still
  satisfies it.
- **Raise `height` to ≈0.70** for the remainder.

That estimate is not to be trusted over a measurement. The file says how:
sum the children, not the last child's offset, and check it in the **deck** dock
(~256px frame) where the font is in its fluid band — never the HUD's larger
frame, which clamps at the 10px ceiling and hides the overflow.

Cost of a taller panel, named: `anchorY` is clamped to
`[height/2, 1 - height/2]`, so vertical travel shrinks from ±0.19 to ±0.15 of
the frame. The panel tracks its eye slightly less far. Accepted — the panel has
been clamped since it was built, and the alternative (a token block somewhere
outside the camera frame) is a second answer to one question.

Rejected: rendering the cache figure as a third column on the Claude row. The
panel is 0.3 frame widths — about 13 characters at deck scale — and
`CLD 1.8M ↺312k +47k` does not fit without shrinking the font below the
panel's floor.

Rejected: turning the retired meter into a "token meter". A meter needs a
ceiling and a cumulative counter has none; a log-scaled last-call size would be
an invented quantity dressed as a measurement.

## D9 — Nothing downstream acts on the counts

Same rule as host telemetry, for a sharper reason. If the counts reach a prompt,
the model can see its own consumption, and a model that can see its budget
starts reasoning about it — trimming work, or explaining its spending, neither
of which was asked for. The authoritative mechanism already exists and is
enforced in configuration rather than by instruction: `run-budget`'s turn and
spend ceilings, and the `limited` terminal status.

So: no prompt fragment, no tool declaration, no verb parameter, no spoken
answer, no note, no session store.

**One exception, deliberate:** the diagnostic log
(`~/.myiris/logs/iris.log`). One line per counted Claude run and one per Live
session close. The panel exists only while the camera is on, so without this a
session's consumption is unrecoverable the moment the window closes — and the
log is documented as the place an investigation goes. This is not a channel
anything reads programmatically.

## D10 — In-flight Claude growth is not shown

A long run would sit still for minutes before its number jumps. The only source
for mid-run growth is
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, already read by
`run-hooks.mjs:80` for the budget ceiling. Adding a second consumer of an API
whose own name says not to rely on it — to animate a decorative row — is the
wrong trade: if it changes shape, the ceiling matters and the panel does not.

The panel is not static in the meantime: Gemini's counter climbs continuously
during any conversation, because audio is billed by the second.

## D11 — The event belongs to the ring; the total belongs to the panel

The capability already divides its two instruments, in the requirement that
governs the ring's dial: *"the ring is this capability's **alerting** instrument
and the panel its reporting one"*. A running total is a report. A unit of work
finishing is an event. So the total goes on the panel and the event goes to the
ring's eye, and no new principle is needed to place either.

**Only a completed run fires an alert.** The voice engine's usage arrives on the
Live socket several times a second while anyone is talking. There is no unit
boundary in that stream that would not be invented — a turn is arbitrary for this
purpose, and a fixed interval is a timer pretending to be an event. Flashing on
it would put a strobe beside the user's face, and its figure is already on the
panel continuously, which is the reading that suits a quantity that never stops
growing.

A run is the opposite shape: discrete, infrequent, and something the user asked
for and is waiting on. "What did that just cost" is exactly the question a
notification answers.

## D12 — The alert arrives as a connector and a badge, and the ring does not change

The tempting implementation is to flash the ring — intensify the crosshair, pulse
the core. **That would break a signal that already means something.** The
capability requires a settling beat marking that a newly acquired eye is held
("Acquisition resolves into a lock"), drawn with exactly those elements. Reusing
them for a token event makes one visual mean two things, and the user cannot tell
"I have been locked onto" from "a run finished".

So the alert borrows the *other* established arrival instead: the tether's
staged reveal. An SVG connector is drawn outward from the ring eye —
`pathLength="1"` plus a `stroke-dashoffset`, the same trick with no length
measurement anywhere — and the badge unfolds at its far end. That idiom is
already in the file, already spec'd, and touches nothing the ring owns. Every
ring rule stays true by construction: adjacent counter-rotation, pairwise
non-harmonic periods, one static reference element, the dial static and driven by
a measurement, and the lock beat still meaning precisely one thing.

Split by material, exactly as the panel already is: the **connector is SVG**
(strokes, in the viewBox the tether already lives in) and the **badge is HTML**
(it renders a number, and SVG `<text>` gives no tabular figures, letter-spacing
or real font metrics — design D10's original reasoning, unchanged).

## D13 — The envelope is driven by the frame loop, never by CSS

`EyeReticle.tsx:113-116` records the trap in as many words: a CSS transition or
`@keyframes` on a transform this loop rewrites *is cancelled by the next frame's
write*. The accent arc's pivot is the second instance of the same class of bug.
The alert's transform is rewritten every frame to track the eye, so its reveal,
hold and fade cannot live in CSS either.

They live where the ring's convergence and lock beat already live: pure functions
of elapsed time in `src/lib/eye-hud.ts`, beside `acquireScale`, `lockSettle` and
`panelReveal`, each with a test. Roughly 5s end to end — connector ~250ms, badge
unfold ~350ms, hold ~3.4s, resolve ~1s — and the exact numbers are tunable in one
place because they are constants in that file rather than durations spread across
a stylesheet. The hold started at 1.9s and was raised after the first run in the
app: the badge exists to be read, and the honest lever is a longer hold rather
than a bigger font, which would put it in competition with the panel.

The **figure itself never animates**. No count-up, no rolling digits. It is a
measured amount, and animating it would draw values that were never reported —
the same rule D7 applies to the panel's counters, and the reason the badge holds
still while only its container's opacity and offset move.

## D14 — One slot, newest wins, nothing replayed

At most one alert exists. A second run finishing while one is showing **replaces**
it and restarts the envelope. A queue would leave a figure on screen after the
panel's total had already moved past it, which is a readout disagreeing with
itself.

Nothing is lost by replacing: the panel's total is the authority and is already
correct, and the diagnostic log has the per-run line (D9).

**No replay.** A run that finished while the camera was off, or while no face was
detected, is not announced when the overlay next appears. An alert is a
notification, not a record; announcing an hour-old run as news is worse than not
announcing it.

That has a concrete consequence in the renderer, and it is the easiest thing here
to get wrong: the hook receives a **snapshot on subscribe** (D6), carrying the
`at` of whatever ran last. It must treat that first snapshot's timestamp as
**already seen**. Without that, turning the camera on flashes the last run from
an hour ago, every time.

## D15 — Placement mirrors the panel, including the clipping

The badge sits **outward** from the ring eye — toward the frame's right, since the
ring is fixed to the eye appearing on the right — mirroring the panel's outward
rule on the left. The two instruments therefore stay in their own halves of the
frame and cannot collide, whatever the head does.

Never over the eye, on the same terms as the panel. And **clipped** at the frame
edge rather than relocated, for the reason already recorded for the panel: a
badge that flips to the other side mid-appearance reads as broken, and relocation
while the user turns their head is worse than truncation. The ring eye is on the
right half by construction, so this case is rarer for the badge than for the
panel.

## Risks

- **The Live counter's regime could be neither cumulative nor per-message** —
  e.g. resetting per turn while also being cumulative within one. D3's rule
  still produces a monotone total, but it would over-count. Task 1.4 logs raw
  `usageMetadata` at debug level for one real session and checks the shape
  before the display is trusted.
- **Layout overflow is silent.** `overflow: hidden` on the panel means a
  mis-measured height clips the foot rather than reporting anything. This is
  exactly how the panel came to be overflowing "since it was built". Task 4.5 is
  a measurement in the deck dock, not an eyeball.
- **`sdk-options.test.mjs` asserts complete option key sets.** This change adds
  no SDK option, so it should stay green; if it does not, something was wired
  through the run options that should not have been.
- **Reduced motion is not honoured, and that is a standing condition rather than
  a decision made here.** `src/styles/claude.css` has no
  `prefers-reduced-motion` block at all, unlike `base.css`, `fx.css`,
  `deck.css`, `overlays.css` and `hud.css` — the eye HUD's scan band, ring
  rotations and lock beat all animate unconditionally today. The alert adds one
  more transient to that set and does not change the policy. A reduced-motion
  policy for this HUD is worth its own change, and is named here so its absence
  reads as known rather than overlooked.
- **The alert is one more thing competing for the frame.** It appears beside a
  face on a small preview, and the deck's dock is ~256px. If it reads as clutter
  in the running app, the tunable is one place (D13's constants) and the honest
  fix is a shorter hold rather than a smaller font — the badge exists to be read.
