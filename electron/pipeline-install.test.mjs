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
    openspecBinary: () => "openspec",
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
  it("installs persona files that are missing from the agents dir", () => {
    writePersonas({ "iris-po.md": "PO persona", "iris-dev.md": "DEV persona" });
    const install = make();
    const result = install.installIrisAgents();
    expect(result.status).toBe("ok");
    expect(result.installed.sort()).toEqual(["iris-dev.md", "iris-po.md"]);
    expect(fs.readFileSync(path.join(homeDir, ".claude", "agents", "iris-po.md"), "utf8")).toBe("PO persona");
  });

  it("cleans up RETIRED_AGENTS files on install", () => {
    writePersonas({ "iris-po.md": "PO persona", "iris-dev.md": "DEV persona" });
    const agentsDir = path.join(homeDir, ".claude", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "iris-ba.md"), "stale BA persona");
    fs.writeFileSync(path.join(agentsDir, "iris-test.md"), "stale test persona");

    const install = make();
    const result = install.installIrisAgents();

    expect(result.removed.sort()).toEqual(["iris-ba.md", "iris-test.md"]);
    expect(fs.existsSync(path.join(agentsDir, "iris-ba.md"))).toBe(false);
    expect(fs.existsSync(path.join(agentsDir, "iris-test.md"))).toBe(false);
  });

  it("skips a persona file whose installed content already matches the bundled template", () => {
    writePersonas({ "iris-po.md": "PO persona" });
    const install = make({ agentRoster: ["po"] });
    install.installIrisAgents();
    const second = install.installIrisAgents();
    expect(second.skipped).toEqual(["iris-po.md"]);
    expect(second.installed).toEqual([]);
  });

  it("reports an error when persona templates are missing from the bundle", () => {
    const install = make();
    const result = install.installIrisAgents();
    expect(result.status).toBe("error");
    expect(result.installed).toEqual([]);
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
    writePersonas({ "iris-po.md": "PO persona", "iris-dev.md": "DEV persona" });
    const install = make({ resolveAgentModel: (_ws, role) => `model-for-${role}` });
    install.installIrisAgents();

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
