import { useEffect, useRef } from "react";
import { EYE_READOUT, EYE_RING, type EyeState } from "../hooks/useEyeTracking";
import {
  EYE_RING_BOOST,
  RING_R,
  VIEW_H,
  VIEW_W,
  acquireScale,
  arcPath,
  dashPattern,
  polarPoint,
  resolveReadoutLayout,
  segmentRing,
  tetherPath,
  tickLine,
  wingPath,
  type ReadoutLayout,
} from "../lib/eye-hud";

// The lock-on reticle and the readout's tether, in ONE svg whose viewBox
// (400×300) matches `.camera-frame`'s 4/3 aspect, with the default
// preserveAspectRatio — so its units are square and a circle is a circle.
// Deliberately not HandSkeleton's `0 0 100 100` + `preserveAspectRatio="none"`
// overlay, which is anisotropic: reusing it would render every ring as an
// ellipse stretched 33% wide (design D10).
//
// Positioning follows HandSkeleton's pattern otherwise: React state decides
// whether anything mounts, and a rAF loop writes attributes through refs, so
// a moving face never re-renders the app.

// Dash arrays are written against a normalized pathLength, so one pattern
// reads identically at any radius.
const PATH_LEN = 120;

// The rotating layers' periods. Pairwise distinct AND non-harmonic on purpose
// (spec: "Rotations never lock into a single rigid spin") — with harmonically
// related periods the stack re-synchronizes on a fixed cycle and momentarily
// reads as one rigid spinning image. Round numbers like 4/8/12 are the trap.
const SEGMENT_PERIOD = "12s";
const CORAL_PERIOD = "7s";
const AMBER_PERIOD = "5s";
// The accent arc's, in ms — it is rotated imperatively, not by CSS (see below).
const ACCENT_PERIOD_MS = 3200;

const ACCENT_SPAN = 110;

// L1: a 24-tick graduated dial, long every 90°. The coral/amber alternation
// falls out of the long/short alternation for free — one "hazard stripe"
// treatment, no separate colour logic.
const DIAL_TICKS = Array.from({ length: 24 }, (_, i) => {
  const deg = i * 15;
  const long = deg % 90 === 0;
  return { ...tickLine(deg, 106, long ? 124 : 117), long, deg };
});

const CROSSHAIR = [0, 90, 180, 270].map((deg) => tickLine(deg, 10, 22));

const ACCENT_MARKERS = [-ACCENT_SPAN / 2, ACCENT_SPAN / 2].map((deg) => polarPoint(62, deg));

