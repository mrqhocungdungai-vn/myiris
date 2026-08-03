import { describe, it, expect, vi } from "vitest";
import { isSessionAlive, nameSession } from "./run-sessions.mjs";

const HOME = "/fake/.iris/claude-home";

describe("isSessionAlive", () => {
  it("reports a session the runtime knows about", async () => {
    const getInfo = /** @type {any} */ (vi.fn(async () => ({ sessionId: "s1", summary: "A session" })));
    await expect(isSessionAlive("s1", { getInfo, claudeHome: HOME, env: {} })).resolves.toBe(true);
  });

  it("reports a session the runtime does not know about", async () => {
    const getInfo = vi.fn(async () => undefined);
    await expect(isSessionAlive("s1", { getInfo, claudeHome: HOME, env: {} })).resolves.toBe(false);
  });

  // Dropping a live session on the strength of a probe that merely errored would
  // silently discard the user's conversation history — far worse than one failed
  // run. Only a positive "does not exist" counts.
  it("keeps the id when it cannot tell", async () => {
    const getInfo = vi.fn(async () => {
      throw new Error("store unreadable");
    });
    await expect(isSessionAlive("s1", { getInfo, claudeHome: HOME, env: {} })).resolves.toBe(true);
  });

  it("treats a missing id as not alive without probing", async () => {
    const getInfo = vi.fn();
    for (const id of [null, undefined, ""]) {
      await expect(isSessionAlive(id, { getInfo, claudeHome: HOME, env: {} })).resolves.toBe(false);
    }
    expect(getInfo).not.toHaveBeenCalled();
  });

  it("scopes the probe to a project directory when given one", async () => {
    const getInfo = vi.fn(async () => undefined);
    await isSessionAlive("s1", { dir: "/tmp/project", getInfo, claudeHome: HOME, env: {} });
    expect(getInfo).toHaveBeenCalledWith("s1", { dir: "/tmp/project" });

    getInfo.mockClear();
    await isSessionAlive("s1", { getInfo, claudeHome: HOME, env: {} });
    expect(getInfo).toHaveBeenCalledWith("s1", undefined);
  });
});

// The reason this module exists. Measured: with CLAUDE_CONFIG_DIR unset,
// listSessions() returned 32 of the USER's own Claude Code sessions out of
// ~/.claude — the boundary Iris must never cross — and would find none of
// Iris's own, which live under ~/.iris/claude-home.
describe("the config directory is pinned for the call and restored after it", () => {
  it("pins Iris's own home while the probe runs", async () => {
    const env = {};
    let seen = "<unset>";
    await isSessionAlive("s1", {
      claudeHome: HOME,
      env,
      getInfo: async () => {
        seen = env.CLAUDE_CONFIG_DIR;
        return undefined;
      },
    });

    expect(seen).toBe(HOME);
    expect("CLAUDE_CONFIG_DIR" in env).toBe(false);
  });

  it("restores a pre-existing value rather than deleting it", async () => {
    const env = { CLAUDE_CONFIG_DIR: "/somewhere/else" };
    await isSessionAlive("s1", { claudeHome: HOME, env, getInfo: async () => undefined });
    expect(env.CLAUDE_CONFIG_DIR).toBe("/somewhere/else");
  });

  it("restores it even when the call throws", async () => {
    const env = {};
    await isSessionAlive("s1", {
      claudeHome: HOME,
      env,
      getInfo: async () => {
        throw new Error("boom");
      },
    });
    expect("CLAUDE_CONFIG_DIR" in env).toBe(false);
  });
});

describe("nameSession", () => {
  it("names the session", async () => {
    const rename = vi.fn(async () => {});
    await expect(
      nameSession("s1", "Iris · PO", { dir: "/tmp/project", rename, claudeHome: HOME, env: {} }),
    ).resolves.toBe(true);
    expect(rename).toHaveBeenCalledWith("s1", "Iris · PO", { dir: "/tmp/project" });
  });

  it("does nothing without an id or a label", async () => {
    const rename = vi.fn();
    for (const [id, title] of [[null, "x"], ["s1", ""], ["s1", "   "], ["s1", null]]) {
      await expect(nameSession(id, title, { rename, claudeHome: HOME, env: {} })).resolves.toBe(false);
    }
    expect(rename).not.toHaveBeenCalled();
  });

  // A title is cosmetic; failing a run over one would be absurd.
  it("swallows a failure rather than disturbing the run", async () => {
    const rename = vi.fn(async () => {
      throw new Error("read-only store");
    });
    await expect(nameSession("s1", "Label", { rename, claudeHome: HOME, env: {} })).resolves.toBe(false);
  });
});
