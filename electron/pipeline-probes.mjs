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
import { resolveBundledClaude, resolveBundledOpenspec } from "./bundled-binaries.mjs";

// Skills the PO/DEV personas actually invoke by name (resources/personas/
// iris-po.md, iris-dev.md). They ship in the Iris plugin
// (resources/iris-plugin/skills/) and reach a run through the SDK's `plugins`
// option, so this probes the APP BUNDLE — never ~/.claude, which Iris no longer
// reads or writes. "Missing" therefore means a damaged bundle, not a skipped
// install step. Presence-only, as before: a directory existing means
// "detected", not semantically validated.
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
 *   irisPluginDir: () => string | null,
 *   execFileImpl?: (bin: string, args: string[], opts: any, cb: (error: any, stdout?: any, stderr?: any) => void) => any,
 * }} deps
 */
export function createPipelineProbes({
  emitEvent,
  maybeStartCanvasMcp,
  checkNotesSkillsStatus,
  irisPluginDir,
  execFileImpl = nodeExecFile,
}) {
  // Single source of truth for whether the PO → DEV pipeline is available.
  //
  // This used to be "the host has a `claude` binary somewhere on disk". Iris now
  // SHIPS Claude Code inside the app (see bundled-binaries.mjs), so that question
  // is always yes and would make the flag a constant. What a user can still
  // legitimately lack is a *credential* — so the gate moved to "the bundled
  // binary runs AND we have something to authenticate it with".
  //
  // Chat-only mode (no Claude tools declared to Gemini, no pipeline prompt
  // content, pipeline UI hidden) survives unchanged as the no-credential state,
  // which is the state a brand-new user starts in.
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

  // Claude Code ships INSIDE the app as the Agent SDK's native binary. There is
  // no host install to probe for, no PATH to search, and deliberately no
  // override: a setting that pointed Iris at a system Claude Code would put
  // back exactly the coupling this design removed, and would run the user's
  // binary — possibly a different version — under bypassPermissions.
  function claudeBinary() {
    const bundled = resolveBundledClaude();
    // Still validated: this is the one place that would catch a packaging
    // mistake (asarUnpack missing, the executable bit lost in a copy) with an
    // error naming the cause rather than a bare ENOENT at spawn time.
    assertExecutable("the bundled Claude binary", bundled);
    return bundled;
  }

  // What the pipeline can actually authenticate with. Either credential works:
  // CLAUDE_CODE_OAUTH_TOKEN bills against a Claude subscription, ANTHROPIC_API_KEY
  // bills per token. Neither present is the honest chat-only state — the bundled
  // binary would launch fine and then fail every single run.
  function claudeCredentialStatus() {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return { ok: true, kind: "subscription" };
    if (process.env.ANTHROPIC_API_KEY?.trim()) return { ok: true, kind: "api-key" };
    return { ok: false, kind: null };
  }

  // How to invoke OpenSpec (the SDD engine the pipeline runs on). Like Claude,
  // it now ships with the app rather than being a host prerequisite — but it is
  // a plain Node CLI, not a native executable, so it cannot simply be exec'd.
  // Returns a command spec instead of a path: the bundled form runs the script
  // through Electron's own embedded Node (ELECTRON_RUN_AS_NODE), which is the
  // only Node a packaged app is guaranteed to have.
  //
  // No host override, for the same reason as claudeBinary(): the app ships it.
  function openspecCommand() {
    return {
      command: process.execPath,
      args: [resolveBundledOpenspec()],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
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
    const next = Boolean(status.reachable) && claudeCredentialStatus().ok;
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
      let spec;
      try {
        spec = openspecCommand();
      } catch (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      const options = { timeout: 15000, env: { ...process.env, ...spec.env } };
      execFileImpl(spec.command, [...spec.args, "--version"], options, (error, stdout) => {
        if (error) resolve({ ok: false, error: error.message });
        else resolve({ ok: true, version: String(stdout).trim() });
      });
    });
  }

  function checkSkillsStatus() {
    const pluginDir = irisPluginDir();
    if (!pluginDir) return { ok: false, missing: REQUIRED_SKILLS, skillsDir: null };
    const skillsDir = path.join(pluginDir, "skills");
    const missing = REQUIRED_SKILLS.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
    return { ok: missing.length === 0, missing, skillsDir };
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
    const notesSkillsStatus = checkNotesSkillsStatus();
    const credential = claudeCredentialStatus();
    return {
      // `reachable` is now strictly "the bundled binary launched" — it is no
      // longer the same question as `pipelineAvailable`, which also requires a
      // credential. Keeping them distinct lets the SetupPanel tell a packaging
      // failure apart from a user who simply hasn't logged in yet.
      reachable: Boolean(status.reachable),
      pipelineAvailable: available,
      version: status.health?.version,
      // Surfaced so the SetupPanel can tell the user the exact command that
      // mints a subscription token. `claude setup-token` needs a real TTY
      // (verified: with piped stdio it produces no output at all), so it cannot
      // be driven from inside the app — but because the binary ships with Iris,
      // the user can still run it without installing anything.
      binaryPath: status.health?.binary,
      error: status.error,
      credentialOk: credential.ok,
      credentialKind: credential.kind,
      billingOk: billing.ok,
      // States the fact only. The panel that shows this already tells the user
      // what to do about it, right above — repeating the instruction here read
      // as "go to the setup panel" while standing in the setup panel.
      billingError: billing.ok ? undefined : "No Claude credential set yet.",
      openspecOk: openspecStatus.ok,
      openspecVersion: openspecStatus.version,
      // Bundled with the app now — a failure here is a packaging problem, not
      // something the user can fix by installing anything.
      openspecInstallHint: "OpenSpec ships with Iris; if this fails, reinstall the app.",
      skillsOk: skillsStatus.ok,
      missingSkills: skillsStatus.missing,
      // Namespaced by the plugin, which is how the personas address them.
      skillsDetail: skillsStatus.ok ? `${REQUIRED_SKILLS.length} skills as iris:*` : undefined,
      skillsInstallHint: skillsStatus.ok
        ? ""
        : `missing from the app bundle: ${skillsStatus.missing.join(", ")} — reinstall Iris`,
      // Informational only — not a pipeline gate: a Talk-only user with these
      // missing is not "missing a prerequisite" for PO/DEV, just missing the
      // second-brain notes capability specifically.
      notesSkillsOk: notesSkillsStatus.ok,
      missingNotesSkills: notesSkillsStatus.missing,
      notesSkillsInstallHint: notesSkillsStatus.ok
        ? ""
        : `missing from the app bundle: ${notesSkillsStatus.missing.join(", ")} — reinstall Iris`,
    };
  }

  return {
    getPipelineAvailable,
    assertExecutable,
    claudeBinary,
    claudeCredentialStatus,
    openspecCommand,
    hasOpenSpec,
    openChangesWithTasks,
    claudeWorkdir,
    checkClaudeStatus,
    probePipelineAvailability,
    checkOpenSpecStatus,
    checkSkillsStatus,
    checkClaudeHealth,
  };
}
