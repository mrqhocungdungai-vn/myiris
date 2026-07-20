// Delivery pipeline: each role is a headless Claude Code agent; moving to the
// next role is a gate, passed when the previous role wrote its handoff file.
export const PIPELINE: AgentRole[] = ["po", "dev"];

// Every selectable role.
export const ALL_ROLES: AgentRole[] = [...PIPELINE];

export const AGENT_LABELS: Record<AgentRole, string> = {
  po: "PO",
  dev: "DEV",
};

// Per-role identity colors, expressed as references to Deep Space's rgb
// tokens (rgba(var(--x), alpha) accepts a nested var()) so they stay themed.
export const AGENT_COLORS: Record<AgentRole, string> = {
  po: "var(--violet-rgb)",
  dev: "var(--mint-rgb)",
};

// Curated model choices for PO/DEV — mirrors electron/main.mjs MODEL_CHOICES.
// The renderer never resolves which model is effective (env vars, defaults —
// that's the main process's job via agents.roster[].model); this is only the
// label lookup and the popover's menu contents.
export const MODEL_CHOICES: { id: string; label: string }[] = [
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export function modelLabel(id?: string | null): string {
  if (!id) return "";
  return MODEL_CHOICES.find((choice) => choice.id === id)?.label ?? id;
}

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (ALL_ROLES as string[]).includes(value);
}
