// The second-brain capability (personal-knowledge-notes,
// second-brain-galaxy-view): the LLM-Wiki notes vault's readiness checks,
// the read-only galaxy graph watcher, and this capability's slice of Gemini
// prose / IPC / teardown — gathered here per design.md D10 rather than
// spread across the layered core modules. Electron-free.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVaultGraph } from "../vault-graph.mjs";
import { appendRunRecord, inboxBacklog } from "../run-inbox.mjs";
import { appendSpoolRecord, captureSpoolDir, runSpoolDir } from "../vault-write.mjs";

// Personal-knowledge-notes capability (see openspec/changes/llm-wiki/): the
// LLM-Wiki vault is pinned to this fixed, user-level path, independent of any
// workstream's project cwd. Only the `capture_learning` verb is granted it.
const NOTES_VAULT_DIR = path.join(os.homedir(), "iris-second-brain");

// Where every finished run's record is appended (design.md D5). Inside the
// vault, so `capture_learning` reaches it through the same granted directory it
// already has, with nothing extra to wire.
const NOTES_INBOX_DIR = runSpoolDir(NOTES_VAULT_DIR);

// Where a voice capture lands, awaiting curation (vault-write-path design D3).
// A one-line spoken thought has no title, tags, or links, so it goes to the
// spool rather than becoming a page — promotion to a linked page is the
// curator's job.
const NOTES_CAPTURES_DIR = captureSpoolDir(NOTES_VAULT_DIR);

// How many un-synthesized records make it worth OFFERING to weave them in.
// Offering too eagerly trains the user to say no; the number is a threshold for
// an offer, never for an action — synthesis is never started unprompted.
const INBOX_OFFER_THRESHOLD = 8;

// The 6 vendored skill names this capability needs installed in
// ~/.claude/skills before Claude actually has LLM-Wiki instructions to follow
// (they are deliberately NOT in REQUIRED_SKILLS — that list gates the
// PO/DEV pipeline, not Talk-mode notes; see pipeline-probes.mjs's
// checkSkillsStatus()). Vault creation (ensureNotesVaultReady, below) and
// skill installation (installPipelinePrereqs, via the SetupPanel's "Install
// missing" button) are two independent actions on two different schedules —
// the vault can exist before the skills are ever installed. Without this
// check, the append-system-prompt directive would tell Claude to "use the
// wiki skills" that aren't actually there, and Claude would either invent an
// ungoverned note format or hallucinate the skill's behavior instead of
// doing the real LLM-Wiki workflow.
const NOTES_SKILLS = ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"];

// Capture's own declaration (vault-write-path design D4): it is NOT a verb —
// it starts no Claude run, so it does not belong in the registry that
// `capture_learning` (curation) is defined in. Declared unconditionally
// (gemini-tools.mjs concatenates every capability's toolDeclarations outside
// the pipelineAvailable gate), so it survives chat-only mode.
const CAPTURE_NOTE_DECLARATION = {
  name: "capture_note",
  description:
    "Save a thought directly to the user's personal notes vault, right now — a plain file write: no Claude run, no tokens, " +
    "no execution slot, and it works even with no Claude credential configured. Use for 'note this down', 'save that', " +
    "'ghi chú lại: …'. Confirm only after this reports status 'ok'; if it reports an error, tell the user the capture failed " +
    "rather than saying it was saved. This only appends the raw thought — for weaving accumulated captures into the wiki, " +
    "retrieving from notes, or an explicit 'write this up as a page' request, use the capture_learning verb instead.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The thought to capture, in the user's own words, as close to verbatim as you can manage.",
      },
      title: { type: "string", description: "A short title, only if the user gave one or it is obvious. Optional." },
      tags: { type: "string", description: "Comma-separated tags, only if obvious from context. Optional." },
    },
    required: ["text"],
  },
};

// Loose heuristic for the vault-write backstop below — matches common
// English/Vietnamese phrasing for "save/capture a note" (mirrors the example
// utterances in specs/personal-knowledge-notes/spec.md). False negatives just
// mean the backstop caveat isn't appended (same as before this capability
// existed); false positives are harmless (the caveat only fires when nothing
// in the vault changed, so a request that never intended to write there
// stays silent).

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   irisPluginDir: () => string | null,
 *   userDisplayName: () => string,
 *   getPipelineAvailable: () => boolean,
 * }} deps
 */
