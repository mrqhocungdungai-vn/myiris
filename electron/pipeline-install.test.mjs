import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPipelineInstall } from "./pipeline-install.mjs";

let homeDir;
let repoRoot;
let restoreHome;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-install-home-"));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iris-install-repo-"));
  restoreHome = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
});

afterEach(() => {
  restoreHome.mockRestore();
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function make(overrides = {}) {
  return createPipelineInstall({
    repoRoot,
    emitEvent: vi.fn(),
    agentRoster: ["po", "dev"],
    agentPrefix: "iris-",
    agentLabels: { po: "PO", dev: "DEV" },
    retiredAgents: ["ba", "test"],
    hasOpenSpec: () => false,
    openspecCommand: () => ({ command: "/fake/node", args: ["/fake/openspec.js"], env: { ELECTRON_RUN_AS_NODE: "1" } }),
    findWorkstream: () => null,
    getActiveWorkstreamId: () => null,
    resolveAgentModel: () => null,
    ...overrides,
  });
}

function writePersonas(personas) {
  const dir = path.join(repoRoot, "resources", "personas");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(personas)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

describe("pipeline-install", () => {
  it("resolves the bundled persona into an SDK agent definition", () => {
    writePersonas({ "iris-po.md": "---\ndescription: The PO\n---\nPO persona body." });
    const install = make();
    expect(install.resolveAgentDefinition("po", null)).toEqual({
      description: "The PO",
      prompt: "PO persona body.",
    });
    // Nothing is written outside the app any more.
    expect(fs.existsSync(path.join(homeDir, ".claude", "agents"))).toBe(false);
  });

  it("prefers a project-local persona override over the bundled one", () => {
    writePersonas({ "iris-dev.md": "---\ndescription: Bundled\n---\nBundled body." });
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-install-proj-"));
    try {
      const dir = path.join(projectDir, ".claude", "agents");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "iris-dev.md"), "---\ndescription: Local\n---\nLocal body.");

      const install = make();
      expect(install.resolveAgentDefinition("dev", projectDir).prompt).toBe("Local body.");
      expect(install.resolveAgentDefinition("dev", null).prompt).toBe("Bundled body.");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("throws when the persona is missing from the bundle", () => {
    const install = make();
    expect(() => install.resolveAgentDefinition("po", null)).toThrow(/app bundle/);
  });

  it("reports what an older Iris left in ~/.claude without touching it", () => {
    const agentsDir = path.join(homeDir, ".claude", "agents");
    const skillsDir = path.join(homeDir, ".claude", "skills");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(path.join(skillsDir, "grilling"), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "iris-po.md"), "stale");

    const status = make().legacyClaudeArtifactsStatus();

    expect(status.count).toBe(2);
    // Reporting must never be destructive — this is what the panel calls on open.
    expect(fs.existsSync(path.join(agentsDir, "iris-po.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "grilling"))).toBe(true);
  });

  it("removes only what Iris itself put in ~/.claude", () => {
    // ~/.claude belongs to the user's own Claude Code install. Deleting
    // anything Iris did not write there is the exact interference this change
    // exists to end.
    const agentsDir = path.join(homeDir, ".claude", "agents");
    const skillsDir = path.join(homeDir, ".claude", "skills");
    const commandsDir = path.join(homeDir, ".claude", "commands", "opsx");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(commandsDir, { recursive: true });
    for (const name of ["iris-po.md", "iris-dev.md", "iris-ba.md"]) fs.writeFileSync(path.join(agentsDir, name), "stale");
    for (const name of ["grilling", "tdd", "wiki-query"]) fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "apply.md"), "stale");
    // Things Iris never wrote:
    fs.writeFileSync(path.join(agentsDir, "someone-elses.md"), "keep me");
    fs.mkdirSync(path.join(skillsDir, "my-own-skill"), { recursive: true });

    const result = make().removeLegacyClaudeArtifacts();

    expect(result.removed.length).toBe(7);
    expect(result.errors).toEqual([]);
    expect(fs.existsSync(path.join(agentsDir, "someone-elses.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "my-own-skill"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "grilling"))).toBe(false);
    expect(make().legacyClaudeArtifactsStatus().count).toBe(0);
  });

  it("offers to remove the transcript directory for Iris's own workspace", () => {
    // Runs used to inherit the default CLAUDE_CONFIG_DIR, so every one of them
    // wrote a transcript into the user's ~/.claude/projects/.
    const dir = path.join(homeDir, ".claude", "projects", path.join(homeDir, ".iris", "workspace").replace(/[/.]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session.jsonl"), "{}");

    expect(make().legacyClaudeArtifactsStatus().count).toBe(1);
    make().removeLegacyClaudeArtifacts();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("never touches transcripts keyed by a real project directory", () => {
    // Those are keyed by working directory, so Iris's runs and the user's own
    // Claude Code sessions for the same project land in the SAME directory.
    // Removing it to clean up after Iris would delete the user's history.
    const mine = path.join(homeDir, ".claude", "projects", "-Users-someone-works-my-app");
    fs.mkdirSync(mine, { recursive: true });
    fs.writeFileSync(path.join(mine, "session.jsonl"), "{}");

    const status = make().legacyClaudeArtifactsStatus();
    make().removeLegacyClaudeArtifacts();

    expect(status.count).toBe(0);
    expect(fs.existsSync(path.join(mine, "session.jsonl"))).toBe(true);
  });

  it("pathExists treats a broken symlink as present", () => {
    const target = path.join(homeDir, "missing-target");
    const link = path.join(homeDir, "broken-link");
    fs.symlinkSync(target, link);
    const install = make();
    expect(install.pathExists(link)).toBe(true);
    expect(install.pathExists(path.join(homeDir, "nothing-here"))).toBe(false);
  });

  it("agentsSnapshot reports installed roster and project gates", () => {
    writePersonas({
      "iris-po.md": "---\ndescription: The PO\n---\nPO body.",
      "iris-dev.md": "---\ndescription: The DEV\n---\nDEV body.",
    });
    make({ resolveAgentModel: (_ws, role) => `model-for-${role}` });

    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-install-project-"));
    try {
      const changeDir = path.join(projectDir, "openspec", "changes", "my-change");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal");
      fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] done\n");

      const install2 = make({
        resolveAgentModel: (_ws, role) => `model-for-${role}`,
        findWorkstream: (id) => (id === "ws1" ? { id: "ws1", cwd: projectDir } : null),
      });
      const snapshot = install2.agentsSnapshot("ws1");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.hasProject).toBe(true);
      expect(snapshot.gates.byRole.po).toBe(true);
      expect(snapshot.gates.byRole.dev).toBe(true);
      expect(snapshot.roster.find((r) => r.key === "po").model).toBe("model-for-po");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
