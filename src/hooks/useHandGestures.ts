import { useEffect, useRef, useState } from "react";
import { dwellFrame, type DwellHold } from "../lib/pointer-dwell";
import { isHudChrome } from "../lib/hudChrome";
import { orbGestureEngaged } from "../lib/gestureContext";
import type { HandPoint, HandState } from "./useHandControl";

// The three hand-driven rAF loops: dwell-to-click, open-palm scroll, and the
// fist/pinch orb drive.
//
// They are one hook because they are one negotiation. Each frame, all three ask
// the same question — does this gesture belong to me right now? — against the
// same facts: whether a reader is open (which takes every gesture until it
// closes), whether an exclusive HUD layer owns the surface under the hand, and
// what the other loops are already doing. Splitting them would mean restating
// those conditions three times and hoping they stay in agreement.
//
// Only two render-visible facts escape as state; the bookkeeping (which
// element, when the hold started, whether it already fired) stays in a ref, so
// charging a dwell does not re-render the tree.

export type HandGestures = {
  /** Orb rotation, written every frame — read by ReactorCore, never rendered. */
  orbRotationRef: { current: { x: number; y: number } };
  /** Orb scale, same contract as the rotation ref. */
  orbScaleRef: { current: number };
  /** A target is being held. Drives the reticle's charging ring. */
  dwellActive: boolean;
  /** The held target already fired, so the ring stops rather than repeating. */
  dwellFired: boolean;
};

