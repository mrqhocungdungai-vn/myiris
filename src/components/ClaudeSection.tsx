import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { BundledRow, Section, TestBadge, type TestState } from "./SetupControls";

// The Claude-pipeline step of the setup panel: the bundled-runtime health
// probe, the two credentials (subscription token and metered API key), and the
// offer to remove what an older Iris left in ~/.claude.
//
// Split out of SetupPanel.tsx, which was 703 code lines. This is not a props
// bag — the eleven pieces of state and four handlers below are used **only**
// here, so they moved with the UI that owns them and the component takes two
// props. `SetupPanel` keeps the `.env` draft; this owns everything about
// whether the pipeline can run.

type ClaudeCredentialKey = "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";

export default function ClaudeSection({
  config,
  onSaved,
}: {
  config: IrisConfig;
  /** A saved credential changes the effective config, which the panel owns. */
  onSaved: (config: IrisConfig) => void;
}) {
  const [claude, setClaude] = useState<TestState & { billing?: string }>({ status: "idle" });
  const [pipelinePrereqs, setPipelinePrereqs] = useState<ClaudeHealth | null>(null);
  // Nothing here installs anything any more; the only write this panel can make
  // outside `.env` is removing what an older Iris left in ~/.claude.
  const [removingLegacy, setRemovingLegacy] = useState(false);
  const [legacyReport, setLegacyReport] = useState<string | null>(null);
  // Files an older Iris wrote into ~/.claude. Iris neither reads nor writes
  // there now, so these are inert — offered for removal, never removed silently.
  const [legacyArtifacts, setLegacyArtifacts] = useState<LegacyClaudeArtifacts | null>(null);
  // The stored token never reaches the renderer, so the input is always empty
  // and `claudeTokenSet` is the only thing we know about it.
  const [claudeToken, setClaudeToken] = useState("");
  const [claudeTokenSet, setClaudeTokenSet] = useState(config.claudeTokenSet);
  const [claudeTokenBusy, setClaudeTokenBusy] = useState(false);
  const [claudeTokenError, setClaudeTokenError] = useState<string | null>(null);
  // The metered alternative, same presence-only contract as the token above.
  // Either credential satisfies the pipeline gate.
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(config.anthropicApiKeySet);

  // Probe the bundled runtime + credential once when the panel opens, so
  // Settings shows current status without an extra click.
  useEffect(() => {
    checkClaude();
    window.iris.getLegacyClaudeArtifacts().then(setLegacyArtifacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkClaude() {
    setClaude({ status: "testing" });
    const health = await window.iris.testClaude();

    // Which credential is actually in use, not just "a token exists" — the two
    // bill differently and the user needs to know which one they're on.
    const billing =
      health.credentialKind === "subscription"
        ? "Subscription token in use — runs bill against your Claude plan."
        : health.credentialKind === "api-key"
          ? "Anthropic API key in use — runs bill per token."
          : health.billingError || "No Claude credential set yet.";

    if (!health.reachable) {
      // A packaging fault, not something the user can install around.
      setClaude({
        status: "error",
        message: health.error || "Iris could not launch its bundled Claude binary.",
        billing,
      });
    } else if (health.pipelineAvailable) {
      // `claude --version` prints "2.1.210 (Claude Code)"; the suffix would read
      // as "Claude 2.1.210 (Claude Code)" here.
      const version = (health.version ?? "").replace(/\s*\(Claude Code\)\s*$/, "").trim();
      setClaude({ status: "ok", message: version ? `Pipeline ready · Claude ${version}` : "Pipeline ready", billing });
    } else {
      // The binary is fine; the pipeline is off only because there's no
      // credential. Reporting "Ready" here would contradict the panel's own
      // "Pipeline off" line directly below it.
      setClaude({ status: "idle", message: undefined, billing });
    }
    setPipelinePrereqs(health);
  }

  // Save/remove share one path across both credentials: on success clear the
  // input, refresh the presence flags, and re-run the Claude check so the
  // billing and availability lines update in place. On refusal (a run is
  // running) keep what the user typed.
  async function applyCredential(action: "save" | "remove", key: ClaudeCredentialKey) {
    const value = key === "CLAUDE_CODE_OAUTH_TOKEN" ? claudeToken : apiKey;
    setClaudeTokenBusy(true);
    setClaudeTokenError(null);
    try {
      const result =
        action === "save"
          ? await window.iris.saveClaudeToken(value.trim(), key)
          : await window.iris.removeClaudeToken(key);
      if (!result.ok) {
        setClaudeTokenError(result.error || "Could not update the credential.");
        return;
      }
      if (key === "CLAUDE_CODE_OAUTH_TOKEN") setClaudeToken("");
      else setApiKey("");
      setClaudeTokenSet(result.config.claudeTokenSet);
      setApiKeySet(result.config.anthropicApiKeySet);
      onSaved(result.config);
      await checkClaude();
    } finally {
      setClaudeTokenBusy(false);
    }
  }

  function applyClaudeToken(action: "save" | "remove") {
    return applyCredential(action, "CLAUDE_CODE_OAUTH_TOKEN");
  }

  // The exact command that mints a subscription token, pointed at Iris's own
  // bundled binary so the user never has to install the CLI. Quoted because the
  // path runs through "Iris.app/Contents/…" and contains spaces.
  const claudeSetupTokenCommand = pipelinePrereqs?.binaryPath
    ? `"${pipelinePrereqs.binaryPath}" setup-token`
    : "claude setup-token";

  async function removeLegacyArtifacts() {
    setRemovingLegacy(true);
    setLegacyReport(null);
    try {
      const result = await window.iris.removeLegacyClaudeArtifacts();
      const parts = [`${result.removed.length} leftover file(s) removed from ~/.claude`];
      if (result.errors.length) parts.push(`${result.errors.length} error(s): ${result.errors.join("; ")}`);
      setLegacyReport(parts.join(", ") + ".");
      setLegacyArtifacts(await window.iris.getLegacyClaudeArtifacts());
    } finally {
      setRemovingLegacy(false);
    }
  }

  return (
    <Section
      title="Claude pipeline (optional)"
      hint="Iris talks to you with just a Gemini key. Claude Code ships inside Iris — adding a Claude credential below additionally unlocks the build pipeline. Recheck any time from here."
    >
      <div className="setup-actions">
        <button className="setup-btn" onClick={checkClaude} disabled={claude.status === "testing"}>
          {claude.status === "testing" ? <Loader2 size={14} className="spin" /> : null}
          Re-check
        </button>
        <TestBadge state={claude} okLabel="Pipeline ready" />
      </div>
      {pipelinePrereqs ? (
        <p className="setup-note">
          {pipelinePrereqs.pipelineAvailable
            ? "Pipeline enabled — the build pipeline and the Work Stream panel are active."
            : pipelinePrereqs.reachable
              ? "Pipeline off — chat-only mode. Add a Claude credential below to unlock the build pipeline."
              : "Pipeline off — Iris could not launch its bundled Claude binary. Reinstalling the app should fix this."}
        </p>
      ) : null}
      {claude.billing ? <p className="setup-note">{claude.billing}</p> : null}
      {/* Credential entry is always available. It used to be hidden behind
          `pipelinePrereqs?.reachable`, which meant the fields did not exist
          until the probe returned — and would stay hidden forever on the one
          machine where the probe fails, i.e. the user who most needs to act. */}
      <>
          <label className="setup-field">
            <span>Subscription token</span>
            <input
              type="password"
              value={claudeToken}
              placeholder={
                claudeTokenSet ? "Token saved — paste a new one to replace it" : "Paste the token the command below prints"
              }
              onChange={(event) => {
                setClaudeToken(event.target.value);
                setClaudeTokenError(null);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <small className="setup-note">
              Bills against your Claude subscription. Iris ships the Claude CLI, so you can generate this without
              installing anything: run <code>{claudeSetupTokenCommand}</code> in Terminal and paste the result here.
              Stored locally only, never shown again.
            </small>
          </label>
          <div className="setup-actions">
            <button
              className="setup-btn"
              onClick={() => applyClaudeToken("save")}
              disabled={claudeTokenBusy || !claudeToken.trim()}
            >
              {claudeTokenBusy ? <Loader2 size={14} className="spin" /> : null}
              Save token
            </button>
            {claudeTokenSet ? (
              <button
                className="setup-btn ghost"
                data-no-dwell
                onClick={() => applyClaudeToken("remove")}
                disabled={claudeTokenBusy}
              >
                Remove
              </button>
            ) : null}
          </div>
          <label className="setup-field">
            <span>Anthropic API key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={apiKeySet ? "Key saved — paste a new one to replace it" : "sk-ant-…"}
              onChange={(event) => {
                setApiKey(event.target.value);
                setClaudeTokenError(null);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <small className="setup-note">
              An alternative to the subscription token, for users without a Claude plan — billed per token from
              console.anthropic.com. Either credential unlocks the pipeline; the subscription token wins when both
              are set.
            </small>
          </label>
          <div className="setup-actions">
            <button
              className="setup-btn"
              onClick={() => applyCredential("save", "ANTHROPIC_API_KEY")}
              disabled={claudeTokenBusy || !apiKey.trim()}
            >
              {claudeTokenBusy ? <Loader2 size={14} className="spin" /> : null}
              Save key
            </button>
            {apiKeySet ? (
              <button
                className="setup-btn ghost"
                data-no-dwell
                onClick={() => applyCredential("remove", "ANTHROPIC_API_KEY")}
                disabled={claudeTokenBusy}
              >
                Remove
              </button>
            ) : null}
          </div>
          {claudeTokenError ? <p className="setup-note">{claudeTokenError}</p> : null}
      </>
      {/* Everything below reports on the bundled runtime and the skills on
          disk, so it only renders once the probe has actually returned. */}
      {pipelinePrereqs ? (
        <>
          <div className="setup-perms">
            <BundledRow label="Claude Code (bundled)" ok={pipelinePrereqs.reachable} detail={pipelinePrereqs.version} />
            <BundledRow
              label="OpenSpec (bundled)"
              ok={pipelinePrereqs.openspecOk}
              detail={pipelinePrereqs.openspecVersion}
              brokenHint={pipelinePrereqs.openspecBrokenHint}
            />
            {/* One row per bundled component, and every row reports the same two
                states: Bundled, or Damaged. There is no row the user can fix by
                installing something — the credential above is the only genuinely
                user-fixable item in this panel. Nor is there an "Iris agents" row:
                the verb personas ship inside the app and are handed to the SDK by
                value, so there is nothing that can be missing. A persona that fails
                to load is a broken bundle, and surfaces as a run failure naming the
                verb. */}
            <BundledRow
              label="Skills & /opsx commands (bundled plugin)"
              ok={pipelinePrereqs.skillsOk}
              detail={pipelinePrereqs.skillsDetail}
              brokenHint={pipelinePrereqs.skillsBrokenHint}
            />
            <BundledRow
              label="Second-brain notes (LLM-Wiki skills)"
              ok={pipelinePrereqs.notesSkillsOk}
              detail="in the bundled plugin"
              brokenHint={pipelinePrereqs.notesSkillsBrokenHint}
            />
          </div>
          {legacyArtifacts && legacyArtifacts.count > 0 ? (
            <>
              <p className="setup-note">
                An older Iris copied {legacyArtifacts.count} file(s) into {legacyArtifacts.dir}. Iris no longer reads
                or writes there — its skills and personas ship inside the app — so these are leftovers you can safely
                remove. Nothing else in that folder is touched.
              </p>
              <div className="setup-actions">
                <button className="setup-btn ghost" onClick={removeLegacyArtifacts} disabled={removingLegacy}>
                  {removingLegacy ? <Loader2 size={14} className="spin" /> : null}
                  Remove leftovers
                </button>
              </div>
            </>
          ) : null}
          {legacyReport ? <p className="setup-note">{legacyReport}</p> : null}
        </>
      ) : null}
    </Section>
  );
}
