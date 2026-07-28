import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const realSkillsSourceDir = path.join(repoRoot, "resources", "skills");

vi.mock("../vault-graph.mjs", () => ({
  createVaultGraph: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    getGraph: vi.fn(() => Promise.resolve({ nodes: [], links: [] })),
    resolveNotePath: vi.fn(() => null),
    onUpdate: vi.fn(),
  })),
}));

// NOTES_VAULT_DIR is a module-top-level const computed once from
// os.homedir() at import time (a verbatim carry-over of main.mjs's
// pre-split shape) — so os.homedir() must be mocked and the module
// re-imported fresh per test (vi.resetModules), never touching the real
// developer machine's actual ~/iris-second-brain vault.
let homeDir;
let restoreHome;
let createSecondBrainCapability;
let createVaultGraph;
let NOTES_VAULT_DIR;

beforeEach(async () => {
  vi.resetModules();
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-secondbrain-home-"));
  restoreHome = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  ({ createSecondBrainCapability } = await import("./second-brain.mjs"));
  ({ createVaultGraph } = await import("../vault-graph.mjs"));
  NOTES_VAULT_DIR = path.join(homeDir, "iris-second-brain");
});

afterEach(() => {
  restoreHome.mockRestore();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function make(overrides = {}) {
  return createSecondBrainCapability({
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    skillsSourceDir: vi.fn(() => realSkillsSourceDir),
    userDisplayName: vi.fn(() => "Alex"),
    getPipelineAvailable: vi.fn(() => true),
    ...overrides,
  });
}

describe("second-brain capability: checkNotesSkillsStatus", () => {
  it("reports ok exactly when nothing is missing", () => {
    // os.homedir() is already mocked to homeDir for the whole test (top
    // beforeEach) — checkNotesSkillsStatus reads it live (not captured at
    // import time, unlike NOTES_VAULT_DIR), so populating homeDir/.claude/
    // skills directly is enough, no additional mocking needed.
    const cap = make();
    const skillsRoot = path.join(homeDir, ".claude", "skills");
    const names = ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"];
    fs.mkdirSync(skillsRoot, { recursive: true });
    for (const name of names) fs.mkdirSync(path.join(skillsRoot, name));
    const status = cap.checkNotesSkillsStatus();
    expect(status).toEqual({ ok: true, missing: [], skillsDir: skillsRoot });
  });

  it("lists exactly the missing skill names when some are absent", () => {
    const cap = make();
    const status = cap.checkNotesSkillsStatus();
    expect(status.ok).toBe(false);
    expect(status.missing).toEqual(["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"]);
  });
});

describe("second-brain capability: ensureNotesVaultReady", () => {
  it("creates the vault directory even when the skill bundle is unresolved", () => {
    const cap = make({ skillsSourceDir: vi.fn(() => null) });
    cap.ensureNotesVaultReady();
    expect(fs.existsSync(NOTES_VAULT_DIR)).toBe(true);
    expect(fs.existsSync(path.join(NOTES_VAULT_DIR, "wiki-config.md"))).toBe(false);
  });

  it("pre-seeds wiki-config.md and wiki-schema.md from the real bundled template on first use", () => {
    const cap = make();
    cap.ensureNotesVaultReady();
    const configPath = path.join(NOTES_VAULT_DIR, "wiki-config.md");
    const schemaPath = path.join(NOTES_VAULT_DIR, "wiki-schema.md");
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(schemaPath)).toBe(true);
    const rendered = fs.readFileSync(configPath, "utf8");
    // renderNotesVaultConfig's macOS adaptation (design.md D5): placeholder
    // blacklist becomes an empty list, and backslash path separators become
    // forward slashes.
    expect(rendered).toContain("blacklist: []");
    expect(rendered).not.toMatch(/templates_folder: templates\\/);
    expect(rendered).toContain("templates_folder: templates/");
  });

  it("never overwrites an existing config on a second call", () => {
    const cap = make();
    cap.ensureNotesVaultReady();
    const configPath = path.join(NOTES_VAULT_DIR, "wiki-config.md");
    fs.writeFileSync(configPath, "USER EDITED THIS", "utf8");
    cap.ensureNotesVaultReady();
    expect(fs.readFileSync(configPath, "utf8")).toBe("USER EDITED THIS");
  });
});

describe("second-brain capability: vaultChangedSince", () => {
  it("is false when nothing in the vault changed since the given time", () => {
    const cap = make();
    cap.ensureNotesVaultReady();
    const future = Date.now() + 60_000;
    expect(cap.vaultChangedSince(future)).toBe(false);
  });

  it("is true once a file at/after the cutoff exists, including in a subdirectory", () => {
    const cap = make();
    fs.mkdirSync(path.join(NOTES_VAULT_DIR, "sub"), { recursive: true });
    const cutoff = Date.now() - 1000;
    fs.writeFileSync(path.join(NOTES_VAULT_DIR, "sub", "note.md"), "hello", "utf8");
    expect(cap.vaultChangedSince(cutoff)).toBe(true);
  });
});

describe("second-brain capability: probeSecondBrainAvailability", () => {
  it("emits only on a real transition, not on every call", () => {
    const emitEvent = vi.fn();
    const cap = make({ emitEvent });
    expect(cap.probeSecondBrainAvailability()).toBe(false); // vault doesn't exist yet
    expect(emitEvent).not.toHaveBeenCalled(); // false -> false is not a transition

    fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true });
    expect(cap.probeSecondBrainAvailability()).toBe(true);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith({ type: "secondbrain_availability", available: true });

    expect(cap.probeSecondBrainAvailability()).toBe(true);
    expect(emitEvent).toHaveBeenCalledTimes(1); // true -> true is not a transition
  });

  it("stops the vault-graph watcher when the vault disappears out from under it", () => {
    const cap = make();
    fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true });
    cap.probeSecondBrainAvailability();
    const graphInstance = createVaultGraph.mock.results.at(-1).value;
    fs.rmSync(NOTES_VAULT_DIR, { recursive: true, force: true });
    cap.probeSecondBrainAvailability();
    expect(graphInstance.stop).toHaveBeenCalled();
  });
});

