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
    notifyIris: vi.fn(),
    irisPluginDir: vi.fn(() => realPluginDir),
    userDisplayName: vi.fn(() => "Alex"),
    getPipelineAvailable: vi.fn(() => true),
    ...overrides,
  });
}

function handlerFor(cap, channel) {
  return cap.ipcHandlers.find((h) => h.channel === channel).fn;
}

// A literal graph the mocked createVaultGraph's getGraph() can resolve, so a
// test can populate `latestGraph` (and thereby resolveFocus/resolveVaultNotePath)
// without touching a real vault. resolveNotePath mirrors vault-graph.mjs's own
// contract: null for a ghost, an unknown id, or a since-removed file.
function seedGraph(cap, nodes) {
  fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true }); // so probeSecondBrainAvailability() reports available
  // Real files on disk, not just literal node objects: resolveVaultNotePath
  // (used by both read-note and the mutation surface) calls fs.realpathSync,
  // which throws for a path that doesn't actually exist.
  for (const node of nodes) {
    if (node.ghost) continue;
    fs.writeFileSync(path.join(NOTES_VAULT_DIR, `${node.id}.md`), node.body ?? `# ${node.title}\n`);
  }
  const graphInstance = createVaultGraph.mock.results.at(-1).value;
  graphInstance.getGraph.mockResolvedValueOnce({ nodes, links: [] });
  graphInstance.resolveNotePath.mockImplementation((id) => {
    const node = nodes.find((n) => n.id === id && !n.ghost);
    return node ? path.join(NOTES_VAULT_DIR, `${node.id}.md`) : null;
  });
  return handlerFor(cap, "secondbrain:get-graph")();
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

  // A real, user-visible note (unlike wiki-config.md/wiki-schema.md, which
  // are system files excluded from the galaxy graph) — so a first-ever open
  // of the galaxy isn't an empty graph with no explanation.
  it("pre-seeds a welcome note that is not one of the excluded system files", () => {
    const cap = make();
    cap.ensureNotesVaultReady();
    const notePath = path.join(NOTES_VAULT_DIR, "Welcome to your Second Brain.md");
    expect(fs.existsSync(notePath)).toBe(true);
    const text = fs.readFileSync(notePath, "utf8");
    expect(text).toContain("title:");
    expect(text).toContain("tags:");
    expect(text).toContain("second brain");
  });

  it("pre-seeds the welcome note even when the skill bundle is unresolved", () => {
    const cap = make({ irisPluginDir: vi.fn(() => null) });
    cap.ensureNotesVaultReady();
    expect(fs.existsSync(path.join(NOTES_VAULT_DIR, "Welcome to your Second Brain.md"))).toBe(true);
  });

  it("never overwrites the welcome note once present — an edit or deletion is the user's own choice", () => {
    const cap = make();
    cap.ensureNotesVaultReady();
    const notePath = path.join(NOTES_VAULT_DIR, "Welcome to your Second Brain.md");
    fs.writeFileSync(notePath, "USER EDITED THIS", "utf8");
    cap.ensureNotesVaultReady();
    expect(fs.readFileSync(notePath, "utf8")).toBe("USER EDITED THIS");
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
  it("registers exactly the 8 secondbrain:* channels plus the 2 ambient-capture:* channels, with the correct handle/on split", () => {
    const cap = make();
    const byChannel = Object.fromEntries(cap.ipcHandlers.map((h) => [h.channel, h.kind]));
    expect(byChannel).toEqual({
      "secondbrain:availability": "handle",
      "secondbrain:get-graph": "handle",
      "secondbrain:activate": "on",
      "secondbrain:deactivate": "on",
      "secondbrain:read-note": "handle",
      "secondbrain:set-focus": "handle",
      "secondbrain:get-focus": "handle",
      "secondbrain:clear-focus": "handle",
      "ambient-capture:set-enabled": "on",
      "ambient-capture:query": "handle",
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

  it("flushes ambient session capture, even if it was never explicitly disabled", async () => {
    const utterances = [{ text: "last words", at: Date.now() + 60000 }];
    const cap = make({ recentUtterances: () => utterances });
    await handlerFor(cap, "ambient-capture:set-enabled")(null, { enabled: true });
    await cap.setAmbientCaptureAwake(true);
    appendSpoolRecord.mockClear();
    await cap.teardown();
    expect(appendSpoolRecord).toHaveBeenCalledTimes(1);
    expect(appendSpoolRecord.mock.calls[0][0].content).toContain("last words");
  });
});

// ambient-memory: the opt-in retention gate. Default off, gated on BOTH the
// renderer's persisted preference and Iris being awake, and fails closed
// against IRIS_AMBIENT_CAPTURE=off no matter what the renderer says.
describe("second-brain capability: ambient session capture", () => {
  afterEach(() => {
    delete process.env.IRIS_AMBIENT_CAPTURE;
  });

  function setEnabled(cap, enabled) {
    return handlerFor(cap, "ambient-capture:set-enabled")(null, { enabled });
  }

  function query(cap) {
    return handlerFor(cap, "ambient-capture:query")();
  }

  it("is off by default: awake alone is not enough to go live", async () => {
    const cap = make();
    expect(query(cap)).toEqual({ enabled: false, live: false, forcedOff: false });
    await cap.setAmbientCaptureAwake(true);
    expect(query(cap)).toEqual({ enabled: false, live: false, forcedOff: false });
  });

  it("retains nothing until the renderer's preference message explicitly enables it", async () => {
    const cap = make();
    await cap.setAmbientCaptureAwake(true); // awake, but no preference message has ever arrived
    expect(query(cap).live).toBe(false);
    await setEnabled(cap, true);
    expect(query(cap).live).toBe(true);
  });

  it("goes live only once BOTH the preference is enabled and Iris is awake", async () => {
    const cap = make();
    await setEnabled(cap, true);
    expect(query(cap).live).toBe(false); // not awake yet
    await cap.setAmbientCaptureAwake(true);
    expect(query(cap).live).toBe(true);
  });

  it("pushes ambient-capture:state on every live transition", async () => {
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    await setEnabled(cap, true);
    await cap.setAmbientCaptureAwake(true);
    expect(emitToRenderer).toHaveBeenCalledWith("ambient-capture:state", { live: true });
    emitToRenderer.mockClear();
    await cap.setAmbientCaptureAwake(false);
    expect(emitToRenderer).toHaveBeenCalledWith("ambient-capture:state", { live: false });
  });

  it("stops retention on sleep and resumes it on wake, without losing the preference", async () => {
    const cap = make();
    await setEnabled(cap, true);
    await cap.setAmbientCaptureAwake(true);
    expect(query(cap).live).toBe(true);
    await cap.setAmbientCaptureAwake(false); // asleep
    expect(query(cap).live).toBe(false);
    expect(query(cap).enabled).toBe(true); // the preference itself is untouched
    await cap.setAmbientCaptureAwake(true); // woken again
    expect(query(cap).live).toBe(true);
  });

  it("flushes what accumulated to the sessions spool when disabled mid-conversation", async () => {
    const utterances = [{ text: "hello there", at: Date.now() + 60000 }];
    const cap = make({ recentUtterances: () => utterances });
    await setEnabled(cap, true);
    await cap.setAmbientCaptureAwake(true);
    appendSpoolRecord.mockClear();
    await setEnabled(cap, false);
    expect(appendSpoolRecord).toHaveBeenCalledTimes(1);
    const call = appendSpoolRecord.mock.calls[0][0];
    expect(call.dir).toBe(path.join(NOTES_VAULT_DIR, "inbox", "sessions"));
    expect(call.content).toContain("hello there");
  });

  // design D3: an env var can only tighten the opt-in, never loosen it — no
  // combination of a renderer message and being awake overrides it.
  it("never goes live when IRIS_AMBIENT_CAPTURE=off, no matter what the renderer says", async () => {
    process.env.IRIS_AMBIENT_CAPTURE = "off";
    const cap = make();
    await setEnabled(cap, true);
    await cap.setAmbientCaptureAwake(true);
    expect(query(cap)).toEqual({ enabled: true, live: false, forcedOff: true });
  });

  it("flushes periodically on a timer while live, not just on a state transition", async () => {
    vi.useFakeTimers();
    try {
      const utterances = [{ text: "ticking along", at: Date.now() + 60000 }];
      const cap = make({ recentUtterances: () => utterances });
      await setEnabled(cap, true);
      await cap.setAmbientCaptureAwake(true);
      appendSpoolRecord.mockClear();
      await vi.advanceTimersByTimeAsync(30000); // AMBIENT_FLUSH_INTERVAL_MS
      expect(appendSpoolRecord).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules no timer at all while not live (spec: the mechanism is inert when off)", async () => {
    vi.useFakeTimers();
    try {
      const cap = make();
      await cap.setAmbientCaptureAwake(true); // awake, but never enabled
      appendSpoolRecord.mockClear();
      await vi.advanceTimersByTimeAsync(60000);
      expect(appendSpoolRecord).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts the sessions spool toward the synthesis backlog, alongside the other two spools", () => {
    const cap = make();
    const sessionsDir = path.join(NOTES_VAULT_DIR, "inbox", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "2026-08-05.md"), "## Verbatim microphone record · a – b\n\n> hi\n");
    expect(cap.notesInboxStatus().records).toBe(1);
  });

  // spec "No synthesis run follows a conversation ending": a conversation
  // ending (sleep) is exactly the moment an automatic synthesis would feel
  // natural and would be wrong. The capability holds no reference to
  // runQueue/submitClaudeTask at all — there is nothing here that COULD
  // start a run — so this asserts the observable half: going asleep with a
  // backlog already above the offer threshold emits nothing beyond the
  // ordinary flush/state-push, never anything resembling a run dispatch.
  it("starts no synthesis run when a conversation ends with material already above the offer threshold", async () => {
    const emitEvent = vi.fn();
    const cap = make({ emitEvent, recentUtterances: () => [{ text: "lots to weave in", at: Date.now() + 60000 }] });
    await setEnabled(cap, true);
    await cap.setAmbientCaptureAwake(true);
    const sessionsDir = path.join(NOTES_VAULT_DIR, "inbox", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    for (let i = 0; i < 8; i += 1) {
      // 8 == INBOX_OFFER_THRESHOLD
      fs.appendFileSync(path.join(sessionsDir, "2026-08-05.md"), `## record ${i}\n\n> hi\n`);
    }
    expect(cap.notesInboxStatus().worthProcessing).toBe(true);
    emitEvent.mockClear();
    await cap.setAmbientCaptureAwake(false); // the conversation ends
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

// second-brain-focus: the shared selection of vault notes, owned as one
// instance here, produced by the hand/mouse (via set-focus), read by the
// voice layer (promptFragment/announceFocusUpdate) and by a run
// (resolveFocusForRun).
describe("second-brain capability: focus", () => {
  const NODES = [
    { id: "a", title: "Alpha", tags: ["x"], ghost: false },
    { id: "b", title: "Beta", tags: [], ghost: false },
    { id: "ghost-target", title: "Ghost Target", tags: [], ghost: true },
  ];

  it("secondbrain:set-focus toggles a note on, then off again", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const setFocus = handlerFor(cap, "secondbrain:set-focus");
    const on = setFocus(null, "a");
    expect(on).toEqual({ ok: true, ids: ["a"], notes: [{ id: "a", title: "Alpha", tags: ["x"] }] });
    const off = setFocus(null, "a");
    expect(off).toEqual({ ok: true, ids: [], notes: [] });
  });

  it("secondbrain:set-focus rejects a malformed id without adding it", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const setFocus = handlerFor(cap, "secondbrain:set-focus");
    expect(setFocus(null, "")).toEqual({ ok: false });
    expect(setFocus(null, 42)).toEqual({ ok: false });
  });

  it("refuses to focus a ghost node", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const setFocus = handlerFor(cap, "secondbrain:set-focus");
    const result = setFocus(null, "ghost-target");
    expect(result.ids).toEqual([]);
  });

  it("secondbrain:get-focus resolves the current selection fresh against the live graph", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    handlerFor(cap, "secondbrain:set-focus")(null, "b");
    const focus = handlerFor(cap, "secondbrain:get-focus")();
    expect(focus.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("secondbrain:clear-focus empties the selection", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    const cleared = handlerFor(cap, "secondbrain:clear-focus")();
    expect(cleared).toEqual({ ok: true, ids: [], notes: [] });
    expect(handlerFor(cap, "secondbrain:get-focus")().ids).toEqual([]);
  });

  // second-brain-focus: "The focus SHALL be cleared whenever the galaxy
  // layer is not active" — deactivate is the single choke point the renderer
  // already calls on every route that takes the galaxy off screen (the
  // toggle, another exclusive layer opening, leaving the HUD, a force-close),
  // so clearing here covers all of them without teaching the renderer a
  // second mechanism.
  it("secondbrain:deactivate clears an existing focus", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    handlerFor(cap, "secondbrain:deactivate")();
    expect(handlerFor(cap, "secondbrain:get-focus")().ids).toEqual([]);
  });

  // Opening the note reader never calls secondbrain:deactivate (the galaxy
  // stays mounted underneath it) — reading a note must not discard the
  // selection that led to it.
  it("reading a note does not clear the focus", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    handlerFor(cap, "secondbrain:read-note")(null, "b");
    expect(handlerFor(cap, "secondbrain:get-focus")().ids).toEqual(["a"]);
  });

  it("announces a live SYSTEM_EVENT_FOCUS_UPDATE on toggle, and again with 'nothing focused' on clear", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    expect(notifyIris).toHaveBeenCalledTimes(1);
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("SYSTEM_EVENT_FOCUS_UPDATE");
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("Alpha");

    handlerFor(cap, "secondbrain:clear-focus")();
    expect(notifyIris).toHaveBeenCalledTimes(2);
    expect(notifyIris.mock.calls[1][0].join("\n")).toContain("Nothing is focused");
  });

  it("clearing an already-empty focus does not announce anything", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:clear-focus")();
    expect(notifyIris).not.toHaveBeenCalled();
  });

  it("deactivating with a non-empty focus announces it is now empty", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    notifyIris.mockClear();
    handlerFor(cap, "secondbrain:deactivate")();
    expect(notifyIris).toHaveBeenCalledTimes(1);
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("Nothing is focused");
  });

  it("resolveFocusForRun returns null when nothing is focused, and the resolved notes otherwise", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    expect(cap.resolveFocusForRun()).toBeNull();
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    expect(cap.resolveFocusForRun()).toEqual([{ id: "a", title: "Alpha", tags: ["x"] }]);
  });
});

describe("second-brain capability: promptFragment focus line", () => {
  const NODES = [{ id: "a", title: "Alpha", tags: [], ghost: false }];

  it("says nothing about focus when the galaxy is closed, even with a lingering selection", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    handlerFor(cap, "secondbrain:deactivate")(); // clears it, but assert the gate independently too
    expect(cap.promptFragment()).not.toContain("focused");
  });

  it("says nothing about focus when the galaxy is active but nothing is focused", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    expect(cap.promptFragment()).not.toContain("focused");
  });

  it("describes the focused notes when the galaxy is active and something is focused", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    const fragment = cap.promptFragment();
    expect(fragment).toContain("focused");
    expect(fragment).toContain("Alpha");
  });
});

