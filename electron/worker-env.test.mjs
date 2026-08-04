import { describe, it, expect } from "vitest";
import path from "node:path";
import { computeWorkerEnv, computeClaudeWorkerEnv, irisClaudeHome } from "./worker-env.mjs";

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
  it("withholds the voice credential from every run, always", () => {
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

describe("computeClaudeWorkerEnv: keeping out of the user's ~/.claude", () => {
  // settingSources does not cover these. Measured before the fix: one run wrote
  // a 57 KB session transcript into ~/.claude/projects/. Everything that
  // escapes settingSources lives under CLAUDE_CONFIG_DIR, so pinning the
  // directory is what actually makes "Iris never writes to ~/.claude" true.
  it("points the whole Claude state directory at Iris's own storage", () => {
    const result = computeClaudeWorkerEnv({ HOME: "/home/x" }, { claudeHome: "/iris/home" });

    expect(result.CLAUDE_CONFIG_DIR).toBe("/iris/home");
  });

  it("disables auto-memory, which writes unprompted under bypassPermissions", () => {
    const result = computeClaudeWorkerEnv({}, { claudeHome: "/iris/home" });

    expect(result.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  it("overrides an inherited CLAUDE_CONFIG_DIR rather than deferring to it", () => {
    // The parent process's own value must not decide where worker state lands —
    // otherwise a developer shell pointing at ~/.claude reintroduces the leak.
    const result = computeClaudeWorkerEnv(
      { CLAUDE_CONFIG_DIR: "/home/x/.claude" },
      { claudeHome: "/iris/home" },
    );

    expect(result.CLAUDE_CONFIG_DIR).toBe("/iris/home");
  });

  it("defaults to a stable per-user directory, not a temp one", () => {
    // Stable because `resume` has to find the transcript a previous run wrote;
    // a temp directory would silently reset every workstream's context.
    const first = irisClaudeHome(() => "/home/x");
    const second = irisClaudeHome(() => "/home/x");

    expect(first).toBe(path.join("/home/x", ".iris", "claude-home"));
    expect(second).toBe(first);
    expect(first).not.toContain(`${path.sep}.claude`);
  });
});
