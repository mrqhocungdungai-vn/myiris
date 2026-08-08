## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The spec anticipated this change by name.** `eye-tracking-hud`'s panel
  requirement ends "unless and until a future change explicitly wires it to one",
  so the delta is a rewrite of an existing requirement rather than an argument
  for a new capability.
- **The panel's box is fixed and nearly full.** `READOUT_GEOMETRY.height` is
  `0.52` of the frame, applied as an inline percentage in `EyeReadout.tsx`; the
  CSS carries no height at all. In the deck's camera dock the font-size is in the
  fluid band of `clamp(6.5px, 3.1cqw, 10px)`, so the panel is a constant
  **12.58em** tall and its current content measures **12.41em**. Everything this
  change adds has to be paid for.
- **The renderer cannot read the host.** `contextIsolation` is on and there is no
  node integration, so every number here has to come from the main process.
- **Electron access is confined to four modules**, machine-enforced by
  `electron-graph.supply.test.mjs`'s exact-set assertion. Anything new is
  Electron-free by construction or the graph test fails.
- **The child-process seam already exists.** `pipeline-probes.mjs` takes
  `execFileImpl` as a defaulted injected parameter, wraps callback `execFile` in
  a hand-rolled promise, and never rejects. Copying it costs nothing and buys the
  whole test surface.
- **Capability channels register by iteration.** `ipc.mjs` loops
  `cap.ipcHandlers`, and `ipc.test.mjs` pins the *core* channel sets with
  `toEqual`. A capability adds channels without touching either file.
- **The panel is HTML, not SVG, on purpose.** Its own header comment says its
  layout depends on real font metrics, letter-spacing and tabular figures. Any
  new element inherits that reasoning.
- **`main-thread-budget` forbids per-frame allocation** on the renderer's hot
  paths, and the readout's rAF loop is one.

## Goals / Non-Goals

**Goals**

- The four rows report the real host, and the header says so.
- A measurement that cannot be taken is visibly absent, never `0`.
- The panel reacts to real load — visibly, and for a real cause.
- The panel gains a time axis.
- Sampling costs demonstrably less than the thing it measures, and stops when
  the readout cannot be seen.
- Every value keeps a constant rendered width across its whole range.

**Non-Goals**

- Elevated privileges, for any measurement, ever.
- Any consumer of this data other than the two overlay components. Not the voice
  layer, not a verb, not disk.
- Making the readout load-bearing. It stays decorative; that is what keeps
  clipping acceptable.
- Cross-platform parity. macOS is the platform; a non-macOS host degrades to
  processor-only rather than acquiring a second code path worth maintaining.

## Decisions

### D1 — A capability module, not a core module

`electron/capabilities/hud-telemetry.mjs`, registered in
`wiring-capabilities.mjs`.

This is the first capability with no tool declaration and no prompt fragment,
which is the obvious objection. It is not decisive. The capability contract
states outright that every field is optional and a capability with nothing to say
for a field omits it; `ipc.test.mjs` already carries a test named "tolerates a
capability with no ipcHandlers field", so the tier is built for partial
contributors. And the repo's capability tier is organized by **spec capability** —
`canvas.mjs` serves `hud-drawing-canvas`, `second-brain.mjs` serves
`personal-knowledge-notes` and its neighbours. This module serves exactly one:
`eye-tracking-hud`, end to end, consumed by no other main-process module.

What it buys, concretely: `ipc.mjs`, `ipc.test.mjs`, `main.mjs` and `wiring.mjs`
are all untouched, and no dependency is threaded anywhere new — `emitToRenderer`
and `getMainWindow` are already parameters of `createCapabilitiesWiring`. The
core-module alternative costs edits to four files including the `toEqual`-pinned
channel test, in exchange for nothing.

### D2 — The sampler is a second module, below the capability

`electron/system-telemetry.mjs` holds the probes, the parsers and the delta
bookkeeping; the capability holds the lifecycle and the IPC surface.

