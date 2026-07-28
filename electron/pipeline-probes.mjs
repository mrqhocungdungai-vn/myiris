// Availability probing for the Claude/OpenSpec pipeline: binary resolution,
// health checks, and the single `pipelineAvailable` flag every other module
// gates on. Split out of electron/main.mjs (split-main-process-modules):
// Electron-free, so every collaborator (emitting to the renderer, waking the
// canvas MCP, checking notes skills, locating the agent-persona directory)
// is injected rather than imported directly.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile as nodeExecFile } from "node:child_process";
import { poBillingStatus } from "./po-session.mjs";

// Skills the PO/DEV personas actually invoke by name (resources/personas/
// iris-po.md, iris-dev.md) — the three core OpenSpec workflow skills plus
// mattpocock's. (No "verify" — that was never a real skill; DEV's own
// verification step is now worded as an action it performs itself. See
// resources/skills/ for the bundled snapshots the "Install missing" action
// installs.) Presence-only probe (pipeline-availability spec): a directory
// existing under ~/.claude/skills means "detected", not semantically
// validated — deeper problems still surface through normal PO/DEV run errors.
const REQUIRED_SKILLS = [
  "grilling",
  "tdd",
  "code-review",
  "diagnosing-bugs",
  "openspec-propose",
  "openspec-apply-change",
  "openspec-archive-change",
];

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   maybeStartCanvasMcp: () => void,
 *   checkNotesSkillsStatus: () => { ok: boolean, missing: string[] },
 *   globalAgentsDir: () => string,
 *   agentRoster: string[],
 *   agentPrefix: string,
 *   execFileImpl?: (bin: string, args: string[], opts: any, cb: (error: any, stdout?: any, stderr?: any) => void) => any,
 * }} deps
 */