describe("second-brain capability: mutate_vault_notes tool", () => {
  const NODES = [
    { id: "a", title: "Alpha", tags: [], ghost: false, body: "# Alpha\n" },
    { id: "b", title: "Beta", tags: [], ghost: false, body: "# Beta\n" },
    { id: "ghost-target", title: "Ghost Target", tags: [], ghost: true },
  ];

  it("contributes the mutate_vault_notes declaration", () => {
    const declaration = make().toolDeclarations.find((d) => d.name === "mutate_vault_notes");
    expect(declaration).toBeDefined();
    expect(declaration.parameters.required).toEqual(["operation"]);
  });

  it("links the two currently-focused notes when note_titles is omitted", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    handlerFor(cap, "secondbrain:set-focus")(null, "b");
    const result = await cap.mutateVaultNotes({ operation: "link" });
    expect(result.status).toBe("ok");
    expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).toContain("[[b]]");
    expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "b.md"), "utf8")).toContain("[[a]]");
  });

  it("links notes named explicitly by title, ignoring an unrelated focus", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const result = await cap.mutateVaultNotes({ operation: "link", note_titles: "Alpha, Beta" });
    expect(result.status).toBe("ok");
    expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).toContain("[[b]]");
  });

  it("unlinks two linked notes", async () => {
    const cap = make();
    await seedGraph(cap, [
      { id: "a", title: "Alpha", tags: [], ghost: false, body: "# Alpha\n[[b]]\n" },
      { id: "b", title: "Beta", tags: [], ghost: false, body: "# Beta\n[[a]]\n" },
    ]);
    const result = await cap.mutateVaultNotes({ operation: "unlink", note_titles: "Alpha, Beta" });
    expect(result.status).toBe("ok");
    expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).not.toContain("[[b]]");
  });

  it("sets tags on the single focused note", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:set-focus")(null, "a");
    const result = await cap.mutateVaultNotes({ operation: "set_tags", tags: "one, two" });
    expect(result.status).toBe("ok");
    const text = fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8");
    expect(text).toContain("one");
    expect(text).toContain("two");
  });

  it("refuses link when fewer or more than two notes are targeted", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:set-focus")(null, "a"); // only one focused
    const result = await cap.mutateVaultNotes({ operation: "link" });
    expect(result.status).toBe("error");
  });

  it("refuses an unknown note title, without writing anything", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const result = await cap.mutateVaultNotes({ operation: "link", note_titles: "Alpha, Nonexistent" });
    expect(result.status).toBe("error");
    expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).not.toContain("[[");
  });

  it("refuses a ghost node named by title", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const result = await cap.mutateVaultNotes({ operation: "link", note_titles: "Alpha, Ghost Target" });
    expect(result.status).toBe("error");
  });

  it("refuses an unknown operation", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    const result = await cap.mutateVaultNotes({ operation: "delete", note_titles: "Alpha" });
    expect(result.status).toBe("error");
  });
});
