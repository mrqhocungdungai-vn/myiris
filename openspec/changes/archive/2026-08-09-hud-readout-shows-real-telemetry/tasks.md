## 1. The sampler

- [x] 1.1 Create `electron/system-telemetry.mjs` — Electron-free, `createSystemTelemetry({ onSample, execFileImpl = nodeExecFile, readCpus = os.cpus, now, platform, intervalMs, setIntervalImpl, clearIntervalImpl })` returning `{ start, stop, isRunning, sampleOnce }`, on the `pipeline-probes.mjs:45` injection seam (D2)
- [x] 1.2 Processor utilization from `os.cpus()` deltas — no child process. First tick has no predecessor, so it reports absence
- [x] 1.3 Graphics utilization from `ioreg`, with the pattern anchored on the **closing quote**. The same dictionary carries `"Device Utilization % at cur p-state"` *before* the real key; a loose pattern matches the decoy and reports roughly triple (D4). Several devices ⇒ take the max
- [x] 1.4 Network throughput from `netstat -ib`: read only the authoritative per-interface rows, index the **trailing seven fields** (rows are 10 or 11 wide), exclude loopback and tunnel interfaces, and sum only interfaces present in both readings (D4)
- [x] 1.5 One `null` for every absence — no delta yet, probe failed, probe timed out, no counter, not macOS (D5). Probes run concurrently, never reject, and carry a timeout
- [x] 1.6 In-flight guard that **skips** an overlapping tick rather than queueing it; rates from real elapsed timestamps so a skipped tick self-corrects (D6)
- [x] 1.7 Generation guard on `vault-graph.mjs:161-163`'s precedent — a probe still in flight when `stop()` runs can never emit
- [x] 1.8 Sticky disable of the graphics probe after three consecutive absences (D5)
- [x] 1.9 `start()` resets every baseline before the first tick, so the first rate after a pause is not the pause's average (D6)
- [x] 1.10 Non-darwin: measure the processor only, spawn nothing
- [x] 1.11 `electron/system-telemetry.test.mjs` — the `ioreg` fixture **with the p-state decoy**, multi-device max, the `netstat` fixture with both row widths, loopback/tunnel exclusion, processor delta math, first-tick absence, counter reset ⇒ absence + re-baseline, interfaces appearing and disappearing, sticky disable after three, overlap skip, generation guard, non-darwin, `start`/`stop` idempotency

## 2. The capability

- [x] 2.1 Create `electron/capabilities/hud-telemetry.mjs` — `hud-telemetry:activate` / `hud-telemetry:deactivate` as `ipcHandlers`, samples pushed on `hud-telemetry:sample` (D1)
- [x] 2.2 Idempotent start/stop, timer `unref`'d, `teardown()` stopping — teardown is already sequenced centrally, so do **not** self-register a hook
- [x] 2.3 Register in `electron/wiring-capabilities.mjs` — `emitToRenderer` and `getMainWindow` are already parameters there, so thread no new dependency
- [x] 2.4 `electron/capabilities/hud-telemetry.test.mjs` — exact channel names and kinds, activate⇒start, deactivate⇒stop, a sample reaching `emitToRenderer`, a destroyed window self-stopping, `teardown()` stopping
- [x] 2.5 Update `electron/wiring-capabilities.test.mjs` for the new entry
- [x] 2.6 Confirm `electron/ipc.mjs`, `electron/ipc.test.mjs`, `electron/main.mjs`, `electron/wiring.mjs` and both graph tests need **no** edit — if any of them does, D1's argument has failed and the placement should be revisited rather than the test loosened

## 3. The bridge

- [x] 3.1 `electron/preload.cjs` — start, stop, and a sample subscription returning an unsubscribe closure, per the existing convention
- [x] 3.2 `src/vite-env.d.ts` — the three members and the sample type

## 4. The renderer's pure layer

- [x] 4.1 Create `src/lib/telemetry-format.ts` in the style of `src/lib/eye-hud.ts` — fixed-width percent and rate formatters, the log meter scale, quantization, the ease, and the load ladder
- [x] 4.2 Both formatters emit a **constant character count across their whole range**, including the absent form. The rounding boundaries are the trap: a bound placed at the round number lets a value round up into an extra character (D9 / the layout requirement)
- [x] 4.3 Pad with a figure space, not a normal space — a leading normal space set through `textContent` is collapsed
- [x] 4.4 Load ladder as one pure function: separate rise and fall levels, plus a minimum dwell, over the higher of the two utilizations (D10)
- [x] 4.5 `src/lib/telemetry-format.test.ts` — width sweeps over the full range of both formatters, the rounding boundaries named individually, monotonicity across unit boundaries, the log scale's endpoints and its constant span per decade, and the ladder's rise / fall / dwell

## 5. The renderer's seam

- [x] 5.1 Create `src/hooks/useSystemTelemetry.ts` — a ref, **no React state at all**, start on enable, unsubscribe then stop on cleanup (D7)
- [x] 5.2 Call it once in `src/App.tsx` beside `useEyeTracking`, gated on gesture control — **not** on face presence (D6)
- [x] 5.3 Thread the ref through `src/components/CameraDock.tsx` and `src/components/HudShell.tsx`, retracing `eyeRef`'s existing path

## 6. The readout

