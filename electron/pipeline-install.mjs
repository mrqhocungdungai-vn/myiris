// Bundle-resource resolution for the Claude/OpenSpec pipeline (personas, the
// Iris plugin) and per-project OpenSpec scaffolding, plus a user-triggered
// cleanup of what older Iris versions wrote into ~/.claude.
//
// Nothing here installs into the user's Claude Code any more: personas go to
// the SDK by value and skills/commands come from the bundled plugin, so the
// system ~/.claude is neither read nor written during a run. Split out of electron/main.mjs
// (split-main-process-modules): Electron-free — `process.resourcesPath` is a
// plain Node global, not an Electron API — so every collaborator that reaches
// into other modules (emitting to the renderer, the OpenSpec/Claude binary
// probes, session-store lookups) is injected.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { buildAgentDefinition } from "./agent-definitions.mjs";

/**
 * @param {{
 *   repoRoot: string,
 *   emitEvent: (event: any) => void,
 *   agentRoster: string[],
 *   agentPrefix: string,
 *   agentLabels: Record<string, string>,
 *   retiredAgents: string[],
 *   hasOpenSpec: (cwd: string) => boolean,
 *   openspecCommand: () => { command: string, args: string[], env: Record<string,string> },
 *   findWorkstream: (id: string | null) => any,
 *   getActiveWorkstreamId: () => string | null,
 *   resolveAgentModel: (workstream: any, role: string) => string | null,
 * }} deps
 */
