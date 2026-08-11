import { useEffect, useRef } from "react";
import { EYE_READOUT, type EyeState } from "../hooks/useEyeTracking";
import { READOUT_GEOMETRY, type ReadoutLayout } from "../lib/eye-hud";
import type { TokenLedgerRef } from "../hooks/useTokenLedger";
import {
  BAR_CLASS,
  HISTORY_BUCKETS,
  easeToward,
  formatPercent,
  formatRate,
  formatTokens,
  higherOf,
  historyLevel,
  logMeterLevel,
  nextLoadBand,
  quantize,
  type LoadBand,
} from "../lib/telemetry-format";

// The telemetry callout beside the readout eye. Plain HTML, not SVG
// (design D10): its layout depends on real font metrics, letter-spacing and
// tabular figures, none of which SVG <text> provides. This is the same overlay
// pattern HandReticles.tsx already uses — an absolutely positioned HTML
// element whose transform is written every frame by a rAF loop, mounted or not
// by semantically-gated React state.
//
// Its content is TWO readings, and the panel says which is which. The rows
// under SYS are the REAL HOST (hud-readout-shows-real-telemetry): processor,
// graphics and network, measured in the main process once a second. The rows
// under APP are what the app's two paid engines have reported consuming
// (token-accounting). There is no churn tick and no generated motion — every
// figure here was measured or reported, and the panel's liveliness comes from
// the machine rather than from a sine wave.
//
// The two halves obey different rules, and conflating them is the mistake to
// avoid here. A host measurement is a sample of a present condition: it eases,
// it goes STALE, and it can wear the panel's one warning tone. A token count is
// none of those. It STEPS (easing would draw counts that were never reached,
// and an ease toward a lower value would render a decrease that cannot happen),
// it never goes stale (silence means nothing was spent, not that the reading
// aged out), and it NEVER wears the accent at any magnitude — there is no level
// at which an amount consumed is a fault, and marking one would imply a limit
// this panel does not enforce. What the app enforces about spend is a per-run
// ceiling, applied in the run's own configuration and reported as that run's
// terminal status.

const METER_CELLS = 14;
/** Top cells set off as a printed redline. Colour-free on purpose — the panel's one warning tone is spent on the accent row. */
const METER_ZONE_CELLS = 3;
/** Beat cells in the header, stepping once per real sample — the only element that runs at the data's own rate. */
const TICK_CELLS = 3;
/** How long a peak marker is held before it decays, in samples. */
const PEAK_HOLD_SAMPLES = 8;

/**
 * Three missed intervals. Both timestamps are wall clocks on the same machine,
 * so this needs no clock discipline — it exists so a wedged main process shows
 * absence rather than a frozen set of plausible numbers, which is otherwise
 * indistinguishable from a very steady machine.
 */
const STALE_MS = 3200;

/**
 * How long an accent must stay put before it may move to the other row, and how
 * far apart the two must be for it to move at all. Without both, two near-equal
 * utilizations trade the accent back and forth every second.
 */
const ACCENT_DWELL_MS = 2000;
const ACCENT_MARGIN = 0.08;

type Field = "cpu" | "gpu" | "netRx" | "netTx";

/**
 * Four rows, four measurements. Deliberately terse and denser than it is
 * readable — that density is what makes it read as instrumentation rather than
 * as a label (design D9).
 *
 * `kind` is the substance of the row, not a formatting detail. A utilization is
 * a LEVEL, so easing between samples shows values the machine genuinely passed
 * through. A byte rate is an INTEGRAL OVER THE SAMPLE WINDOW, so a value between
 * two window-averages is the average of nothing — and because rates span
 * decades, easing one would render fictional intermediate magnitudes. Levels
 * ease; rates step.
 *
 * The two eased rows carry different time constants so they never cross an
 * integer on the same frame: they arrive in the same packet, and six elements
 * updating in lockstep is the single loudest "one timer drives this" tell.
 */
const ROWS: Array<{ key: string; label: string; field: Field; kind: "level" | "rate"; tau: number }> = [
  { key: "cpu", label: "CPU", field: "cpu", kind: "level", tau: 160 },
  { key: "gpu", label: "GPU", field: "gpu", kind: "level", tau: 240 },
  { key: "rx", label: "NET▼", field: "netRx", kind: "rate", tau: 0 },
  { key: "tx", label: "NET▲", field: "netTx", kind: "rate", tau: 0 },
];

