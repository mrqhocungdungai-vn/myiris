import { describe, it, expect } from "vitest";
import { computeWorkerEnv } from "./worker-env.mjs";

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
