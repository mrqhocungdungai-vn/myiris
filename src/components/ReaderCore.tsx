import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import type { HandState } from "../hooks/useHandControl";

// Extracted from ReaderOverlay (second-brain-galaxy-view design.md D6): the
// `.reader-backdrop`/`.reader-card` DOM, drag-to-dismiss, two-palm zoom,
// palm-scroll rAF loop, and Esc/X close — everything that isn't
// task-specific chrome. `ReaderOverlay` passes its status/agent/run-id
// badges via `headerSlot` and its rendered markdown via `body`; `NoteReader`
// passes no `headerSlot` and its own markdown. Keep `.reader-backdrop` in
// App.tsx's click-through allowlist (~line 422) — this class is what makes
// either reader clickable at all in the HUD.
export default function ReaderCore({
  title,
  body,
  footerHint,
  headerSlot,
  hand,
  handRef,
  gesturesEnabled,
  onClose,
}: {
  title: string;
  body: ReactNode;
  footerHint: string;
  headerSlot?: ReactNode;
  hand: HandState | null;
  /**
   * Per-frame hand data (useHandControl's stateRef) — read every rAF, not
   * React state. `{ current: null }` is safe (e.g. NoteReader with hand
   * control off) — the loop below reads it via `?.`.
   */
  handRef: { current: HandState | null };
  /**
   * Gates the palm-scroll/two-palm-resize rAF loop (second-brain-gesture-nav
   * design.md D6/M-A1): without this, the loop's `useEffect(…, [])` would
   * schedule a frame for as long as any reader is mounted, even with hand
   * control off — a no-op 60fps loop over an empty hand ref.
   */
  gesturesEnabled: boolean;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [readerScale, setReaderScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readerScaleRef = useRef(1);
  const zoomRef = useRef<{ distance: number; scale: number } | null>(null);

  const CLOSE_DISTANCE = 160;

  function closeWithSnap() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeWithSnap();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing, onClose]);

  useEffect(() => {
    if (hand?.fist) closeWithSnap();
  }, [hand?.fist]);

  // Joystick-style hold-to-scroll: with an open palm, holding the hand above the
  // card's center scrolls up, below scrolls down, and the middle is a dead zone.
  // Two open palms control reader scale instead.
  useEffect(() => {
    if (!gesturesEnabled) return;
    let raf = 0;
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const loop = () => {
      const h = handRef.current;
      const bodyEl = bodyRef.current;
      const openHands = h?.hands.filter((item) => item.openPalm && item.point) ?? [];
      if (openHands.length >= 2) {
        const currentDistance = distance(openHands[0].point, openHands[1].point);
        if (!zoomRef.current) {
          zoomRef.current = { distance: currentDistance, scale: readerScaleRef.current };
        }
        const ratio = currentDistance / Math.max(80, zoomRef.current.distance);
        const next = Math.max(0.72, Math.min(1.28, zoomRef.current.scale * ratio));
        if (Math.abs(next - readerScaleRef.current) > 0.004) {
          readerScaleRef.current = next;
          setReaderScale(next);
        }
      } else {
        zoomRef.current = null;
      }

      if (openHands.length < 2 && h?.openPalm && h.point && bodyEl) {
        const rect = bodyEl.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const deadZone = Math.max(24, rect.height * 0.12);
        const delta = h.point.y - center;
        if (Math.abs(delta) > deadZone) {
          const reach = rect.height / 2 - deadZone;
          const norm = Math.max(-1, Math.min(1, (delta - Math.sign(delta) * deadZone) / reach));
          bodyEl.scrollTop += norm * 26;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gesturesEnabled]);

  function beginDrag(clientX: number, clientY: number, target: HTMLElement, pointerId: number) {
    startRef.current = { x: clientX, y: clientY };
    setDragging(true);
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!startRef.current) return;
    setOffset({ x: clientX - startRef.current.x, y: clientY - startRef.current.y });
  }

  function endDrag() {
    if (!startRef.current) return;
    const distance = Math.hypot(offset.x, offset.y);
    startRef.current = null;
    setDragging(false);
    if (distance > CLOSE_DISTANCE) {
      closeWithSnap();
    } else {
      setOffset({ x: 0, y: 0 });
    }
  }

  const dim = Math.min(1, Math.hypot(offset.x, offset.y) / (CLOSE_DISTANCE * 2));

  return (
    <div
      className={`reader-backdrop ${closing ? "closing" : ""}`}
      style={{ opacity: 1 - dim * 0.6 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeWithSnap();
      }}
    >
      <article
        className={`reader-card ${dragging ? "dragging" : ""} ${closing ? "closing" : ""}`}
        style={{
          "--reader-transform": `translate(${offset.x}px, ${offset.y}px) scale(${readerScale * (1 - dim * 0.08)})`,
        } as CSSProperties}
      >
        <header
          className="reader-grab"
          onPointerDown={(event) => beginDrag(event.clientX, event.clientY, event.currentTarget, event.pointerId)}
          onPointerMove={(event) => dragging && moveDrag(event.clientX, event.clientY)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="reader-grip" />
          {headerSlot}
          <button className="reader-close" onPointerDown={(event) => event.stopPropagation()} onClick={closeWithSnap} title="Close">
            <X size={16} />
          </button>
        </header>
        <h2 className="reader-title">{title}</h2>
        <div className="reader-body" ref={bodyRef}>
          {body}
        </div>
        <div className="reader-hint">{footerHint}</div>
      </article>
    </div>
  );
}