export function createSecondBrainCapability({
  emitEvent,
  emitToRenderer,
  irisPluginDir,
  userDisplayName,
  getPipelineAvailable,
}) {
  // The wiki skills ship in the Iris plugin, so this checks the app bundle —
  // never ~/.claude, which Iris no longer reads or writes. It still gates the
  // append-system-prompt directive (startDevRun) and the SetupPanel row, but
  // "missing" now means a damaged bundle rather than a skipped install step.
  function checkNotesSkillsStatus() {
    const pluginDir = irisPluginDir();
    if (!pluginDir) return { ok: false, missing: NOTES_SKILLS, skillsDir: null };
    const skillsDir = path.join(pluginDir, "skills");
    const missing = NOTES_SKILLS.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
    return { ok: missing.length === 0, missing, skillsDir };
  }

  // Adapts the vendored wiki-config template's frontmatter for this
  // single-purpose, macOS-only vault (design.md D5): the template ships
  // `blacklist` as placeholder prose ("Folder(s) where the wiki should not
  // write"), not real folder names — wiki-config's own Validate step flags
  // leftover placeholder text, and since nothing but wiki content ever lives
  // under ~/iris-second-brain, an empty list is the correct config, not a
  // stub. `index_excludes`/`templates_folder` ship with the template's
  // Windows-style trailing backslash; this app is macOS-only, so those
  // become forward slashes. Everything else (ingested_folder,
  // ingested_subdirs, log_format, and all prose below the frontmatter) is
  // left exactly as vendored.
  function renderNotesVaultConfig(templateText) {
    const match = templateText.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return templateText; // unexpected shape — copy verbatim rather than risk corrupting it
    const [, frontmatter, body] = match;
    const adapted = frontmatter
      .replace(/^blacklist:\n(?:  - .*\n)+/m, "blacklist: []\n")
      .replace(/^(\s*- (?:raw|archive|ingested))\\$/gm, "$1/")
      .replace(/^templates_folder: templates\\$/m, "templates_folder: templates/");
    return `---\n${adapted}\n---\n${body}`;
  }

  // Ensures the vault directory exists and, on first use, pre-seeds
  // wiki-config.md + wiki-schema.md from the vendored wiki-config skill's own
  // bundled templates. Without this, the operational wiki skills' "Config
  // Discovery" step finds no config on a genuinely first-ever run and ends
  // the turn asking the user to run an interactive /wiki-config setup — a
  // question a one-shot `claude -p` run has no way to answer (design.md D5 of
  // the llm-wiki change). Idempotent: never overwrites either file once
  // present, so user edits or a missing bundle (irisPluginDir() unresolved)
  // are safe — the directory still gets created either way.
  function ensureNotesVaultReady() {
    try {
      fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true });
    } catch (error) {
      emitEvent({ type: "log", level: "warn", message: `Could not create notes vault at ${NOTES_VAULT_DIR}: ${error.message}` });
      return;
    }

    const configTarget = path.join(NOTES_VAULT_DIR, "wiki-config.md");
    const schemaTarget = path.join(NOTES_VAULT_DIR, "wiki-schema.md");
    if (fs.existsSync(configTarget) && fs.existsSync(schemaTarget)) return;

    const pluginDir = irisPluginDir();
    if (!pluginDir) return; // bundle not present — the directory alone is still created above
    const assetsDir = path.join(pluginDir, "skills", "wiki-config", "assets");

    try {
      if (!fs.existsSync(schemaTarget)) {
        const schemaSource = path.join(assetsDir, "wiki-schema.md");
        if (fs.existsSync(schemaSource)) fs.copyFileSync(schemaSource, schemaTarget);
      }
      if (!fs.existsSync(configTarget)) {
        const configSource = path.join(assetsDir, "wiki-config-template.md");
        if (fs.existsSync(configSource)) {
          fs.writeFileSync(configTarget, renderNotesVaultConfig(fs.readFileSync(configSource, "utf8")));
        }
      }
    } catch (error) {
      emitEvent({ type: "log", level: "warn", message: `Could not pre-seed notes vault config: ${error.message}` });
    }
  }

  // Second-brain galaxy view (second-brain-galaxy-view): reads the same
  // NOTES_VAULT_DIR the notes capability writes, purely for viewing — never
  // creates or writes to the vault. Module-level singleton, like canvasStore,
  // so its watcher/cache lifecycle survives window recreation.
  const notesVaultGraph = createVaultGraph({ dir: NOTES_VAULT_DIR });
  // Dedicated channel for the (potentially large) full graph payload, kept out
  // of the sidecar:event log stream (design.md D3/L2). Only fires while the
  // watcher is actually running (start()'d), so this subscription is safe to
  // hold for the module's whole lifetime rather than churning per toggle.
  notesVaultGraph.onUpdate((graph) => emitToRenderer("secondbrain:graph-updated", graph));

  // Gated purely on the vault existing, independent of pipelineAvailable
  // (design.md D7) — viewing only reads local markdown. Modeled exactly on
  // probePipelineAvailability's single-mutation-choke-point shape: tracks the
  // last-emitted value and only emits on a real false<->true transition, never
  // on every ensureNotesVaultReady() call (which runs on every plain-Claude
  // turn and would otherwise fire constantly).
  let secondBrainAvailable = false;
  function probeSecondBrainAvailability() {
    const next = fs.existsSync(NOTES_VAULT_DIR);
    if (next !== secondBrainAvailable) {
      secondBrainAvailable = next;
      emitEvent({ type: "secondbrain_availability", available: secondBrainAvailable });
      // The vault disappeared out from under an active watch (e.g. deleted
      // while the galaxy was open) — stop rather than let fs.watch spin on a
      // now-missing directory.
      if (!secondBrainAvailable) notesVaultGraph.stop();
    }
    return secondBrainAvailable;
  }

  // Records one finished run. Called from the run queue's finalize path for
  // EVERY terminal status, successes and failures alike — a failed attempt is at
  // least as worth keeping as a successful one. It is a plain file append: no
  // run is started, no tokens are spent, and the single execution slot is not
  // held, so bookkeeping can never delay the user's next request.
  //
  // Deliberately not conditional on the voice layer choosing to record
  // something: accumulated knowledge that requires a model to remember to save
  // it is knowledge that will be lost.
  function captureRunOutcome(run) {
    return appendRunRecord({
      dir: NOTES_INBOX_DIR,
      run,
      onError: (error) => {
        emitEvent({ type: "log", level: "warn", message: `Could not record the run in the second brain: ${error.message}` });
      },
    });
  }

  // The capture record's own shape (design D3): a raw voice capture has no
  // title, tags, or links by default — those are honoured when Gemini supplies
  // them, but the common case is a bare thought. Owned here, not by
  // vault-write.mjs, on the same D1 split run-inbox.mjs already uses: that
  // module owns writing, this capability owns what a record looks like.
  function renderCaptureRecord({ text, title, tags, now = () => new Date() }) {
    const tagList = Array.isArray(tags)
      ? tags
      : typeof tags === "string" && tags
        ? tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
    const lines = [`## ${now().toISOString()}`];
    if (title) lines.push(`- title: ${title}`);
    if (tagList.length) lines.push(`- tags: ${tagList.join(", ")}`);
    lines.push("", text, "");
    return lines.join("\n");
  }

  // The capture tool's handler (personal-knowledge-notes, vault-write-path
  // design D4): a direct file write, not a run. Ensures the vault exists first
  // (design D7) so a first-ever capture on a machine with no vault yet still
  // lands, then appends to the capture spool and reports what the filesystem
  // actually did — never a claim of success before the write settles (spec: "A
  // capture whose write fails is reported as failed, not confirmed").
  /** @param {{ text?: string, title?: string, tags?: string | string[] }} [params] */
  async function captureNote({ text, title, tags } = {}) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return { status: "error", error: "Nothing to capture — text is required." };
    ensureNotesVaultReady();
    const result = await appendSpoolRecord({
      dir: NOTES_CAPTURES_DIR,
      content: renderCaptureRecord({ text: trimmed, title, tags }),
    });
    if (!result.ok) return { status: "error", error: `Could not save the note: ${result.error}` };
    return { status: "ok", message: "Saved to your notes.", file: result.file };
  }

  // What is waiting to be synthesized. Read by the voice layer's prose below so
  // Iris can offer — never so it can act. Counts both spools (design D3): a
  // capture waiting for curation is material too, not just finished-run
  // records.
  function notesInboxStatus() {
    const backlog = inboxBacklog({ dir: [NOTES_INBOX_DIR, NOTES_CAPTURES_DIR] });
    return { ...backlog, worthProcessing: backlog.records >= INBOX_OFFER_THRESHOLD };
  }

  function promptFragment() {
    // Capture needs no worker, so this half is NEVER gated on
    // getPipelineAvailable()/notes-skills (pipeline-availability spec: "A
    // worker-free local tool still works" in chat-only mode). Curation and
    // retrieval genuinely run on the worker, through the capture_learning
    // verb, so that half stays gated exactly as before.
    //
    // What this no longer does is describe how to route note work through a
    // general-purpose task tool. The second brain has its own callable
    // surfaces (capture_note, capture_learning), so this fragment says only
    // what a schema cannot: when to offer.
    const captureGuidance =
      `SECOND BRAIN — ${userDisplayName()} has a personal notes vault. capture_note saves a thought directly, right now, ` +
      "with no Claude run and no credential required. After a conversational exchange has produced durable value (a research " +
      'result, a worked-out decision), you MAY offer ONCE, in a single short line, to save it (e.g. "Want me to save that to ' +
      'your notes?"). Never auto-save and never repeat the offer for the same exchange; if declined or ignored, drop it ' +
      "silently. Always honor an explicit save request whether or not you offered.";

    if (!getPipelineAvailable() || !checkNotesSkillsStatus().ok) return captureGuidance;

    const backlog = notesInboxStatus();
    const nudge = backlog.worthProcessing
      ? ` Right now ${backlog.records} items are waiting to be woven in — you MAY mention that once, in one short line, and offer to do it. Never start it unprompted.`
      : "";
    return (
      `${captureGuidance} Retrieving from notes ("what do my notes say about X") or weaving accumulated captures into the ` +
      `wiki goes through the capture_learning verb; always honor an explicit request for either.${nudge}`
    );
  }

  /** @type {Array<{ channel: string, kind: "handle"|"on", fn: Function }>} */
  const ipcHandlers = [
    // Second-brain galaxy view (second-brain-galaxy-view design.md D3/D7/D8):
    // renderer's boot-time/HUD-open availability pull — the live push half of
    // this rides the existing sidecar:event stream (secondbrain_availability),
    // not a new dedicated channel (design.md D7, L2).
    { channel: "secondbrain:availability", kind: "handle", fn: () => ({ available: probeSecondBrainAvailability() }) },
    // Always a fresh scan (design.md D3) — re-checks availability inline so a
    // vault that vanished between the toggle showing and being clicked is
    // caught here too, not just on the next HUD-open re-check.
    {
      channel: "secondbrain:get-graph",
      kind: "handle",
      fn: async () => {
        const available = probeSecondBrainAvailability();
        if (!available) return { graph: { nodes: [], links: [] }, available };
        const graph = await notesVaultGraph.getGraph();
        return { graph, available };
      },
    },
    // Start/stop the watcher exactly on galaxy toggle-on/off (design.md D3
    // M-2) — an always-on recursive watcher would rebuild constantly during
    // normal note-capture use for a view that's off by default. start() is
    // idempotent; stop() is safe to call even if never started.
    { channel: "secondbrain:activate", kind: "on", fn: () => notesVaultGraph.start() },
    { channel: "secondbrain:deactivate", kind: "on", fn: () => notesVaultGraph.stop() },
    // Read-by-node-id only, resolved against the single graph cache — never a
    // renderer-supplied filesystem path (design.md D8/L-1). Type/bound-check
    // the arg since an XSS-in-renderer could pass anything (L1), then assert
    // the resolved path (after following symlinks) is inside the vault
    // (H3) before reading — refuses a note symlinked outside the vault
    // (e.g. `secret.md -> ~/.ssh/id_rsa`).
    {
      channel: "secondbrain:read-note",
      kind: "handle",
      fn: (_event, id) => {
        if (typeof id !== "string" || id.length === 0 || id.length > 512) return { ok: false };
        const notePath = notesVaultGraph.resolveNotePath(id);
        if (!notePath) return { ok: false }; // ghost node, unknown id, or since-removed file
        let realNotePath;
        let realVaultDir;
        try {
          realNotePath = fs.realpathSync(notePath);
          realVaultDir = fs.realpathSync(NOTES_VAULT_DIR);
        } catch {
          return { ok: false };
        }
        const withinVault = realNotePath === realVaultDir || realNotePath.startsWith(realVaultDir + path.sep);
        if (!withinVault) return { ok: false };
        try {
          return { ok: true, content: fs.readFileSync(realNotePath, "utf8") };
        } catch {
          return { ok: false };
        }
      },
    },
  ];

  function teardown() {
    // Tear down the vault-graph watcher, if it was running (second-brain-galaxy-view design.md D3).
    notesVaultGraph.stop();
  }

  return {
    // capture_learning (curation/retrieval) is a verb in the registry, and the
    // registry is the single place a verb is defined — no parallel declaration
    // for it here. capture_note is different: it is NOT a verb (design D4), so
    // its declaration belongs to the capability that owns it, the same way
    // canvas's MCP tools are declared by a run's `mcpServers`, not a capability
    // toolDeclaration — this is the one place a non-verb tool is declared.
    toolDeclarations: [CAPTURE_NOTE_DECLARATION],
    notesVaultDir: NOTES_VAULT_DIR,
    notesInboxDir: NOTES_INBOX_DIR,
    notesCapturesDir: NOTES_CAPTURES_DIR,
    captureRunOutcome,
    captureNote,
    notesInboxStatus,
    checkNotesSkillsStatus,
    ensureNotesVaultReady,
    probeSecondBrainAvailability,
    stopVaultGraphWatch: () => notesVaultGraph.stop(),
    promptFragment,
    ipcHandlers,
    teardown,
  };
}