const BAND_TOKEN: Record<LoadBand, string> = { nom: "NOM", elv: "ELV", sat: "SAT" };

/**
 * The five token figures, in render order. Indices into `display.tokenLast` and
 * `tokenValueRefs` — one array rather than five named refs, so the frame path
 * is a single loop with no branching per figure.
 *
 * `signed` marks the two "what the most recent call added" figures. `cacheRead`
 * is Claude's alone and is deliberately NOT summed into its headline: cached
 * reads routinely exceed everything else by an order of magnitude while costing
 * a fraction per token, so folding them in would make the headline climb far
 * faster than consumption actually rises.
 */
const TOKEN_FIGURES: Array<{ key: string; signed: boolean; read: (snapshot: TokenUsageSnapshot) => number | null }> = [
  { key: "gemTotal", signed: false, read: (s) => s.gemini.total },
  { key: "gemLast", signed: true, read: (s) => s.gemini.last },
  { key: "cldTotal", signed: false, read: (s) => s.claude.total },
  { key: "cldLast", signed: true, read: (s) => s.claude.last },
  { key: "cacheRead", signed: false, read: (s) => s.claude.cacheRead },
];

export default function EyeReadout({
  eye,
  eyeRef,
  telemetryRef,
  ledgerRef,
  layoutRef,
}: {
  eye: EyeState;
  eyeRef: { current: EyeState };
  /** Latest host measurement (useSystemTelemetry's sampleRef). Read, never written. */
  telemetryRef: { current: TelemetrySample };
  /**
   * The token account (useTokenLedger's ledgerRef). Read, never written, and on
   * a different channel from `telemetryRef` — which is the whole reason these
   * figures do not fall to absent when host sampling stops.
   */
  ledgerRef: TokenLedgerRef;
  /**
   * Resolved by EyeReticle earlier in the same frame — the one shared
   * frame-normalized position the tether's far end also derives from, so the
   * two stay in register without either measuring the other (design D10).
   */
  layoutRef: { current: ReadoutLayout };
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<HTMLSpanElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const valueRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tokenValueRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // ONE meter, not two. The GPU meter was a segmented bar restating the GPU
  // percentage printed directly above it; the network meter is log-scaled
  // across decades, which is a reading the two rate rows genuinely do not give
  // at a glance. The spec requires *a* graduated segmented meter, singular.
  const meterRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tickRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // The frame's pixel size, kept by a ResizeObserver rather than measured each
  // frame — which also means the HUD's camera-zoom toggle rescales the panel
  // live, with no re-tuning and no reinitialization.
  const frameSizeRef = useRef({ width: 0, height: 0 });

  // Every piece of per-frame state, allocated ONCE. Typed arrays and scalars in
  // one object, mutated in place — the frame path below must not allocate
  // (main-thread-budget), and the deleted churn generator allocated a record
  // plus four strings every 130ms.
  const display = useRef({
    eased: new Float32Array(2), // the two levels, mid-ease
    /** -1 means "nothing rendered yet", which no rounded percentage can be. */
    lastInt: new Int32Array(ROWS.length).fill(-1),
    /** Whether each eased row currently holds a real value; a gap must snap, not ease. */
    present: [false, false],
    meterEased: 0,
    meterLast: -1,
    meterPeak: 0,
    meterPeakAge: 0,
    meterPeakCell: -1,
    /**
     * Last RENDERED token figure per slot. Float64, not Int32: a session total
     * passes 2^31 long before it passes anything interesting. `-1` means "the
     * absent form is on screen", which is both the initial DOM text and what a
     * `null` renders as — so the two cases collapse correctly into one sentinel
     * and no real count (always ≥ 0) can collide with it.
     */
    tokenLast: new Float64Array(TOKEN_FIGURES.length).fill(-1),
    history: new Uint8Array(HISTORY_BUCKETS),
    historyHead: 0,
    band: "nom" as LoadBand,
    bandSince: 0,
    accentRow: -1,
    accentSince: 0,
    lastSampleAt: -1,
    lastFrameMs: 0,
    tickPhase: 0,
  }).current;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const observer = new ResizeObserver(([entry]) => {
      frameSizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(layer);
    return () => observer.disconnect();
  }, [eye.present]);

  useEffect(() => {
    let raf = 0;

    /** Rewrites all 20 bars from the ring buffer. Once a second, never per frame. */
    function paintHistory() {
      for (let i = 0; i < HISTORY_BUCKETS; i += 1) {
        const bar = barRefs.current[i];
        if (!bar) continue;
        // Oldest on the left: read forward from the head, which points at the
        // slot the next sample will overwrite.
        const level = display.history[(display.historyHead + i) % HISTORY_BUCKETS];
        const next = BAR_CLASS[level];
        if (bar.className !== next) bar.className = next;
      }
    }

    /**
     * Everything that must run at the DATA's rate rather than the frame's:
     * history, the beat, peaks, the band, the accent, and the stepped rate rows.
     * Reads RAW values throughout — anything deciding a state from an eased
     * value would strobe as the ease crawled across a threshold.
     */
    function onSample(sample: TelemetrySample, nowMs: number) {
      display.history[display.historyHead] = historyLevel(sample.cpu);
      display.historyHead = (display.historyHead + 1) % HISTORY_BUCKETS;
      paintHistory();

      display.tickPhase = (display.tickPhase + 1) % TICK_CELLS;
      for (let i = 0; i < TICK_CELLS; i += 1) {
        const cell = tickRefs.current[i];
        if (cell) cell.className = i === display.tickPhase ? "cell lit" : "cell";
      }

      const rawMeter = logMeterLevel((sample.netRx ?? 0) + (sample.netTx ?? 0));
      display.meterPeakAge += 1;
      if (rawMeter >= display.meterPeak || display.meterPeakAge > PEAK_HOLD_SAMPLES) {
        display.meterPeak = rawMeter;
        display.meterPeakAge = 0;
      }

      const load = higherOf(sample.cpu, sample.gpu);
      const band = nextLoadBand(display.band, load, nowMs - display.bandSince);
      if (band !== display.band) {
        display.band = band;
        display.bandSince = nowMs;
        const panel = panelRef.current;
        if (panel) panel.className = `eye-readout ${band}`;
        const token = tokenRef.current;
        if (token) token.textContent = BAND_TOKEN[band];
      }

      // The panel's one warning tone, spent on a real condition. NOTHING is
      // amber at nominal — a tone that is always present marks nothing, which is
      // what the unconditional accent this replaced was doing. Under load
      // exactly one row wears it: whichever utilization is higher, and only once
      // it has been higher by a clear margin for long enough that a near-tie
      // cannot trade it back and forth.
      let accent = -1;
      if (band !== "nom") {
        const cpu = sample.cpu ?? -1;
        const gpu = sample.gpu ?? -1;
        accent = cpu >= gpu ? 0 : 1;
        if (display.accentRow >= 0 && accent !== display.accentRow) {
          const settled = nowMs - display.accentSince >= ACCENT_DWELL_MS;
          if (!settled || Math.abs(cpu - gpu) < ACCENT_MARGIN) accent = display.accentRow;
        }
      }
      if (accent !== display.accentRow) {
        display.accentRow = accent;
        display.accentSince = nowMs;
        for (let i = 0; i < ROWS.length; i += 1) {
          const row = rowRefs.current[i];
          if (row) row.className = i === accent ? "row accent" : "row";
        }
      }

      // Rates are written here and only here — one measurement, one figure.
      for (let i = 0; i < ROWS.length; i += 1) {
        if (ROWS[i].kind !== "rate") continue;
        const node = valueRefs.current[i];
        if (node) node.textContent = formatRate(sample[ROWS[i].field]);
      }
    }

    const loop = () => {
      const live = eyeRef.current;
      const readoutEye = live.eyes[EYE_READOUT];
      const panel = panelRef.current;
      if (readoutEye && panel) {
        const layout = layoutRef.current;
        const { width, height } = frameSizeRef.current;
        // The anchor is the panel's RIGHT edge, vertically centered: the panel
        // hangs leftward from its eye and never crosses it, so the pinned edge
        // is fixed and the frame's left edge clips it rather than moving it.
        panel.style.transform =
          `translate(${layout.anchorX * width}px, ${layout.anchorY * height}px) translate(-100%, -50%)`;
        panel.style.opacity = String(layout.panel);

        const nowMs = performance.now();
        const dt = display.lastFrameMs === 0 ? 0 : nowMs - display.lastFrameMs;
        display.lastFrameMs = nowMs;

        const sample = telemetryRef.current;
        // A sample that stopped arriving is absent, not frozen: a readout stuck
        // on plausible numbers cannot be told apart from a very steady machine.
        const fresh = sample.at > 0 && Date.now() - sample.at <= STALE_MS;

        if (fresh && sample.at !== display.lastSampleAt) {
          display.lastSampleAt = sample.at;
          onSample(sample, nowMs);
        } else if (!fresh && display.lastSampleAt !== -1) {
          display.lastSampleAt = -1;
          display.present[0] = false;
          display.present[1] = false;
        }

        // ---- the frame path. No allocation past this point in steady state:
        // the integer comparison allocates nothing, and the formatter is called
        // only inside the branch where the rendered figure actually changed.
        for (let i = 0; i < 2; i += 1) {
          const raw = fresh ? sample[ROWS[i].field] : null;
          const node = valueRefs.current[i];
          if (raw === null) {
            // Absence FREEZES rather than decaying toward zero: decaying would
            // assert 0%, which is a claim about a machine nobody measured.
            display.present[i] = false;
            if (node && display.lastInt[i] !== -1) {
              display.lastInt[i] = -1;
              node.textContent = formatPercent(null);
            }
            continue;
          }
          // Returning from a gap SNAPS: easing out of a figure that predates the
          // gap would draw a ramp through numbers that were never measured.
          display.eased[i] = display.present[i] ? easeToward(display.eased[i], raw, dt, ROWS[i].tau) : raw;
          display.present[i] = true;
          const rounded = Math.round(display.eased[i] * 100);
          if (node && rounded !== display.lastInt[i]) {
            display.lastInt[i] = rounded;
            node.textContent = formatPercent(display.eased[i]);
          }
        }

        {
          const target = fresh ? logMeterLevel((sample.netRx ?? 0) + (sample.netTx ?? 0)) : 0;
          display.meterEased = easeToward(display.meterEased, target, dt, 220);
          const lit = quantize(display.meterEased, METER_CELLS);
          // Peak reads the RAW sample, not the ease — a marker that lags the
          // value it marks is not a peak.
          const peakCell = fresh ? quantize(display.meterPeak, METER_CELLS) : -1;
          if (lit !== display.meterLast || peakCell !== display.meterPeakCell) {
            display.meterLast = lit;
            display.meterPeakCell = peakCell;
            for (let i = 0; i < METER_CELLS; i += 1) {
              const cell = meterRefs.current[i];
              if (!cell) continue;
              const zone = i >= METER_CELLS - METER_ZONE_CELLS ? " zone" : "";
              const state = i < lit ? " lit" : i + 1 === peakCell ? " peak" : "";
              const next = `cell${zone}${state}`;
              if (cell.className !== next) cell.className = next;
            }
          }
        }

        // ---- the token figures. A THIRD kind of row, and every rule above is
        // deliberately absent here: no ease (a count steps — easing would draw
        // amounts that were never reported), no `fresh` gate (these arrive on
        // their own channel, and silence on it means nothing was spent rather
        // than that a reading aged out), and no contribution to the band or the
        // accent (there is no magnitude at which a count is a warning).
        //
        // Allocation-free on the same terms as the percent rows: compare the
        // raw number, and call the formatter only inside the branch where the
        // rendered figure actually changed.
        const ledger = ledgerRef.current;
        for (let i = 0; i < TOKEN_FIGURES.length; i += 1) {
          const raw = TOKEN_FIGURES[i].read(ledger);
          const next = raw === null || !Number.isFinite(raw) ? -1 : raw;
          if (next === display.tokenLast[i]) continue;
          display.tokenLast[i] = next;
          const node = tokenValueRefs.current[i];
          if (node) node.textContent = formatTokens(raw, { signed: TOKEN_FIGURES[i].signed });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [eyeRef, layoutRef, telemetryRef, ledgerRef, display]);

  if (!eye.present) return null;

  return (
    <div className="eye-readout-layer" ref={layerRef} aria-hidden="true">
      <div
        className="eye-readout nom"
        ref={panelRef}
        style={{
          // Both from the one geometry the placement math uses, so the box the
          // flip logic reasons about is the box actually drawn.
          width: `${READOUT_GEOMETRY.width * 100}%`,
          height: `${READOUT_GEOMETRY.height * 100}%`,
          opacity: 0,
        }}
      >
        {/* The frame is implied, never closed: corner brackets plus one
            chamfered corner for orientation (spec: "The panel has no closed
            border"). The chamfer and the brackets are drawn in claude.css. */}
        <span className="bracket tl" />
        <span className="bracket tr" />
        <span className="bracket bl" />
        <span className="bracket br" />
        <span className="scan" />

        <div className="head">
          {/* The panel reports the machine, not the eye it hangs beside. */}
          <span className="tag">SYS</span>
          <span className="tick">
            {Array.from({ length: TICK_CELLS }, (_unused, index) => (
              <span
                className="cell"
                key={index}
                ref={(el) => {
                  tickRefs.current[index] = el;
                }}
              />
            ))}
          </span>
          <span className="token" ref={tokenRef}>
            {BAND_TOKEN.nom}
          </span>
        </div>

        {ROWS.map((row, index) => (
          <div
            className="row"
            key={row.key}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
          >
            <span className="label">{row.label}</span>
            <span
              className="value"
              ref={(el) => {
                valueRefs.current[index] = el;
              }}
            >
              {row.kind === "level" ? formatPercent(null) : formatRate(null)}
            </span>
          </div>
        ))}

        {/* Segmented, never a smooth fill — a smooth progress bar is the most
            recognizably-generic-UI element available (design D9). ONE meter:
            the network one, because it is logarithmic and linear against any
            sane ceiling would sit at zero for everything below a megabit. The
            GPU meter that stood beside it restated the percentage printed two
            rows above, and its ~1.56em is what pays for the token block below
            (design D8). */}
        <div className="meter">
          <span className="label">NET</span>
          <span className="cells">
            {Array.from({ length: METER_CELLS }, (_unused, index) => (
              <span
                className={index >= METER_CELLS - METER_ZONE_CELLS ? "cell zone" : "cell"}
                key={index}
                ref={(el) => {
                  meterRefs.current[index] = el;
                }}
              />
            ))}
          </span>
        </div>

        {/* The panel's second reading begins here, and the rule plus the APP
            tag is how the panel says so — the rows above report the machine,
            the rows below report what this app has spent. Without the break
            they would read as one undifferentiated list, which invites the
            reading that a token count is a utilization. */}
        <div className="rule">
          <span className="tag">APP</span>
          <span className="line" />
        </div>

        {/* One row per engine, never a combined figure: two different models at
            different prices per token, one dominated by audio frames and the
            other by file contents. A sum of the two would move for reasons the
            user could not attribute and could not act on. */}
        {[
          { key: "gem", label: "GEM", total: 0, last: 1 },
          { key: "cld", label: "CLD", total: 2, last: 3 },
        ].map((engine) => (
          <div className="row tokens" key={engine.key}>
            <span className="label">{engine.label}</span>
            <span
              className="value"
              ref={(el) => {
                tokenValueRefs.current[engine.total] = el;
              }}
            >
              {formatTokens(null)}
            </span>
            {/* What the most recent call added. A total alone hides an
                expensive single call; a per-call figure alone hides an
                accumulation of cheap ones. */}
            <span
              className="delta"
              ref={(el) => {
                tokenValueRefs.current[engine.last] = el;
              }}
            >
              {formatTokens(null, { signed: true })}
            </span>
          </div>
        ))}

        {/* Cached input, on its own line and never inside CLD's headline. */}
        <div className="row tokens cache">
          <span className="label">↺</span>
          <span
            className="value"
            ref={(el) => {
              tokenValueRefs.current[4] = el;
            }}
          >
            {formatTokens(null)}
          </span>
        </div>

        {/* The only element in the HUD with a time axis: twenty real processor
            samples, one per bar, never interpolated. Discrete DOM bars rather
            than block glyphs — the font stack falls back, and fallback glyphs
            can carry different advance widths, so a data-driven glyph strip
            would change width with its data (D11). */}
        <div className="foot">
          <span className="label">CPU</span>
          <span className="strip">
            {Array.from({ length: HISTORY_BUCKETS }, (_unused, index) => (
              <span
                className={BAR_CLASS[0]}
                key={index}
                ref={(el) => {
                  barRefs.current[index] = el;
                }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
