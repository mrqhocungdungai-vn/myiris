## Why

`eye-tracking-hud` shipped the readout panel with its content deliberately fake,
and said so in the requirement itself:

> Its content SHALL be clearly placeholder/illustrative data. It SHALL NOT be
> presented as derived from any real signal **unless and until a future change
> explicitly wires it to one.**

This is that change. It exists because the placeholder is no longer merely
neutral — it is the thing that makes the HUD read as a prop.

The panel's four values come from `churnValues(seconds)`, four pure sine waves of
wall-clock time, and its two meters from two more. All six are written on one
`CHURN_MS = 130` tick, so they flash in lockstep; a sine dwells at its extremes
and races through the middle, a signature the eye learns in about three cycles;
and the whole set repeats visibly in two to four seconds. The `.foot` line is a
monotonic staircase of block glyphs — the one shape that never occurs in real
data — and it is static, which is what proves the panel is an image pasted over
live video. The `SIM` token announces all of this in the panel's single warning
tone.

The deeper fault is that **nothing in the panel is caused by anything.** No event
in the world changes one pixel of it. Real numbers alone do not fix that: real
numbers that nothing reacts to still read as decoration that happens to be
accurate. What the panel is missing is a reason to change, a memory of what came
before, and a visible response when the machine it sits on is actually working.

The machine is right there, and every number worth showing is available on this
platform without elevated privileges — which is the second reason to do it now
rather than reach for a heavier mechanism later.

## What Changes

**The readout reports the host.** Four rows — processor utilization, graphics
utilization, network received, network sent — measured from the machine Iris is
running on. The header declares that provenance instead of declaring simulation:
the `SIM` token becomes a live status token, and the `OCULAR` chip becomes `SYS`,
because the panel now reports the machine rather than the eye it hangs beside.

**Measurement is gated on the camera and capped at 1 Hz.** Nothing is sampled
while gesture control is off. Nothing is sampled per frame. A readout that costs
more than it reports is a readout that moves its own number, and the change
records the measured cost rather than assuming it away.

**An unavailable measurement reads as absent, never as zero.** A host with no
graphics-utilization counter, a probe that failed, a non-macOS host, the first
second before a delta exists — all of these show a visibly absent value. `0%` is
a claim, and it is the wrong one.

**Displayed values are interpolated toward each measurement rather than the
measurement rate being raised to smooth them** — and the interpolation is
asymmetric, deliberately. Utilization is a *level*: interpolating between two
samples shows values the machine genuinely passed through. A byte rate is an
*integral over the sample window*, so a value between two window-averages is the
average of nothing at all, and — because rates span several orders of magnitude —
easing one would render fictional intermediate *magnitudes*. Percentages ease;
rates step. The panel visibly carries two kinds of instrument, which is itself
more honest than making them all behave alike.

**The panel gains a memory and a reaction.** The decorative foot line becomes a
rolling strip of the last twenty real processor samples — the only element in the
HUD with a time axis. A single load ladder, with hysteresis and a minimum dwell,
drives the status token, the scan band's rate, and *which* row wears the accent.

**The one warning tone finally means something.** Today one row is
unconditionally amber, which is the same as no row being amber. Under this change
no row is amber at nominal load, and exactly one is under load — whichever of the
two utilizations is higher. The tone stops being decoration and starts saying
"this is the thing to look at", which is what "the panel is the reporting
instrument" was supposed to mean.

**The ring's graduated dial becomes a real gauge.** `eye-tracking-hud` requires
the ring to carry "a graduated element … so it reads as an instrument with a
measurable face rather than as a set of plain circles". It has one, and it
measures nothing. Lighting its ticks from processor load gives the requirement
its purpose and puts the machine's state on the alerting instrument, where the
spec's own division of labour says it belongs. The dial stays static, so the
fixed reference the spec mandates is untouched.

**Acquisition gains a lock beat.** Today the ring converges and then runs
forever, with nothing marking the moment it arrived. A brief settle on the
crosshair after convergence completes the sequence the spec already stages —
acquire, tether, report — with the beat it was missing.

Explicitly **not** in this change:

- *Any measurement requiring elevated privileges.* The obvious richer source for
  graphics and power telemetry needs `sudo`. A HUD decoration is not a reason to
  ask for it, and a feature that silently degrades on every machine whose user
  declines is worse than one that never asked.
