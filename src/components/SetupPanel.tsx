import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mic,
  Play,
  Wand2,
  X,
} from "lucide-react";
import { SYSTEM_DEFAULT_MIC } from "../lib/mic-device";
import { acceleratorParts } from "../lib/accelerator-label";
import Keycaps from "./Keycaps";

type Mode = "onboarding" | "settings";
type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };
type PermState = "idle" | "granted" | "denied";

type Draft = {
  GEMINI_API_KEY: string;
  GEMINI_LIVE_MODEL: string;
  GEMINI_LIVE_VOICE: string;
  IRIS_USER_NAME: string;
  IRIS_LOAD_TEST_DATA: string;
  IRIS_WAKE_WORD: string;
  IRIS_WAKE_THRESHOLD: string;
  IRIS_ENABLE_GOOGLE_SEARCH: string;
};

const WIZARD_STEPS = ["welcome", "gemini", "claude", "you", "permissions", "finish"] as const;

const SYSTEM_DEFAULT_CAMERA = "default";

// Wake-word sensitivity presets (design D5) — anchored to the values the code
// itself recorded: 0.10 caused false wakes, 0.18 missed too much, 0.15 is
// today's shipped compromise. A raw 0-1 float invites values that make the
// feature useless in either direction, so the panel offers only these three.
const WAKE_THRESHOLD_PRESETS: Option[] = [
  { value: "0.18", label: "Strict" },
  { value: "0.15", label: "Balanced" },
  { value: "0.11", label: "Sensitive" },
];

