import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const realPluginDir = path.join(repoRoot, "resources", "iris-plugin");

vi.mock("../vault-graph.mjs", () => ({
  createVaultGraph: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    getGraph: vi.fn(() => Promise.resolve({ nodes: [], links: [] })),
    resolveNotePath: vi.fn(() => null),
    onUpdate: vi.fn(),
  })),
}));

// Real path-helper behavior is kept (captureSpoolDir/runSpoolDir); only the
// write itself is mocked, so a test can force a failure without touching disk.
vi.mock("../vault-write.mjs", async () => {
  const actual = await vi.importActual("../vault-write.mjs");
  return { ...actual, appendSpoolRecord: vi.fn(async () => ({ ok: true, file: "/mock/inbox/captures/x.md" })) };
});

// NOTES_VAULT_DIR is a module-top-level const computed once from
// os.homedir() at import time (a verbatim carry-over of main.mjs's
// pre-split shape) — so os.homedir() must be mocked and the module
// re-imported fresh per test (vi.resetModules), never touching the real
// developer machine's actual ~/iris-second-brain vault.
let homeDir;
let restoreHome;
let createSecondBrainCapability;
let createVaultGraph;
/** @type {any} */
let appendSpoolRecord;
let NOTES_VAULT_DIR;

beforeEach(async () => {
  vi.resetModules();
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-secondbrain-home-"));
  restoreHome = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  ({ createSecondBrainCapability } = await import("./second-brain.mjs"));
  ({ createVaultGraph } = await import("../vault-graph.mjs"));
  ({ appendSpoolRecord } = await import("../vault-write.mjs"));
  appendSpoolRecord.mockClear();
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
    irisPluginDir: vi.fn(() => realPluginDir),
    userDisplayName: vi.fn(() => "Alex"),
    getPipelineAvailable: vi.fn(() => true),
    ...overrides,
  });
}

describe("second-brain capability: checkNotesSkillsStatus", () => {
  it("reports ok against the REAL shipped plugin, never ~/.claude", () => {
    // The wiki skills ship in resources/iris-plugin. Asserting against the real
    // bundle is what would catch a skill being dropped or renamed in a refactor.
    const cap = make();
    const status = cap.checkNotesSkillsStatus();
    expect(status).toEqual({ ok: true, missing: [], skillsDir: path.join(realPluginDir, "skills") });
    // The user's own Claude Code install is not consulted at all.
    expect(status.skillsDir.startsWith(homeDir)).toBe(false);
  });

  it("lists exactly the missing skill names when the bundle lacks them", () => {
    const emptyPlugin = fs.mkdtempSync(path.join(os.tmpdir(), "iris-empty-plugin-"));
    try {
      const status = make({ irisPluginDir: () => emptyPlugin }).checkNotesSkillsStatus();
      expect(status.ok).toBe(false);
      expect(status.missing).toEqual(["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"]);
    } finally {
      fs.rmSync(emptyPlugin, { recursive: true, force: true });
    }
  });
});

describe("second-brain capability: ensureNotesVaultReady", () => {
  it("creates the vault directory even when the skill bundle is unresolved", () => {
    const cap = make({ irisPluginDir: vi.fn(() => null) });
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
  // vault-write-path design D4/D7: capture needs no worker, so its guidance is
  // never withheld — unlike the pre-split behavior where the whole fragment
  // vanished without a pipeline.
  it("still offers capture guidance when the pipeline is unavailable", () => {
    const fragment = make({ getPipelineAvailable: () => false }).promptFragment();
    expect(fragment).toContain("SECOND BRAIN");
    expect(fragment).toContain("capture_note");
    expect(fragment).not.toContain("capture_learning");
  });

  it("still offers capture guidance when the pipeline is available but the bundle lacks the notes skills", () => {
    const emptyPlugin = fs.mkdtempSync(path.join(os.tmpdir(), "iris-empty-plugin-"));
    try {
      const fragment = make({ getPipelineAvailable: () => true, irisPluginDir: () => emptyPlugin }).promptFragment();
      expect(fragment).toContain("SECOND BRAIN");
      expect(fragment).not.toContain("capture_learning");
    } finally {
      fs.rmSync(emptyPlugin, { recursive: true, force: true });
    }
  });

  it("adds curation/retrieval guidance only when the pipeline is available and the bundle has the skills", () => {
    const fragment = make().promptFragment();
    expect(fragment).toContain("SECOND BRAIN");
    expect(fragment).toContain("capture_learning");
  });

  // The capability is reachable as named functions now, so its prose says only
  // what a schema cannot: when to offer. It no longer has to describe how to
  // route note work through a general-purpose task tool.
  it("names capabilities rather than describing how to shape a general task", () => {
    const fragment = make().promptFragment();
    expect(fragment).not.toContain("submit_claude_task");
    expect(fragment).not.toMatch(/\bPO\b|\bDEV\b/);
  });
});

describe("second-brain capability: capture_note tool", () => {
  it("contributes the capture_note declaration", () => {
    const declaration = make().toolDeclarations.find((d) => d.name === "capture_note");
    expect(declaration).toBeDefined();
    expect(declaration.parameters.required).toEqual(["text"]);
  });

  it("ensures the vault exists before writing, even on a machine with no vault yet", async () => {
    const cap = make();
    expect(fs.existsSync(NOTES_VAULT_DIR)).toBe(false);
    const result = await cap.captureNote({ text: "remember this" });
    expect(result.status).toBe("ok");
    expect(fs.existsSync(NOTES_VAULT_DIR)).toBe(true);
  });

  it("appends the trimmed text to the capture spool, not the run spool", async () => {
    await make().captureNote({ text: "  remember this  " });
    expect(appendSpoolRecord).toHaveBeenCalledTimes(1);
    const call = appendSpoolRecord.mock.calls[0][0];
    expect(call.dir).toBe(path.join(NOTES_VAULT_DIR, "inbox", "captures"));
    expect(call.content).toContain("remember this");
  });

  it("names the saved file on a successful write", async () => {
    const result = await make().captureNote({ text: "remember this" });
    expect(result.status).toBe("ok");
    expect(result.file).toBe("/mock/inbox/captures/x.md");
  });

  // spec: "A capture whose write fails is reported as failed, not confirmed."
  it("reports a failure, not a save, when the write fails", async () => {
    appendSpoolRecord.mockResolvedValueOnce({ ok: false, error: "ENOSPC" });
    const result = await make().captureNote({ text: "remember this" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("ENOSPC");
    expect(result.file).toBeUndefined();
  });

  it("rejects an empty capture without touching the filesystem", async () => {
    const result = await make().captureNote({ text: "   " });
    expect(result.status).toBe("error");
    expect(appendSpoolRecord).not.toHaveBeenCalled();
    expect(fs.existsSync(NOTES_VAULT_DIR)).toBe(false);
  });

  // Capture is a plain file write, not a run (design D4): its result carries no
  // run_id, unlike every verb dispatch's result — there is no execution slot
  // for it to occupy in the first place.
  it("returns a filesystem outcome, never a run-shaped result", async () => {
    const result = await make().captureNote({ text: "remember this" });
    expect(result).not.toHaveProperty("run_id");
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
