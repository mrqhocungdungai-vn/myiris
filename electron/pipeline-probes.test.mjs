import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPipelineProbes } from "./pipeline-probes.mjs";

function make(overrides = {}) {
  return createPipelineProbes({
    emitEvent: vi.fn(),
    maybeStartCanvasMcp: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true, missing: [] }),
    globalAgentsDir: () => "/fake/agents",
    agentRoster: ["po", "dev"],
    agentPrefix: "iris-",
    execFileImpl: (_bin, _args, _opts, cb) => cb(null, "1.2.3\n"),
    ...overrides,
  });
}

describe("pipeline-probes", () => {
  it("assertExecutable rejects a non-existent, non-file, and non-executable candidate", () => {
    const probes = make();
    expect(() => probes.assertExecutable("TEST", "/definitely/not/a/real/path")).toThrow(/does not exist/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-probe-"));
    expect(() => probes.assertExecutable("TEST", dir)).toThrow(/not a regular file/);

    const file = path.join(dir, "not-executable");
    fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o644 });
    expect(() => probes.assertExecutable("TEST", file)).toThrow(/not executable/);

    const executable = path.join(dir, "executable");
    fs.writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
    expect(() => probes.assertExecutable("TEST", executable)).not.toThrow();
  });

  it("checkClaudeStatus spawns no real subprocess and does not require claude on PATH", async () => {
    const execFileImpl = vi.fn((_bin, _args, _opts, cb) => cb(null, "2.0.0\n"));
    const probes = make({ execFileImpl });
    const result = await probes.checkClaudeStatus();
    expect(result.reachable).toBe(true);
    expect(result.health.version).toBe("2.0.0");
    expect(execFileImpl).toHaveBeenCalledTimes(1);
  });

  it("checkClaudeStatus reports unreachable when the fake exec errors", async () => {
    const execFileImpl = vi.fn((_bin, _args, _opts, cb) => cb(new Error("boom")));
    const probes = make({ execFileImpl });
    const result = await probes.checkClaudeStatus();
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("probePipelineAvailability flips the flag and notifies once on transition", async () => {
    const maybeStartCanvasMcp = vi.fn();
    const emitEvent = vi.fn();
    const probes = make({ maybeStartCanvasMcp, emitEvent });
    expect(probes.getPipelineAvailable()).toBe(false);

    await probes.probePipelineAvailability();
    expect(probes.getPipelineAvailable()).toBe(true);
    expect(maybeStartCanvasMcp).toHaveBeenCalledTimes(1);

    // Second call with the same reachability: no further transition event.
    await probes.probePipelineAvailability();
    expect(maybeStartCanvasMcp).toHaveBeenCalledTimes(1);
  });

  it("checkAgentsStatus reports missing personas by name", () => {
    const probes = make({ globalAgentsDir: () => "/fake/agents/does-not-exist" });
    const status = probes.checkAgentsStatus();
    expect(status.ok).toBe(false);
    expect(status.missing).toEqual(["iris-po.md", "iris-dev.md"]);
  });
});