`pipeline-probes.mjs` is the precedent: child-process probing lives in its own
Electron-free module with an injected `execFileImpl`, and it is not a capability.
One module would still be under the size ceiling, so the reason is the test seam
— the parsers can be driven with captured fixture strings and no emit plumbing at
all, and the parsers are where this change's real defects live (D4).

### D3 — One sample per second, and the cost is recorded, not assumed

Measured on the development machine: the graphics probe is 0.03s of CPU per
call, the network probe 0.01s. At 1 Hz that is **~0.04s/s ≈ 0.35% of one machine
with twelve cores**, with the two probes run concurrently.

500 ms was rejected on its own terms rather than on general caution: at that rate
the sampler starts visibly moving the very number it displays. A telemetry
readout that measures its own overhead is worse than one that is slightly slow,
and the failure is invisible — the number is *correct*, it is just partly about
the panel. Utilization windows below ~500 ms are mostly noise anyway.

Reductions considered and rejected: one shell invocation running both commands is
*three* processes, not one; staggering the graphics probe to alternate ticks
saves ~1.5% of one core and costs a partially-fresh sample shape in the one place
the interpolation has to reason about arrival cadence; a native binding's build
and notarization cost vastly exceeds 40 ms/s. The real mitigations are structural
and are already in the design — camera-gating (D6) and the sticky disable (D5).

This number belongs on the record because the temptation to "improve" the readout
by sampling faster is real, will look like a pure win, and is the one change that
turns a decoration into a drag. The delta spec carries it as a requirement.

### D4 — The two parsers are the change's real defect surface, so both traps are
fixtures

Neither is a hypothetical. Both were confirmed against real output on the
development machine before any code was written.

**The graphics counter carries a decoy.** The same one-line statistics
dictionary that holds `"Device Utilization %"=9` also holds
`"Device Utilization % at cur p-state"=30` — and the decoy appears **first**. A
pattern that omits the closing quote matches the decoy and reports roughly triple,
silently and plausibly. The fixture is the captured dictionary, decoy included,
and the assertion is that the parser returns `9`.

Where several devices report — an integrated and a discrete GPU — the parser
takes the **maximum**. For a single "how busy is the graphics hardware" number,
averaging against a present-but-idle device understates it.

**The network counter's rows vary in width.** The authoritative per-interface
rows have **ten or eleven** whitespace-separated fields depending on whether the
address column is present, which it is not for down or virtual interfaces. Only
the trailing seven fields can be indexed. The fixture holds both widths.

Interfaces are filtered to the authoritative rows only — the address rows repeat
the same counters — and loopback and tunnel interfaces are excluded, because a
tunnel carries the same bytes as the physical interface it rides on and would
double-count under a VPN. That exclusion is a heuristic and is commented as one:
the readout is atmospheric, and an exotic interface set over-counting is not
worth more machinery.

### D5 — `null` is the single absence signal, and a missing graphics counter is
sticky

Every reason a value can be missing — no delta yet, probe failed, probe timed
out, no counter on this host, not macOS — resolves to the same `null`. One rule
at the renderer instead of four, and one requirement in the spec instead of a
list of cases.

After three consecutive ticks with no graphics counter, the probe is disabled for
the session. A host without that counter will not grow one, and paying 30 ms a
second forever to receive a guaranteed `null` is the wrong trade. The cost is
that a graphics device attached mid-session is not noticed until the next
activation, which is the camera being toggled — acceptable for a decoration.

### D6 — The gate is the camera, not the face

Sampling starts when gesture control turns on and stops when it turns off, on the
`secondbrain:activate`/`deactivate` precedent, whose recorded rationale is the
same one: an always-on watcher feeding a view that is off by default is the wrong
default.

Gating on *face presence* was rejected. Presence flickers frame to frame by
design — the tracker publishes a presence transition whenever both irises fail to
resolve — so it would thrash start/stop and pay the priming interval on every
re-acquire. The camera being on is the stable gate, it is the gate the eye
tracker itself already uses, and `eye-tracking-hud` already forbids a separate
switch.

