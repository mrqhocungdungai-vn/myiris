import { useEffect, useRef } from "react";
import { EYE_READOUT, type EyeState } from "../hooks/useEyeTracking";
import { READOUT_GEOMETRY, type ReadoutLayout } from "../lib/eye-hud";

// The telemetry callout beside the readout eye. Plain HTML, not SVG
// (design D10): its layout depends on real font metrics, letter-spacing and
// tabular figures, none of which SVG <text> provides. This is the same overlay
// pattern HandReticles.tsx already uses — an absolutely positioned HTML
// element whose transform is written every frame by a rAF loop, mounted or not
// by semantically-gated React state.

const METER_CELLS = 14;
// Slow enough to read a value before it changes, fast enough that the panel
// never reads as a screenshot pasted over the video.
const CHURN_MS = 130;

type Row = { key: string; label: string; accent?: boolean };

// Deliberately terse and denser than it is readable — that density is what
// makes it read as instrumentation rather than as a label (design D9). None of
// it is wired to a real signal, and the SIM token in the header says so.
const ROWS: Row[] = [
  { key: "sacc", label: "SACC" },
  { key: "aper", label: "APER" },
  { key: "vec", label: "Δ-VEC", accent: true },
  { key: "phz", label: "PHZ" },
];

/** Time-driven so the churn is smooth and deterministic rather than a random walk. */
function churnValues(seconds: number): Record<string, string> {
  const saccade = Math.round(96 + 46 * Math.sin(seconds * 1.7) + 9 * Math.sin(seconds * 5.3));
  const aperture = 4.4 + 0.9 * Math.sin(seconds * 0.9 + 1.2);
  const vector = -18 + 32 * Math.sin(seconds * 1.3 + 0.4);
  const phase = Math.floor(((Math.sin(seconds * 2.1) + 1) / 2) * 0xffff);
  return {
    // Digit counts genuinely vary here (2 ↔ 3). The row must not twitch, which
    // is what the right-aligned tabular-figure value column is for.
    sacc: `${saccade} ms`,
    aper: `${aperture.toFixed(2)} mm`,
    vec: vector.toFixed(1),
    phz: `0x${phase.toString(16).toUpperCase().padStart(4, "0")}`,
  };
}

export default function EyeReadout({
  eye,
  eyeRef,
  layoutRef,
}: {
  eye: EyeState;
  eyeRef: { current: EyeState };
  /**
   * Resolved by EyeReticle earlier in the same frame — the one shared
   * frame-normalized position the tether's far end also derives from, so the
   * two stay in register without either measuring the other (design D10).
   */
  layoutRef: { current: ReadoutLayout };
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const valueRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const meterRefs = useRef<Array<Array<HTMLSpanElement | null>>>([[], []]);
  // The frame's pixel size, kept by a ResizeObserver rather than measured each
  // frame — which also means the HUD's camera-zoom toggle rescales the panel
  // live, with no re-tuning and no reinitialization.
  const frameSizeRef = useRef({ width: 0, height: 0 });

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
    let lastChurn = 0;
    const loop = () => {
      const live = eyeRef.current;
      const readoutEye = live.eyes[EYE_READOUT];
      const panel = panelRef.current;
      if (readoutEye && panel) {
        const layout = layoutRef.current;
        const { width, height } = frameSizeRef.current;
        // The anchor is the panel's NEAR edge, vertically centered — so the
        // side flip is a change of which edge is pinned, not a re-measurement.
        panel.style.transform =
          `translate(${layout.anchorX * width}px, ${layout.anchorY * height}px)` +
          ` translate(${layout.side === "right" ? "0" : "-100%"}, -50%)`;
        panel.style.opacity = String(layout.panel);

        const now = performance.now();
        if (now - lastChurn >= CHURN_MS) {
          lastChurn = now;
          const values = churnValues(now / 1000);
          for (const row of ROWS) {
            const node = valueRefs.current[row.key];
            if (node) node.textContent = values[row.key];
          }
          const seconds = now / 1000;
          const levels = [0.5 + 0.42 * Math.sin(seconds * 0.8), 0.5 + 0.46 * Math.sin(seconds * 1.9 + 2.1)];
          levels.forEach((level, meter) => {
            const lit = Math.round(level * METER_CELLS);
            meterRefs.current[meter].forEach((cell, index) => {
              if (cell) cell.className = index < lit ? "cell lit" : "cell";
            });
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [eyeRef, layoutRef]);

  if (!eye.present) return null;

  return (
    <div className="eye-readout-layer" ref={layerRef} aria-hidden="true">
      <div
        className="eye-readout"
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
          <span className="tag">OCULAR</span>
          <span className="token">SIM</span>
        </div>

        {ROWS.map((row) => (
          <div className={`row ${row.accent ? "accent" : ""}`} key={row.key}>
            <span className="label">{row.label}</span>
            <span
              className="value"
              ref={(el) => {
                valueRefs.current[row.key] = el;
              }}
            >
              —
            </span>
          </div>
        ))}

        {/* Segmented, never a smooth fill — a smooth progress bar is the most
            recognizably-generic-UI element available (design D9). */}
        {["COH", "SIG"].map((label, meter) => (
          <div className="meter" key={label}>
            <span className="label">{label}</span>
            <span className="cells">
              {Array.from({ length: METER_CELLS }, (_, index) => (
                <span
                  className="cell"
                  key={index}
                  ref={(el) => {
                    meterRefs.current[meter][index] = el;
                  }}
                />
              ))}
            </span>
          </div>
        ))}

        <div className="foot">▏▎▍▌▋▊▉ ▁▂▃▄▅▆▇ ◦◦◦</div>
      </div>
    </div>
  );
}