export function createPipelineProbes({
  emitEvent,
  maybeStartCanvasMcp,
  checkNotesSkillsStatus,
  globalAgentsDir,
  agentRoster,
  agentPrefix,
  execFileImpl = nodeExecFile,
}) {
  // Single source of truth for whether the PO → DEV pipeline is available —
  // determined solely by the `claude` binary resolving (see design.md decision
  // 1). Chat-only mode (no Claude tools declared to Gemini, no pipeline prompt
  // content, pipeline UI hidden) is the default until this flips true.
  // CLAUDE_CODE_OAUTH_TOKEN is deliberately NOT part of this check — it only
  // gates individual PO turns via poBillingStatus(), never the master switch.
  let pipelineAvailable = false;

  function getPipelineAvailable() {
    return pipelineAvailable;
  }

  // D5: the executable path resolved from configuration/environment is the
  // highest-value sink reachable from config — a redirected binary runs with
  // the user's full privileges on the next task. Validated before every spawn;
  // a failing candidate throws naming the setting rather than silently falling
  // through to the probe list or a bare command name.
  function assertExecutable(settingName, candidate) {
    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      throw new Error(`${settingName} is set to "${candidate}", but that path does not exist.`);
    }
    if (!stat.isFile()) {
      throw new Error(`${settingName} is set to "${candidate}", but that path is not a regular file.`);
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      throw new Error(`${settingName} is set to "${candidate}", but that path is not executable.`);
    }
  }

  function claudeBinary() {
    if (process.env.IRIS_CLAUDE_BIN) {
      assertExecutable("IRIS_CLAUDE_BIN", process.env.IRIS_CLAUDE_BIN);
      return process.env.IRIS_CLAUDE_BIN;
    }
    // A packaged .app does not inherit the shell PATH, so probe common installs.
    const known = [
      path.join(os.homedir(), ".local", "bin", "claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
    for (const candidate of known) {
      if (fs.existsSync(candidate)) {
        assertExecutable("the probed claude install", candidate);
        return candidate;
      }
    }
    return "claude";
  }

  // Same PATH-probe rationale as claudeBinary(): a packaged .app does not inherit
  // the shell PATH, and the OpenSpec CLI (the SDD engine the pipeline runs on) is
  // typically installed under ~/.local/bin. Override with IRIS_OPENSPEC_BIN.
  function openspecBinary() {
    if (process.env.IRIS_OPENSPEC_BIN) {
      assertExecutable("IRIS_OPENSPEC_BIN", process.env.IRIS_OPENSPEC_BIN);
      return process.env.IRIS_OPENSPEC_BIN;
    }
    const known = [
      path.join(os.homedir(), ".local", "bin", "openspec"),
      "/usr/local/bin/openspec",
      "/opt/homebrew/bin/openspec",
    ];
    for (const candidate of known) {
      if (fs.existsSync(candidate)) {
        assertExecutable("the probed openspec install", candidate);
        return candidate;
      }
    }
    return "openspec";
  }

  // A `cwd` is OpenSpec-ready once it has an `openspec/` directory (created by
  // `openspec init`). The pipeline uses OpenSpec as its only SDD surface.
  function hasOpenSpec(cwd) {
    try {
      return fs.statSync(path.join(cwd, "openspec")).isDirectory();
    } catch {
      return false;
    }
  }

  // Names of active (non-archived) OpenSpec changes in `cwd` whose tasks.md still
  // has at least one unchecked `- [ ]` task. DEV runs are gated on this being
  // non-empty (see startClaudeRun): no open change with work → no DEV run.
  function openChangesWithTasks(cwd) {
    const out = [];
    try {
      const changesDir = path.join(cwd, "openspec", "changes");
      for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
        const tasksMd = path.join(changesDir, entry.name, "tasks.md");
        try {
          if (/^\s*-\s*\[\s\]/m.test(fs.readFileSync(tasksMd, "utf8"))) out.push(entry.name);
        } catch { /* no tasks.md yet — not an implementable change */ }
      }
    } catch { /* no openspec/changes — none */ }
    return out;
  }

  function claudeWorkdir() {
    const dir = process.env.IRIS_CLAUDE_CWD || path.join(os.homedir(), ".iris", "workspace");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async function checkClaudeStatus() {
    return new Promise((resolve) => {
      let binary;
      try {
        binary = claudeBinary();
      } catch (error) {
        emitEvent({ type: "claude_status", status: "error", error: error.message });
        resolve({ reachable: false, error: error.message });
        return;
      }
      execFileImpl(binary, ["--version"], { timeout: 15000 }, (error, stdout) => {
        if (error) {
          emitEvent({ type: "claude_status", status: "error", error: error.message });
          resolve({ reachable: false, error: error.message });
        } else {
          const health = { version: String(stdout).trim(), binary };
          emitEvent({ type: "claude_status", status: "ready", detail: health });
          resolve({ reachable: true, health });
        }
      });
    });
  }

  async function probePipelineAvailability() {
    const status = await checkClaudeStatus();
    const next = Boolean(status.reachable);
    if (next !== pipelineAvailable) {
      pipelineAvailable = next;
      emitEvent({ type: "pipeline_availability", available: pipelineAvailable });
      // Claude just became available mid-session: bring the canvas MCP up if
      // the drawing panel was already engaged (design.md D6 of
      // canvas-claude-mcp) — a no-op otherwise.
      maybeStartCanvasMcp();
    }
    return { available: pipelineAvailable, status };
  }

  async function checkOpenSpecStatus() {
    return new Promise((resolve) => {
      let binary;
      try {
        binary = openspecBinary();
      } catch (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      execFileImpl(binary, ["--version"], { timeout: 15000 }, (error, stdout) => {
        if (error) resolve({ ok: false, error: error.message });
        else resolve({ ok: true, version: String(stdout).trim() });
      });
    });
  }

  function checkSkillsStatus() {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    const missing = REQUIRED_SKILLS.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
    return { ok: missing.length === 0, missing, skillsDir };
  }

  // Same presence-only shape as checkSkillsStatus(), for the two Iris persona
  // files installIrisAgents() is responsible for.
  function checkAgentsStatus() {
    const agentsDir = globalAgentsDir();
    const missing = agentRoster.map((role) => `${agentPrefix}${role}.md`).filter(
      (name) => !fs.existsSync(path.join(agentsDir, name)),
    );
    return { ok: missing.length === 0, missing, agentsDir };
  }

  // Combined status for the SetupPanel's Claude section (design.md D3b/D3c):
  // CLI reachability (same probe as checkClaudeStatus), the PO subscription
  // billing-path status, and the openspec CLI / global skills / agents
  // prerequisite checks (pipeline-availability spec) — all read-only, never
  // editable from the UI. Also the SetupPanel's re-check path for pipeline
  // availability (design.md decision 1).
  async function checkClaudeHealth() {
    const { available, status } = await probePipelineAvailability();
    const billing = poBillingStatus();
    const openspecStatus = await checkOpenSpecStatus();
    const skillsStatus = checkSkillsStatus();
    const agentsStatus = checkAgentsStatus();
    const notesSkillsStatus = checkNotesSkillsStatus();
    return {
      reachable: available,
      pipelineAvailable: available,
      version: status.health?.version,
      error: status.error,
      billingOk: billing.ok,
      billingError: billing.ok
        ? undefined
        : "No CLAUDE_CODE_OAUTH_TOKEN set — PO turns will fail until you run `claude setup-token`.",
      openspecOk: openspecStatus.ok,
      openspecVersion: openspecStatus.version,
      openspecInstallHint: "npm install -g @fission-ai/openspec@latest",
      skillsOk: skillsStatus.ok,
      missingSkills: skillsStatus.missing,
      skillsInstallHint: "Use \"Install missing\" below, or run: npx skills@latest add mattpocock/skills (and `openspec init` for its Claude skills)",
      agentsOk: agentsStatus.ok,
      missingAgents: agentsStatus.missing,
      // Informational only — not a pipeline gate (see NOTES_SKILLS above): a
      // Talk-only user with these missing is not "missing a prerequisite" for
      // PO/DEV, just missing the second-brain notes capability specifically.
      notesSkillsOk: notesSkillsStatus.ok,
      missingNotesSkills: notesSkillsStatus.missing,
      notesSkillsInstallHint: 'Use "Install missing" below to add the second-brain notes skills.',
    };
  }

  return {
    getPipelineAvailable,
    assertExecutable,
    claudeBinary,
    openspecBinary,
    hasOpenSpec,
    openChangesWithTasks,
    claudeWorkdir,
    checkClaudeStatus,
    probePipelineAvailability,
    checkOpenSpecStatus,
    checkSkillsStatus,
    checkAgentsStatus,
    checkClaudeHealth,
  };
}
