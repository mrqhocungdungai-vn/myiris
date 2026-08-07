// The vendored-config check's cases.
//
// Exercised against synthetic trees in a temp directory rather than the real
// `.claude/`, so the test asserts the check's LOGIC and not today's state of the
// repo — a test that passed only because the repo happens to be clean would go
// green the day someone deleted the allowance list.
//
// The real tree is covered by one case at the end, which asserts the check passes
// as currently configured. That one is allowed to be state-dependent: it is the
// build-attached invariant, and if it breaks the build should say so.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPluginSync } from "./check-plugin-sync.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

let root;

/** Write a file, creating parents. */
function put(relative, contents) {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  return absolute;
}

/** A tree with one shared skill file that matches on both sides, plus a valid lock. */
function seedMatchingTree({ claudeBody = "same\n", pluginBody = "same\n" } = {}) {
  put(".claude/skills/shared/SKILL.md", claudeBody);
  put("resources/iris-plugin/skills/shared/SKILL.md", pluginBody);
  put(
    "skills-lock.json",
    JSON.stringify({
      version: 2,
      skills: { shared: { source: "x", sourceType: "github", installedHash: sha256(claudeBody) } },
      agents: {},
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "plugin-sync-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkPluginSync: duplication", () => {
  it("passes when a shared file is identical on both sides", () => {
    seedMatchingTree();
    const result = checkPluginSync({ repoRoot: root });
    expect(result.ok).toBe(true);
  });

  it("fails an undeclared divergence, naming the file and both paths", () => {
    seedMatchingTree({ claudeBody: "one\n", pluginBody: "two\n" });
    const result = checkPluginSync({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("DIVERGED");
    expect(result.output).toContain("skills/shared/SKILL.md");
    expect(result.output).toContain(".claude/");
    expect(result.output).toContain("resources/iris-plugin/");
  });

  it("passes a declared divergence, and only that one", () => {
    seedMatchingTree({ claudeBody: "one\n", pluginBody: "two\n" });
    const allowances = [{ file: "skills/shared/SKILL.md", reason: "declared for the test" }];
    expect(checkPluginSync({ repoRoot: root, allowances }).ok).toBe(true);

    // A second diverging pair is NOT covered by the first's allowance.
    put(".claude/commands/other.md", "a\n");
    put("resources/iris-plugin/commands/other.md", "b\n");
    const result = checkPluginSync({ repoRoot: root, allowances });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("commands/other.md");
  });

  it("reports an allowance that is no longer needed, so exemptions cannot outlive their cause", () => {
    seedMatchingTree();
    const result = checkPluginSync({
      repoRoot: root,
      allowances: [{ file: "skills/shared/SKILL.md", reason: "obsolete" }],
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("STALE ALLOWANCE");
  });

  it("ignores a file present in only one tree — the trees need not hold the same set", () => {
    seedMatchingTree();
    put("resources/iris-plugin/skills/plugin-only/SKILL.md", "ships in the app only\n");
    put(".claude/skills/dev-only/SKILL.md", "developer surface only\n");
    expect(checkPluginSync({ repoRoot: root }).ok).toBe(true);
  });

  it("changes neither copy", () => {
    seedMatchingTree({ claudeBody: "one\n", pluginBody: "two\n" });
    checkPluginSync({ repoRoot: root });
    expect(readFileSync(path.join(root, ".claude/skills/shared/SKILL.md"), "utf8")).toBe("one\n");
    expect(
      readFileSync(path.join(root, "resources/iris-plugin/skills/shared/SKILL.md"), "utf8"),
    ).toBe("two\n");
  });
});

describe("checkPluginSync: provenance", () => {
  it("fails when a locked file no longer hashes to its recorded installedHash", () => {
    seedMatchingTree();
    put(".claude/skills/shared/SKILL.md", "edited after the lock was written\n");
    put("resources/iris-plugin/skills/shared/SKILL.md", "edited after the lock was written\n");
    const result = checkPluginSync({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("CHANGED");
    expect(result.output).toContain("installedHash");
  });

  it("fails when a locked file is absent, so the lock cannot describe a repo that moved on", () => {
    seedMatchingTree();
    rmSync(path.join(root, ".claude/skills/shared/SKILL.md"));
    rmSync(path.join(root, "resources/iris-plugin/skills/shared/SKILL.md"));
    const result = checkPluginSync({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("MISSING");
  });

  it("fails an entry that records no installedHash — there is nothing to verify", () => {
    seedMatchingTree();
    put(
      "skills-lock.json",
      JSON.stringify({ version: 2, skills: { shared: { source: "x" } }, agents: {} }),
    );
    const result = checkPluginSync({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("installedHash");
  });

  it("verifies agents on the same terms as skills", () => {
    const body = "---\nname: a\n---\n";
    put(".claude/agents/a.md", body);
    put("skills-lock.json", JSON.stringify({ version: 2, skills: {}, agents: { a: { installedHash: sha256(body) } } }));
    expect(checkPluginSync({ repoRoot: root }).ok).toBe(true);

    put(".claude/agents/a.md", "---\nname: a\ntools: Read\n---\n");
    expect(checkPluginSync({ repoRoot: root }).ok).toBe(false);
  });

  it("fails closed when the lock is missing or unparseable", () => {
    put(".claude/skills/shared/SKILL.md", "x\n");
    expect(checkPluginSync({ repoRoot: root }).ok).toBe(false);
    put("skills-lock.json", "{ not json");
    const result = checkPluginSync({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not valid JSON");
  });
});

describe("checkPluginSync: this repo", () => {
  it("passes as currently configured", () => {
    const result = checkPluginSync();
    expect(result.ok, result.output).toBe(true);
  });
});
