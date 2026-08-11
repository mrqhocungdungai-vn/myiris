import { describe, it, expect, vi } from "vitest";
import {
  resolveActionTarget,
  resolveStepsTarget,
  applyUiAction,
  resolveTaskQuery,
  buildUiContext,
  CLEAR_WINNER_MARGIN,
  type UiActionTargets,
} from "./ui-actions";
import type { TaskCard } from "../types";

const task = (id: string, over: Partial<TaskCard> = {}) =>
  ({ id, task: id, status: "completed", updatedAt: 0, output: "out", error: "", ...over }) as TaskCard;

const none: UiActionTargets = { byId: null, current: null, focused: null, latestResult: null };

// The hard part is the REFERENT: "open it" / "show its steps" must resolve to a
// task without the user naming one.
describe("resolveActionTarget", () => {
  it("prefers the open reader over the hovered card", () => {
    const t = { ...none, current: task("open"), focused: task("hover"), latestResult: task("latest") };
    expect(resolveActionTarget(t)?.id).toBe("open");
  });

  it("falls back to the hovered card, then to the latest result", () => {
    expect(resolveActionTarget({ ...none, focused: task("hover"), latestResult: task("latest") })?.id).toBe("hover");
    expect(resolveActionTarget({ ...none, latestResult: task("latest") })?.id).toBe("latest");
  });

  it("resolves to nothing when there is no referent", () => {
    expect(resolveActionTarget(none)).toBeNull();
  });

  // The two chains are not the same. Folding them would make "open the current
  // result" silently obey a stale id.
  it("ignores an explicit id — that is open_task's job, not this one's", () => {
    expect(resolveActionTarget({ ...none, byId: task("named") })).toBeNull();
    expect(resolveActionTarget({ ...none, byId: task("named"), current: task("open") })?.id).toBe("open");
  });
});

describe("resolveStepsTarget", () => {
  const tasks = [task("running", { status: "running" }), task("done")];

  it("honours an explicit id first", () => {
    expect(resolveStepsTarget({ ...none, byId: task("named"), current: task("open") }, tasks, tasks)?.id).toBe("named");
  });

  it("matches a spoken name by query when no id resolved", () => {
    const named = [task("deploy the site"), task("other")];
    expect(resolveStepsTarget(none, named, named, "deploy")?.id).toBe("deploy the site");
  });

  // "show its steps" mid-run should find the running task with nothing open.
  it("falls back to a still-running task before the latest result", () => {
    const t = { ...none, latestResult: task("done") };
    expect(resolveStepsTarget(t, tasks, tasks)?.id).toBe("running");
  });

  it("prefers what is open or hovered over the running task", () => {
    expect(resolveStepsTarget({ ...none, current: task("open") }, tasks, tasks)?.id).toBe("open");
    expect(resolveStepsTarget({ ...none, focused: task("hover") }, tasks, tasks)?.id).toBe("hover");
  });
});

function handlers() {
  return {
    openTask: vi.fn(),
    openTaskByQuery: vi.fn(),
    closeReader: vi.fn(),
    setShowHistory: vi.fn(),
    setChooser: vi.fn(),
    setStepsOpen: vi.fn(),
  };
}