describe("second-brain capability: promptFragment", () => {
  it("is empty when the pipeline is unavailable", () => {
    expect(make({ getPipelineAvailable: () => false }).promptFragment()).toBe("");
  });

  it("is empty when the pipeline is available but notes skills are missing", () => {
    expect(make({ getPipelineAvailable: () => true }).promptFragment()).toBe("");
  });

  it("offers the note-save line only when the pipeline is available and skills are installed", () => {
    const skillsRoot = path.join(homeDir, ".claude", "skills");
    for (const name of ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"]) {
      fs.mkdirSync(path.join(skillsRoot, name), { recursive: true });
    }
    const cap = make();
    expect(cap.promptFragment()).toContain("NOTE-OFFER");
  });
});

describe("second-brain capability: ipcHandlers", () => {
  it("registers exactly the 5 secondbrain:* channels with the correct handle/on split", () => {
    const cap = make();
    const byChannel = Object.fromEntries(cap.ipcHandlers.map((h) => [h.channel, h.kind]));
    expect(byChannel).toEqual({
      "secondbrain:availability": "handle",
      "secondbrain:get-graph": "handle",
      "secondbrain:activate": "on",
      "secondbrain:deactivate": "on",
      "secondbrain:read-note": "handle",
    });
  });

  it("secondbrain:read-note rejects a malformed id without touching the graph", () => {
    const cap = make();
    const handler = cap.ipcHandlers.find((h) => h.channel === "secondbrain:read-note").fn;
    expect(handler(null, "")).toEqual({ ok: false });
    expect(handler(null, 42)).toEqual({ ok: false });
    const graphInstance = createVaultGraph.mock.results.at(-1).value;
    expect(graphInstance.resolveNotePath).not.toHaveBeenCalled();
  });

  it("secondbrain:get-graph returns an empty graph without reading the vault when unavailable", async () => {
    const cap = make();
    const handler = cap.ipcHandlers.find((h) => h.channel === "secondbrain:get-graph").fn;
    const result = await handler();
    expect(result).toEqual({ graph: { nodes: [], links: [] }, available: false });
    const graphInstance = createVaultGraph.mock.results.at(-1).value;
    expect(graphInstance.getGraph).not.toHaveBeenCalled();
  });
});

describe("second-brain capability: teardown", () => {
  it("stops the vault-graph watcher", () => {
    const cap = make();
    cap.teardown();
    const graphInstance = createVaultGraph.mock.results.at(-1).value;
    expect(graphInstance.stop).toHaveBeenCalled();
  });
});
