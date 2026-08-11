// BUG D: an empty terminal result must replace the activity log shown
// during a run, not fall back to it. resolveMergedString is the pure merge
// decision extracted from the App.tsx reducer — see
// openspec/changes/show-real-result-not-activity-log/design.md D1.
import { describe, it, expect } from "vitest";
import {
  MAX_TASK_CARDS,
  MAX_TASK_STEPS,
  TERMINAL,
  applyStepPhase,
  applyTaskUpdate,
  closeRunningSteps,
  latestWithResult,
  sortTasks,
  readTaskUsage,
  resolveMergedString,
  taskKeyFor,
  usageSummary,
} from "./tasks";
import type { TaskCard, TaskStep } from "../types";

describe("resolveMergedString", () => {
  it("replaces the existing value with a non-empty incoming string", () => {
    expect(resolveMergedString("result", "old activity")).toBe("result");
  });

  it("replaces the existing value with an empty incoming string", () => {
    expect(resolveMergedString("", "old activity")).toBe("");
  });

  it("keeps the existing value when the field is absent", () => {
    expect(resolveMergedString(undefined, "old activity")).toBe("old activity");
  });

  it("falls back to empty when both the field and existing value are absent", () => {
    expect(resolveMergedString(undefined, undefined)).toBe("");
  });
});

describe("readTaskUsage", () => {
  it("reads the cost and turn figures off an update", () => {
    expect(readTaskUsage({ cost_usd: 0.42, num_turns: 7 })).toEqual({ costUsd: 0.42, numTurns: 7 });
  });

  // Every update before the run's result lands carries no usage. Returning a
  // blank object there would wipe a figure already on the card.
  it("returns null when the update carries no figures at all", () => {
    for (const value of [null, undefined, {}, { cost_usd: null, num_turns: null }, "nope"]) {
      expect(readTaskUsage(value)).toBeNull();
    }
  });

  it("keeps whichever figure is present", () => {
    expect(readTaskUsage({ num_turns: 3 })).toEqual({ costUsd: null, numTurns: 3 });
  });
});

describe("usageSummary", () => {
  it("reads as metadata, cost then turns", () => {
    expect(usageSummary({ costUsd: 0.7781, numTurns: 29 })).toBe("$0.78 · 29 turns");
    expect(usageSummary({ costUsd: 1, numTurns: 1 })).toBe("$1.00 · 1 turn");
  });

  // "$0.00" reads as free rather than as very cheap.
  it("never rounds a real cost down to nothing", () => {
    expect(usageSummary({ costUsd: 0.004, numTurns: 2 })).toBe("<$0.01 · 2 turns");
    expect(usageSummary({ costUsd: 0, numTurns: 2 })).toBe("$0.00 · 2 turns");
  });

  it("is empty when there is nothing recorded to show", () => {
    expect(usageSummary(null)).toBe("");
    expect(usageSummary(undefined)).toBe("");
  });
});

describe("TERMINAL", () => {
  // A ceiling termination is over — the deck must stop showing it as working.
  it("counts a ceiling termination as terminal", () => {
    expect(TERMINAL.has("limited")).toBe(true);
  });

  // So is a run that stopped for want of an answer (ask-when-unspecified): it is
  // waiting for nothing, and a card left spinning would say otherwise.
  it("counts an unanswered question as terminal", () => {
    expect(TERMINAL.has("unanswered")).toBe(true);
  });
});

