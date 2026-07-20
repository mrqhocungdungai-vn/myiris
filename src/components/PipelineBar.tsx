import type { CSSProperties } from "react";
import { Users } from "lucide-react";
import { AGENT_COLORS, AGENT_LABELS, ALL_ROLES, MODEL_CHOICES, modelLabel } from "../lib/agents";

/**
 * PO/DEV agent chips + gate ✓ marks + per-role model popover. Switching roles
 * is a soft gate (confirm dialog on a missing handoff) handled by the caller;
 * this component only renders and calls the passed-in handlers.
 */
export default function PipelineBar({
  agents,
  activeAgent,
  installingAgents,
  modelPopoverRole,
  onChooseAgent,
  onInstallAgents,
  onToggleModelPopover,
  onSetRoleModel,
}: {
  agents: AgentsSnapshot | null;
  activeAgent: AgentRole | null;
  installingAgents: boolean;
  modelPopoverRole: AgentRole | null;
  onChooseAgent: (role: AgentRole | null) => void;
  onInstallAgents: () => void;
  onToggleModelPopover: (role: AgentRole) => void;
  onSetRoleModel: (role: AgentRole, model: string) => void;
}) {
  if (agents && !agents.installed) {
    return (
      <div className="pipeline-bar">
        <button
          className="agent-install"
          onClick={onInstallAgents}
          disabled={installingAgents}
          title="Install the PO / DEV agents into ~/.claude/agents"
        >
          <Users size={13} />
          {installingAgents ? "Installing agents…" : "Install agents…"}
        </button>
      </div>
    );
  }

  return (
    <div className="pipeline-bar">
      <button
        className={`agent-chip iris ${activeAgent === null ? "active" : ""}`}
        onClick={() => onChooseAgent(null)}
        title="Plain Claude — no pipeline role"
      >
        Iris
      </button>
      {ALL_ROLES.map((role) => {
        const info = agents?.roster.find((entry) => entry.key === role);
        const passed = Boolean(agents?.gates.byRole?.[role]);
        const currentModel = info?.model ?? null;
        return (
          <div
            key={role}
            className={`agent-chip ${activeAgent === role ? "active" : ""} ${passed ? "passed" : ""}`}
            style={{ "--agent-color": AGENT_COLORS[role] } as CSSProperties}
          >
            <button
              type="button"
              className="agent-chip-label"
              onClick={() => onChooseAgent(role)}
              title={`${info?.description || AGENT_LABELS[role]}${
                agents?.gates.slug ? ` · feature: ${agents.gates.slug}` : ""
              } — each role keeps its own Claude conversation (context crosses roles via handoff files; reset with New)`}
            >
              {AGENT_LABELS[role]}
              {passed ? <span className="gate-check">✓</span> : null}
            </button>
            <button
              type="button"
              className="agent-chip-model"
              onClick={(event) => {
                event.stopPropagation();
                onToggleModelPopover(role);
              }}
              title={`${AGENT_LABELS[role]} model: ${modelLabel(currentModel) || "…"} — click to change`}
            >
              {modelLabel(currentModel) || "…"}
            </button>
            {modelPopoverRole === role ? (
              <div className="model-popover" onClick={(event) => event.stopPropagation()}>
                {MODEL_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    className={`model-option ${currentModel === choice.id ? "selected" : ""}`}
                    onClick={() => onSetRoleModel(role, choice.id)}
                  >
                    {choice.label}
                    {currentModel === choice.id ? <span className="model-check">✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
