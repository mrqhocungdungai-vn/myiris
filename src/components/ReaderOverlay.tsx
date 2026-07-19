import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskCard } from "../types";
import { normalizeMarkdown, shortRunId } from "../lib/tasks";
import type { HandState } from "../hooks/useHandControl";
import { AgentBadge } from "./WorkCard";

export default function ReaderOverlay({
  task,
  hand,
  onClose,
}: {
  task: TaskCard;
  hand: HandState | null;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [readerScale, setReaderScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const handRef = useRef<HandState | null>(hand);
  const readerScaleRef = useRef(1);
  const zoomRef = useRef<{ distance: number; scale: number } | null>(null);
  handRef.current = hand;

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
    let raf = 0;
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const loop = () => {
      const h = handRef.current;
      const body = bodyRef.current;
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

      if (openHands.length < 2 && h?.openPalm && h.point && body) {
        const rect = body.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const deadZone = Math.max(24, rect.height * 0.12);
        const delta = h.point.y - center;
        if (Math.abs(delta) > deadZone) {
          const reach = rect.height / 2 - deadZone;
          const norm = Math.max(-1, Math.min(1, (delta - Math.sign(delta) * deadZone) / reach));
          body.scrollTop += norm * 26;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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
          <span className={`badge ${task.status.toLowerCase()}`}>{task.status}</span>
          <AgentBadge agent={task.agent} model={task.model} />
          <code
            title={
              task.claudeSessionId
                ? `Claude session ${task.claudeSessionId} (run ${task.id})`
                : `run ${task.id} — the Claude session id appears once the run starts`
            }
          >
            {task.claudeSessionId ? `⛓ ${shortRunId(task.claudeSessionId)}` : shortRunId(task.id)}
          </code>
          <button className="reader-close" onPointerDown={(event) => event.stopPropagation()} onClick={closeWithSnap} title="Close">
            <X size={16} />
          </button>
        </header>
        <h2 className="reader-title">{task.task}</h2>
        <div className="reader-body" ref={bodyRef}>
          <div className={`markdown-body ${task.error ? "error" : ""}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdown(task.error || task.output)}</ReactMarkdown>
          </div>
        </div>
        <div className="reader-hint">
          {hand
            ? "Open palm — hold high/low to scroll · Two open palms resize · Fist to close"
            : "Scroll to read · Esc or × to close"}
        </div>
      </article>
    </div>
  );
}