describe("applyTaskUpdate", () => {
  const base = (over: Record<string, unknown> = {}) =>
    ({ type: "claude_task_update", task: "Build it", ts: 1000, ...over }) as unknown as SidecarEvent;

  it("creates a card keyed by run_id", () => {
    const [card] = applyTaskUpdate([], base({ run_id: "r1", status: "running" }));
    expect(card.id).toBe("r1");
    expect(card.task).toBe("Build it");
    expect(card.status).toBe("running");
  });

  // The first update for a run can arrive before an id does.
  it("falls back to a task-derived key when run_id is absent", () => {
    const [card] = applyTaskUpdate([], base({}));
    expect(card.id).toBe(taskKeyFor("Build it"));
  });

  // …and the placeholder that fallback created must not survive beside the
  // real card once the id shows up.
  it("replaces the placeholder card when the real run_id arrives", () => {
    const first = applyTaskUpdate([], base({}));
    expect(first).toHaveLength(1);
    const second = applyTaskUpdate(first, base({ run_id: "r1", status: "running" }));
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe("r1");
  });

  it("moves the updated card to the front without duplicating it", () => {
    let list = applyTaskUpdate([], base({ run_id: "a", task: "A" }));
    list = applyTaskUpdate(list, base({ run_id: "b", task: "B" }));
    expect(list.map((t) => t.id)).toEqual(["b", "a"]);
    list = applyTaskUpdate(list, base({ run_id: "a", task: "A", status: "completed" }));
    expect(list.map((t) => t.id)).toEqual(["a", "b"]);
    expect(list).toHaveLength(2);
  });

  // The rule that a plain assignment would silently break.
  it("never lets an absent field erase a recorded one", () => {
    let list = applyTaskUpdate(
      [],
      base({
        run_id: "r1",
        verb: "execute",
        model: "claude-opus-5",
        claude_session_id: "s1",
        usage: { cost_usd: 0.5, num_turns: 3 },
      }),
    );
    // A later activity update carries none of those fields.
    list = applyTaskUpdate(list, base({ run_id: "r1", status: "running" }));
    expect(list[0].verb).toBe("execute");
    expect(list[0].model).toBe("claude-opus-5");
    expect(list[0].claudeSessionId).toBe("s1");
    expect(list[0].usage).toEqual({ costUsd: 0.5, numTurns: 3 });
  });

  it("rejects a verb the registry does not know", () => {
    const [card] = applyTaskUpdate([], base({ run_id: "r1", verb: "dev" }));
    expect(card.verb).toBeNull();
  });

  it("caps the list at MAX_TASK_CARDS, newest first", () => {
    let list: TaskCard[] = [];
    for (let i = 0; i < MAX_TASK_CARDS + 5; i += 1) {
      list = applyTaskUpdate(list, base({ run_id: `r${i}`, task: `T${i}` }));
    }
    expect(list).toHaveLength(MAX_TASK_CARDS);
    expect(list[0].id).toBe(`r${MAX_TASK_CARDS + 4}`);
  });
});

describe("applyStepPhase", () => {
  const ev = (over: Record<string, unknown>) => ({ type: "claude_task_update", ...over }) as unknown as SidecarEvent;

  it("opens a step on tool_start", () => {
    const steps = applyStepPhase(undefined, ev({ phase: "tool_start", tool_id: "t1", tool: "Read" }), 5);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({ id: "t1", tool: "Read", status: "running", ts: 5 });
  });

  // Keyed by the tool_use id so interleaved calls close correctly.
  it("closes the matching step on tool_end, leaving others running", () => {
    let steps = applyStepPhase(undefined, ev({ phase: "tool_start", tool_id: "t1", tool: "Read" }), 1);
    steps = applyStepPhase(steps, ev({ phase: "tool_start", tool_id: "t2", tool: "Bash" }), 2);
    steps = applyStepPhase(steps, ev({ phase: "tool_end", tool_id: "t1", duration: 42 }), 3);
    expect(steps?.find((s) => s.id === "t1")).toMatchObject({ status: "done", duration: 42 });
    expect(steps?.find((s) => s.id === "t2")).toMatchObject({ status: "running" });
  });

  it("marks an errored tool_end as error rather than done", () => {
    let steps = applyStepPhase(undefined, ev({ phase: "tool_start", tool_id: "t1", tool: "Bash" }), 1);
    steps = applyStepPhase(steps, ev({ phase: "tool_end", tool_id: "t1", error: true }), 2);
    expect(steps?.[0].status).toBe("error");
  });

  it("leaves the timeline untouched for a plain activity update", () => {
    const opened = applyStepPhase(undefined, ev({ phase: "tool_start", tool_id: "t1", tool: "Read" }), 1);
    expect(applyStepPhase(opened, ev({ status: "running" }), 2)).toBe(opened);
  });

  it("caps the timeline at MAX_TASK_STEPS", () => {
    let steps: TaskStep[] | undefined;
    for (let i = 0; i < MAX_TASK_STEPS + 5; i += 1) {
      steps = applyStepPhase(steps, ev({ phase: "tool_start", tool_id: `t${i}`, tool: "Read" }), i);
    }
    expect(steps).toHaveLength(MAX_TASK_STEPS);
    expect(steps?.[MAX_TASK_STEPS - 1].id).toBe(`t${MAX_TASK_STEPS + 4}`);
  });
});