Three guards make the lifecycle safe rather than merely tidy: an in-flight flag
that **skips** an overlapping tick rather than queueing it (rates are computed
from real elapsed timestamps, so a skipped tick self-corrects at the next one);
a generation counter, on `vault-graph.mjs`'s precedent, so a probe still in
flight when the sampler stops can never emit into it; and a baseline reset on
every start, so the first delta after a pause is not a ten-minute average
presented as a one-second rate.

That reset means the first tick after activation reports absence for everything
derived from a delta. That is the honest answer, and it lands in the same moment
as the ring's convergence animation, so it reads as acquisition rather than as
failure.

### D7 — The subscription lives at App level, not in the panel

`EyeReadout` mounts in **both** camera surfaces and returns null on every face
loss. Subscribing inside it would open two subscriptions, send two
activate/deactivate pairs, and thrash the sampler on every blink. The hook is
called once beside `useEyeTracking` — which is at App level for exactly this
reason, already recorded there — and the ref is threaded down the path `eyeRef`
already takes.

The hook publishes **no React state at all**. `useEyeTracking` calls `setState`
on presence transitions because the tree branches on presence; nothing branches
on telemetry, so there is no state and therefore no re-render. Both mounted
panels read the same ref; the App-level hook is the single writer.

### D8 — Percentages ease, rates step

The asymmetry is the design, not an inconsistency.

A utilization is a **level** — a continuously varying physical quantity sampled
at 1 Hz. Interpolating between two samples displays values the machine genuinely
passed through, which is what every system monitor's line graph does.

A byte rate is an **integral over the sample window**: bytes in the last second,
divided by one second. A value between two window-averages is the average of
nothing. And because rates span six orders of magnitude, easing one renders
fictional intermediate *magnitudes* — a figure sliding down through the megabytes
on its way to zero when no such traffic ever existed. That is a stronger lie than
a value that simply steps.

Three rules follow, and they are in the delta spec because they are the honesty
of the feature rather than an implementation detail: no synthetic jitter is ever
added; an absent value **freezes** rather than decaying toward zero, because
decaying asserts `0%`, which is a claim about a signal that is not there; and a
value returning from absence **snaps** rather than easing, because easing from a
figure that predates the gap draws a ramp through numbers that were never
measured.

Nothing that decides *state* is ever read from an eased value — the load band,
the sample beat, the history strip and the peak markers all read the raw sample.
An eased value crawling across a threshold would strobe the accent.

### D9 — Displayed motion comes from write-on-change, not from a tick

The 130 ms churn tick is deleted rather than retimed. Per frame the eased value
is advanced, rounded, and compared against the integer already rendered; the DOM
is written only when it differs.

This removes the change's most visible tell at the source. Six elements flashing
on one shared interval is what "a single timer drives a fake" looks like, and it
is what the panel does today. Under write-on-change each row's digits change when
*its own* value crosses an integer. Giving the two utilizations different time
constants finishes the job for free: they arrive in the same packet and still
never update on the same frame.

The allocation rule that keeps this inside `main-thread-budget` is that the
formatter is called **only inside the on-change branch** — the integer comparison
allocates nothing, so a steady-state frame allocates nothing.

### D10 — A single load ladder with hysteresis and a dwell, driving three things

One pure function over the higher of the two utilizations, with separate rise and
fall thresholds and a minimum time in band. A 1 Hz sample train sitting on a bare
threshold would otherwise strobe the whole panel, and no amount of care further
downstream fixes that.

It drives the status token, the scan band's rate (a class on the panel root, so
one className write per band change and nothing per frame), and which row wears
the accent.

**The accent rule is the point.** The spec reserves one warning tone; today it is
spent unconditionally on one row, which means it says nothing. Under this change
no row is amber at nominal, and exactly one is under load — whichever utilization
is higher, with its own dwell and margin so a near-tie cannot ping-pong. This
strictly tightens compliance with "any warning tone reserved for a single accent
value" (which permits zero), and the chrome keeps a persistent amber note
regardless through the corner bracket and the chamfer, so the panel never loses
amber as a design element.