export function useHandGestures({
  handControl,
  liveHandRef,
  readerOpen,
  drawingActive,
  galaxyActive,
  showHistory,
  uiMode,
  onFocusTask,
}: {
  handControl: boolean;
  liveHandRef: { current: HandState };
  /** An open reader paints a full-screen backdrop and takes every gesture. */
  readerOpen: boolean;
  drawingActive: boolean;
  galaxyActive: boolean;
  showHistory: boolean;
  uiMode: "deck" | "hud";
  /** The card under the hand, so voice references like "this one" resolve to it. */
  onFocusTask: (id: string) => void;
}): HandGestures {
  // Bookkeeping (which element, when it started, whether it already fired)
  // stays in a ref — only the render-visible facts below become state.
  const dwellRef = useRef<DwellHold<HTMLElement>>(null);
  const [dwellActive, setDwellActive] = useState(false);
  const [dwellFired, setDwellFired] = useState(false);

  // Universal point-and-hold: the finger pointer can activate ANY clickable
  // element — task cards, close buttons, answer options, chips. Holding
  // over a target for 300ms fires a real click; the target must be left and
  // re-entered before it can fire again. Reads live per-frame hand data from
  // a ref (not React state) so charging the dwell timer never forces a
  // re-render — only entering/leaving a target or firing does (BUG F).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // Resolve what the hand is over this frame, or null if nothing dwells.
      // Every suspension reason funnels into one `null`, so releasing the hold
      // has exactly one path instead of one per early return.
      const target = resolveDwellTarget();
      const now = performance.now();
      const outcome = dwellFrame(dwellRef.current, target, now);
      dwellRef.current = outcome.hold;
      setDwellActive((prev) => (prev === outcome.active ? prev : outcome.active));
      setDwellFired((prev) => (prev === outcome.fired ? prev : outcome.fired));
      if (outcome.fire && target) target.click();
      raf = requestAnimationFrame(loop);
    };

    function resolveDwellTarget(): HTMLElement | null {
      const h = liveHandRef.current;
      // Focus mode: an open reader takes every gesture until it closes, so
      // nothing outside it dwells. (The shared mode's positional rule for a
      // coexisting layer is applied below, AFTER actionable resolves, since it
      // needs an element to test.)
      if (!handControl || !h.present || !h.point || !h.pointing || readerOpen) return null;

      const el = document.elementFromPoint(h.point.x, h.point.y);
      const actionable = el?.closest<HTMLElement>('button, a, [data-task-id], [role="button"]') ?? null;
      if (!actionable || actionable.closest("[data-no-dwell]")) return null;

      // Shared mode: a coexisting HUD layer (the drawing panel or the
      // second-brain galaxy) owns only the surface it actually occupies. Both
      // are painted BENEATH `.hud-chrome`, where the islands stay visible and
      // mouse-clickable — so the hand reaches them too, and only the layer's
      // own surface is suppressed. Testing "is a layer active" instead left
      // every island but `.hud-controls` visible, clickable, and untouchable.
      if ((drawingActive || galaxyActive) && !isHudChrome(actionable)) return null;

      // Track which card the hand is hovering so voice references like "this
      // one" / "show its steps" can resolve to it (design.md D1 focusedTaskId).
      // `focus` compares before writing, so a rAF loop hovering the same card
      // does not re-render the tree.
      const taskId = actionable.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
      if (taskId) onFocusTask(taskId);

      return actionable;
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, readerOpen, drawingActive, galaxyActive]);

  // Open-palm hold-to-scroll: scrolls whichever scrollable region (Comms or
  // Work Stream column, on the deck or in the HUD) is under the hand.
  useEffect(() => {
    let raf = 0;
    // `.hud-work` / `.hud-comms` are the HUD's own scroll containers. Without
    // them this loop only ever named deck classes, so palm-scroll in the Glass
    // HUD never worked at all — layer or no layer (design.md D4).
    const SCROLLABLES =
      ".activity-timeline, .comms-scroll, .work-scroll, .history-grid, .hud-work, .hud-comms";
    const loop = () => {
      const h = liveHandRef.current;
      // Two open palms mean scale, and only scale (design.md D5) — otherwise a
      // palm drifting over a column mid-zoom would scroll it as well.
      const twoPalms = (h?.hands.filter((item) => item.openPalm).length ?? 0) >= 2;
      if (handControl && h?.openPalm && h.point && !twoPalms && !readerOpen && !showHistory) {
        const el = document.elementFromPoint(h.point.x, h.point.y);
        // Shared mode, same positional rule as the dwell: a coexisting layer
        // owns its own surface, the chrome above it keeps its own bindings.
        const layerOwnsPoint = (drawingActive || galaxyActive) && !isHudChrome(el);
        const target = layerOwnsPoint ? null : el?.closest<HTMLElement>(SCROLLABLES) ?? null;
        if (target) {
          const rect = target.getBoundingClientRect();
          const center = rect.top + rect.height / 2;
          const deadZone = Math.max(24, rect.height * 0.12);
          const delta = h.point.y - center;
          if (Math.abs(delta) > deadZone) {
            const reach = rect.height / 2 - deadZone;
            const norm = Math.max(-1, Math.min(1, (delta - Math.sign(delta) * deadZone) / reach));
            target.scrollTop += norm * 26;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, readerOpen, showHistory, drawingActive, galaxyActive]);

  // Closed-fist rotates the Arc Reactor orb, pinch scales it — only on the
  // deck, with the reader closed and neither the drawing panel nor the
  // second-brain galaxy active. Excluded from the Glass HUD entirely: there
  // the orb is a small floating puck, not the stage, so the gesture surface
  // belongs to the HUD's own content instead (scope-orb-gesture-out-of-hud
  // design.md D1) — this never collides with the reader-open fist-close or
  // two-palm-resize bindings, nor with excalidraw/the galaxy's own input,
  // nor with whatever the HUD binds the fist to next. Written straight into
  // refs (not React state) every frame, same as the audio-level refs
  // ReactorCore already reads.
  const orbRotationRef = useRef({ x: 0, y: 0 });
  const orbScaleRef = useRef(1);
  useEffect(() => {
    let raf = 0;
    let prevFistPoint: HandPoint | null = null;
    const loop = () => {
      const h = liveHandRef.current;
      const engaged = orbGestureEngaged({
        handControl,
        handPresent: !!h?.present,
        uiMode: uiMode,
        readerOpen: !!readerOpen,
        drawingActive: drawingActive,
        secondBrainActive: galaxyActive,
      });

      if (engaged && h.fist && h.point) {
        if (prevFistPoint) {
          const dx = h.point.x - prevFistPoint.x;
          const dy = h.point.y - prevFistPoint.y;
          orbRotationRef.current = {
            x: Math.max(-0.8, Math.min(0.8, orbRotationRef.current.x + dy * 0.006)),
            y: orbRotationRef.current.y + dx * 0.006,
          };
        }
        prevFistPoint = h.point;
      } else {
        prevFistPoint = null;
      }

      if (engaged) {
        // Clamped tighter than a "natural" zoom range: the outer wireframe
        // sphere already fills ~85% of the camera frustum at scale 1, so
        // anything much past ~1.15 gets clipped by the (square) canvas
        // viewport, showing as an ugly hard-edged square cutting into the
        // circular silhouette instead of a smooth zoom.
        const norm = Math.max(0, Math.min(1, (h.pinchDistance - 0.03) / (0.3 - 0.03)));
        orbScaleRef.current = 0.7 + norm * 0.45;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, uiMode, readerOpen, drawingActive, galaxyActive]);

  return { dwellActive, dwellFired, orbRotationRef, orbScaleRef };
}
