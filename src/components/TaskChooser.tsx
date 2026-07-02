import { useEffect } from "react";
import { X } from "lucide-react";
import type { TaskCard } from "../types";
import { shortRunId } from "../lib/tasks";

export default function TaskChooser({
  query,
  matches,
  onOpen,
  onClose,
}: {
  query: string;
  matches: TaskCard[];
  onOpen: (task: TaskCard) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      const index = Number(event.key);
      if (index >= 1 && index <= matches.length) {
        onOpen(matches[index - 1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matches, onClose, onOpen]);

  return (
    <div
      className="match-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="match-card">
        <div className="match-head">
          <span>Which task did you mean?</span>
          <button className="reader-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <p className="match-query">Matched voice query: “{query || "task"}”</p>
        <div className="match-list">
          {matches.map((task, index) => (
            <button key={task.id} className="match-option" onClick={() => onOpen(task)}>
              <span className="match-number">{index + 1}</span>
              <span className="match-copy">
                <strong>{task.task}</strong>
                <em>
                  {task.status} · {shortRunId(task.id)}
                </em>
              </span>
            </button>
          ))}
        </div>
        <div className="match-hint">Press 1-{matches.length}, click a result, or press Esc.</div>
      </section>
    </div>
  );
}