describe("sortTasks", () => {
  const t = (id: string, status: string, updatedAt: number) =>
    ({ id, task: id, status, updatedAt, output: "", error: "", verb: null, model: null, claudeSessionId: null, usage: null }) as TaskCard;

  // A finished run that updated a second ago is less interesting than one
  // still working.
  it("puts active runs ahead of finished ones, whatever the timestamps", () => {
    const sorted = sortTasks([t("done", "completed", 100), t("running", "running", 1)]);
    expect(sorted.map((x) => x.id)).toEqual(["running", "done"]);
  });

  it("orders by recency within each group", () => {
    const sorted = sortTasks([
      t("oldActive", "running", 1),
      t("newActive", "running", 9),
      t("oldDone", "completed", 2),
      t("newDone", "completed", 8),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["newActive", "oldActive", "newDone", "oldDone"]);
  });

  // Status arrives from the runtime as free text.
  it("recognizes a terminal status regardless of case", () => {
    const sorted = sortTasks([t("upper", "COMPLETED", 100), t("running", "running", 1)]);
    expect(sorted[0].id).toBe("running");
  });

  it("treats every terminal status as finished", () => {
    for (const status of TERMINAL) {
      const sorted = sortTasks([t("terminal", status, 100), t("running", "running", 1)]);
      expect(sorted[0].id).toBe("running");
    }
  });

  it("does not mutate the list it was given", () => {
    const original = [t("a", "completed", 1), t("b", "running", 2)];
    sortTasks(original);
    expect(original.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("latestWithResult", () => {
  const t = (id: string, over: Partial<TaskCard> = {}) =>
    ({ id, task: id, status: "completed", updatedAt: 0, output: "", error: "", steps: undefined, ...over }) as TaskCard;

  // A run that finished with nothing to read has nothing to open.
  it("skips a run with neither output nor error", () => {
    expect(latestWithResult([t("empty"), t("has", { output: "text" })])?.id).toBe("has");
  });

  it("accepts a run whose result is an error", () => {
    expect(latestWithResult([t("err", { error: "boom" })])?.id).toBe("err");
  });

  it("returns null when nothing has a result", () => {
    expect(latestWithResult([t("a"), t("b")])).toBeNull();
  });

  it("takes the first of an already-sorted list", () => {
    expect(latestWithResult([t("first", { output: "a" }), t("second", { output: "b" })])?.id).toBe("first");
  });
});

describe("closeRunningSteps", () => {
  const withSteps = (id: string, statuses: string[]) =>
    ({
      id,
      task: id,
      status: "completed",
      updatedAt: 0,
      steps: statuses.map((status, i) => ({ id: `s${i}`, tool: "Read", status, ts: 0 })),
    }) as TaskCard;

  // Without this the timeline keeps a spinner forever on a run that is over.
  it("closes a step left running when the run ended", () => {
    const [task] = closeRunningSteps([withSteps("r1", ["running"])], "r1");
    expect(task.steps?.[0].status).toBe("done");
  });

  it("leaves already-settled steps alone", () => {
    const [task] = closeRunningSteps([withSteps("r1", ["done", "error", "running"])], "r1");
    expect(task.steps?.map((s) => s.status)).toEqual(["done", "error", "done"]);
  });

  it("touches only the run that ended", () => {
    const result = closeRunningSteps([withSteps("r1", ["running"]), withSteps("r2", ["running"])], "r1");
    expect(result[0].steps?.[0].status).toBe("done");
    expect(result[1].steps?.[0].status).toBe("running");
  });

  it("is safe for a run with no timeline at all", () => {
    const bare = { id: "r1", task: "r1", status: "completed", updatedAt: 0 } as TaskCard;
    expect(() => closeRunningSteps([bare], "r1")).not.toThrow();
  });
});
