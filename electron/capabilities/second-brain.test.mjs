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
  it("registers exactly the 13 secondbrain:* channels plus the 2 ambient-capture:* channels, with the correct handle/on split", () => {
    const cap = make();
    const byChannel = Object.fromEntries(cap.ipcHandlers.map((h) => [h.channel, h.kind]));
    expect(byChannel).toEqual({
      "secondbrain:availability": "handle",
      "secondbrain:get-graph": "handle",
      "secondbrain:activate": "on",
      "secondbrain:deactivate": "on",
      "secondbrain:read-note": "handle",
      // voice-finds-a-note D2: the typed find field's route into the one
      // matcher Iris's spoken lookup also calls.
      "secondbrain:find-notes": "handle",
      // add-manual-note-editing: the note reader's editor and its route out to
      // a real editor. Neither is reachable from any model-facing surface —
      // personal-knowledge-notes, "A user-authored write is not reachable by a
      // model".
      "secondbrain:write-note": "handle",
      "secondbrain:open-note-externally": "handle",
      "secondbrain:set-focus": "handle",
      "secondbrain:get-focus": "handle",
      "secondbrain:clear-focus": "handle",
      "secondbrain:note-opened": "on",
      "secondbrain:note-closed": "on",
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

// ambient-session-capture: ambient capture stands aside for the whole span
// listen-only mode is engaged, and the reason is the CONSENT rather than a
// competing writer — while that mode is engaged what Iris hears widens to
// whatever the machine is playing, which is outside what this preference was
// given for. Nothing retains that span, which is the intended outcome
// (listen-window-is-bounded).
describe("second-brain capability: yielding to listen-only mode", () => {
  function setAmbient(cap, enabled) {
    return handlerFor(cap, "ambient-capture:set-enabled")(null, { enabled });
  }

  it("stands aside for the mode's span, then resumes without back-filling it", async () => {
    let listenOnly = false;
    const cap = make({ isListenOnlyEngaged: () => listenOnly });
    await setAmbient(cap, true);
    await cap.setAmbientCaptureAwake(true);
    expect(handlerFor(cap, "ambient-capture:query")().live).toBe(true);

    listenOnly = true;
    await cap.syncAmbientCaptureState();
    expect(handlerFor(cap, "ambient-capture:query")().live).toBe(false);
    // The preference itself is untouched: the mode does not revoke it, it only
    // takes the span out of its scope.
    expect(handlerFor(cap, "ambient-capture:query")().enabled).toBe(true);

    listenOnly = false;
    await cap.syncAmbientCaptureState();
    expect(handlerFor(cap, "ambient-capture:query")().live).toBe(true);
  });

  it("flushes what it had before standing aside, so nothing is lost to the yield", async () => {
    let listenOnly = false;
    const utterances = [{ text: "said before the mode", at: Date.now() + 60000 }];
    const cap = make({ isListenOnlyEngaged: () => listenOnly, recentUtterances: () => utterances });
    await setAmbient(cap, true);
    await cap.setAmbientCaptureAwake(true);
    appendSpoolRecord.mockClear();

    listenOnly = true;
    await cap.syncAmbientCaptureState();
    expect(appendSpoolRecord).toHaveBeenCalledTimes(1);
    expect(appendSpoolRecord.mock.calls[0][0].content).toContain("said before the mode");
  });

  // The span belongs to NOBODY now: no second area, no second consent, nothing
  // written anywhere for it.
  it("writes nothing at all for the span the mode covers", async () => {
    let listenOnly = false;
    const utterances = [];
    const cap = make({ isListenOnlyEngaged: () => listenOnly, recentUtterances: () => utterances });
    await setAmbient(cap, true);
    await cap.setAmbientCaptureAwake(true);

    listenOnly = true;
    await cap.syncAmbientCaptureState();
    appendSpoolRecord.mockClear();
    utterances.push({ text: "a question from the room", at: Date.now() + 120000 });

    // Nothing flushes it while the mode is engaged, and disengaging does not
    // back-fill it either — the watermark moves on.
    await cap.syncAmbientCaptureState();
    listenOnly = false;
    await cap.syncAmbientCaptureState();
    expect(appendSpoolRecord).not.toHaveBeenCalled();
    // And no second area either: the capability writes to exactly three spools,
    // none of which is a per-engagement one.
    expect(Object.keys(cap).filter((key) => /^notes.*Dir$/.test(key)).sort()).toEqual([
      "notesCapturesDir",
      "notesInboxDir",
      "notesSessionsDir",
      "notesVaultDir",
    ]);
  });

  it("leaves the mode's own state alone in either direction", async () => {
    const isListenOnlyEngaged = vi.fn(() => true);
    const cap = make({ isListenOnlyEngaged });
    // The preference is the only thing this capability writes; the mode is read
    // and never written, which is what keeps the live session its sole owner.
    await setAmbient(cap, true);
    await setAmbient(cap, false);
    expect(cap).not.toHaveProperty("setListenOnlyEngaged");
    expect(cap).not.toHaveProperty("toggleListenOnly");
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

// open-note-session: main owns the open note on the same terms as the focus.
describe("second-brain capability: open note", () => {
  const NODES = [
    { id: "a", title: "Alpha", tags: ["x"], ghost: false },
    { id: "b", title: "Beta", tags: [], ghost: false },
  ];

  it("secondbrain:note-opened sets the open note; secondbrain:note-closed clears it", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    expect(cap.resolveOpenNoteForRun()).toEqual({ id: "a", title: "Alpha", tags: ["x"], relativePath: "a.md" });
    handlerFor(cap, "secondbrain:note-closed")(null);
    expect(cap.resolveOpenNoteForRun()).toBeNull();
  });

  it("rejects a malformed id without opening anything", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "");
    expect(cap.resolveOpenNoteForRun()).toBeNull();
    handlerFor(cap, "secondbrain:note-opened")(null, 42);
    expect(cap.resolveOpenNoteForRun()).toBeNull();
  });

  it("opening a different note (switching) replaces the open note", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    handlerFor(cap, "secondbrain:note-opened")(null, "b");
    expect(cap.resolveOpenNoteForRun()?.id).toBe("b");
  });

  it("secondbrain:deactivate clears the open note, on the same terms as the focus", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:activate")();
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    handlerFor(cap, "secondbrain:deactivate")();
    expect(cap.resolveOpenNoteForRun()).toBeNull();
  });

  it("a renamed open note resolves to its current title", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    // Renamed on disk and in the graph — the identity ("a") is unchanged.
    const renamed = [{ id: "a", title: "Alpha (renamed)", tags: ["x"], ghost: false }, NODES[1]];
    await seedGraph(cap, renamed);
    expect(cap.resolveOpenNoteForRun()?.title).toBe("Alpha (renamed)");
  });

  it("a deleted open note resolves to nothing rather than a phantom", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    await seedGraph(cap, [NODES[1]]); // "a" is gone from the graph
    expect(cap.resolveOpenNoteForRun()).toBeNull();
    expect(cap.openNoteWritePath()).toBeNull();
  });

  it("openNoteWritePath resolves to the real, vault-checked absolute path — never sent to the model", async () => {
    const cap = make();
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    expect(cap.openNoteWritePath()).toBe(fs.realpathSync(path.join(NOTES_VAULT_DIR, "a.md")));
    // The run-facing shape carries the relative path, never the absolute one.
    expect(cap.resolveOpenNoteForRun()).not.toHaveProperty("absolutePath");
    expect(cap.resolveOpenNoteForRun().relativePath).toBe("a.md");
  });

  it("announces SYSTEM_EVENT_NOTE_OPENED on open and SYSTEM_EVENT_NOTE_CLOSED on close", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    await seedGraph(cap, NODES);

    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("SYSTEM_EVENT_NOTE_OPENED");
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("Alpha");

    handlerFor(cap, "secondbrain:note-closed")(null);
    expect(notifyIris.mock.calls[1][0].join("\n")).toContain("SYSTEM_EVENT_NOTE_CLOSED");
  });

  it("closing when nothing is open announces nothing", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-closed")(null);
    expect(notifyIris).not.toHaveBeenCalled();
  });

  it("switching notes announces the new one (a close-then-open would be wrong: it never closed)", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    await seedGraph(cap, NODES);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    notifyIris.mockClear();
    handlerFor(cap, "secondbrain:note-opened")(null, "b");
    expect(notifyIris).toHaveBeenCalledTimes(1);
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("SYSTEM_EVENT_NOTE_OPENED");
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("Beta");
  });

  it("carries no body in either the announcement or the run-facing shape", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    const withBody = [{ id: "a", title: "Alpha", tags: [], ghost: false, body: "SECRET NOTE BODY" }];
    await seedGraph(cap, withBody);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    expect(notifyIris.mock.calls[0][0].join("\n")).not.toContain("SECRET NOTE BODY");
    expect(JSON.stringify(cap.resolveOpenNoteForRun())).not.toContain("SECRET NOTE BODY");
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

  // open-note-session D1: exactly one referent is ever described.
  describe("referent precedence against the open note", () => {
    const TWO_NODES = [
      { id: "a", title: "Alpha", tags: [], ghost: false },
      { id: "b", title: "Beta", tags: [], ghost: false },
    ];

    it("describes the open note and says nothing about the focus while one is open", async () => {
      const cap = make();
      await seedGraph(cap, TWO_NODES);
      handlerFor(cap, "secondbrain:activate")();
      handlerFor(cap, "secondbrain:set-focus")(null, "a");
      handlerFor(cap, "secondbrain:note-opened")(null, "b");
      const fragment = cap.promptFragment();
      expect(fragment).toContain("note open in the reader");
      expect(fragment).toContain("Beta");
      expect(fragment).not.toContain("focused");
      expect(fragment).not.toContain("Alpha");
    });

    it("describes the focus again the moment the note closes — the focus was never cleared", async () => {
      const cap = make();
      await seedGraph(cap, TWO_NODES);
      handlerFor(cap, "secondbrain:activate")();
      handlerFor(cap, "secondbrain:set-focus")(null, "a");
      handlerFor(cap, "secondbrain:note-opened")(null, "b");
      handlerFor(cap, "secondbrain:note-closed")(null);
      const fragment = cap.promptFragment();
      expect(fragment).toContain("focused");
      expect(fragment).toContain("Alpha");
      expect(fragment).not.toContain("note open in the reader");
    });

    it("opening a note never clears the focus itself", async () => {
      const cap = make();
      await seedGraph(cap, TWO_NODES);
      handlerFor(cap, "secondbrain:activate")();
      handlerFor(cap, "secondbrain:set-focus")(null, "a");
      handlerFor(cap, "secondbrain:note-opened")(null, "b");
      expect(handlerFor(cap, "secondbrain:get-focus")().ids).toEqual(["a"]);
    });
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

  // open-note-session: "Structural edits target the open note when there is
  // one" — explicit titles > open note > focus.
  describe("target precedence: explicit titles > open note > focus", () => {
    const THREE_NODES = [
      { id: "a", title: "Alpha", tags: [], ghost: false, body: "# Alpha\n" },
      { id: "b", title: "Beta", tags: [], ghost: false, body: "# Beta\n" },
      { id: "c", title: "Gamma", tags: [], ghost: false, body: "# Gamma\n" },
    ];

    it("tags the open note when one is open, ignoring the focus", async () => {
      const cap = make();
      await seedGraph(cap, THREE_NODES);
      handlerFor(cap, "secondbrain:set-focus")(null, "a");
      handlerFor(cap, "secondbrain:note-opened")(null, "b");
      const result = await cap.mutateVaultNotes({ operation: "set_tags", tags: "urgent" });
      expect(result.status).toBe("ok");
      expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "b.md"), "utf8")).toContain("urgent");
      expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).not.toContain("urgent");
    });

    it("named titles still win over an open note", async () => {
      const cap = make();
      await seedGraph(cap, THREE_NODES);
      handlerFor(cap, "secondbrain:note-opened")(null, "a");
      const result = await cap.mutateVaultNotes({ operation: "link", note_titles: "Beta, Gamma" });
      expect(result.status).toBe("ok");
      expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "b.md"), "utf8")).toContain("[[c]]");
      expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).not.toContain("[[");
    });

    it("falls back to the focus when no note is open", async () => {
      const cap = make();
      await seedGraph(cap, THREE_NODES);
      handlerFor(cap, "secondbrain:set-focus")(null, "a");
      const result = await cap.mutateVaultNotes({ operation: "set_tags", tags: "urgent" });
      expect(result.status).toBe("ok");
      expect(fs.readFileSync(path.join(NOTES_VAULT_DIR, "a.md"), "utf8")).toContain("urgent");
    });
  });
});