export default function SetupPanel({
  mode,
  config,
  soundsEnabled,
  onToggleSounds,
  webglHighFidelity,
  onToggleWebglQuality,
  ambientCaptureEnabled,
  onToggleAmbientCapture,
  ambientCaptureForcedOff,
  cameraDeviceId,
  onChangeCameraDevice,
  micDeviceId,
  onChangeMicDevice,
  onClose,
  onSaved,
  onStart,
  onRunWizard,
}: {
  mode: Mode;
  config: IrisConfig;
  soundsEnabled: boolean;
  onToggleSounds: () => void;
  /** webgl-quality-mode: Off (light path, default) / On (high-fidelity). */
  webglHighFidelity: boolean;
  onToggleWebglQuality: () => void;
  /** ambient-memory: the PREFERENCE only — off by default (design D1). */
  ambientCaptureEnabled: boolean;
  onToggleAmbientCapture: () => void;
  /** IRIS_AMBIENT_CAPTURE=off (design D3): the row is not offered at all. */
  ambientCaptureForcedOff: boolean;
  cameraDeviceId: string;
  onChangeCameraDevice: (deviceId: string) => void;
  micDeviceId: string;
  onChangeMicDevice: (deviceId: string) => void;
  onClose: () => void;
  onSaved: (config: IrisConfig) => void;
  onStart?: () => void;
  onRunWizard?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    // The stored key never reaches the renderer (design D11, mirrors the PO
    // token below), so the input always starts empty regardless of whether a
    // key is already configured — see `geminiApiKeySet`.
    GEMINI_API_KEY: "",
    GEMINI_LIVE_MODEL: config.geminiModel,
    GEMINI_LIVE_VOICE: config.geminiVoice,
    IRIS_USER_NAME: config.userName,
    IRIS_LOAD_TEST_DATA: config.loadTestData ? "true" : "false",
    IRIS_WAKE_WORD: config.wakeWord ? "true" : "false",
    IRIS_WAKE_THRESHOLD: String(config.wakeThreshold),
    IRIS_ENABLE_GOOGLE_SEARCH: config.googleSearch ? "true" : "false",
  });
  const [step, setStep] = useState(0);
  const [gemini, setGemini] = useState<TestState>({ status: "idle" });
  const [claude, setClaude] = useState<TestState & { billing?: string }>({ status: "idle" });
  const [pipelinePrereqs, setPipelinePrereqs] = useState<ClaudeHealth | null>(null);
  // Nothing here installs anything any more; the only write this panel can make
  // outside `.env` is removing what an older Iris left in ~/.claude.
  const [removingLegacy, setRemovingLegacy] = useState(false);
  const [legacyReport, setLegacyReport] = useState<string | null>(null);
  // Files an older Iris wrote into ~/.claude. Iris neither reads nor writes
  // there now, so these are inert — offered for removal, never removed silently.
  const [legacyArtifacts, setLegacyArtifacts] = useState<LegacyClaudeArtifacts | null>(null);
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(config.geminiApiKeySet);
  // The stored token never reaches the renderer, so the input is always empty
  // and `poTokenSet` is the only thing we know about it.
  const [poToken, setPoToken] = useState("");
  const [poTokenSet, setPoTokenSet] = useState(config.poTokenSet);
  const [poTokenBusy, setPoTokenBusy] = useState(false);
  const [poTokenError, setPoTokenError] = useState<string | null>(null);
  // The metered alternative, same presence-only contract as the token above.
  // Either credential satisfies the pipeline gate.
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(config.anthropicApiKeySet);
  const [preview, setPreview] = useState<TestState>({ status: "idle" });
  const [mic, setMic] = useState<PermState>("idle");
  const [cam, setCam] = useState<PermState>("idle");
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  // Reflect the OS/browser's actual permission state so previously-granted mic or
  // camera shows as "Granted" instead of asking again every time Settings opens.
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    const toState = (state: PermissionState): PermState =>
      state === "granted" ? "granted" : state === "denied" ? "denied" : "idle";

    const watch = async (name: "microphone" | "camera", setter: (value: PermState) => void) => {
      try {
        const status = await navigator.permissions.query({ name: name as PermissionName });
        if (cancelled) return;
        setter(toState(status.state));
        status.onchange = () => setter(toState(status.state));
      } catch {
        // Some platforms don't support querying these names; leave as idle.
      }
    };

    watch("microphone", setMic);
    watch("camera", setCam);
    return () => {
      cancelled = true;
    };
  }, []);

  // Device labels only come through once camera permission is granted, so the
  // picker stays empty/hidden until then. While granted, keep the list live so
  // a device that appears or disappears at runtime (e.g. starting OBS Virtual
  // Camera) shows up without reopening Settings.
  useEffect(() => {
    if (cam !== "granted") {
      setCamDevices([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCamDevices(devices.filter((device) => device.kind === "videoinput"));
      } catch {
        // Leave the list as-is; enumeration can fail transiently.
      }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [cam]);

  // Same live-refresh pattern as the camera list above, filtered to audio
  // input devices and gated on Microphone permission instead of Camera.
  useEffect(() => {
    if (mic !== "granted") {
      setMicDevices([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setMicDevices(devices.filter((device) => device.kind === "audioinput"));
      } catch {
        // Leave the list as-is; enumeration can fail transiently.
      }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [mic]);

  // Probe the bundled runtime + credential once when the panel opens, so
  // Settings shows current status without an extra click.
  useEffect(() => {
    checkClaude();
    window.iris.getLegacyClaudeArtifacts().then(setLegacyArtifacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function testGemini() {
    setGemini({ status: "testing" });
    const result = await window.iris.testGemini(draft.GEMINI_API_KEY.trim());
    setGemini(result.ok ? { status: "ok", message: "Key works." } : { status: "error", message: result.error });
  }

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
  // billing and availability lines update in place. On refusal (a PO turn is
  // running) keep what the user typed.
  async function applyCredential(action: "save" | "remove", key: ClaudeCredentialKey) {
    const value = key === "CLAUDE_CODE_OAUTH_TOKEN" ? poToken : apiKey;
    setPoTokenBusy(true);
    setPoTokenError(null);
    try {
      const result =
        action === "save"
          ? await window.iris.savePoToken(value.trim(), key)
          : await window.iris.removePoToken(key);
      if (!result.ok) {
        setPoTokenError(result.error || "Could not update the credential.");
        return;
      }
      if (key === "CLAUDE_CODE_OAUTH_TOKEN") setPoToken("");
      else setApiKey("");
      setPoTokenSet(result.config.poTokenSet);
      setApiKeySet(result.config.anthropicApiKeySet);
      onSaved(result.config);
      await checkClaude();
    } finally {
      setPoTokenBusy(false);
    }
  }

  function applyPoToken(action: "save" | "remove") {
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

  async function doPreview() {
    setPreview({ status: "testing" });
    const result = await window.iris.previewVoice({
      voice: draft.GEMINI_LIVE_VOICE,
      key: draft.GEMINI_API_KEY.trim(),
    });
    setPreview(result.ok ? { status: "idle" } : { status: "error", message: result.error });
  }

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMic("granted");
    } catch {
      setMic("denied");
    }
  }

  async function requestCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setCam("granted");
    } catch {
      setCam("denied");
    }
  }

  // A save can be refused (e.g. a control character in a value, see
  // config-persistence) — surface that instead of failing silently, and
  // don't close the panel or advance the wizard on refusal.
  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await window.iris.saveConfig({ ...draft });
      onSaved(updated);
      setGeminiApiKeySet(updated.geminiApiKeySet);
      return updated;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function finishWizard() {
    const updated = await save();
    if (!updated) return;
    onClose();
    onStart?.();
  }

  // A stored key (geminiApiKeySet) satisfies readiness even with the input
  // left empty — onboarding never has a stored key yet, so this reduces to
  // "typed a key" there exactly as before; settings additionally allows
  // testing/saving with the field empty when a key is already configured.
  const keyReady = draft.GEMINI_API_KEY.trim().length > 0 || geminiApiKeySet;

  // ---- Section renderers (shared between wizard steps and settings) ----
  const geminiSection = (
    <Section title="Gemini API key" hint="Powers Iris's realtime voice. Get one free at Google AI Studio.">
      <label className="setup-field">
        <span>API key</span>
        <input
          type="password"
          value={draft.GEMINI_API_KEY}
          placeholder={geminiApiKeySet ? "Key saved — paste a new one to replace it" : "AI… paste your key"}
          onChange={(event) => {
            set("GEMINI_API_KEY", event.target.value);
            setGemini({ status: "idle" });
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <small className="setup-note">
          Get a free key from{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          , then paste the whole thing. Stored locally only, never shown again.
          {geminiApiKeySet ? " A key is currently configured." : ""}
        </small>
      </label>
      <div className="setup-actions">
        <button className="setup-btn" onClick={testGemini} disabled={!keyReady || gemini.status === "testing"}>
          {gemini.status === "testing" ? <Loader2 size={14} className="spin" /> : null}
          Test Gemini
        </button>
        <TestBadge state={gemini} okLabel="Key works" />
      </div>
      <label className="setup-field">
        <span>Google Search</span>
        <ThemedSelect
          ariaLabel="Google Search"
          value={draft.IRIS_ENABLE_GOOGLE_SEARCH}
          options={[
            { value: "false", label: "Off" },
            { value: "true", label: "On" },
          ]}
          onChange={(value) => set("IRIS_ENABLE_GOOGLE_SEARCH", value)}
        />
        <small className="setup-note">
          Lets Iris search the web directly for quick facts. Needs a paid Gemini key — on a free-tier key, enabling
          this disconnects the live session with a 1011 quota error. Applies on the next reconnect (no need to
          restart Iris).
        </small>
      </label>
    </Section>
  );

  const claudeSection = (
    <Section
      title="Claude pipeline (optional)"
      hint="Iris talks to you with just a Gemini key. Claude Code ships inside Iris — adding a Claude credential below additionally unlocks the PO/DEV build pipeline. Recheck any time from here."
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
            ? "Pipeline enabled — PO/DEV tools and the Work Stream panel are active."
            : pipelinePrereqs.reachable
              ? "Pipeline off — chat-only mode. Add a Claude credential below to unlock PO/DEV."
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
              value={poToken}
              placeholder={
                poTokenSet ? "Token saved — paste a new one to replace it" : "Paste the token the command below prints"
              }
              onChange={(event) => {
                setPoToken(event.target.value);
                setPoTokenError(null);
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
              onClick={() => applyPoToken("save")}
              disabled={poTokenBusy || !poToken.trim()}
            >
              {poTokenBusy ? <Loader2 size={14} className="spin" /> : null}
              Save token
            </button>
            {poTokenSet ? (
              <button
                className="setup-btn ghost"
                data-no-dwell
                onClick={() => applyPoToken("remove")}
                disabled={poTokenBusy}
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
                setPoTokenError(null);
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
              disabled={poTokenBusy || !apiKey.trim()}
            >
              {poTokenBusy ? <Loader2 size={14} className="spin" /> : null}
              Save key
            </button>
            {apiKeySet ? (
              <button
                className="setup-btn ghost"
                data-no-dwell
                onClick={() => applyCredential("remove", "ANTHROPIC_API_KEY")}
                disabled={poTokenBusy}
              >
                Remove
              </button>
            ) : null}
          </div>
          {poTokenError ? <p className="setup-note">{poTokenError}</p> : null}
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

  const youSection = (
    <Section title="You & voice" hint="How Iris addresses you and which voice it speaks with.">
      <label className="setup-field">
        <span>Display name</span>
        <input
          value={draft.IRIS_USER_NAME}
          placeholder="Your name"
          onChange={(event) => set("IRIS_USER_NAME", event.target.value)}
          spellCheck={false}
        />
        <small className="setup-note">What Iris calls you out loud, e.g. “Alex”.</small>
      </label>
      <label className="setup-field">
        <span>Voice</span>
        <div className="setup-inline">
          <ThemedSelect
            ariaLabel="Voice"
            value={draft.GEMINI_LIVE_VOICE}
            options={config.voices.map((voice) => ({ value: voice, label: voice }))}
            onChange={(value) => {
              set("GEMINI_LIVE_VOICE", value);
              setPreview({ status: "idle" });
            }}
          />
          <button
            className="setup-btn ghost"
            onClick={doPreview}
            disabled={!keyReady || preview.status === "testing"}
            title={keyReady ? "Preview this voice" : "Add your Gemini key first"}
          >
            {preview.status === "testing" ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            Preview
          </button>
        </div>
        <small className="setup-note">Iris's speaking voice. Tap Preview to hear a sample (needs a saved Gemini key).</small>
      </label>
      {preview.status === "error" ? <p className="setup-error">{preview.message}</p> : null}
      <label className="setup-field">
        <span>Model</span>
        <ThemedSelect
          ariaLabel="Model"
          value={draft.GEMINI_LIVE_MODEL}
          options={config.models.map((model) => ({ value: model, label: model.replace(/^models\//, "") }))}
          onChange={(value) => set("GEMINI_LIVE_MODEL", value)}
        />
        <small className="setup-note">Gemini Live model that powers realtime voice. Keep the default unless you have a reason to change it.</small>
      </label>
      <label className="setup-field">
        <span>Wake word — “Hey Iris”</span>
        <ThemedSelect
          ariaLabel="Wake word"
          value={draft.IRIS_WAKE_WORD}
          options={[
            { value: "false", label: "Off" },
            { value: "true", label: "On" },
          ]}
          onChange={(value) => set("IRIS_WAKE_WORD", value)}
        />
        <small className="setup-note">
          When on, Iris listens locally for “Hey Iris” and wakes hands-free (same as pressing W). Runs fully on-device —
          no audio leaves your machine. Needs microphone permission.
        </small>
      </label>
      <label className="setup-field">
        <span>Wake-word sensitivity</span>
        <ThemedSelect
          ariaLabel="Wake-word sensitivity"
          value={draft.IRIS_WAKE_THRESHOLD}
          options={
            WAKE_THRESHOLD_PRESETS.some((preset) => preset.value === draft.IRIS_WAKE_THRESHOLD)
              ? WAKE_THRESHOLD_PRESETS
              : [...WAKE_THRESHOLD_PRESETS, { value: draft.IRIS_WAKE_THRESHOLD, label: "Custom" }]
          }
          onChange={(value) => set("IRIS_WAKE_THRESHOLD", value)}
          disabled={draft.IRIS_WAKE_WORD !== "true"}
        />
        <small className="setup-note">
          Strict wakes less easily (fewer false wakes, may miss quieter “Hey Iris”). Sensitive wakes more easily. A
          hand-edited value outside these three shows as Custom and is left alone unless you pick a level here.
        </small>
      </label>
      <label className="setup-field">
        <span>Interface sounds</span>
        <ThemedSelect
          ariaLabel="Interface sounds"
          value={soundsEnabled ? "true" : "false"}
          options={[
            { value: "true", label: "On" },
            { value: "false", label: "Off" },
          ]}
          onChange={(value) => {
            if ((value === "true") !== soundsEnabled) onToggleSounds();
          }}
        />
        <small className="setup-note">
          Subtle audio cues for wake, sleep, task sent, and task done. Synthesized locally — quiet by design.
        </small>
      </label>
      <label className="setup-field">
        <span>WebGL quality</span>
        <ThemedSelect
          ariaLabel="WebGL quality"
          value={webglHighFidelity ? "true" : "false"}
          options={[
            { value: "false", label: "Off" },
            { value: "true", label: "On" },
          ]}
          onChange={(value) => {
            if ((value === "true") !== webglHighFidelity) onToggleWebglQuality();
          }}
        />
        <small className="setup-note">
          On restores full visual effects (bloom, sharper rendering) at a materially higher GPU cost. Off by
          default so Iris runs smoothly on a modest machine. Applies immediately — no Save, no relaunch.
        </small>
      </label>
      {ambientCaptureForcedOff ? null : (
        <label className="setup-field">
          <span>Ambient session capture — retains a transcript of speech near the microphone, which may include other people</span>
          <ThemedSelect
            ariaLabel="Ambient session capture"
            value={ambientCaptureEnabled ? "true" : "false"}
            options={[
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ]}
            onChange={(value) => {
              if ((value === "true") !== ambientCaptureEnabled) onToggleAmbientCapture();
            }}
          />
          <small className="setup-note">
            Off by default. When on, ordinary conversation — text only, never audio, and only while Iris is awake
            and listening — is saved into your second brain, so it accumulates from what you already talk about
            instead of only from deliberate notes. A recording indicator with a stop button appears whenever this
            is actually retaining. Applies immediately — no Save, no relaunch.
          </small>
        </label>
      )}
    </Section>
  );

  const cameraOptions: Option[] = [{ value: SYSTEM_DEFAULT_CAMERA, label: "System Default" }].concat(
    camDevices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    })),
  );
  const cameraSelectionMissing =
    cameraDeviceId !== SYSTEM_DEFAULT_CAMERA && !camDevices.some((device) => device.deviceId === cameraDeviceId);
  if (cameraSelectionMissing) {
    cameraOptions.push({ value: cameraDeviceId, label: "Previously selected camera (unavailable)" });
  }

  const micOptions: Option[] = [{ value: SYSTEM_DEFAULT_MIC, label: "System Default" }].concat(
    micDevices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    })),
  );
  // Unlike the camera list, this entry is self-correcting: once either mic
  // consumer actually tries to open the missing device it auto-falls-back to
  // System Default and App.tsx reconciles micDeviceId to match, at which
  // point this condition stops matching on its own — no extra "already
  // corrected" flag needed.
  const micSelectionMissing =
    micDeviceId !== SYSTEM_DEFAULT_MIC && !micDevices.some((device) => device.deviceId === micDeviceId);
  if (micSelectionMissing) {
    micOptions.push({ value: micDeviceId, label: "Previously selected microphone (unavailable)" });
  }

  const permissionsSection = (
    <Section title="Permissions" hint="Iris needs your mic to hear you. Camera is optional (hand gestures).">
      <div className="setup-perms">
        <PermRow icon={<Mic size={16} />} label="Microphone" required state={mic} onRequest={requestMic} />
        <PermRow icon={<Camera size={16} />} label="Camera (gestures)" state={cam} onRequest={requestCam} />
      </div>
      <label className="setup-field">
        <span>Microphone</span>
        {mic === "granted" ? (
          <ThemedSelect
            ariaLabel="Microphone"
            value={micDeviceId}
            options={micOptions}
            onChange={onChangeMicDevice}
          />
        ) : (
          <p className="setup-note">Grant Microphone permission above to choose a specific device.</p>
        )}
        <small className="setup-note">
          Governs both voice conversation and local “Hey Iris” wake-word listening — pick a specific device (e.g. a
          USB mic) instead of the system default. Applies immediately to whichever is currently listening. If the
          chosen device fails or is unplugged, Iris automatically falls back to System Default rather than going
          silent.
        </small>
      </label>
      <label className="setup-field">
        <span>Gesture camera</span>
        {cam === "granted" ? (
          <ThemedSelect
            ariaLabel="Gesture camera"
            value={cameraDeviceId}
            options={cameraOptions}
            onChange={onChangeCameraDevice}
          />
        ) : (
          <p className="setup-note">Grant Camera permission above to choose a specific device.</p>
        )}
        <small className="setup-note">
          Which camera gesture control reads from — pick a specific device (e.g. OBS Virtual Camera) instead of the
          system default. Applies immediately, including while gesture control is running.
        </small>
      </label>
    </Section>
  );

  const advancedSection = (
    <Section title="Advanced" hint="Demo data lets you explore Iris without dispatching real Claude work.">
      <label className="setup-field">
        <span>Load demo / test data</span>
        <ThemedSelect
          ariaLabel="Load demo data"
          value={draft.IRIS_LOAD_TEST_DATA}
          options={[
            { value: "false", label: "Off" },
            { value: "true", label: "On" },
          ]}
          onChange={(value) => set("IRIS_LOAD_TEST_DATA", value)}
        />
        <small className="setup-note">Fills the Work Stream with sample task cards for exploring the UI. Turn off for normal use.</small>
      </label>
    </Section>
  );

  // ---- Settings mode: everything in one scroll ----
  if (mode === "settings") {
    return (
      <div className="setup-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
        <div className="setup-card settings">
          <header className="setup-head">
            <span>Settings</span>
            <button className="reader-close" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </header>
          <div className="setup-scroll">
            {geminiSection}
            {claudeSection}
            {youSection}
            {permissionsSection}
            {advancedSection}
            <p className="setup-path">Saved to {config.configPath}</p>
            {saveError ? <p className="setup-note">{saveError}</p> : null}
          </div>
          <footer className="setup-foot">
            <button className="setup-btn ghost" onClick={() => onRunWizard?.()}>
              <Wand2 size={14} />
              Run setup wizard
            </button>
            <div className="setup-foot-right">
              <button className="setup-btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="setup-btn primary"
                onClick={async () => {
                  const updated = await save();
                  if (updated) onClose();
                }}
                disabled={saving}
              >
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                Save
              </button>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // ---- Onboarding mode: step-by-step wizard ----
  const current = WIZARD_STEPS[step];
  let body: ReactNode = null;
  if (current === "welcome") {
    body = (
      <div className="setup-welcome">
        <h2>Welcome to Iris</h2>
        <p>
          Iris is a hands-free voice companion — add a Gemini key and start talking. Claude Code ships inside
          Iris, so adding a Claude credential also unlocks an optional PO/DEV build pipeline for real work —
          with nothing else to install. Let's get you set up in under a minute.
        </p>
      </div>
    );
  } else if (current === "gemini") {
    body = geminiSection;
  } else if (current === "claude") {
    body = claudeSection;
  } else if (current === "you") {
    body = youSection;
  } else if (current === "permissions") {
    body = permissionsSection;
  } else {
    body = (
      <div className="setup-welcome">
        <h2>You're all set</h2>
        {acceleratorParts(config.wakeHotkey).length > 0 && acceleratorParts(config.sleepHotkey).length > 0 ? (
          <p>
            Iris will save your settings and wake up. Press <Keycaps accelerator={config.wakeHotkey} /> any time to
            wake, <Keycaps accelerator={config.sleepHotkey} /> to sleep — from any app, even when Iris isn't in front.
          </p>
        ) : (
          // A chord that can't be rendered is one we can't promise fires, so
          // the guidance names no key rather than a wrong one.
          <p>Iris will save your settings and wake up.</p>
        )}
        <ul className="setup-summary">
          <li>
            Gemini key {gemini.status === "ok" ? <Check size={13} className="ok" /> : keyReady ? "added" : "missing"}
          </li>
          <li>Voice · {draft.GEMINI_LIVE_VOICE}</li>
          <li>Name · {draft.IRIS_USER_NAME || "(not set)"}</li>
          <li>Mic · {mic === "granted" ? "granted" : "ask on start"}</li>
        </ul>
      </div>
    );
  }

  const isFirst = step === 0;
  const isLast = step === WIZARD_STEPS.length - 1;
  const canNext = current === "gemini" ? keyReady : true;

  return (
    <div className="setup-backdrop">
      <div className="setup-card wizard">
        <header className="setup-head">
          <span>Setup · {step + 1}/{WIZARD_STEPS.length}</span>
          <div className="setup-progress">
            {WIZARD_STEPS.map((name, index) => (
              <i key={name} className={index <= step ? "on" : ""} />
            ))}
          </div>
          <button className="reader-close" onClick={onClose} title="Close (configure later)">
            <X size={16} />
          </button>
        </header>
        <div className="setup-scroll">
          {body}
          {isLast && saveError ? <p className="setup-note">{saveError}</p> : null}
        </div>
        <footer className="setup-foot">
          <button className="setup-btn ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={isFirst}>
            <ChevronLeft size={14} />
            Back
          </button>
          {isLast ? (
            <button className="setup-btn primary" onClick={finishWizard} disabled={saving || !keyReady}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              Save &amp; Start Iris
            </button>
          ) : (
            <button
              className="setup-btn primary"
              onClick={() => setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}
              disabled={!canNext}
            >
              {isFirst ? "Get started" : "Next"}
              <ChevronRight size={14} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

type Option = { value: string; label: string };

// Fully themed dropdown (native <select> popups can't be styled to match on macOS).
// The menu is position:fixed off the trigger rect so the panel's scroll/overflow
// never clips it.
function ThemedSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (btnRef.current?.contains(target) || target.closest(".ts-menu")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Close when the page/panel scrolls, but NOT when scrolling inside the menu.
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === "function" && target.closest(".ts-menu")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuMax = 260;
    const dropUp = rect.bottom + menuMax > window.innerHeight && rect.top > window.innerHeight - rect.bottom;
    setPos({
      left: rect.left,
      width: rect.width,
      ...(dropUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
    setOpen(true);
  }

  return (
    <div className={`ts ${disabled ? "disabled" : ""}`}>
      <button
        ref={btnRef}
        type="button"
        className={`ts-trigger ${open ? "open" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="ts-value">{current?.label ?? value}</span>
        <ChevronDown size={14} className="ts-chev" />
      </button>
      {open && pos ? (
        <div
          className="ts-menu"
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`ts-option ${option.value === value ? "sel" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="setup-section">
      <h3>{title}</h3>
      {hint ? <p className="setup-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

function TestBadge({ state, okLabel }: { state: TestState; okLabel: string }) {
  if (state.status === "ok") {
    return (
      <span className="setup-result ok">
        <Check size={13} />
        {state.message || okLabel}
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="setup-result err" title={state.message}>
        <X size={13} />
        {state.message || "Failed"}
      </span>
    );
  }
  return null;
}

// Status row for anything that ships *inside* the app — which is now everything
// this panel reports except the credential. There is no command the user could
// run to fix a failure here, so the row never offers one: a copyable "install"
// hint for a bundled component would be actively misleading. A failure means a
// damaged bundle, and the row says exactly that (Bundled / Damaged).
//
// This used to be one of two row components. The other reported the same
// `skillsOk` field under a "Global skills" label and offered a "Copy install
// command" button, from when skills really did live in the user's ~/.claude — so
// the panel showed one state twice, once saying "install these" and once saying
// "Bundled". This row is the only one now.
function BundledRow({
  label,
  ok,
  detail,
  brokenHint,
}: {
  label: string;
  ok: boolean;
  detail?: string;
  brokenHint?: string;
}) {
  return (
    <div className={`setup-perm ${ok ? "granted" : "denied"}`}>
      <span className="perm-label">
        {label}
        {ok && detail ? <em>{detail}</em> : null}
        {!ok && brokenHint ? <em>{brokenHint}</em> : null}
      </span>
      <span className={`setup-result ${ok ? "ok" : "err"}`}>
        {ok ? <Check size={13} /> : <X size={13} />}
        {ok ? "Bundled" : "Damaged"}
      </span>
    </div>
  );
}

function PermRow({
  icon,
  label,
  required,
  state,
  onRequest,
}: {
  icon: ReactNode;
  label: string;
  required?: boolean;
  state: PermState;
  onRequest: () => void;
}) {
  return (
    <div className={`setup-perm ${state}`}>
      <span className="perm-icon">{icon}</span>
      <span className="perm-label">
        {label}
        {required ? <em>required</em> : <em>optional</em>}
      </span>
      {state === "granted" ? (
        <span className="setup-result ok">
          <Check size={13} />
          Granted
        </span>
      ) : (
        <button className="setup-btn ghost" onClick={onRequest}>
          {state === "denied" ? "Retry" : "Allow"}
        </button>
      )}
    </div>
  );
}
