import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPipelineProbes } from "./pipeline-probes.mjs";

// The credential gate reads process.env directly (it is the same environment the
// worker would inherit), so tests own it explicitly rather than inheriting the
// developer's real one — otherwise the availability cases pass or fail depending
// on whether the machine running them happens to be logged in.
const CREDENTIAL_KEYS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
let savedCredentials;

beforeEach(() => {
  savedCredentials = Object.fromEntries(CREDENTIAL_KEYS.map((k) => [k, process.env[k]]));
  for (const k of CREDENTIAL_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of CREDENTIAL_KEYS) {
    if (savedCredentials[k] === undefined) delete process.env[k];
    else process.env[k] = savedCredentials[k];
  }
});

function make(overrides = {}) {
  return createPipelineProbes({
    emitEvent: vi.fn(),
    maybeStartCanvasMcp: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true, missing: [] }),
    irisPluginDir: () => null,
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

  it("claudeCredentialStatus recognises either credential and neither", () => {
    const probes = make();
    expect(probes.claudeCredentialStatus()).toEqual({ ok: false, kind: null });

    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(probes.claudeCredentialStatus()).toEqual({ ok: true, kind: "api-key" });

    // A subscription token outranks the API key: it is the billing path a
    // long-running resident session is priced for.
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok";
    expect(probes.claudeCredentialStatus()).toEqual({ ok: true, kind: "subscription" });
  });

  it("claudeCredentialStatus treats a blank credential as absent", () => {
    const probes = make();
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "   ";
    expect(probes.claudeCredentialStatus()).toEqual({ ok: false, kind: null });
  });

  it("probePipelineAvailability flips the flag and notifies once on transition", async () => {
    const maybeStartCanvasMcp = vi.fn();
    const emitEvent = vi.fn();
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok";
    const probes = make({ maybeStartCanvasMcp, emitEvent });
    expect(probes.getPipelineAvailable()).toBe(false);

    await probes.probePipelineAvailability();
    expect(probes.getPipelineAvailable()).toBe(true);
    expect(maybeStartCanvasMcp).toHaveBeenCalledTimes(1);

    // Second call with the same reachability: no further transition event.
    await probes.probePipelineAvailability();
    expect(maybeStartCanvasMcp).toHaveBeenCalledTimes(1);
  });

  it("stays unavailable when the binary runs but no credential is configured", async () => {
    // The bundled binary always launches now, so this — not a missing install —
    // is the state a brand-new user is in, and it must still mean chat-only.
    const emitEvent = vi.fn();
    const probes = make({ emitEvent });

    const { available } = await probes.probePipelineAvailability();
    expect(available).toBe(false);
    expect(probes.getPipelineAvailable()).toBe(false);
    expect(emitEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "pipeline_availability" }));
  });

  it("becomes available when a credential is added mid-session", async () => {
    const emitEvent = vi.fn();
    const probes = make({ emitEvent });
    await probes.probePipelineAvailability();
    expect(probes.getPipelineAvailable()).toBe(false);

    process.env.ANTHROPIC_API_KEY = "sk-test";
    await probes.probePipelineAvailability();

    expect(probes.getPipelineAvailable()).toBe(true);
    expect(emitEvent).toHaveBeenCalledWith({ type: "pipeline_availability", available: true });
  });

  it("checkClaudeHealth sends exactly the fields the renderer's ClaudeHealth declares", async () => {
    // src/vite-env.d.ts is a hand-written mirror of this payload with nothing
    // checking the two agree, and the two-project typecheck cannot see across the
    // IPC boundary. Dropping `agentsOk`/`missingAgents` here while the renderer
    // still declared and dereferenced them threw during SetupPanel's render and
    // took the whole UI down. Pin the key set so a change to it is deliberate,
    // and update src/vite-env.d.ts in the same commit.
    const probes = make();
    const health = await probes.checkClaudeHealth();

    expect(Object.keys(health).sort()).toEqual([
      "billingError",
      "billingOk",
      "binaryPath",
      "credentialKind",
      "credentialOk",
      "error",
      "missingNotesSkills",
      "missingSkills",
      "notesSkillsBrokenHint",
      "notesSkillsOk",
      "openspecBrokenHint",
      "openspecOk",
      "openspecVersion",
      "pipelineAvailable",
      "reachable",
      "skillsBrokenHint",
      "skillsDetail",
      "skillsOk",
      "version",
    ]);
  });

  it("never sends an undefined array the renderer would call .join on", async () => {
    // `src/vite-env.d.ts` declares both as `string[]`, so shipping `undefined`
    // would be a lie to every consumer, and any consumer that iterates or joins
    // one gets a render-time TypeError rather than an empty list. The prose in
    // `*BrokenHint` is derived from these, so they cannot silently go absent.
    const probes = make();
    const health = await probes.checkClaudeHealth();

    for (const key of ["missingSkills", "missingNotesSkills"]) {
      expect(Array.isArray(health[key])).toBe(true);
    }
  });

  it("checkClaudeHealth separates binary reachability from pipeline availability", async () => {
    // A packaging failure and a not-logged-in user are different problems; the
    // SetupPanel has to be able to tell them apart.
    const probes = make();
    const health = await probes.checkClaudeHealth();

    expect(health.reachable).toBe(true);
    expect(health.pipelineAvailable).toBe(false);
    expect(health.credentialOk).toBe(false);
    expect(health.version).toBe("1.2.3");
  });

});