- [x] 6.1 Delete `churnValues` and the shared 130 ms churn tick (D9)
- [x] 6.2 Four rows on the real fields; header chip renames to the host, and the simulation token becomes the live status token
- [x] 6.3 Per frame: ease, round, compare against the integer already rendered, write only on change. Different time constants for the two utilizations so they never update together (D9)
- [x] 6.4 Percentages ease; rates step (D8)
- [x] 6.5 The three honesty rules: no synthetic jitter; absence freezes rather than decaying to zero; a value returning from absence snaps rather than easing (D8)
- [x] 6.6 Staleness — several missed intervals falls every value to absent
- [x] 6.7 A sample beat in the header, stepped on real arrival, built from the existing cell element rather than a glyph
- [x] 6.8 Meters on graphics (linear) and network (log). Load structure on the top cells is **colour-free** — a brighter unlit background and a wider gap, not a second warning tone (D10)
- [x] 6.9 Peak-hold marker per meter, from raw samples, outlined rather than filled
- [x] 6.10 Foot becomes the history strip — discrete DOM bars, class table indexed by quantized level, never interpolated, never re-measured (D11). Landed at **fourteen** buckets, not twenty: on the meters' cell count, width and gap, so the strip sits on their column grid
- [x] 6.11 The accent becomes conditional: none at nominal, exactly one under load, on the higher utilization, with its own dwell and margin (D10)
- [x] 6.12 Scan band rate follows the band via a class on the panel root — one className write per band change, nothing per frame
- [x] 6.13 Nothing that decides state reads an eased value — band, beat, history and peaks all read the raw sample (D8)
- [x] 6.14 Allocation audit of the frame path: no object literals, no closures, no template strings, formatter called only inside the on-change branch. Typed arrays allocated once

## 7. The ring

- [x] 7.1 Light the dial's ticks from processor load (D12) — dial stays static, ticks stay strokes, no rotation period touched. Update only the ticks between the old and new lit count
- [x] 7.2 Add the lock beat to `src/lib/eye-hud.ts` and drive it from the existing per-frame loop, after convergence, without delaying the tether or the panel
- [x] 7.3 Extend `src/lib/eye-hud.test.ts` for the lock beat's shape and bounds

## 8. Styles

- [x] 8.1 Readout CSS: token tones per band, the head's beat cells, the meters' zone and peak cells, the scan durations per band, and the foot's strip
- [x] 8.2 Pay for the taller foot. The column gap covered part of it; the rest came from `READOUT_GEOMETRY.height`, which turned out to have been overflowing already — see *Found while implementing*. Do **not** add a height or min-height to the CSS: the inline percentage is the box the placement math reasons about, and divergence between the two is a real defect class
- [x] 8.3 The value cell must preserve its padding, so its whitespace handling has to allow it

## 9. Verification

- [x] 9.1 Run all five gates — `/gates`, or `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`
- [x] 9.2 Manual: load the processor hard and watch the whole ladder fire at once — token, accent, scan rate, history plateau, dial. Then release it and watch all of it come back down. **This is the change's real test**; nothing in the unit suite can see it
- [x] 9.3 Manual: pull a large download and watch a rate cross unit boundaries in both directions, watching the **left edge of the text** rather than the row
- [x] 9.4 Manual: shrink the window until the deck's camera dock is at its narrowest and confirm the panel does not clip its own content. The larger HUD frame will look fine and will hide this (D3 risks)
- [x] 9.5 Manual: turn gesture control off and confirm no measurement subprocess is started; turn it back on and confirm the first moment reads as absence, not as zero
- [x] 9.6 Manual: quit with the camera on, and confirm nothing is left running
- [x] 9.7 Degradation pass: force the graphics probe to return nothing and confirm the row reads absent rather than zero, no error surfaces, and the probe stops being attempted
- [x] 9.8 Update `docs/GESTURES.md`'s account of what the panel shows; keep `CLAUDE.md` a router
- [x] 9.9 Settle the design's open questions from the manual pass — the ladder's levels on a machine that idles hot, and whether the history's span is right

## Deferred — needs the running app with a face in frame

The readout only mounts once the tracker has both irises, which no automated
check on this machine can produce. What WAS verified without one:

- The full IPC path in the real packaged app, driven through the renderer's own
  preload bridge: five samples at 1 Hz, the first reporting absence for every
  delta-derived value exactly as designed, and **zero** samples after deactivate.
- The panel's rendered layout at the deck dock's true width (256px), in Chromium,
  against the real stylesheet — which is how the height overflow below was found.

Left unchecked, all of them needing a face:

- 9.2 The load ladder firing end to end under real load, and coming back down.
  This is the change's real test and nothing in the unit suite can see it.
- 9.3 A rate crossing a unit boundary with the text's left edge held still.
- 9.4 The panel at the deck dock's narrowest, in the app rather than in a harness.
- 9.7 The degradation pass with the graphics probe forced to return nothing.
- 9.9 The ladder's levels on a machine that idles hot, and the history's span.

## Found while implementing

**The panel has been overflowing its box since it was built.** Measured in
Chromium at the deck dock's real width: the content is 13.83em against a 12.6em
box at the original `height: 0.52`. It never showed because `overflow: hidden`
was clipping a decorative glyph line and nothing was lost. The foot now carries
fourteen real measurements, so `READOUT_GEOMETRY.height` is 0.62 — a 15.0em box
with 1.16em of slack, with the arithmetic and the measuring method recorded
beside the constant.

**Twenty history buckets was too many.** At the deck's width the bars came out
under a pixel wide and read as noise. Fourteen — the same count as the meters'
cells, on the same width and gap — puts the strip on the meters' column grid, so
it reads as another row of one instrument rather than as a different graphic.

**`gemini-tools.mjs` and `gemini-prompts.mjs` needed their capability parameter
types widened.** A capability contributing neither a tool declaration nor a
prompt fragment has no property in common with `{ promptFragment?: ... }`, which
trips TypeScript's weak-type check. The contract already said every field is
optional; the declarations now say so too.

---

The manual items above were run by the user on 2026-08-09 and reported as passing. Recorded here because a box ticked by someone who could not have performed the check is the one kind of entry this file must never contain — the manual passes are exactly the parts no unit test can stand in for.