export function createPipelineInstall({
  repoRoot,
  emitEvent,
  agentRoster,
  agentPrefix,
  agentLabels,
  retiredAgents,
  hasOpenSpec,
  openspecCommand,
  findWorkstream,
  getActiveWorkstreamId,
  resolveAgentModel,
}) {
  // A project-local .claude/agents copy still wins, so a user who customized a
  // persona for one project keeps that. There is no longer a global
  // ~/.claude/agents fallback: the bundled persona IS the default, handed to the
  // SDK by value (see agent-definitions.mjs), so nothing has to be installed.
  function projectAgentFile(agent, cwd) {
    if (!cwd) return null;
    const candidate = path.join(cwd, ".claude", "agents", `${agentPrefix}${agent}.md`);
    return fs.existsSync(candidate) ? candidate : null;
  }

  // The SDK agent definition for a role: the project-local override if there is
  // one, otherwise the persona shipped in the app bundle. Throws if neither can
  // be read — callers turn that into a run failure naming the role.
  function resolveAgentDefinition(agent, cwd) {
    return buildAgentDefinition(agent, {
      personasDir: personasSourceDir(),
      agentPrefix,
      projectFile: projectAgentFile(agent, cwd),
    });
  }

  // Shared resolver for anything bundled under resources/<name> in dev vs a
  // packaged app's resourcesPath — personas and skill snapshots both use this.
  function bundledResourceDir(name) {
    const candidates = [
      path.join(repoRoot, "resources", name),
      process.resourcesPath ? path.join(process.resourcesPath, name) : null,
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  }

  function personasSourceDir() {
    return bundledResourceDir("personas");
  }

  // The Claude Code plugin Iris ships: the skills and /opsx commands the PO and
  // DEV personas invoke, bundled with the app and handed to the SDK as a local
  // plugin. This is what replaced copying them into the user's ~/.claude — the
  // system Claude Code install is now neither read nor written.
  //
  // Everything it provides is namespaced by the plugin name: `iris:grilling`,
  // `/iris:opsx:apply`. The personas reference those names directly.
  function irisPluginDir() {
    return bundledResourceDir("iris-plugin");
  }

  // The `plugins` entry for a query(), or null if the bundle is damaged.
  // skipMcpDiscovery: Iris owns its MCP wiring (the canvas server is passed
  // through `mcpServers`); the plugin must not introduce connections of its own.
  function irisPluginConfig() {
    const dir = irisPluginDir();
    return dir ? [{ type: /** @type {"local"} */ ("local"), path: dir, skipMcpDiscovery: true }] : null;
  }

  // Does a filesystem entry exist at this path, whether a real file/dir or a
  // symlink (even a symlink whose target is missing)? lstat, not exists, so a
  // broken symlink still counts as present.
  function pathExists(candidate) {
    try {
      fs.lstatSync(candidate);
      return true;
    } catch {
      return false;
    }
  }

  // Everything an older Iris copied into the user's ~/.claude. Iris no longer
  // reads or writes any of it — personas go to the SDK by value, skills and
  // commands come from the bundled plugin — so these files are inert leftovers.
  //
  // Removing them is offered, never automatic: ~/.claude belongs to the user's
  // own Claude Code install, and silently deleting from it is exactly the
  // interference this change exists to end. A file is only ever a candidate if
  // Iris is the thing that put it there.
  const LEGACY_SKILLS = [
    "grilling", "tdd", "code-review", "diagnosing-bugs",
    "openspec-propose", "openspec-apply-change", "openspec-archive-change",
    "openspec-explore", "openspec-sync-specs", "openspec-update-change",
    "wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize",
  ];
  const LEGACY_COMMANDS = ["apply.md", "archive.md", "explore.md", "propose.md", "sync.md", "update.md"];

  function legacyClaudeArtifacts() {
    const home = path.join(os.homedir(), ".claude");
    const found = [];
    for (const agent of [...agentRoster, ...retiredAgents]) {
      const p = path.join(home, "agents", `${agentPrefix}${agent}.md`);
      if (pathExists(p)) found.push(p);
    }
    for (const name of LEGACY_SKILLS) {
      const p = path.join(home, "skills", name);
      if (pathExists(p)) found.push(p);
    }
    for (const name of LEGACY_COMMANDS) {
      const p = path.join(home, "commands", "opsx", name);
      if (pathExists(p)) found.push(p);
    }
    return found;
  }

  // Reports what an older Iris left behind, without touching anything.
  function legacyClaudeArtifactsStatus() {
    const paths = legacyClaudeArtifacts();
    return { count: paths.length, paths, dir: path.join(os.homedir(), ".claude") };
  }

  // Removes exactly the paths legacyClaudeArtifacts() reports and nothing else.
  function removeLegacyClaudeArtifacts() {
    const removed = [];
    const errors = [];
    for (const target of legacyClaudeArtifacts()) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(path.basename(target));
      } catch (error) {
        errors.push(`${path.basename(target)}: ${error.message}`);
      }
    }
    emitEvent({
      type: "log",
      level: errors.length ? "warn" : "info",
      message: `Removed ${removed.length} leftover file(s) an older Iris wrote into ~/.claude${errors.length ? ` — errors: ${errors.join("; ")}` : ""}.`,
    });
    return { removed, errors };
  }

  // OpenSpec is the pipeline's only SDD surface (see the po-voice-controller
  // change). A fresh project `cwd` is made OpenSpec-ready with `openspec init`.
  // The PO agent then produces changes under `openspec/changes/`, and archiving
  // syncs deltas into `openspec/specs/`. No-op if `openspec/` already exists so an
  // existing OpenSpec setup is never disturbed.
  function ensureProjectScaffold(cwd) {
    if (hasOpenSpec(cwd)) return { created: [] };
    try {
      // `openspec init` is interactive by default; `--tools claude` runs it
      // non-interactively and writes the Claude slash-commands (verified against
      // openspec 1.6.0). Point it at `cwd` explicitly rather than relying on the
      // child's own cwd. The command spec carries its own interpreter and env —
      // the bundled CLI is a Node script run through Electron's embedded Node,
      // not something that can be exec'd directly (see openspecCommand).
      const spec = openspecCommand();
      execFileSync(spec.command, [...spec.args, "init", cwd, "--tools", "claude"], {
        stdio: "ignore",
        timeout: 60000,
        env: { ...process.env, ...spec.env },
      });
      return { created: hasOpenSpec(cwd) ? ["openspec/"] : [] };
    } catch (error) {
      return { created: [], error: `openspec init failed: ${error.message}` };
    }
  }

  function agentDescription(filePath) {
    try {
      const head = fs.readFileSync(filePath, "utf8").slice(0, 2000);
      const match = /^description:\s*(.+)$/m.exec(head);
      return match ? match[1].trim() : "";
    } catch {
      return "";
    }
  }

  // The most recently modified active (non-archived) OpenSpec change in `cwd`, or
  // null. This is the "current feature" the pipeline UI reports gates for.
  function latestOpenChange(cwd) {
    try {
      const changesDir = path.join(cwd, "openspec", "changes");
      let best = null;
      let bestTime = -1;
      for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
        const mtime = fs.statSync(path.join(changesDir, entry.name)).mtimeMs;
        if (mtime > bestTime) {
          bestTime = mtime;
          best = entry.name;
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  // Snapshot for the pipeline UI: the roles and — for the workstream's project
  // folder — which gates have been passed for the current OpenSpec change. PO
  // gate = a proposal exists (the change was proposed); DEV gate = every task in
  // tasks.md is checked (implementation complete).
  //
  // `installed` is retained in the shape but is now always true: the personas
  // ship in the app, so a role can no longer be missing. It stays because the
  // renderer's roster rendering keys off it, and a role that genuinely cannot
  // load still fails loudly at run start (startClaudeRun).
  function agentsSnapshot(workstreamId) {
    const workstream = findWorkstream(workstreamId) || findWorkstream(getActiveWorkstreamId());
    const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
    const roster = agentRoster.map((agent) => {
      let description = "";
      let installed = true;
      try {
        description = resolveAgentDefinition(agent, cwd).description;
      } catch {
        installed = false;
      }
      return {
        key: agent,
        label: agentLabels[agent],
        installed,
        description,
        model: resolveAgentModel(workstream, agent),
      };
    });
    const gates = { slug: null, byRole: {} };
    if (cwd) {
      gates.slug = latestOpenChange(cwd);
      if (gates.slug) {
        const changeDir = path.join(cwd, "openspec", "changes", gates.slug);
        gates.byRole.po = fs.existsSync(path.join(changeDir, "proposal.md"));
        // DEV gate passes when tasks.md exists and has no unchecked `- [ ]` left.
        let devDone = false;
        try {
          const tasks = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf8");
          devDone = !/^\s*-\s*\[\s\]/m.test(tasks);
        } catch { devDone = false; }
        gates.byRole.dev = devDone;
      }
    }
    return {
      roster,
      installed: roster.every((entry) => entry.installed),
      hasProject: Boolean(cwd),
      gates,
    };
  }

  return {
    projectAgentFile,
    resolveAgentDefinition,
    irisPluginDir,
    irisPluginConfig,
    pathExists,
    legacyClaudeArtifactsStatus,
    removeLegacyClaudeArtifacts,
    bundledResourceDir,
    personasSourceDir,
    ensureProjectScaffold,
    agentDescription,
    latestOpenChange,
    agentsSnapshot,
  };
}
