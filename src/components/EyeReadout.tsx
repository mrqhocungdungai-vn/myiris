import { useEffect, useRef } from "react";
import { EYE_READOUT, type EyeState } from "../hooks/useEyeTracking";
import { READOUT_GEOMETRY, type ReadoutLayout } from "../lib/eye-hud";
import {
  BAR_CLASS,
  HISTORY_BUCKETS,
  easeToward,
  formatPercent,
  formatRate,
  higherOf,
  historyLevel,
  logMeterLevel,
  meterLevel,
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
// Its content is the REAL HOST (hud-readout-shows-real-telemetry): processor,
// graphics and network, measured in the main process once a second. There is no
// churn tick and no generated motion — every figure here was measured, and the
// panel's liveliness comes from the machine rather than from a sine wave.

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

export default function EyeReadout({
  eye,
  eyeRef,
  telemetryRef,
  layoutRef,
}: {
  eye: EyeState;
  eyeRef: { current: EyeState };
  /** Latest host measurement (useSystemTelemetry's sampleRef). Read, never written. */
  telemetryRef: { current: TelemetrySample };
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
  const meterRefs = useRef<Array<Array<HTMLSpanElement | null>>>([[], []]);
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
    meterEased: new Float32Array(2),
    meterLast: new Int32Array(2).fill(-1),
    meterPeak: new Float32Array(2),
    meterPeakAge: new Int32Array(2),
    meterPeakCell: new Int32Array(2).fill(-1),
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

      const rawMeters = [meterLevel(sample.gpu), logMeterLevel((sample.netRx ?? 0) + (sample.netTx ?? 0))];
      for (let m = 0; m < 2; m += 1) {
        display.meterPeakAge[m] += 1;
        if (rawMeters[m] >= display.meterPeak[m] || display.meterPeakAge[m] > PEAK_HOLD_SAMPLES) {
          display.meterPeak[m] = rawMeters[m];
          display.meterPeakAge[m] = 0;
        }
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

        for (let m = 0; m < 2; m += 1) {
          const target = fresh ? (m === 0 ? meterLevel(sample.gpu) : logMeterLevel((sample.netRx ?? 0) + (sample.netTx ?? 0))) : 0;
          display.meterEased[m] = easeToward(display.meterEased[m], target, dt, 220);
          const lit = quantize(display.meterEased[m], METER_CELLS);
          // Peak reads the RAW sample, not the ease — a marker that lags the
          // value it marks is not a peak.
          const peakCell = fresh ? quantize(display.meterPeak[m], METER_CELLS) : -1;
          if (lit === display.meterLast[m] && peakCell === display.meterPeakCell[m]) continue;
          display.meterLast[m] = lit;
          display.meterPeakCell[m] = peakCell;
          const cells = meterRefs.current[m];
          for (let i = 0; i < METER_CELLS; i += 1) {
            const cell = cells[i];
            if (!cell) continue;
            const zone = i >= METER_CELLS - METER_ZONE_CELLS ? " zone" : "";
            const state = i < lit ? " lit" : i + 1 === peakCell ? " peak" : "";
            const next = `cell${zone}${state}`;
            if (cell.className !== next) cell.className = next;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [eyeRef, layoutRef, telemetryRef, display]);

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
            recognizably-generic-UI element available (design D9). The network
            meter is logarithmic: linear against any sane ceiling would sit at
            zero for everything below a megabit. */}
        {["GPU", "NET"].map((label, meter) => (
          <div className="meter" key={label}>
            <span className="label">{label}</span>
            <span className="cells">
              {Array.from({ length: METER_CELLS }, (_unused, index) => (
                <span
                  className={index >= METER_CELLS - METER_ZONE_CELLS ? "cell zone" : "cell"}
                  key={index}
                  ref={(el) => {
                    meterRefs.current[meter][index] = el;
                  }}
                />
              ))}
            </span>
          </div>
        ))}

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
