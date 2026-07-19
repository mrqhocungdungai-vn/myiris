import { type ReactNode, type RefObject } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import type { TaskCard } from "../types";
import { acceptedKey } from "../lib/tasks";
import WorkCard from "./WorkCard";
import SessionSwitcher from "./SessionSwitcher";

export default function WorkStream({
  tasks,
  sortedTasks,
  scrollRef,
  acceptedIds,
  session,
  sessions,
  onSwitchSession,
  onNewSession,
  onShowHistory,
  onOpenTask,
  stepsOpenIds,
  onToggleTaskSteps,
  children,
}: {
  tasks: TaskCard[];
  sortedTasks: TaskCard[];
  scrollRef: RefObject<HTMLDivElement | null>;
  acceptedIds: Record<string, number>;
  session: ClaudeSession | null;
  sessions: ClaudeSession[];
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onShowHistory: () => void;
  onOpenTask: (task: TaskCard) => void;
  stepsOpenIds: Record<string, boolean>;
  onToggleTaskSteps: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <aside className="deck-panel deck-right">
      <div className="col-head">
        <Terminal size={13} />
        <span>Work Stream</span>
        {tasks.length > 0 ? <span className="count">{tasks.length}</span> : null}
        {tasks.length > 3 ? (
          <button className="view-all" onClick={onShowHistory}>
            View all <ChevronRight size={12} />
          </button>
        ) : null}
      </div>
      <SessionSwitcher session={session} sessions={sessions} onSwitch={onSwitchSession} onNew={onNewSession} />
      {children}
      <div className="work-scroll" ref={scrollRef}>
        {tasks.length === 0 ? (
          <p className="empty">No Claude runs yet. Ask Iris to take on a task.</p>
        ) : (
          sortedTasks.map((task) => (
            <WorkCard
              key={task.id}
              task={task}
              accepted={Boolean(acceptedIds[acceptedKey(task.task)])}
              stepsOpen={Boolean(stepsOpenIds[task.id])}
              onToggleSteps={() => onToggleTaskSteps(task.id)}
              onOpen={() => onOpenTask(task)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