- *Sampling while the camera is off.* There is no background collection, no
  history that survives the camera being turned off, and nothing written to disk.
- *A separate toggle.* `eye-tracking-hud` already requires that this capability
  be enabled and disabled with gesture control and no other control, and
  measurement follows the overlays it feeds.
- *Any of this reaching the voice layer, a run, or a tool.* The readout is
  decorative. No verb learns about it, no prompt mentions it, and nothing
  downstream may read it.
- *Making the readout load-bearing.* Nothing may come to depend on reading it.
  That is what keeps clipping at the frame edge an acceptable cost, and this
  change must not quietly spend that.
- *Synthetic jitter.* Once the sine waves are gone the temptation is to sprinkle
  noise so it still "feels alive". That is the crime being fixed. Motion comes
  from measurement, or it does not come.

## Capabilities

### Modified Capabilities

- `eye-tracking-hud`: the panel's content becomes real host telemetry rather than
  placeholder data; a measurement that cannot be taken reads as absent rather
  than as zero; sampling is bounded to when the readout can be seen, and bounded
  in cost so that it does not move the number it reports.

No new capability. This is what the readout panel of `eye-tracking-hud` shows;
giving telemetry its own capability would split one panel's story across two
specs and imply the numbers are useful somewhere else, which is exactly what the
change forbids.

`main-thread-budget` needs no delta: its "no per-frame heap allocation on the hot
path" requirement is satisfied rather than changed — the readout's per-frame work
goes *down*, because `churnValues` allocated an object and four strings every
130 ms and its replacement allocates only when a displayed integer changes.

`main-process-structure` needs no delta: the sampler is a new Electron-free
module with its own tests, and the capability registers its channels by the
existing iteration; nothing about the structure's rules changes.

## Impact

- `electron/system-telemetry.mjs` + `electron/system-telemetry.test.mjs` —
  **new.** The sampler and its parsers, Electron-free, with the child process
  injected on the `pipeline-probes.mjs` seam. The two parser traps are captured
  as fixtures: the graphics counter's output carries a decoy key that a slightly
  loose pattern matches *first* and reports roughly triple, and the network
  counter's rows vary in column count so only the trailing fields can be
  trusted.
- `electron/capabilities/hud-telemetry.mjs` +
  `electron/capabilities/hud-telemetry.test.mjs` — **new.** Activate/deactivate,
  the sample push, and teardown. The first capability with no tool declaration
  and no prompt fragment — accepted, because the capability contract states every
  field is optional, and this module serves exactly one spec capability
  end to end.
- `electron/wiring-capabilities.mjs` + its test — one import, one construction,
  one array entry. `emitToRenderer` and `getMainWindow` are already parameters
  there, so no dependency is threaded anywhere new.
- `electron/ipc.mjs`, `electron/ipc.test.mjs`, `electron/main.mjs`,
  `electron/wiring.mjs` — **deliberately untouched.** Capability channels
  register by iteration, and capability teardown is already sequenced centrally.
- `electron/preload.cjs` + `src/vite-env.d.ts` — the three new bindings.
- `src/lib/telemetry-format.ts` + `src/lib/telemetry-format.test.ts` — **new.**
  Fixed-width formatters, the log meter scale, the ease, and the load ladder —
  pure, in the style `src/lib/eye-hud.ts` already establishes. The width tests
  are the real guard on the no-reflow requirement: right-aligned tabular figures
  hold the *box* still, but the text's left edge still moves when the string
  length changes, which real data does far more than sine waves did.
- `src/hooks/useSystemTelemetry.ts` — **new.** A ref seam mirroring
  `useEyeTracking`'s, with no React state at all, since nothing in the tree
  branches on telemetry.
- `src/components/EyeReadout.tsx` — the substance of the visible change.
- `src/components/EyeReticle.tsx` + `src/lib/eye-hud.ts` + its test — the dial
  gauge and the lock beat.
- `src/App.tsx`, `src/components/CameraDock.tsx`,
  `src/components/HudShell.tsx` — one prop each, retracing `eyeRef`'s existing
  path exactly.
- `src/styles/claude.css` — the readout block, including a gap reduction that
  pays for the taller foot; the panel's height is fixed at 52% of the frame and
  has almost no slack.
- `docs/GESTURES.md` — the eye-HUD section's account of what the panel shows.
- No new dependency. No change to the verb registry, the run queue, the voice
  surface, or anything on disk.
