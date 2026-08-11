import type { TaskCard, TaskStep, TaskUsage } from "../types";
import { isVerb } from "./verbs";

// "limited" is a run that reached its turn or spend ceiling — over, but not
// failed (see electron/run-budget.mjs). "unanswered" is a run that asked a
// question its work depended on and got no answer — also over, also not failed
// (see electron/run-queue.mjs's RUN_STATUS).
export const TERMINAL = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "error",
  "limited",
  "unanswered",
]);

export function taskKeyFor(task: string): string {
  return `starting:${task.toLowerCase().trim()}`;
}

// Stable key for the transient "task submitted" stamp. Keyed by task text so
// it survives Claude swapping the placeholder card for the real run_id card.
export function acceptedKey(task: string): string {
  return task.toLowerCase().trim();
}

export function shortRunId(id: string): string {
  if (!id || id === "pending") return "pending";
  if (id.startsWith("starting:")) return "starting";
  if (id.length <= 14) return id;
  return `${id.slice(0, 7)}…${id.slice(-5)}`;
}

export function normalizeMarkdown(text?: string): string {
  if (!text) return "";
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ");
}

export type ToolCategory = "browser" | "search" | "code" | "file" | "tool";

export function toolCategory(tool: string): ToolCategory {
  const t = tool.toLowerCase();
  if (t.includes("search")) return "search";
  if (t.includes("browser") || t.includes("navigate") || t.includes("fetch") || t.includes("web") || t.includes("url"))
    return "browser";
  if (
    t.includes("code") ||
    t.includes("python") ||
    t.includes("shell") ||
    t.includes("bash") ||
    t.includes("exec") ||
    t.includes("terminal") ||
    t.includes("command") ||
    t.includes("run")
  )
    return "code";
  if (t.includes("file") || t.includes("read") || t.includes("write") || t.includes("edit") || t.includes("patch"))
    return "file";
  return "tool";
}

export function prettyToolName(tool: string): string {
  return tool.replace(/[_.]+/g, " ").trim();
}

