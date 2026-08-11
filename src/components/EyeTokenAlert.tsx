import { useEffect, useRef, useState } from "react";
import { EYE_RING, type EyeState } from "../hooks/useEyeTracking";
import { ALERT_GEOMETRY, type AlertState } from "../lib/eye-hud";
import { formatTokens } from "../lib/telemetry-format";

// The completed-run announcement's badge (token-accounting): what that unit of
// work consumed, beside the ring's eye, for a few seconds.
//
// Plain HTML, not SVG, for the reason the readout panel is HTML: it renders a
// number, and SVG <text> gives no tabular figures, no letter-spacing and no
// real font metrics. Its connector IS SVG and lives in EyeReticle, which is the
// same split by material the panel and its tether already make.
//
// It belongs to the ring — this capability's ALERTING instrument — because a
// unit of work finishing is an event, while a running total is a report and
// belongs to the panel. It is emphatically NOT a second panel: it is transient,
// it dismisses itself, it leaves nothing behind, and the rule fixing one
// persistent element per eye is untouched by it.
//
// EyeReticle owns the alert's state and resolves its position each frame; this
// component only draws. Neither measures the other — the shared ref carries one
// frame-normalized position, exactly as it does for the panel.

export default function EyeTokenAlert({
  eye,
  eyeRef,
  alertRef,
}: {
  eye: EyeState;
  /** Per-frame eye data. Read only to know whether the ring's eye is still there. */
  eyeRef: { current: EyeState };
  /** Resolved by EyeReticle earlier in the same frame. Read, never written. */
  alertRef: { current: AlertState };
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const frameSizeRef = useRef({ width: 0, height: 0 });

  // React state that flips ONCE PER EVENT, never per frame — the same rule
  // `eye.present` follows. The figure lives here rather than being written by
  // the loop, which is what makes it hold still: it is rendered once when the
  // badge appears and is never re-formatted, and there is no count-up. It is a
  // measured amount, and animating it would draw values that were never
  // reported.
  const [shown, setShown] = useState<{ at: number; text: string } | null>(null);

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
    // Mirrors what React last rendered, so the loop can tell a genuinely new
    // event from the one already on screen without reading state it captured.
    let renderedAt: number | null = null;

    const loop = () => {
      const alert = alertRef.current;
      const at = alert.shownAt !== null ? alert.at : null;
      const active = at !== null;

      if (at !== null && at !== renderedAt) {
        // A new completion. One slot: this REPLACES whatever was showing and
        // its lifetime starts again, rather than queueing — the two are never
        // on screen together.
        renderedAt = at;
        setShown({ at, text: formatTokens(alert.tokens) });
      } else if (!active && renderedAt !== null) {
        renderedAt = null;
        setShown(null);
      }

      const badge = badgeRef.current;
      const ringEye = eyeRef.current.eyes[EYE_RING];
      if (badge && active && ringEye) {
        const { width, height } = frameSizeRef.current;
        // The anchor is the badge's LEFT edge, vertically centered: it hangs
        // rightward from its eye and never crosses it, so the pinned edge is
        // fixed and the frame's right edge clips it rather than moving it.
        //
        // Written here and not in CSS, and the reason is recorded at
        // EyeReticle.tsx's own loop: a transition or @keyframes on a transform
        // this loop rewrites is cancelled by the next frame's write. It fails
        // silently rather than loudly, which is why it has happened twice.
        badge.style.transform =
          `translate(${alert.anchorX * width}px, ${alert.anchorY * height}px) translate(0, -50%)`;
        badge.style.opacity = String(alert.badge);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [alertRef, eyeRef]);

  if (!eye.present) return null;

  return (
    <div className="eye-alert-layer" ref={layerRef} aria-hidden="true">
      {shown ? (
        <div
          className="eye-alert"
          ref={badgeRef}
          key={shown.at}
          style={{ width: `${ALERT_GEOMETRY.width * 100}%`, opacity: 0 }}
        >
          {/* Labelled with the engine, so the badge is unambiguous next to a
              panel that carries both. */}
          <span className="tag">CLD</span>
          <span className="value">{shown.text}</span>
        </div>
      ) : null}
    </div>
  );
}
