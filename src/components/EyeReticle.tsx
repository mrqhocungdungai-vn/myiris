import { useEffect, useRef } from "react";
import { EYE_READOUT, EYE_RING, type EyeState } from "../hooks/useEyeTracking";
import type { TokenAlertSeenRef, TokenLedgerRef } from "../hooks/useTokenLedger";
import {
  ACQUIRE_MS,
  ALERT_TOTAL_MS,
  EYE_RING_BOOST,
  LOCK_MS,
  LOCK_STRETCH,
  RING_R,
  VIEW_H,
  VIEW_W,
  acquireScale,
  alertPath,
  arcPath,
  dashPattern,
  gaugeTicks,
  lockSettle,
  polarPoint,
  resolveAlertLayout,
  resolveReadoutLayout,
  segmentRing,
  tetherPath,
  tickLine,
  wingPath,
  type AlertState,
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

const CROSSHAIR_DEGS = [0, 90, 180, 270];
const CROSSHAIR_INNER = 10;
const CROSSHAIR_OUTER = 22;
const CROSSHAIR = CROSSHAIR_DEGS.map((deg) => tickLine(deg, CROSSHAIR_INNER, CROSSHAIR_OUTER));

const ACCENT_MARKERS = [-ACCENT_SPAN / 2, ACCENT_SPAN / 2].map((deg) => polarPoint(62, deg));

export default function EyeReticle({
  eye,
  eyeRef,
  telemetryRef,
  ledgerRef,
  alertSeenRef,
  layoutRef,
  alertRef,
}: {
  eye: EyeState;
  /** Per-frame eye data (useEyeTracking's stateRef) — drives every transform below. */
  eyeRef: { current: EyeState };
  /**
   * Latest host measurement. Drives L1's graduation and nothing else here — the
   * ring is this capability's ALERTING instrument, so what it carries is the one
   * quantity whose rise is worth alerting on (design D12).
   */
  telemetryRef: { current: TelemetrySample };
  /**
   * Shared with EyeReadout. This component OWNS it: it is mounted first, so it
   * resolves the layout early in the frame and the panel reads the value this
   * same frame rather than the previous one (design D10 — one shared
   * frame-normalized position, never one element measured off the other).
   */
  layoutRef: { current: ReadoutLayout };
  /**
   * The token account. Read for ONE thing here — whether a run has finished
   * since the last frame — and for nothing else. The ring's dial keeps reading
   * the host measurement above; a token figure never drives any ring element.
   */
  ledgerRef: TokenLedgerRef;
  /**
   * Which completion has already been announced. App-level, so it survives the
   * remounts a blink causes, and re-armed on every mount below — an alert is a
   * notification, not a record, and work that finished while nothing was
   * rendering is not announced afterwards.
   */
  alertSeenRef: TokenAlertSeenRef;
  /**
   * Shared with EyeTokenAlert, on exactly the terms layoutRef is shared with
   * EyeReadout: this component OWNS it, resolves it early in the frame, and the
   * badge reads the value this same frame rather than the previous one.
   */
  alertRef: { current: AlertState };
}) {
  const ringRef = useRef<SVGGElement | null>(null);
  const accentRef = useRef<SVGGElement | null>(null);
  const tetherGroupRef = useRef<SVGGElement | null>(null);
  const tetherLineRef = useRef<SVGPathElement | null>(null);
  const tetherDotRef = useRef<SVGCircleElement | null>(null);
  const tetherTickRef = useRef<SVGLineElement | null>(null);
  const dialTickRefs = useRef<Array<SVGLineElement | null>>([]);
  const crossRefs = useRef<Array<SVGLineElement | null>>([]);
  const coreRef = useRef<SVGCircleElement | null>(null);
  // Last painted lit count, so only the ticks that actually changed are
  // rewritten — a handful of attribute writes a second, not 24 per frame.
  const litTicksRef = useRef(-1);
  const alertGroupRef = useRef<SVGGElement | null>(null);
  const alertLineRef = useRef<SVGPathElement | null>(null);
  const alertDotRef = useRef<SVGCircleElement | null>(null);
  const alertTickRef = useRef<SVGLineElement | null>(null);

  useEffect(() => {
    let raf = 0;

    // Whatever ran before this overlay existed is ALREADY SEEN. This component
    // mounts on face acquisition, so without this line every re-acquire — every
    // blink, every camera-on — would announce the last run again, possibly an
    // hour old. Presenting old work as news is worse than not presenting it.
    alertSeenRef.current = ledgerRef.current.claude.at;
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

      // L1's graduation, from the measured processor load. The dial itself
      // stays STATIC — it is the fixed reference the rotating layers are read
      // against, and lighting a tick is not moving it.
      const lit = gaugeTicks(telemetryRef.current.cpu, DIAL_TICKS.length);
      if (lit !== litTicksRef.current) {
        const from = Math.min(lit, Math.max(0, litTicksRef.current));
        const to = Math.max(lit, litTicksRef.current);
        for (let i = from; i < to; i += 1) {
          const node = dialTickRefs.current[i];
          if (!node) continue;
          const long = DIAL_TICKS[i].long ? " long" : "";
          node.setAttribute("class", `eye-tick${long}${i < lit ? " lit" : ""}`);
        }
        litTicksRef.current = lit;
      }

      // The lock beat (design D12/R2): the crosshair is drawn long at the
      // instant convergence completes and snaps back over LOCK_MS, so the
      // sequence resolves into a hold instead of simply ending.
      if (elapsed <= ACQUIRE_MS + LOCK_MS) {
        const settle = lockSettle(elapsed);
        const outer = CROSSHAIR_OUTER * (1 + (LOCK_STRETCH - 1) * settle);
        for (let i = 0; i < CROSSHAIR_DEGS.length; i += 1) {
          const node = crossRefs.current[i];
          if (!node) continue;
          const line = tickLine(CROSSHAIR_DEGS[i], CROSSHAIR_INNER, outer);
          node.setAttribute("x2", String(line.x2));
          node.setAttribute("y2", String(line.y2));
        }
        const core = coreRef.current;
        if (core) core.setAttribute("r", String(2.6 * (1 + settle)));
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

      // ---- the completed-run announcement (token-accounting).
      //
      // Everything above this line belongs to the ring and to the panel's
      // tether, and NONE of it is touched here: not the crosshair, not the
      // core, not the dial, not lockSettle. That beat already means "the target
      // is held", and one signal must not carry two meanings — a user cannot
      // tell "I have been locked onto" from "a run finished" if both are drawn
      // with the same elements. This borrows the OTHER established arrival, the
      // tether's staged reveal, which is why the block below is a near-mirror
      // of the one above it.
      const alert = alertRef.current;
      const claude = ledgerRef.current.claude;
      // The trigger is a change in the account's own timestamp. Nothing fires
      // for the voice engine at all: its usage arrives several times a second
      // while anyone is talking, there is no unit boundary in that stream that
      // would not be invented, and flashing on it would put a strobe beside the
      // user's face. Its figure is on the panel continuously instead.
      if (claude.at !== null && claude.at !== alertSeenRef.current) {
        // Marked seen either way. With no ring eye there is nothing to announce
        // beside, and the announcement is NOT deferred until one appears — an
        // alert is a notification, not a record, and the tokens are already in
        // the panel's totals.
        alertSeenRef.current = claude.at;
        if (ringEye) {
          // ONE SLOT, newest wins: a second completion replaces the visible
          // badge and restarts the envelope rather than queueing behind it. A
          // queued figure would still be on screen after the panel's total had
          // moved past it, which is a readout disagreeing with itself.
          alert.shownAt = now;
          alert.at = claude.at;
          alert.tokens = claude.last;
        }
      }

      const alertGroup = alertGroupRef.current;
      if (alert.shownAt !== null) {
        const alertElapsed = now - alert.shownAt;
        // The expiry is checked UNCONDITIONALLY, outside the ringEye/alertGroup
        // guard below. Gated behind them, an announcement whose face was lost
        // mid-envelope would keep its state forever and flash a stale figure for
        // one frame the moment the face came back — a bounded lifetime has to
        // hold whether or not anything is drawing it.
        if (alertElapsed >= ALERT_TOTAL_MS) {
          // Cleared rather than left at zero so nothing of it remains, and so
          // the badge's own loop can tell "gone" from "not yet".
          alert.shownAt = null;
          alert.tokens = null;
          alert.connector = 0;
          alert.badge = 0;
          if (alertGroup) alertGroup.style.opacity = "0";
        } else if (ringEye && alertGroup) {
          resolveAlertLayout(ringEye.center, alertElapsed, alert);
          alertLineRef.current?.setAttribute("d", alertPath(ringEye.center, alert));
          alertDotRef.current?.setAttribute("cx", String(ringEye.center.x * VIEW_W));
          alertDotRef.current?.setAttribute("cy", String(ringEye.center.y * VIEW_H));
          const alertAnchorX = alert.anchorX * VIEW_W;
          const alertAnchorY = alert.anchorY * VIEW_H;
          const alertTick = alertTickRef.current;
          if (alertTick) {
            alertTick.setAttribute("x1", String(alertAnchorX));
            alertTick.setAttribute("x2", String(alertAnchorX));
            alertTick.setAttribute("y1", String(alertAnchorY - 6));
            alertTick.setAttribute("y2", String(alertAnchorY + 6));
          }
          alertGroup.style.opacity = String(alert.connector);
          alertLineRef.current?.style.setProperty("stroke-dashoffset", String(1 - alert.connector));
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [eyeRef, layoutRef, telemetryRef, ledgerRef, alertSeenRef, alertRef]);

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

      {/* The announcement's connector, in the ring's own coordinate system and
          drawn with the same pathLength trick as the tether — but running the
          other way, outward from the RING eye toward the frame's right, so the
          two instruments stay in their own halves of the frame and cannot
          collide whatever the head does. Nothing inside `.eye-ring` below is
          touched by it. */}
      <g className="eye-alert-tether" ref={alertGroupRef} style={{ opacity: 0 }}>
        <path ref={alertLineRef} pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1 }} />
        <circle ref={alertDotRef} className="eye-alert-origin" r={2.2} />
        <line ref={alertTickRef} className="eye-alert-tick" />
      </g>

      <g className="eye-ring" ref={ringRef}>
        {/* L0 — wing brackets flanking left and right. Static. */}
        <path className="eye-wing" d={wingPath(130, 90, 46, 14)} />
        <path className="eye-wing" d={wingPath(130, 270, 46, 14)} />

        {/* L1 — the graduated dial. Static, and with L3 it is the fixed
            reference the rotations are read against (spec: "A static reference
            is always present"). Do not animate it for extra motion. */}
        {DIAL_TICKS.map((tick, index) => (
          <line
            key={tick.deg}
            className={`eye-tick${tick.long ? " long" : ""}`}
            ref={(el) => {
              dialTickRefs.current[index] = el;
            }}
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
          <line
            key={index}
            className="eye-cross"
            ref={(el) => {
              crossRefs.current[index] = el;
            }}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        ))}
        <circle className="eye-core" ref={coreRef} r={2.6} />
      </g>
    </svg>
  );
}