function hostFromUrl(value?: string): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function baseName(value?: string): string {
  if (!value) return "";
  const cleaned = value.split(/[?#]/)[0].replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Short secondary detail for a tool step: a host for URLs, a filename for file
// tools, or a trimmed single-line snippet for code/other tools.
export function stepDetail(step: TaskStep): string {
  if (!step.preview) return "";
  const category = toolCategory(step.tool);
  if (category === "browser" || category === "search") {
    return hostFromUrl(step.preview) || step.preview.slice(0, 60);
  }
  if (category === "file") {
    return baseName(step.preview) || step.preview.slice(0, 48);
  }
  const oneLine = step.preview.replace(/\s+/g, " ").trim();
  return oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine;
}

// One-line "what Claude is doing right now" headline for an active step.
export function stepHeadline(step: TaskStep): string {
  const category = toolCategory(step.tool);
  const detail = stepDetail(step);
  if (category === "browser") return detail ? `Browsing ${detail}` : "Browsing the web";
  if (category === "search") return detail ? `Searching ${detail}` : "Searching the web";
  if (category === "code") return "Running code";
  if (category === "file") return detail ? `Working on ${detail}` : "Working with files";
  return `Using ${prettyToolName(step.tool)}`;
}

export function eventTime(event: SidecarEvent): number {
  return typeof event.timestamp === "number" ? event.timestamp * 1000 : Date.now();
}

export function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Merge an incoming event field over the card's existing value: take the
// event's value whenever the event carried a string (even ""), otherwise keep
// what's there. Presence — not truthiness — so an empty terminal result
// replaces the activity log instead of falling back to it (BUG D).
export function resolveMergedString(raw: unknown, existing: string | undefined): string {
  return typeof raw === "string" ? raw : (existing ?? "");
}

// The cost/turn figures off a claude_task_update. Returns null unless at least
// one is actually present, so an update that carries no usage (every one before
// the run's result lands) leaves an already-recorded figure alone rather than
// blanking it.
export function readTaskUsage(value: unknown): TaskUsage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const costUsd = typeof raw.cost_usd === "number" ? raw.cost_usd : null;
  const numTurns = typeof raw.num_turns === "number" ? raw.num_turns : null;
  if (costUsd === null && numTurns === null) return null;
  return { costUsd, numTurns };
}

// Never rounded to nothing: a real run that cost a fraction of a cent must not
// read as "$0.00", which looks like "free" rather than "very cheap".
export function formatCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(2)}`;
}

export function usageSummary(usage: TaskUsage | null | undefined): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.costUsd !== null) parts.push(formatCost(usage.costUsd));
  if (usage.numTurns !== null) parts.push(`${usage.numTurns} turn${usage.numTurns === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function readStatusObject(value: unknown): {
  running?: boolean;
  pid?: number | null;
  model?: string;
  mode?: string;
} {
  if (!value || typeof value !== "object") return {};
  return value as { running?: boolean; pid?: number | null; model?: string; mode?: string };
}

// ===== Fuzzy voice-query task matching =====

const QUERY_STOP_WORDS = new Set([
  "open",
  "show",
  "me",
  "the",
  "a",
  "an",
  "one",
  "task",
  "card",
  "result",
  "latest",
  "current",
]);

const QUERY_SYNONYMS: Record<string, string> = {
  pakage: "package",
  pkg: "package",
  fialed: "failed",
  fail: "failed",
  errored: "failed",
  error: "failed",
  hands: "hand",
  hadn: "hand",
  deisgn: "design",
  desing: "design",
};

function normalizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => QUERY_SYNONYMS[token] ?? token)
    .filter((token) => !QUERY_STOP_WORDS.has(token));
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyTokenMatch(queryToken: string, candidateToken: string): boolean {
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
  if (queryToken.length < 4 || candidateToken.length < 4) return false;
  const maxDistance = Math.min(queryToken.length, candidateToken.length) >= 6 ? 2 : 1;
  return editDistance(queryToken, candidateToken) <= maxDistance;
}

export function findTaskMatches(
  sortedTasks: TaskCard[],
  query?: string,
): Array<{ task: TaskCard; score: number }> {
  const queryTokens = normalizeQuery(query ?? "");
  if (!queryTokens.length) return [];

  const scored: Array<{ task: TaskCard; score: number }> = [];
  for (const task of sortedTasks) {
    const haystack = `${task.task} ${task.status} ${task.id}`;
    const candidateTokens = normalizeQuery(haystack);
    let score = 0;

    for (const token of queryTokens) {
      const exact = candidateTokens.includes(token);
      const fuzzy = exact || candidateTokens.some((candidate) => fuzzyTokenMatch(token, candidate));
      if (exact) score += 4;
      else if (fuzzy) score += 2;
    }

    if ((task.output || task.error) && score > 0) score += 2;
    if (task.status.toLowerCase() === "failed" && queryTokens.includes("failed")) score += 6;
    if (!TERMINAL.has(task.status.toLowerCase())) score -= 1;

    if (score > 0) scored.push({ task, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.task.updatedAt - a.task.updatedAt)
    .slice(0, 3);
}

// The task-card reduction: one `claude_task_update` event folded into the
// current card list. Pure and total — it reads nothing but its arguments and
// returns the next list, so the whole step/merge/cap policy below is testable
// without a React tree (this lived inside `App.tsx`'s event handler, where it
// was 70 lines of untested branching).
//
// Three rules are load-bearing and easy to break by accident:
//
//   * **A run is identified by `run_id`, falling back to a key derived from the
//     task text.** The fallback exists because the first update for a run can
//     arrive before an id does; the placeholder card it created must then be
//     replaced rather than left beside the real one.
//   * **An absent field never overwrites a recorded one.** Terminal figures in
//     particular (`usage`, `verb`, `model`, the session id) arrive once and are
//     absent from every other update, so a plain assignment would erase them.
//   * **Steps are keyed by Claude's own `tool_use` id**, so a `tool_end` closes
//     exactly the step its `tool_start` opened even when calls interleave.
export const MAX_TASK_STEPS = 40;
export const MAX_TASK_CARDS = 20;

/** Folds a `tool_start` / `tool_end` phase into a card's step timeline. */
export function applyStepPhase(
  steps: TaskStep[] | undefined,
  event: SidecarEvent,
  now: number,
): TaskStep[] | undefined {
  const phase = readString(event.phase);
  const toolId = readString(event.tool_id);
  if (phase === "tool_start" && toolId) {
    const step: TaskStep = {
      id: toolId,
      tool: readString(event.tool, "tool"),
      preview: readString(event.detail) || undefined,
      status: "running",
      ts: now,
    };
    return [...(steps ?? []), step].slice(-MAX_TASK_STEPS);
  }
  if (phase === "tool_end" && toolId && steps) {
    const isError = event.error === true;
    const duration = typeof event.duration === "number" ? event.duration : undefined;
    return steps.map((step) =>
      step.id === toolId ? { ...step, status: isError ? "error" : "done", duration } : step,
    );
  }
  // Plain activity and terminal updates leave the timeline untouched.
  return steps;
}

/**
 * Folds one `claude_task_update` event into the card list, newest first.
 *
 * The updated card moves to the front and both its real id and its
 * text-derived placeholder id are filtered out of the tail, so a run that
 * gained an id part-way through does not appear twice.
 */
export function applyTaskUpdate(current: TaskCard[], event: SidecarEvent): TaskCard[] {
  const task = readString(event.task, "Claude task");
  const rawRunId = readString(event.run_id);
  const runId = rawRunId || taskKeyFor(task);
  const placeholderId = taskKeyFor(task);
  const existing = current.find((item) => item.id === runId);
  const now = eventTime(event);

  const next: TaskCard = {
    id: runId,
    task,
    status: readString(event.status, "unknown"),
    output: resolveMergedString(event.output, existing?.output),
    error: resolveMergedString(event.error, existing?.error),
    verb: (isVerb(event.verb) ? event.verb : null) ?? existing?.verb ?? null,
    model: (typeof event.model === "string" ? event.model : null) ?? existing?.model ?? null,
    claudeSessionId: readString(event.claude_session_id) || existing?.claudeSessionId || null,
    usage: readTaskUsage(event.usage) ?? existing?.usage ?? null,
    updatedAt: now,
    steps: applyStepPhase(existing?.steps, event, now),
  };

  return [next, ...current.filter((item) => item.id !== runId && item.id !== placeholderId)].slice(
    0,
    MAX_TASK_CARDS,
  );
}

/**
 * Newest-first, but **active runs first of all**.
 *
 * A finished run that updated a second ago is less interesting than one still
 * working, so terminal status outranks recency. Within each group the most
 * recently updated leads.
 *
 * `TERMINAL` is compared case-insensitively because the status arrives from the
 * runtime as free text.
 */
export function sortTasks(tasks: TaskCard[]): TaskCard[] {
  const isActive = (task: TaskCard) => !TERMINAL.has(task.status.toLowerCase());
  return [...tasks].sort((a, b) => {
    const activeDelta = Number(isActive(b)) - Number(isActive(a));
    if (activeDelta !== 0) return activeDelta;
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * The most recent task that actually produced something to read.
 *
 * Takes an already-sorted list. A run that finished with neither output nor an
 * error has nothing to open, so it is skipped rather than offered.
 */
export function latestWithResult(sorted: TaskCard[]): TaskCard | null {
  return sorted.find((task) => Boolean(task.output || task.error)) ?? null;
}

/**
 * Closes any step still marked running on a run that has finished.
 *
 * A run can end while a tool call is open — the process exits, or the run is
 * cancelled — and the `tool_end` that would have closed the step never arrives.
 * Without this the timeline keeps a spinner forever on a run that is visibly
 * over.
 */
export function closeRunningSteps(tasks: TaskCard[], runId: string): TaskCard[] {
  return tasks.map((item) =>
    item.id === runId && item.steps
      ? { ...item, steps: item.steps.map((step) => (step.status === "running" ? { ...step, status: "done" } : step)) }
      : item,
  );
}