// add-manual-note-editing: the app's only arbitrary-content write, reachable
// from the note reader's editor and from nowhere else. These cover the guard it
// inherits from resolveVaultNotePath, the concurrent-write refusal, and the
// stale-reading announcement to the voice layer.
describe("second-brain capability: hand-authored note write", () => {
  const NODES = [
    { id: "a", title: "Alpha", tags: ["x"], ghost: false, body: "# Alpha\noriginal\n" },
    { id: "b", title: "Beta", tags: [], ghost: false, body: "# Beta\n" },
    { id: "missing", title: "Missing", tags: [], ghost: true },
  ];

  function notePath(id) {
    return path.join(NOTES_VAULT_DIR, `${id}.md`);
  }

  async function openWithRead(cap, id = "a") {
    await seedGraph(cap, NODES);
    return handlerFor(cap, "secondbrain:read-note")(null, id);
  }

  it("read-note serves a revision token for the content it returned", async () => {
    const cap = make();
    const read = await openWithRead(cap);
    expect(read.ok).toBe(true);
    expect(read.content).toBe("# Alpha\noriginal\n");
    expect(read.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes the note when the revision still matches, and returns the new revision", async () => {
    const cap = make();
    const read = await openWithRead(cap);
    const result = handlerFor(cap, "secondbrain:write-note")(null, {
      id: "a",
      content: "# Alpha\nedited by hand\n",
      revision: read.revision,
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(notePath("a"), "utf8")).toBe("# Alpha\nedited by hand\n");
    // The returned revision is the one a second save in the same sitting must
    // present — i.e. of what was just written, not of what was first read.
    expect(result.revision).not.toBe(read.revision);
    const second = handlerFor(cap, "secondbrain:write-note")(null, {
      id: "a",
      content: "# Alpha\nagain\n",
      revision: result.revision,
    });
    expect(second.ok).toBe(true);
  });

  it("refuses a stale revision and leaves the file untouched", async () => {
    const cap = make();
    const read = await openWithRead(cap);
    // Something else writes the note after the reader read it — Claude's note
    // session, a capture, or another app.
    fs.writeFileSync(notePath("a"), "# Alpha\nwritten by someone else\n");
    const result = handlerFor(cap, "secondbrain:write-note")(null, {
      id: "a",
      content: "# Alpha\nmy edit\n",
      revision: read.revision,
    });
    expect(result).toEqual({ ok: false, reason: "stale" });
    expect(fs.readFileSync(notePath("a"), "utf8")).toBe("# Alpha\nwritten by someone else\n");
  });

  it("force overwrites a note that changed underneath", async () => {
    const cap = make();
    const read = await openWithRead(cap);
    fs.writeFileSync(notePath("a"), "# Alpha\nwritten by someone else\n");
    const result = handlerFor(cap, "secondbrain:write-note")(null, {
      id: "a",
      content: "# Alpha\nmy edit wins\n",
      revision: read.revision,
      force: true,
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(notePath("a"), "utf8")).toBe("# Alpha\nmy edit wins\n");
  });

  it("refuses a ghost node, an unknown id, a malformed id, and non-string content", async () => {
    const cap = make();
    const read = await openWithRead(cap);
    const write = handlerFor(cap, "secondbrain:write-note");
    for (const id of ["missing", "nope", "", 42, "x".repeat(513)]) {
      expect(write(null, { id, content: "hi", revision: read.revision })).toEqual({ ok: false, reason: "refused" });
    }
    expect(write(null, { id: "a", content: 42, revision: read.revision })).toEqual({ ok: false, reason: "refused" });
    expect(write(null, undefined)).toEqual({ ok: false, reason: "refused" });
    expect(fs.readFileSync(notePath("a"), "utf8")).toBe("# Alpha\noriginal\n");
  });

  it("announces the edit to the voice layer only when the saved note is the open one", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    const read = await openWithRead(cap);

    // Nothing open yet: a save announces nothing.
    handlerFor(cap, "secondbrain:write-note")(null, { id: "a", content: "one\n", revision: read.revision });
    expect(notifyIris.mock.calls.flat(2).join("\n")).not.toContain("SYSTEM_EVENT_NOTE_EDITED");

    // Open "b", then save "a" — a different note is not a stale-reading hazard.
    handlerFor(cap, "secondbrain:note-opened")(null, "b");
    notifyIris.mockClear();
    const readA = handlerFor(cap, "secondbrain:read-note")(null, "a");
    handlerFor(cap, "secondbrain:write-note")(null, { id: "a", content: "two\n", revision: readA.revision });
    expect(notifyIris.mock.calls.flat(2).join("\n")).not.toContain("SYSTEM_EVENT_NOTE_EDITED");

    // Save the note that IS open.
    notifyIris.mockClear();
    const readB = handlerFor(cap, "secondbrain:read-note")(null, "b");
    handlerFor(cap, "secondbrain:write-note")(null, { id: "b", content: "# Beta\nedited\n", revision: readB.revision });
    const announced = notifyIris.mock.calls.flat(2).join("\n");
    expect(announced).toContain("SYSTEM_EVENT_NOTE_EDITED");
    expect(announced).toContain("Beta");
    expect(announced).toContain("superseded");
  });

  it("a refused write announces nothing", async () => {
    const notifyIris = vi.fn();
    const cap = make({ notifyIris });
    const read = await openWithRead(cap);
    handlerFor(cap, "secondbrain:note-opened")(null, "a");
    fs.writeFileSync(notePath("a"), "changed\n");
    notifyIris.mockClear();
    handlerFor(cap, "secondbrain:write-note")(null, { id: "a", content: "mine\n", revision: read.revision });
    expect(notifyIris.mock.calls.flat(2).join("\n")).not.toContain("SYSTEM_EVENT_NOTE_EDITED");
  });

  it("hands the external opener a resolved in-vault path, never the caller's id", async () => {
    const openPathExternally = vi.fn(async () => "");
    const cap = make({ openPathExternally });
    await seedGraph(cap, NODES);
    const open = handlerFor(cap, "secondbrain:open-note-externally");

    await expect(open(null, "a")).resolves.toEqual({ ok: true });
    expect(openPathExternally).toHaveBeenCalledWith(fs.realpathSync(notePath("a")));

    openPathExternally.mockClear();
    for (const id of ["missing", "nope", "", 42]) {
      await expect(open(null, id)).resolves.toEqual({ ok: false });
    }
    expect(openPathExternally).not.toHaveBeenCalled();
  });

  // personal-knowledge-notes "A user-authored write is not reachable by a model":
  // the write lives on the IPC surface only. Asserting the EXACT declaration
  // roster is what makes that checkable — a future change that exposed the write
  // (or any other arbitrary-content write) as a tool fails here rather than
  // merely being in poor taste.
  it("exposes no arbitrary-content write to a model", () => {
    const cap = make();
    expect(cap.toolDeclarations.map((d) => d.name)).toEqual([
      "capture_note",
      "find_note_by_name",
      "mutate_vault_notes",
    ]);
    // The lookup reads titles and nothing else — it takes no content and has no
    // write in it, so it does not weaken what this test guards.
    const find = cap.toolDeclarations.find((d) => d.name === "find_note_by_name");
    expect(Object.keys(find.parameters.properties)).toEqual(["name", "open"]);
    const mutate = cap.toolDeclarations.find((d) => d.name === "mutate_vault_notes");
    // The one note-editing tool a model has takes an enumerated operation, never
    // note content.
    expect(mutate.parameters.properties.operation.enum).toEqual(["link", "unlink", "set_tags"]);
    expect(Object.keys(mutate.parameters.properties)).not.toContain("content");
  });

  it("reports failure rather than throwing when the opener rejects", async () => {
    const cap = make({ openPathExternally: vi.fn(async () => { throw new Error("no handler"); }) });
    await seedGraph(cap, NODES);
    await expect(handlerFor(cap, "secondbrain:open-note-externally")(null, "a")).resolves.toEqual({ ok: false });
  });
});

// voice-finds-a-note: the spoken lookup. What is asserted here is the half no
// manual pass can check repeatably — that the declaration exists and survives a
// missing credential, that the boundary against the curation verb is stated in
// the contract rather than only in prose, and that opening refuses the cases it
// must refuse.
describe("second-brain capability: find_note_by_name", () => {
  const NODES = [
    { id: "deploy", title: "Deploy runbook", tags: ["ops"], ghost: false },
    { id: "deploy-notes", title: "Deploy runbook notes", tags: [], ghost: false },
    { id: "kt", title: "Ghi chú kiến trúc", tags: [], ghost: false },
    { id: "phantom", title: "Phantom page", tags: [], ghost: true },
  ];

  // Unlike seedGraph's mockResolvedValueOnce, this stays resolved: the lookup
  // performs a FRESH scan per call (design.md D6), so a test that calls it twice
  // would otherwise get undefined the second time.
  function seedFindableGraph(cap, nodes = NODES) {
    fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true });
    for (const node of nodes) {
      if (node.ghost) continue;
      fs.writeFileSync(path.join(NOTES_VAULT_DIR, `${node.id}.md`), `# ${node.title}\n`);
    }
    const graphInstance = createVaultGraph.mock.results.at(-1).value;
    graphInstance.getGraph.mockResolvedValue({ nodes, links: [] });
    return graphInstance;
  }

  it("declares the lookup with a parameter named for a NAME, not a subject or question", () => {
    // design.md D3 mechanism 1: a schema is a contract the calling interface
    // enforces, where prose is only advice. The strongest available statement
    // of "this takes a title" is the name of the thing it takes.
    const declaration = make().toolDeclarations.find((d) => d.name === "find_note_by_name");
    expect(declaration).toBeDefined();
    expect(declaration.parameters.required).toEqual(["name"]);
    expect(Object.keys(declaration.parameters.properties)).not.toContain("query");
    expect(Object.keys(declaration.parameters.properties)).not.toContain("subject");
    expect(Object.keys(declaration.parameters.properties)).not.toContain("question");
  });

  it("states the negative case and names capture_learning as the alternative", () => {
    // design.md D3 mechanism 2, on the pattern capture_note's declaration
    // already uses against the same verb.
    const { description } = make().toolDeclarations.find((d) => d.name === "find_note_by_name");
    expect(description).toContain("Do NOT use this");
    expect(description).toContain("capture_learning");
    expect(description.toLowerCase()).toContain("what do my notes say about");
  });

  it("is declared with no Claude credential, exactly as capture is", () => {
    // personal-knowledge-notes: "The lookup works with no Claude credential" —
    // comparing strings against a list of titles needs no model, so the cheapest
    // question this capability answers must not be the one that requires a
    // credential to ask.
    const cap = make({ getPipelineAvailable: vi.fn(() => false) });
    expect(cap.toolDeclarations.map((d) => d.name)).toContain("find_note_by_name");
  });

  it("describes the lookup in the prompt even with no pipeline", () => {
    const cap = make({ getPipelineAvailable: vi.fn(() => false) });
    expect(cap.promptFragment()).toContain("find_note_by_name");
  });

  it("finds a note by name and returns its title", async () => {
    const cap = make();
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "deploy runbook" });
    expect(result.status).toBe("ok");
    expect(result.matches.map((m) => m.title)).toEqual(["Deploy runbook", "Deploy runbook notes"]);
  });

  it("ignores case and diacritics, so a transcribed title still matches", async () => {
    const cap = make();
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "ghi chu kien truc" });
    expect(result.matches.map((m) => m.title)).toEqual(["Ghi chú kiến trúc"]);
  });

  it("reports no match as no match rather than offering the nearest note", async () => {
    const cap = make();
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "something nobody wrote" });
    expect(result).toMatchObject({ status: "ok", count: 0 });
    expect(result.matches).toEqual([]);
  });

  it("performs a fresh scan per call rather than reading a kept copy", async () => {
    // design.md D6: with the galaxy closed the watcher is off and nothing keeps
    // a copy current — on a cold session that copy is the empty initial graph,
    // so a cached read would answer "no matches" for a whole vault.
    const cap = make();
    const graphInstance = seedFindableGraph(cap);
    await cap.findNoteByName({ name: "deploy" });
    await cap.findNoteByName({ name: "deploy" });
    expect(graphInstance.getGraph).toHaveBeenCalledTimes(2);
  });

  it("emits the matches to the rail on the capability's own channel", async () => {
    // design.md D4: never through iris:ui-action, whose vocabulary is fixed and
    // is not about the second brain.
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    seedFindableGraph(cap);
    await cap.findNoteByName({ name: "deploy" });
    const channels = emitToRenderer.mock.calls.map(([channel]) => channel);
    expect(channels).toContain("secondbrain:name-matches");
    expect(channels.every((c) => c.startsWith("secondbrain:"))).toBe(true);
  });

  it("clears the rail's matches when a later search finds nothing", async () => {
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    seedFindableGraph(cap);
    await cap.findNoteByName({ name: "nothing at all" });
    const emitted = emitToRenderer.mock.calls.find(([c]) => c === "secondbrain:name-matches");
    expect(emitted[1].matches).toEqual([]);
  });

  it("opens nothing unless asked, and selects nothing when it does not", async () => {
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "ghi chu kien truc" });
    expect(result.opened).toBeUndefined();
    expect(emitToRenderer.mock.calls.map(([c]) => c)).not.toContain("secondbrain:open-note");
  });

  it("opens the note when exactly one matches and the user asked", async () => {
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "ghi chu kien truc", open: true });
    expect(result).toMatchObject({ opened: true, title: "Ghi chú kiến trúc" });
    const open = emitToRenderer.mock.calls.find(([c]) => c === "secondbrain:open-note");
    expect(open[1]).toEqual({ id: "kt", title: "Ghi chú kiến trúc" });
  });

  it("names the candidates rather than picking one when several match", async () => {
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "deploy runbook", open: true });
    expect(result).toMatchObject({ opened: false, reason: "several_matched" });
    expect(result.matches).toHaveLength(2);
    expect(emitToRenderer.mock.calls.map(([c]) => c)).not.toContain("secondbrain:open-note");
  });

  it("refuses to open a ghost with that reason, and brings up no galaxy for it", async () => {
    // design.md D5: an unresolved [[wikilink]] target has no file. Refused with
    // the reason rather than with a read error — and nothing is activated,
    // because there would be nothing to show.
    const emitToRenderer = vi.fn();
    const cap = make({ emitToRenderer });
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "phantom page", open: true });
    expect(result).toMatchObject({ opened: false, reason: "no_file" });
    expect(result.message).toContain("does not exist yet");
    expect(emitToRenderer.mock.calls.map(([c]) => c)).not.toContain("secondbrain:open-note");
  });

  it("returns titles and openability, never note contents", async () => {
    // The lookup answers "which note is called that". Returning content would
    // let a contents question be answered from here, which is the routing
    // failure D3 exists to prevent.
    const cap = make();
    seedFindableGraph(cap);
    const result = await cap.findNoteByName({ name: "deploy runbook" });
    for (const match of result.matches) expect(Object.keys(match)).toEqual(["title", "openable"]);
  });

  it("reports an unavailable vault rather than answering for an empty one", async () => {
    const cap = make();
    fs.rmSync(NOTES_VAULT_DIR, { recursive: true, force: true });
    await expect(cap.findNoteByName({ name: "anything" })).resolves.toMatchObject({ status: "error" });
  });

  it("selects nothing: no focus change, no note opened, no voice-layer context touched", async () => {
    // second-brain-gesture-nav: "A spoken search SHALL NOT change what is
    // selected" — the same rule stepping already holds to, for the same reason:
    // navigating is not selecting.
    const emitEvent = vi.fn();
    const notifyIris = vi.fn();
    const emitToRenderer = vi.fn();
    const cap = make({ emitEvent, notifyIris, emitToRenderer });
    seedFindableGraph(cap);
    const focusBefore = await handlerFor(cap, "secondbrain:get-focus")();

    await cap.findNoteByName({ name: "deploy" });

    expect(await handlerFor(cap, "secondbrain:get-focus")()).toEqual(focusBefore);
    expect(emitToRenderer.mock.calls.map(([c]) => c)).not.toContain("secondbrain:open-note");
    // Nothing about the referent announced to Gemini, and nothing pushed at the
    // user: the answer is the tool's return value, which Iris speaks herself.
    // (An availability transition may fire — that is the vault appearing on
    // disk for this test, not the lookup changing what anything reads.)
    // What the voice layer reads about the referent is pushed with notifyIris
    // (SYSTEM_EVENT_FOCUS_UPDATE / SYSTEM_EVENT_NOTE_OPENED) — so this is the
    // assertion that "nothing the voice layer or a run reads has changed".
    expect(notifyIris).not.toHaveBeenCalled();
    // The only thing emitted at all is the vault appearing on disk for this
    // test, which is availability, not selection.
    expect(emitEvent.mock.calls.map(([event]) => event.type)).toEqual(["secondbrain_availability"]);
  });

  it("answers with the galaxy closed — the rail is where matches are shown, not a precondition", async () => {
    // second-brain-gesture-nav: "Asking to find a note while the galaxy is NOT
    // active SHALL still be answered." The emit is how the rail learns; the
    // return is how the question gets answered, and only one of those needs a
    // galaxy.
    const cap = make();
    seedFindableGraph(cap);
    // Never activated: no secondbrain:activate, so the watcher was never
    // started and nothing has been keeping a graph copy current.
    const result = await cap.findNoteByName({ name: "deploy runbook" });
    expect(result.status).toBe("ok");
    expect(result.matches.map((m) => m.title)).toEqual(["Deploy runbook", "Deploy runbook notes"]);
  });

  it("answers the same as the typed field, through the same call", async () => {
    // personal-knowledge-notes: "Spoken and typed searches agree". They do so
    // by being one call into one matcher, which is what this asserts.
    const cap = make();
    seedFindableGraph(cap);
    const spoken = await cap.findNoteByName({ name: "deploy" });
    const typed = await handlerFor(cap, "secondbrain:find-notes")(null, "deploy");
    expect(typed.matches.map((m) => m.title)).toEqual(spoken.matches.map((m) => m.title));
  });
});
