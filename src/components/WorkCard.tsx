import { type CSSProperties } from "react";
import { Check, ChevronDown, Code2, Cpu, FileText, Globe, Search, Wrench, X } from "lucide-react";
import type { TaskCard } from "../types";
import {
  TERMINAL,
  normalizeMarkdown,
  prettyToolName,
  shortRunId,
  stepDetail,
  stepHeadline,
  toolCategory,
} from "../lib/tasks";
import { AGENT_COLORS, AGENT_LABELS, isAgentRole, modelLabel } from "../lib/agents";

export function AgentBadge({ agent, model }: { agent?: AgentRole | null; model?: string | null }) {
  if (!agent || !isAgentRole(agent)) return null;
  return (
    <span className="agent-badge" style={{ "--agent-color": AGENT_COLORS[agent] } as CSSProperties}>
      {AGENT_LABELS[agent]}
      {model ? <span className="agent-badge-model">{modelLabel(model)}</span> : null}
    </span>
  );
}

export function StepIcon({ tool }: { tool: string }) {
  const category = toolCategory(tool);
  if (category === "browser") return <Globe size={13} />;
  if (category === "search") return <Search size={13} />;
  if (category === "code") return <Code2 size={13} />;
  if (category === "file") return <FileText size={13} />;
  return <Cpu size={13} />;
}

// Shared tool-step timeline (used on the work card; PO and DEV render it
// identically since both flow through the same claude_task_update shape).
export function StepTimeline({ steps }: { steps: NonNullable<TaskCard["steps"]> }) {
  return (
    <ul className="activity-timeline">
      {steps.map((step) => {
        const detail = stepDetail(step);
        return (
          <li key={step.id} className={`activity-step ${step.status} ${toolCategory(step.tool)}`}>
            <span className="step-icon">
              <StepIcon tool={step.tool} />
            </span>
            <span className="step-main">
              <span className="step-tool">{prettyToolName(step.tool)}</span>
              {detail ? <span className="step-detail">{detail}</span> : null}
            </span>
            <span className="step-meta">
              {step.duration !== undefined ? <em>{step.duration.toFixed(1)}s</em> : null}
              {step.status === "running" ? (
                <span className="step-run" />
              ) : step.status === "error" ? (
                <X size={12} className="step-x" />
              ) : (
                <Check size={12} className="step-ok" />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function WorkCard({
  task,
  accepted = false,
  stepsOpen = false,
  onToggleSteps,
  onOpen,
}: {
  task: TaskCard;
  accepted?: boolean;
  stepsOpen?: boolean;
  onToggleSteps?: () => void;
  onOpen: () => void;
}) {
  const expandable = Boolean(task.output || task.error);
  const status = task.status.toLowerCase();
  const active = !TERMINAL.has(status);
  const steps = task.steps ?? [];
  const runningStep = [...steps].reverse().find((step) => step.status === "running");

  return (
    <article
      className={`wcard ${active ? "working" : ""} ${expandable ? "expandable" : ""} ${accepted ? "accepted" : ""}`}
      data-task-id={expandable ? task.id : undefined}
      onClick={onOpen}
    >
      {accepted ? <span className="wcard-accepted">Task submitted</span> : null}
      <div className="wcard-top">
        <span className={`badge ${status}`}>{task.status}</span>
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
      </div>
      <p className="wcard-task">{task.task}</p>
      {expandable ? <div className="wcard-preview">{normalizeMarkdown(task.error || task.output)}</div> : null}

      {active && runningStep ? (
        <div className="activity-now">
          <span className="activity-spark" />
          <span className="activity-now-text">{stepHeadline(runningStep)}</span>
        </div>
      ) : null}

      {steps.length > 0 ? (
        <div className="activity" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`activity-toggle ${stepsOpen ? "open" : ""}`}
            onClick={onToggleSteps}
          >
            <Wrench size={11} />
            {steps.length} step{steps.length === 1 ? "" : "s"}
            <ChevronDown size={12} className="chev" />
          </button>
          {stepsOpen ? <StepTimeline steps={steps} /> : null}
        </div>
      ) : null}

      {active ? (
        <div className="wcard-progress">
          <i />
        </div>
      ) : null}
    </article>
  );
}
