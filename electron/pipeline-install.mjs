// One-click provisioning for the Claude/OpenSpec pipeline: installing the PO
// and DEV persona files, vendored skill/command snapshots, and per-project
// OpenSpec scaffolding. Split out of electron/main.mjs
// (split-main-process-modules): Electron-free — `process.resourcesPath` is a
// plain Node global, not an Electron API — so every collaborator that reaches
// into other modules (emitting to the renderer, the OpenSpec/Claude binary
// probes, session-store lookups) is injected.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * @param {{
 *   repoRoot: string,
 *   emitEvent: (event: any) => void,
 *   agentRoster: string[],
 *   agentPrefix: string,
 *   agentLabels: Record<string, string>,
 *   retiredAgents: string[],
 *   hasOpenSpec: (cwd: string) => boolean,
 *   openspecBinary: () => string,
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
  openspecBinary,
  findWorkstream,
  getActiveWorkstreamId,
  resolveAgentModel,
}) {
  function globalAgentsDir() {
    return path.join(os.homedir(), ".claude", "agents");
  }

  // Roles install globally (~/.claude/agents) so they work in any project, but a
  // project-local .claude/agents copy wins if the user customized one there.
  function installedAgentFile(agent, cwd) {
    const name = `${agentPrefix}${agent}.md`;
    const candidates = [
      cwd ? path.join(cwd, ".claude", "agents", name) : null,
      path.join(globalAgentsDir(), name),
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
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

  // Vendored snapshots of the third-party skills/commands the personas invoke
  // (see resources/skills/ATTRIBUTION.md) — installed only on explicit user
  // action via installPipelinePrereqs(), never at startup.
  function skillsSourceDir() {
    return bundledResourceDir("skills");
  }

  function installIrisAgents() {
    const sourceDir = personasSourceDir();
    if (!sourceDir) {
      return { status: "error", error: "Persona templates were not found in the app bundle.", installed: [], skipped: [], errors: [] };
    }
    const targetDir = globalAgentsDir();
    const installed = [];
    const skipped = [];
    const removed = [];
    const errors = [];
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (error) {
      return { status: "error", error: `Could not create ${targetDir}: ${error.message}`, installed, skipped, errors };
    }
    for (const agent of agentRoster) {
      const name = `${agentPrefix}${agent}.md`;
      try {
        const source = path.join(sourceDir, name);
        const target = path.join(targetDir, name);
        if (!fs.existsSync(source)) {
          errors.push(`${name}: template missing from the app bundle`);
          continue;
        }
        // "Install agents" is an explicit user action: always sync the installed
        // copy to the bundled template so prompt updates actually land.
        const content = fs.readFileSync(source, "utf8");
        if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
          skipped.push(name);
          continue;
        }
        fs.writeFileSync(target, content);
        installed.push(name);
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }
    for (const agent of retiredAgents) {
      const name = `${agentPrefix}${agent}.md`;
      try {
        const target = path.join(targetDir, name);
        if (fs.existsSync(target)) {
          fs.rmSync(target);
          removed.push(name);
        }
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }
    emitEvent({
      type: "log",
      level: errors.length ? "warn" : "info",
      message: `Iris agents: ${installed.length} installed/updated, ${skipped.length} already current, ${removed.length} retired removed in ${targetDir}${errors.length ? ` — errors: ${errors.join("; ")}` : ""}.`,
    });
    return { status: errors.length ? "partial" : "ok", installed, skipped, removed, errors };
  }

  // Does a filesystem entry exist at this path, whether a real file/dir or a
  // symlink (even a symlink whose target is missing)? Used so a skills.sh- or
  // openspec-managed symlink is treated as "already present" and never
  // clobbered — existsSync() alone would follow (and skip) broken symlinks,
  // which is not the same guarantee.
  function pathExists(candidate) {
    try {
      fs.lstatSync(candidate);
      return true;
    } catch {
      return false;
    }
  }

  // One-click provisioning for a fresh machine (pipeline-setup-install spec):
  // (1) sync-installs the Iris personas via the existing installIrisAgents()
  // path unchanged, then (2) copies each bundled third-party skill directory
  // and /opsx command file into ~/.claude only where nothing already exists —
  // an existing entry (including a symlink managed by skills.sh or a manual
  // openspec init) is left completely untouched. Runs only on explicit user
  // action (SetupPanel's "Install missing"), never at app startup.
  function installPipelinePrereqs() {
    const agents = installIrisAgents();

    const sourceDir = skillsSourceDir();
    const installedSkills = [];
    const skippedSkills = [];
    const installedCommands = [];
    const skippedCommands = [];
    const errors = [];

    if (!sourceDir) {
      errors.push("Bundled skill/command snapshots were not found in the app bundle.");
      return { agents, installedSkills, skippedSkills, installedCommands, skippedCommands, errors };
    }

    const skillsSrcDir = path.join(sourceDir, "claude-skills");
    const skillsTargetDir = path.join(os.homedir(), ".claude", "skills");
    try {
      fs.mkdirSync(skillsTargetDir, { recursive: true });
      for (const entry of fs.readdirSync(skillsSrcDir, { withFileTypes: true })) {
        // LICENSE-* files sit beside the skill directories for attribution —
        // not skills themselves, so they never get copied into ~/.claude.
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        const target = path.join(skillsTargetDir, name);
        if (pathExists(target)) {
          skippedSkills.push(name);
          continue;
        }
        try {
          fs.cpSync(path.join(skillsSrcDir, name), target, { recursive: true });
          installedSkills.push(name);
        } catch (error) {
          errors.push(`${name}: ${error.message}`);
        }
      }
    } catch (error) {
      errors.push(`Could not read/create skills directories: ${error.message}`);
    }

    const commandsSrcDir = path.join(sourceDir, "claude-commands", "opsx");
    const commandsTargetDir = path.join(os.homedir(), ".claude", "commands", "opsx");
    try {
      fs.mkdirSync(commandsTargetDir, { recursive: true });
      for (const file of fs.readdirSync(commandsSrcDir)) {
        const target = path.join(commandsTargetDir, file);
        if (pathExists(target)) {
          skippedCommands.push(file);
          continue;
        }
        try {
          fs.copyFileSync(path.join(commandsSrcDir, file), target);
          installedCommands.push(file);
        } catch (error) {
          errors.push(`${file}: ${error.message}`);
        }
      }
    } catch (error) {
      errors.push(`Could not read/create commands directory: ${error.message}`);
    }

    emitEvent({
      type: "log",
      level: errors.length ? "warn" : "info",
      message: `Pipeline prerequisites: ${installedSkills.length} skills + ${installedCommands.length} commands installed, ${skippedSkills.length + skippedCommands.length} already present${errors.length ? ` — errors: ${errors.join("; ")}` : ""}.`,
    });

    return {
      status: errors.length ? "partial" : "ok",
      agents,
      installedSkills,
      skippedSkills,
      installedCommands,
      skippedCommands,
      errors,
    };
  }

  // OpenSpec is the pipeline's only SDD surface (see the po-voice-controller
  // change). A fresh project `cwd` is made OpenSpec-ready with `openspec init`
  // instead of the old hand-written `.scratch/` + CONTEXT.md + docs/agents seeding.
  // The PO agent then produces changes under `openspec/changes/`, and archiving
  // syncs deltas into `openspec/specs/`. No-op if `openspec/` already exists so an
  // existing OpenSpec setup is never disturbed.
  function ensureProjectScaffold(cwd) {
    if (hasOpenSpec(cwd)) return { created: [] };
    try {
      // `openspec init` is interactive by default; `--tools claude` runs it
      // non-interactively and writes the Claude slash-commands (verified against
      // openspec 1.6.0). Point it at `cwd` explicitly rather than relying on the
      // child's own cwd.
      execFileSync(openspecBinary(), ["init", cwd, "--tools", "claude"], {
        stdio: "ignore",
        timeout: 60000,
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

  // Snapshot for the pipeline UI: which roles are installed, and — for the
  // workstream's project folder — which gates have been passed for the current
  // OpenSpec change. PO gate = a proposal exists (the change was proposed); DEV
  // gate = every task in tasks.md is checked (implementation complete).
  function agentsSnapshot(workstreamId) {
    const workstream = findWorkstream(workstreamId) || findWorkstream(getActiveWorkstreamId());
    const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
    const roster = agentRoster.map((agent) => {
      const file = installedAgentFile(agent, cwd);
      return {
        key: agent,
        label: agentLabels[agent],
        installed: Boolean(file),
        description: file ? agentDescription(file) : "",
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
    globalAgentsDir,
    installedAgentFile,
    bundledResourceDir,
    personasSourceDir,
    skillsSourceDir,
    installIrisAgents,
    pathExists,
    installPipelinePrereqs,
    ensureProjectScaffold,
    agentDescription,
    latestOpenChange,
    agentsSnapshot,
  };
}
