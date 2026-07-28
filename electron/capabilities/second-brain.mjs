// The second-brain capability (personal-knowledge-notes,
// second-brain-galaxy-view): the LLM-Wiki notes vault's readiness checks,
// the read-only galaxy graph watcher, and this capability's slice of Gemini
// prose / IPC / teardown — gathered here per design.md D10 rather than
// spread across the layered core modules. Electron-free.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVaultGraph } from "../vault-graph.mjs";

// Personal-knowledge-notes capability (see openspec/changes/llm-wiki/): the
// LLM-Wiki vault is pinned to this fixed, user-level path, independent of
// any workstream's project cwd — plain-Claude runs only, never PO/DEV.
const NOTES_VAULT_DIR = path.join(os.homedir(), "iris-second-brain");

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

// Loose heuristic for the vault-write backstop below — matches common
// English/Vietnamese phrasing for "save/capture a note" (mirrors the example
// utterances in specs/personal-knowledge-notes/spec.md). False negatives just
// mean the backstop caveat isn't appended (same as before this capability
// existed); false positives are harmless (the caveat only fires when nothing
// in the vault changed, so a request that never intended to write there
// stays silent).
const NOTE_CAPTURE_HINT_RE = /ghi ch[uú]|note (it |this )?down|jot down|save (a |this )?note|second[- ]brain/i;

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   skillsSourceDir: () => string | null,
 *   userDisplayName: () => string,
 *   getPipelineAvailable: () => boolean,
 * }} deps
 */
export function createSecondBrainCapability({
  emitEvent,
  emitToRenderer,
  skillsSourceDir,
  userDisplayName,
  getPipelineAvailable,
}) {
  // Same presence-only shape as checkSkillsStatus()/checkAgentsStatus() — used
  // both to gate the append-system-prompt directive (startDevRun) and to
  // surface a status row in the SetupPanel (checkClaudeHealth), so the user
  // has a visible signal for whether the notes capability is actually
  // installed, not just whether the vault directory happens to exist.
  function checkNotesSkillsStatus() {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
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
  // present, so user edits or a missing bundle (skillsSourceDir() unresolved)
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

    const skillsRoot = skillsSourceDir();
    if (!skillsRoot) return; // bundle not present (e.g. unpackaged dev checkout) — directory alone is still created above
    const assetsDir = path.join(skillsRoot, "claude-skills", "wiki-config", "assets");

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

  // True if any file under the notes vault has an mtime at/after `sinceMs`.
  // Cheap, best-effort backstop — not a guarantee (a write racing the scan, or
  // one outside the vault entirely, can still be missed or misreported).
  function vaultChangedSince(sinceMs) {
    const stack = [NOTES_VAULT_DIR];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        try {
          if (fs.statSync(full).mtimeMs >= sinceMs) return true;
        } catch {
          // file removed mid-scan — ignore
        }
      }
    }
    return false;
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

  function promptFragment() {
    // Pipeline-availability gate mirrors the pre-split behavior and is a
    // hard requirement of role-capabilities ("When the pipeline is
    // available... Iris MAY offer..."). Notes-skills gate is additional (not
    // just pipelineAvailable) — otherwise Iris could offer a save the
    // plain-Claude worker would refuse (role-capabilities "No offer when
    // notes skills are not installed").
    if (!getPipelineAvailable() || !checkNotesSkillsStatus().ok) return "";
    return `NOTE-OFFER — after a conversational exchange has produced durable value (a research result, a worked-out decision), you MAY offer ONCE, in a single short line, to save it to ${userDisplayName()}'s second brain (e.g. "Want me to save that to your notes?"). Never auto-save and never repeat the offer for the same exchange; if declined or ignored, drop it silently. Always honor an explicit save or retrieve request regardless of whether you offered — send it to Claude as a plain task.`;
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
    // No Gemini function declarations — the second brain is offered purely
    // through submit_claude_task plus the NOTE-OFFER prose above. Declared
    // explicitly (rather than omitted) so this capability object shares at
    // least one property with every other core module's
    // `{ toolDeclarations?: any[] }` composition target.
    toolDeclarations: [],
    notesVaultDir: NOTES_VAULT_DIR,
    noteCaptureHintRe: NOTE_CAPTURE_HINT_RE,
    checkNotesSkillsStatus,
    ensureNotesVaultReady,
    vaultChangedSince,
    probeSecondBrainAvailability,
    stopVaultGraphWatch: () => notesVaultGraph.stop(),
    promptFragment,
    ipcHandlers,
    teardown,
  };
}
