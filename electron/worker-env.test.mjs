import { describe, it, expect } from "vitest";
import { computeWorkerEnv, computeClaudeWorkerEnv } from "./worker-env.mjs";

describe("computeWorkerEnv", () => {
  it("derives by subtraction, leaving the base environment untouched", () => {
    const base = { PATH: "/usr/bin", GEMINI_API_KEY: "voice-secret", HOME: "/home/x" };
    const result = computeWorkerEnv(base, ["GEMINI_API_KEY"]);

    expect(result).toEqual({ PATH: "/usr/bin", HOME: "/home/x" });
    expect(base.GEMINI_API_KEY).toBe("voice-secret");
  });

  it("removes every listed key, ignoring keys that are absent", () => {
    const base = { A: "1", B: "2", C: "3" };
    const result = computeWorkerEnv(base, ["B", "D"]);

    expect(result).toEqual({ A: "1", C: "3" });
  });

  it("keeps every key the worker legitimately needs", () => {
    const base = { PATH: "/usr/bin", TERM: "xterm", CLAUDE_CODE_OAUTH_TOKEN: "tok" };
    const result = computeWorkerEnv(base, ["GEMINI_API_KEY"]);

    expect(result).toEqual(base);
  });
});

describe("computeClaudeWorkerEnv", () => {
  it("withholds the voice credential from every role, always", () => {
    // Least privilege: no role has any use for GEMINI_API_KEY, and a worker runs
    // with bypassPermissions over content it did not author.
    const result = computeClaudeWorkerEnv({ PATH: "/usr/bin", GEMINI_API_KEY: "voice-secret" });

    expect(result.GEMINI_API_KEY).toBeUndefined();
    expect(result.PATH).toBe("/usr/bin");
  });

  it("lets a subscription token win by stripping the metered keys", () => {
    // Stronger than relying on the SDK's auth precedence: a stray API key cannot
    // silently move a subscription user onto metered billing if it isn't there.
    const result = computeClaudeWorkerEnv({
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_AUTH_TOKEN: "bearer",
    });

    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("keeps the API key when it is the only credential the user has", () => {
    // Stripping it unconditionally (the old PO-only rule) would leave an
    // API-key-only user unable to authenticate at all.
    const result = computeClaudeWorkerEnv({ ANTHROPIC_API_KEY: "sk-ant" });

    expect(result.ANTHROPIC_API_KEY).toBe("sk-ant");
  });

  it("treats a blank subscription token as absent", () => {
    const result = computeClaudeWorkerEnv({ CLAUDE_CODE_OAUTH_TOKEN: "   ", ANTHROPIC_API_KEY: "sk-ant" });

    expect(result.ANTHROPIC_API_KEY).toBe("sk-ant");
  });

  it("does not mutate the base environment", () => {
    const base = { GEMINI_API_KEY: "voice", CLAUDE_CODE_OAUTH_TOKEN: "tok", ANTHROPIC_API_KEY: "sk-ant" };
    computeClaudeWorkerEnv(base);

    expect(base.GEMINI_API_KEY).toBe("voice");
    expect(base.ANTHROPIC_API_KEY).toBe("sk-ant");
  });
});