export default function EyeReticle({
  eye,
  eyeRef,
  layoutRef,
}: {
  eye: EyeState;
  /** Per-frame eye data (useEyeTracking's stateRef) — drives every transform below. */
  eyeRef: { current: EyeState };
  /**
   * Shared with EyeReadout. This component OWNS it: it is mounted first, so it
   * resolves the layout early in the frame and the panel reads the value this
   * same frame rather than the previous one (design D10 — one shared
   * frame-normalized position, never one element measured off the other).
   */
  layoutRef: { current: ReadoutLayout };
}) {
  const ringRef = useRef<SVGGElement | null>(null);
  const accentRef = useRef<SVGGElement | null>(null);
  const tetherGroupRef = useRef<SVGGElement | null>(null);
  const tetherLineRef = useRef<SVGPathElement | null>(null);
  const tetherDotRef = useRef<SVGCircleElement | null>(null);
  const tetherTickRef = useRef<SVGLineElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const live = eyeRef.current;
      const now = performance.now();
      const elapsed = now - live.acquiredAt;

      const ringEye = live.eyes[EYE_RING];
      const ring = ringRef.current;
      if (ringEye && ring) {
        // The acquire is folded into the scale THIS loop already writes.
        // A CSS transition or @keyframes on this transform would be cancelled
        // by the next frame's write — design D8, the same class of mistake as
        // the accent arc's pivot below.
        const scale = (ringEye.radius * VIEW_W * EYE_RING_BOOST) / RING_R;
        const converge = acquireScale(elapsed);
        ring.setAttribute(
          "transform",
          `translate(${ringEye.center.x * VIEW_W} ${ringEye.center.y * VIEW_H}) scale(${scale * converge})`,
        );
      }

      // The accent arc is a PARTIAL arc, so its own bounding box is not
      // centered on the circle it belongs to: `transform-box: fill-box;
      // transform-origin: center` would pivot it around that off-center
      // centroid and it would visibly orbit rather than spin in place.
      // SVG's single-argument rotate() pivots around the local origin, which
      // IS the tracked eye's center here by construction (design D7). Any
      // future partial-sweep element added to this HUD inherits this.
      const accent = accentRef.current;
      if (accent) {
        accent.setAttribute("transform", `rotate(${((now % ACCENT_PERIOD_MS) / ACCENT_PERIOD_MS) * 360})`);
      }

      const readoutEye = live.eyes[EYE_READOUT];
      const tetherGroup = tetherGroupRef.current;
      if (readoutEye && tetherGroup) {
        const layout = resolveReadoutLayout(readoutEye.center, elapsed, layoutRef.current);
        const anchorX = layout.anchorX * VIEW_W;
        const anchorY = layout.anchorY * VIEW_H;

        // Both endpoints are recomputed here every frame — the eye end because
        // the head moves, the panel end because the panel hangs off the eye
        // (spec: "The connector tracks both ends").
        tetherLineRef.current?.setAttribute("d", tetherPath(readoutEye.center, layout));
        tetherDotRef.current?.setAttribute("cx", String(readoutEye.center.x * VIEW_W));
        tetherDotRef.current?.setAttribute("cy", String(readoutEye.center.y * VIEW_H));
        const tick = tetherTickRef.current;
        if (tick) {
          tick.setAttribute("x1", String(anchorX));
          tick.setAttribute("x2", String(anchorX));
          tick.setAttribute("y1", String(anchorY - 7));
          tick.setAttribute("y2", String(anchorY + 7));
        }
        // pathLength="1" makes the draw-on a plain dashoffset with no length
        // measurement — the tether extends before the panel unfolds at its end.
        tetherGroup.style.opacity = String(layout.tether);
        tetherLineRef.current?.style.setProperty("stroke-dashoffset", String(1 - layout.tether));
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [eyeRef, layoutRef]);

  if (!eye.present) return null;

  return (
    <svg className="eye-reticle" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
      <defs>
        {/* Stop colours are set in claude.css, not here: `var()` resolves in a
            CSS declaration but not in an SVG presentation attribute, so the
            token would silently render as nothing if written inline. */}
        <linearGradient id="eye-accent-sweep" gradientUnits="userSpaceOnUse" x1="-62" y1="0" x2="62" y2="0">
          <stop className="eye-accent-fade" offset="0" />
          <stop className="eye-accent-mid" offset="0.55" />
          <stop className="eye-accent-full" offset="1" />
        </linearGradient>
      </defs>

      {/* The tether lives here rather than with the panel: it is a line, it
          needs no text, and one of its ends must reach the ring's coordinate
          system (design D10). */}
      <g className="eye-tether" ref={tetherGroupRef} style={{ opacity: 0 }}>
        <path ref={tetherLineRef} pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1 }} />
        <circle ref={tetherDotRef} className="eye-tether-origin" r={2.6} />
        <line ref={tetherTickRef} className="eye-tether-tick" />
      </g>

      <g className="eye-ring" ref={ringRef}>
        {/* L0 — wing brackets flanking left and right. Static. */}
        <path className="eye-wing" d={wingPath(130, 90, 46, 14)} />
        <path className="eye-wing" d={wingPath(130, 270, 46, 14)} />

        {/* L1 — the graduated dial. Static, and with L3 it is the fixed
            reference the rotations are read against (spec: "A static reference
            is always present"). Do not animate it for extra motion. */}
        {DIAL_TICKS.map((tick) => (
          <line
            key={tick.deg}
            className={`eye-tick ${tick.long ? "long" : ""}`}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        ))}

        {/* L2 — three unequal cyan arcs. CW. */}
        <circle
          className="eye-layer cyan spin-cw"
          style={{ animationDuration: SEGMENT_PERIOD }}
          r={100}
          pathLength={PATH_LEN}
          strokeDasharray={segmentRing(PATH_LEN, [5, 3, 2], 6)}
        />

        {/* L3 — the solid bezel, plus an inner highlight rim. Static. */}
        <circle className="eye-bezel" r={92} />
        <circle className="eye-rim" r={88} />

        {/* L4 — dashed coral. CCW: adjacent rotating layers must counter-rotate
            (spec), which is only legible between neighbours. */}
        <circle
          className="eye-layer coral spin-ccw"
          style={{ animationDuration: CORAL_PERIOD }}
          r={78}
          pathLength={PATH_LEN}
          strokeDasharray={dashPattern(PATH_LEN, 14, 0.55, 10)}
        />

        {/* L5 — the accent sweep and the markers riding it, in the group that
            gets the imperative rotate() above. CW. */}
        <g ref={accentRef}>
          <path className="eye-accent" d={arcPath(62, -ACCENT_SPAN / 2, ACCENT_SPAN)} />
          {ACCENT_MARKERS.map((marker, index) => (
            <circle key={index} className="eye-accent-dot" cx={marker.x} cy={marker.y} r={2.8} />
          ))}
        </g>

        {/* L6 — dashed amber. CCW. */}
        <circle
          className="eye-layer amber spin-ccw"
          style={{ animationDuration: AMBER_PERIOD }}
          r={46}
          pathLength={PATH_LEN}
          strokeDasharray={dashPattern(PATH_LEN, 9, 0.6, 14)}
        />

        {/* L7 — center crosshair. Static, pulsing dot. */}
        {CROSSHAIR.map((tick, index) => (
          <line key={index} className="eye-cross" x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
        ))}
        <circle className="eye-core" r={2.6} />
      </g>
    </svg>
  );
}
