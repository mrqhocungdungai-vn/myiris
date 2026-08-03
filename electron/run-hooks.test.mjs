import { describe, it, expect, vi } from "vitest";
import { buildRunHooks, destructiveReason, readInFlightCostUsd } from "./run-hooks.mjs";

function make(overrides = {}) {
  const emitEvent = vi.fn();
  const onToolEnd = vi.fn();
  const onActivity = vi.fn();
  const hooks = buildRunHooks({
    budget: { maxBudgetUsd: 4 },
    warnFraction: 0.75,
    costUsd: async () => null,
    onToolEnd,
    onActivity,
    emitEvent,
    ...overrides,
  });
  const fire = (event, input) => hooks[event][0].hooks[0](input);
  return { hooks, fire, emitEvent, onToolEnd, onActivity };
}

describe("destructiveReason", () => {
  it("catches a recursive delete rooted outside the working directory", () => {
    for (const command of ["rm -rf /", "rm -rf ~", "rm -rf $HOME", "sudo rm -fr /", "rm -rf /*"]) {
      expect(destructiveReason(command)).toContain("recursive delete");
    }
  });

  // A run cleaning up its own build output is ordinary work. A guard that
  // blocked it would be one users switch off.
  it("leaves ordinary relative deletes alone", () => {
    for (const command of ["rm -rf node_modules", "rm -rf ./dist", "rm -f package-lock.json", "rm foo.txt"]) {
      expect(destructiveReason(command)).toBeNull();
    }
  });

  it("catches a force-push and a hard reset onto a remote", () => {
    expect(destructiveReason("git push --force origin main")).toContain("force-push");
    expect(destructiveReason("git push -f")).toContain("force-push");
    expect(destructiveReason("git reset --hard origin/main")).toContain("hard reset");
  });

  it("leaves ordinary git alone", () => {
    for (const command of ["git push origin main", "git reset --hard HEAD~1", "git commit -m 'f'"]) {
      expect(destructiveReason(command)).toBeNull();
    }
  });
});

describe("PreToolUse — the guard", () => {
  it("denies a destructive command and tells the model what to do instead", async () => {
    const { fire, emitEvent, onActivity } = make();
    const out = await fire("PreToolUse", { tool_name: "Bash", tool_input: { command: "rm -rf /" } });

    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("recursive delete");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("narrow the command");
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ level: "warn" }));
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("[blocked]"));
  });

  it("lets an ordinary command through, and never inspects a non-Bash tool", async () => {
    const { fire } = make();
    expect(await fire("PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } })).toEqual({
      continue: true,
    });
    // A Write whose content happens to contain the text of a blocked command is
    // not a blocked command.
    expect(await fire("PreToolUse", { tool_name: "Write", tool_input: { content: "rm -rf /" } })).toEqual({
      continue: true,
    });
  });

  it("warns once the run crosses the fraction of its spend ceiling", async () => {
    const { fire, emitEvent, onActivity } = make({ costUsd: async () => 3.5 });
    await fire("PreToolUse", { tool_name: "Read", tool_input: {} });

    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ level: "warn" }));
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("$3.50"));
  });

  // A warning repeated on every tool call is noise, and noise stops being read.
  it("warns only once per run", async () => {
    const { fire, emitEvent } = make({ costUsd: async () => 3.9 });
    await fire("PreToolUse", { tool_name: "Read", tool_input: {} });
    await fire("PreToolUse", { tool_name: "Read", tool_input: {} });
    await fire("PreToolUse", { tool_name: "Read", tool_input: {} });

    expect(emitEvent.mock.calls.filter(([e]) => e.level === "warn")).toHaveLength(1);
  });

  it("stays silent while the run is inside its ceiling, and when no figure is available", async () => {
    for (const costUsd of [async () => 0.2, async () => null]) {
      const { fire, emitEvent } = make({ costUsd });
      await fire("PreToolUse", { tool_name: "Read", tool_input: {} });
      expect(emitEvent).not.toHaveBeenCalled();
    }
  });
});

describe("PostToolUse — the authoritative boundary", () => {
  it("closes a step as succeeded, and a failure as failed", async () => {
    const { fire, onToolEnd, onActivity } = make();

    await fire("PostToolUse", { tool_name: "Bash", tool_use_id: "t1" });
    expect(onToolEnd).toHaveBeenCalledWith("t1", false);

    await fire("PostToolUseFailure", { tool_name: "Bash", tool_use_id: "t2", error: "exit 1" });
    expect(onToolEnd).toHaveBeenCalledWith("t2", true);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("exit 1"));
  });
});

describe("PreCompact and Notification — state that would otherwise look like a stall", () => {
  it("says a compaction is expected rather than leaving a silent pause", async () => {
    const { fire, onActivity, emitEvent } = make();
    await fire("PreCompact", { trigger: "auto" });

    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("compacting"));
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("pause is expected"));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ level: "info" }));
  });

  it("surfaces a runtime notification, and ignores an empty one", async () => {
    const { fire, onActivity } = make();
    await fire("Notification", { message: "Waiting on the network" });
    expect(onActivity).toHaveBeenCalledWith("[claude] Waiting on the network");

    onActivity.mockClear();
    await fire("Notification", { message: "   " });
    expect(onActivity).not.toHaveBeenCalled();
  });
});

describe("readInFlightCostUsd", () => {
  const method = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET";

  it("reads the live session cost", async () => {
    const handle = { [method]: async () => ({ session: { total_cost_usd: 1.25 } }) };
    expect(await readInFlightCostUsd(handle)).toBe(1.25);
  });

  // It is experimental by declaration, so it degrades to silence — never to a
  // thrown error, and never to a figure Iris invented.
  it("degrades to null rather than failing the run", async () => {
    const cases = [
      null,
      {},
      { [method]: async () => { throw new Error("gone"); } },
      { [method]: async () => ({}) },
      { [method]: async () => ({ session: { total_cost_usd: "1.25" } }) },
    ];
    for (const handle of cases) {
      await expect(readInFlightCostUsd(handle)).resolves.toBeNull();
    }
  });
});