The meters' load structure is deliberately **colour-free** — a brighter unlit
background and a wider gap on the top cells, a printed redline on the dial face
rather than a second warning tone. The amber budget stays on the accent row.

### D11 — The history strip is DOM bars, not glyphs and not SVG

Block glyphs were the obvious choice and are wrong. The font stack falls back,
and fallback glyphs can carry **different advance widths** — so a data-driven
glyph strip changes width with the data, which is precisely the reflow the spec
forbids. Today's foot ships those glyphs *statically*, so the bug cannot surface;
making them follow data would surface it.

SVG was the other candidate and is also wrong here. The panel is HTML because it
depends on font metrics — its own comment says so — and an SVG child introduces a
second coordinate system with aspect-ratio care. This repo has already been bitten
once by an anisotropic overlay.

Discrete DOM bars win on both counts, match the meters' visual language, satisfy
"discrete segments rather than a smoothly filled bar", and update with zero
allocation from a module-level table of class strings indexed by quantized level.

Twenty buckets of the processor's real samples, one per bucket, never
interpolated. It is the only element in the HUD with a time axis, which is most
of why the panel will read differently.

### D12 — The dial gauge uses the element the spec already mandates

`eye-tracking-hud` requires the ring to include "a graduated element (a tick dial
or equivalent scale) so it reads as an instrument with a measurable face". It has
one. It measures nothing.

Lighting its ticks from processor load gives that requirement a purpose and puts
the machine's state on the **alerting** instrument, which is where the spec's own
division of labour puts it. Three constraints survive by construction: the dial
stays static, so "at least one element … is stationary" is untouched; ticks are
strokes, so "no filled areas" is untouched; and no rotation period is involved,
so the pairwise-distinct, non-harmonic rule is not re-opened.

### D13 — The delta RENAMEs rather than only MODIFYing

Requirements are keyed by their header text, and the header currently reads
"… and clearly placeholder content". Leaving that title over a body about real
measurement is exactly the self-contradiction the drift check exists to catch.

Two neighbouring requirements need amending for the same reason, and both are
easy to miss:

- "The panel stays on its eye's outward side, even when that clips it" closes by
  justifying the clipping with **"Its content is placeholder data, so nothing is
  actually lost by clipping it."** That sentence becomes false with this change.
  The justification is replaced rather than deleted — the readout is decorative
  and nothing depends on reading it, so clipping remains acceptable for a reason
  that survives.
- "The panel's values change continuously without disturbing its layout" has a
  scenario ending "and it is evident from that motion that they are illustrative
  rather than measured", which is the exact inverse of the new behaviour.

## Risks / Trade-offs

- **The graphics number includes this HUD's own rendering.** Unavoidable and
  mildly funny; it is part of why the interval is one second and why the cost is
  on the record (D3).
- **The panel's box has almost no slack.** The taller foot is paid for by a gap
  reduction with about 0.2em to spare, and the constraint binds in the *deck's*
  camera dock, not in the larger HUD — which will look fine and hide the problem.
  Verification says so explicitly.
- **The interface filter is a heuristic** (D4). An unusual interface set can
  over- or under-count. The mitigation is that this is a decoration, and the
  alternative is a routing-table reader nobody should maintain for a HUD.
- **Real data has a much wider digit range than sine waves did.** Right-aligned
  tabular figures hold the value *box* still but not the text's left edge, so the
  no-reflow requirement now rests on fixed-width formatters. Their width tests
  are the guard, and the rounding boundaries are the trap — a naive bound lets a
  value round up into an extra character.
- **A stuck main process would freeze the panel at plausible numbers.** Handled
  by a staleness fallback to absence after three missed ticks, which is cheap and
  covers the case that is otherwise indistinguishable from a very steady machine.

## Open Questions

- Whether the load ladder's thresholds are right on a machine that idles hot.
  They are a first guess; the manual pass under real load is what settles them,
  and they live in one pure function so moving them is a one-line change.
- Whether twenty buckets is the right span for the history strip. Twenty seconds
  is long enough to show a build starting and short enough to stay legible at
  this size, but only the running app can say.
