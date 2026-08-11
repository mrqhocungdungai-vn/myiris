import { TERMINAL, findTaskMatches } from "./tasks";
import type { TaskCard } from "../types";

// Which task a voice UI action refers to, and what the action does.
//
// The hard part is not the dispatch, it is the **referent**: "open it", "show
// its steps" and "close that" all have to resolve to a task without the user
// naming one. The fallback chain below is that resolution, and it was a chain
// of `||` inside an IPC callback where nothing could exercise it.
//
// The order is deliberate and each step earns its place:
//
//   * whatever reader is already open — "it" most often means what you are
//     looking at;
//   * the card the hand is hovering — the deictic "this one";
//   * the most recent task with a result.
//
// The **steps** actions widen that chain deliberately, and differently: they
// also honour an explicit `target_id`, a spoken name matched by query, and any
// still-running task — because "show its steps" mid-run should find the running
// task even with nothing open.
//
// The two chains are NOT the same and must not be merged. `open_current_claude_result`
// does not consult `target_id` (the caller has `open_task` for that), and the
// plain actions do not fall back to a running task.

export type UiActionTargets = {
  /** Named outright by the action. */
  byId: TaskCard | null;
  /** The task whose reader is open. */
  current: TaskCard | null;
  /** The card the hand is hovering. */
  focused: TaskCard | null;
  /** The most recent task with output or an error. */
  latestResult: TaskCard | null;
};

/**
 * The task a plain "open it" style action refers to.
 *
 * Deliberately does **not** consult `byId` — the caller has `open_task` for an
 * explicitly named task, and folding the two would make "open the current
 * result" silently obey a stale id.
 */
export function resolveActionTarget(targets: UiActionTargets): TaskCard | null {
  return targets.current ?? targets.focused ?? targets.latestResult ?? null;
}

/**
 * The task a steps action refers to.
 *
 * Widens the chain: a spoken name may match by query, and "show its steps"
 * during a run should find the running task even when nothing is open.
 */
export function resolveStepsTarget(
  targets: UiActionTargets,
  tasks: TaskCard[],
  sorted: TaskCard[],
  query?: string,
): TaskCard | null {
  const byQuery = !targets.byId && query ? (findTaskMatches(sorted, query)[0]?.task ?? null) : null;
  const running = tasks.find((task) => !TERMINAL.has(task.status.toLowerCase())) ?? null;
  return targets.byId ?? byQuery ?? targets.current ?? targets.focused ?? running ?? targets.latestResult ?? null;
}

export type UiActionHandlers = {
  openTask: (task: TaskCard) => void;
  openTaskByQuery: (query?: string) => void;
  closeReader: () => void;
  setShowHistory: (open: boolean) => void;
  setChooser: (chooser: null) => void;
  setStepsOpen: (id: string, open: boolean) => void;
};

/** Applies one voice UI action. Unknown actions are ignored, not thrown on. */
export function applyUiAction(
  action: string,
  query: string | undefined,
  targets: UiActionTargets,
  tasks: TaskCard[],
  sorted: TaskCard[],
  handlers: UiActionHandlers,
): void {
  const fallback = resolveActionTarget(targets);

  if (action === "open_task") {
    if (targets.byId) handlers.openTask(targets.byId);
    return;
  }
  if (action === "open_task_by_query") {
    handlers.openTaskByQuery(query);
    return;
  }
  if (action === "open_current_claude_result") {
    if (fallback) handlers.openTask(fallback);
    return;
  }
  if (action === "open_latest_claude_result") {
    if (targets.latestResult) handlers.openTask(targets.latestResult);
    return;
  }
  if (action === "open_claude_history") {
    handlers.setShowHistory(true);
    return;
  }
  if (action === "close_reader") {
    handlers.closeReader();
    return;
  }
  if (action === "close_history") {
    handlers.setShowHistory(false);
    return;
  }
  if (action === "close_all_overlays") {
    handlers.closeReader();
    handlers.setShowHistory(false);
    handlers.setChooser(null);
    return;
  }
  if (action === "show_task_steps" || action === "hide_task_steps") {
    const target = resolveStepsTarget(targets, tasks, sorted, query);
    if (!target) return;
    handlers.setStepsOpen(target.id, action === "show_task_steps");
  }
}

/**
 * What a spoken "open the X task" should do.
 *
 * Two rules, both easy to lose in an `if` chain:
 *
 *   * **A clear winner opens directly.** "Clear" means the best match beats the
 *     runner-up by at least `CLEAR_WINNER_MARGIN`; a single match is always
 *     clear. Below that margin, picking one would be guessing at which of two
 *     similarly-named runs the user meant.
 *   * **A pending question or parked review outranks disambiguation**
 *     (design.md D2, prompt-review-gate D3). The chooser must never stack over
 *     those banners, so an ambiguous request is **dropped** rather than queued —
 *     the banner already occupies the "answer by voice" surface, and stacking a
 *     second thing to answer on top of it is worse than doing nothing.
 */
export const CLEAR_WINNER_MARGIN = 3;

export type TaskQueryOutcome =
  | { kind: "open"; task: TaskCard }
  | { kind: "choose"; query: string; matches: TaskCard[] }
  | { kind: "none" };

export function resolveTaskQuery(
  matches: Array<{ task: TaskCard; score: number }>,
  query: string | undefined,
  bannerShowing: boolean,
): TaskQueryOutcome {
  if (matches.length === 0) return { kind: "none" };
  const [best, second] = matches;
  if (!second || best.score - second.score >= CLEAR_WINNER_MARGIN) {
    return { kind: "open", task: best.task };
  }
  if (bannerShowing) return { kind: "none" };
  return { kind: "choose", query: query || "task", matches: matches.map((match) => match.task) };
}

/**
 * The snapshot the voice layer reads to resolve deictic references.
 *
 * A pure projection of renderer state, so what Iris can "see" of the UI is one
 * function rather than an object literal inside an effect. That matters because
 * the fields are a **contract with the model**: `index` is 1-based because it is
 * what the user says out loud ("the second one"), and `hasResult` is precomputed
 * rather than shipping the output text, since the model needs to know a run is
 * openable without being handed its entire contents.
 */
export function buildUiContext(input: {
  expandedTaskId: string | null;
  focusedTaskId: string | null;
  latestResult: TaskCard | null;
  chooserMatches: TaskCard[];
  showHistory: boolean;
  sorted: TaskCard[];
  stepsOpen: Record<string, boolean>;
  uiMode: UiMode;
}): UiContextSnapshot {
  return {
    expandedTaskId: input.expandedTaskId,
    focusedTaskId: input.focusedTaskId,
    latestResultTaskId: input.latestResult?.id ?? null,
    // 1-based: this is the ordinal the user speaks, not an array index.
    pendingTaskMatches: input.chooserMatches.map((task, index) => ({
      index: index + 1,
      id: task.id,
      task: task.task,
      status: task.status,
    })),
    showHistory: input.showHistory,
    tasks: input.sorted.map((task) => ({
      id: task.id,
      task: task.task,
      status: task.status,
      // Precomputed rather than shipping the output itself.
      hasResult: Boolean(task.output || task.error),
      stepCount: task.steps?.length ?? 0,
      stepsOpen: Boolean(input.stepsOpen[task.id]),
      updatedAt: task.updatedAt,
    })),
    uiMode: input.uiMode,
  };
}
