import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskCard } from "../types";
import { normalizeMarkdown, shortRunId } from "../lib/tasks";
import type { HandState } from "../hooks/useHandControl";
import { AgentBadge } from "./WorkCard";
import ReaderCore from "./ReaderCore";

export default function ReaderOverlay({
  task,
  hand,
  handRef,
  onClose,
}: {
  task: TaskCard;
  hand: HandState | null;
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handRef: { current: HandState };
  onClose: () => void;
}) {
  return (
    <ReaderCore
      title={task.task}
      hand={hand}
      handRef={handRef}
      gesturesEnabled={hand != null}
      onClose={onClose}
      footerHint={
        hand
          ? "Open palm — hold high/low to scroll · Two open palms resize · Fist to close"
          : "Scroll to read · Esc or × to close"
      }
      headerSlot={
        <>
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
        </>
      }
      body={
        <div className={`markdown-body ${task.error ? "error" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdown(task.error || task.output)}</ReactMarkdown>
        </div>
      }
    />
  );
}