describe("applyUiAction", () => {
  const tasks = [task("a")];

  it("opens only an explicitly named task for open_task", () => {
    const h = handlers();
    applyUiAction("open_task", undefined, { ...none, current: task("open") }, tasks, tasks, h);
    expect(h.openTask).not.toHaveBeenCalled();
    applyUiAction("open_task", undefined, { ...none, byId: task("named") }, tasks, tasks, h);
    expect(h.openTask).toHaveBeenCalledWith(expect.objectContaining({ id: "named" }));
  });

  it("closes every overlay for close_all_overlays", () => {
    const h = handlers();
    applyUiAction("close_all_overlays", undefined, none, tasks, tasks, h);
    expect(h.closeReader).toHaveBeenCalled();
    expect(h.setShowHistory).toHaveBeenCalledWith(false);
    expect(h.setChooser).toHaveBeenCalledWith(null);
  });

  it("opens and closes history", () => {
    const h = handlers();
    applyUiAction("open_claude_history", undefined, none, tasks, tasks, h);
    expect(h.setShowHistory).toHaveBeenCalledWith(true);
    applyUiAction("close_history", undefined, none, tasks, tasks, h);
    expect(h.setShowHistory).toHaveBeenLastCalledWith(false);
  });

  it("shows and hides steps on the resolved target", () => {
    const h = handlers();
    const t = { ...none, current: task("open") };
    applyUiAction("show_task_steps", undefined, t, tasks, tasks, h);
    expect(h.setStepsOpen).toHaveBeenCalledWith("open", true);
    applyUiAction("hide_task_steps", undefined, t, tasks, tasks, h);
    expect(h.setStepsOpen).toHaveBeenLastCalledWith("open", false);
  });

  // Acting on a guess is worse than doing nothing.
  it("does nothing when a steps action has no referent at all", () => {
    const h = handlers();
    applyUiAction("show_task_steps", undefined, none, [], [], h);
    expect(h.setStepsOpen).not.toHaveBeenCalled();
  });

  it("ignores an unknown action rather than throwing", () => {
    const h = handlers();
    expect(() => applyUiAction("teleport", undefined, none, tasks, tasks, h)).not.toThrow();
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("resolveTaskQuery", () => {
  const m = (id: string, score: number) => ({ task: task(id), score });

  it("does nothing when nothing matches", () => {
    expect(resolveTaskQuery([], "x", false).kind).toBe("none");
  });

  it("opens a lone match without asking", () => {
    const outcome = resolveTaskQuery([m("only", 5)], "only", false);
    expect(outcome).toMatchObject({ kind: "open" });
  });

  // Below the margin, picking one would be guessing between two similarly
  // named runs.
  it("opens directly only when the winner clears the margin", () => {
    expect(resolveTaskQuery([m("a", 10), m("b", 10 - CLEAR_WINNER_MARGIN)], "a", false).kind).toBe("open");
    expect(resolveTaskQuery([m("a", 10), m("b", 10 - CLEAR_WINNER_MARGIN + 1)], "a", false).kind).toBe("choose");
  });

  it("offers the ambiguous matches in order", () => {
    const outcome = resolveTaskQuery([m("a", 10), m("b", 9)], "deploy", false);
    expect(outcome).toMatchObject({ kind: "choose", query: "deploy" });
    if (outcome.kind === "choose") expect(outcome.matches.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("names the chooser 'task' when no query was spoken", () => {
    const outcome = resolveTaskQuery([m("a", 10), m("b", 9)], undefined, false);
    if (outcome.kind === "choose") expect(outcome.query).toBe("task");
  });

  // The banner already occupies the "answer by voice" surface; stacking a
  // second thing to answer on top of it is worse than doing nothing.
  it("DROPS an ambiguous request while a banner is showing", () => {
    expect(resolveTaskQuery([m("a", 10), m("b", 9)], "deploy", true).kind).toBe("none");
  });

  // A clear winner is not a question, so the banner does not block it.
  it("still opens a clear winner while a banner is showing", () => {
    expect(resolveTaskQuery([m("a", 10), m("b", 1)], "a", true).kind).toBe("open");
  });
});

// The snapshot is a CONTRACT WITH THE MODEL, not an internal shape.
describe("buildUiContext", () => {
  const base = {
    expandedTaskId: null,
    focusedTaskId: null,
    latestResult: null,
    chooserMatches: [],
    showHistory: false,
    sorted: [],
    stepsOpen: {},
    uiMode: "deck" as const,
  };

  // "the second one" is what the user says out loud.
  it("numbers the disambiguation choices from 1, not 0", () => {
    const ctx = buildUiContext({ ...base, chooserMatches: [task("a"), task("b")] });
    expect(ctx.pendingTaskMatches.map((m) => m.index)).toEqual([1, 2]);
  });

  // The model needs to know a run is openable, not to be handed its contents.
  it("reports hasResult instead of shipping the output text", () => {
    const ctx = buildUiContext({
      ...base,
      sorted: [task("withOutput", { output: "long text" }), task("empty", { output: "", error: "" })],
    });
    expect(ctx.tasks[0].hasResult).toBe(true);
    expect(ctx.tasks[1].hasResult).toBe(false);
    expect(JSON.stringify(ctx)).not.toContain("long text");
  });

  it("counts an error as a result", () => {
    const ctx = buildUiContext({ ...base, sorted: [task("err", { output: "", error: "boom" })] });
    expect(ctx.tasks[0].hasResult).toBe(true);
  });

  it("reports the step count and whether the timeline is open", () => {
    const withSteps = task("t", { steps: [{ id: "s1", tool: "Read", status: "done", ts: 0 }] } as never);
    const ctx = buildUiContext({ ...base, sorted: [withSteps], stepsOpen: { t: true } });
    expect(ctx.tasks[0]).toMatchObject({ stepCount: 1, stepsOpen: true });
  });

  it("reports zero steps for a run with no timeline", () => {
    const ctx = buildUiContext({ ...base, sorted: [task("t")] });
    expect(ctx.tasks[0]).toMatchObject({ stepCount: 0, stepsOpen: false });
  });

  it("passes the latest result as an id, not an object", () => {
    const ctx = buildUiContext({ ...base, latestResult: task("latest") });
    expect(ctx.latestResultTaskId).toBe("latest");
  });

  it("sends an empty match list rather than omitting the field", () => {
    expect(buildUiContext(base).pendingTaskMatches).toEqual([]);
  });
});
