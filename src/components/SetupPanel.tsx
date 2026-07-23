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
};

const WIZARD_STEPS = ["welcome", "gemini", "claude", "you", "permissions", "finish"] as const;

const SYSTEM_DEFAULT_CAMERA = "default";

export default function SetupPanel({
  mode,
  config,
  soundsEnabled,
  onToggleSounds,
  cameraDeviceId,
  onChangeCameraDevice,
  onClose,
  onSaved,
  onStart,
  onRunWizard,
}: {
  mode: Mode;
  config: IrisConfig;
  soundsEnabled: boolean;
  onToggleSounds: () => void;
  cameraDeviceId: string;
  onChangeCameraDevice: (deviceId: string) => void;
  onClose: () => void;
  onSaved: (config: IrisConfig) => void;
  onStart?: () => void;
  onRunWizard?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    GEMINI_API_KEY: config.geminiApiKey,
    GEMINI_LIVE_MODEL: config.geminiModel,
    GEMINI_LIVE_VOICE: config.geminiVoice,
    IRIS_USER_NAME: config.userName,
    IRIS_LOAD_TEST_DATA: config.loadTestData ? "true" : "false",
    IRIS_WAKE_WORD: config.wakeWord ? "true" : "false",
  });
  const [step, setStep] = useState(0);
  const [gemini, setGemini] = useState<TestState>({ status: "idle" });
  const [claude, setClaude] = useState<TestState & { billing?: string }>({ status: "idle" });
  const [pipelinePrereqs, setPipelinePrereqs] = useState<ClaudeHealth | null>(null);
  const [installingPrereqs, setInstallingPrereqs] = useState(false);
  const [installReport, setInstallReport] = useState<string | null>(null);
  // The stored token never reaches the renderer, so the input is always empty
  // and `poTokenSet` is the only thing we know about it.
  const [poToken, setPoToken] = useState("");
  const [poTokenSet, setPoTokenSet] = useState(config.poTokenSet);
  const [poTokenBusy, setPoTokenBusy] = useState(false);
  const [poTokenError, setPoTokenError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TestState>({ status: "idle" });
  const [mic, setMic] = useState<PermState>("idle");
  const [cam, setCam] = useState<PermState>("idle");
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [saving, setSaving] = useState(false);

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

  // Run the Claude CLI + subscription-billing check once when the panel opens
  // so Settings mode shows current status without an extra click.
  useEffect(() => {
    checkClaude();
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
    const billing = health.billingOk
      ? "Subscription token found — PO bills against your Claude subscription."
      : health.billingError || "No CLAUDE_CODE_OAUTH_TOKEN set — PO turns will fail until you run `claude setup-token`.";
    if (health.reachable) {
      setClaude({ status: "ok", message: health.version ? `Ready · ${health.version}` : "Ready", billing });
    } else {
      setClaude({ status: "error", message: health.error || "Claude CLI not found.", billing });
    }
    setPipelinePrereqs(health);
  }

  // Save/remove share one path: on success clear the input, refresh the
  // presence flag, and re-run the Claude check so the billing line updates in
  // place. On refusal (a PO turn is running) keep what the user typed.
  async function applyPoToken(action: "save" | "remove") {
    setPoTokenBusy(true);
    setPoTokenError(null);
    try {
      const result =
        action === "save" ? await window.iris.savePoToken(poToken.trim()) : await window.iris.removePoToken();
      if (!result.ok) {
        setPoTokenError(result.error || "Could not update the token.");
        return;
      }
      setPoToken("");
      setPoTokenSet(result.config.poTokenSet);
      onSaved(result.config);
      await checkClaude();
    } finally {
      setPoTokenBusy(false);
    }
  }

  async function installMissingPrereqs() {
    setInstallingPrereqs(true);
    setInstallReport(null);
    try {
      const report = await window.iris.installPipelinePrereqs();
      const parts = [
        `${report.agents.installed.length} agent${report.agents.installed.length === 1 ? "" : "s"} installed`,
        `${report.installedSkills.length} skill${report.installedSkills.length === 1 ? "" : "s"} installed`,
        `${report.installedCommands.length} command${report.installedCommands.length === 1 ? "" : "s"} installed`,
      ];
      if (report.errors.length) parts.push(`${report.errors.length} error(s): ${report.errors.join("; ")}`);
      setInstallReport(parts.join(", ") + ".");
    } finally {
      setInstallingPrereqs(false);
      await checkClaude();
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

  async function save() {
    setSaving(true);
    const updated = await window.iris.saveConfig({ ...draft });
    setSaving(false);
    onSaved(updated);
    return updated;
  }

  async function finishWizard() {
    await save();
    onClose();
    onStart?.();
  }

  const keyReady = draft.GEMINI_API_KEY.trim().length > 0;

  // ---- Section renderers (shared between wizard steps and settings) ----
  const geminiSection = (
    <Section title="Gemini API key" hint="Powers Iris's realtime voice. Get one free at Google AI Studio.">
      <label className="setup-field">
        <span>API key</span>
        <input
          type="password"
          value={draft.GEMINI_API_KEY}
          placeholder="AI… paste your key"
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
          , then paste the whole thing. Stored locally only.
        </small>
      </label>
      <div className="setup-actions">
        <button className="setup-btn" onClick={testGemini} disabled={!keyReady || gemini.status === "testing"}>
          {gemini.status === "testing" ? <Loader2 size={14} className="spin" /> : null}
          Test Gemini
        </button>
        <TestBadge state={gemini} okLabel="Key works" />
      </div>
    </Section>
  );

  const claudeSection = (
    <Section
      title="Claude pipeline (optional)"
      hint="Iris talks to you with just a Gemini key. Installing the Claude Code CLI additionally unlocks the PO/DEV build pipeline — recheck any time from here."
    >
      <div className="setup-actions">
        <button className="setup-btn" onClick={checkClaude} disabled={claude.status === "testing"}>
          {claude.status === "testing" ? <Loader2 size={14} className="spin" /> : null}
          Check Claude
        </button>
        <TestBadge state={claude} okLabel="Ready" />
      </div>
      {pipelinePrereqs ? (
        <p className="setup-note">
          {pipelinePrereqs.pipelineAvailable
            ? "Pipeline enabled — PO/DEV tools and the Work Stream panel are active."
            : "Pipeline off — chat-only mode. Install the Claude Code CLI, then recheck, to unlock PO/DEV."}
        </p>
      ) : null}
      {claude.billing ? <p className="setup-note">{claude.billing}</p> : null}
      {pipelinePrereqs?.reachable ? (
        <>
          <label className="setup-field">
            <span>Subscription token</span>
            <input
              type="password"
              value={poToken}
              placeholder={
                poTokenSet ? "Token saved — paste a new one to replace it" : "Paste the output of `claude setup-token`"
              }
              onChange={(event) => {
                setPoToken(event.target.value);
                setPoTokenError(null);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <small className="setup-note">
              Run <code>claude setup-token</code> in a terminal and paste the token here so PO bills against your
              Claude subscription. Stored locally only, never shown again.
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
          {poTokenError ? <p className="setup-note">{poTokenError}</p> : null}
          <div className="setup-perms">
            <PrereqRow
              label="openspec CLI"
              ok={pipelinePrereqs.openspecOk}
              okDetail={pipelinePrereqs.openspecVersion}
              installHint={pipelinePrereqs.openspecInstallHint}
            />
            <PrereqRow
              label="Global skills (OpenSpec + Grill Me/TDD/code-review)"
              ok={pipelinePrereqs.skillsOk}
              okDetail={pipelinePrereqs.skillsOk ? undefined : `missing: ${pipelinePrereqs.missingSkills.join(", ")}`}
              installHint={pipelinePrereqs.skillsInstallHint}
            />
            <PrereqRow
              label="Iris agents (PO/DEV personas)"
              ok={pipelinePrereqs.agentsOk}
              okDetail={pipelinePrereqs.agentsOk ? undefined : `missing: ${pipelinePrereqs.missingAgents.join(", ")}`}
              installHint='Use "Install missing" below, or the Install agents button on the pipeline bar.'
            />
            <PrereqRow
              label="Second-brain notes (LLM-Wiki skills)"
              ok={pipelinePrereqs.notesSkillsOk}
              okDetail={
                pipelinePrereqs.notesSkillsOk ? undefined : `missing: ${pipelinePrereqs.missingNotesSkills.join(", ")}`
              }
              installHint={pipelinePrereqs.notesSkillsInstallHint}
            />
          </div>
          {!pipelinePrereqs.openspecOk ||
          !pipelinePrereqs.skillsOk ||
          !pipelinePrereqs.agentsOk ||
          !pipelinePrereqs.notesSkillsOk ? (
            <div className="setup-actions">
              <button className="setup-btn" onClick={installMissingPrereqs} disabled={installingPrereqs}>
                {installingPrereqs ? <Loader2 size={14} className="spin" /> : null}
                Install missing
              </button>
            </div>
          ) : null}
          {installReport ? <p className="setup-note">{installReport}</p> : null}
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

  const permissionsSection = (
    <Section title="Permissions" hint="Iris needs your mic to hear you. Camera is optional (hand gestures).">
      <div className="setup-perms">
        <PermRow icon={<Mic size={16} />} label="Microphone" required state={mic} onRequest={requestMic} />
        <PermRow icon={<Camera size={16} />} label="Camera (gestures)" state={cam} onRequest={requestCam} />
      </div>
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
                  await save();
                  onClose();
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
          Iris is a hands-free voice companion — add a Gemini key and start talking. If you also have the Claude
          Code CLI installed, Iris unlocks an optional PO/DEV build pipeline for real work. Let's get you set up
          in under a minute.
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
        <p>Iris will save your settings and wake up. Press W any time to wake, S to sleep.</p>
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
        <div className="setup-scroll">{body}</div>
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
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel?: string;
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
    <div className="ts">
      <button
        ref={btnRef}
        type="button"
        className={`ts-trigger ${open ? "open" : ""}`}
        onClick={toggle}
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

// Read-only prerequisite check row (openspec CLI, global skills) — Iris never
// installs these itself; it only reports presence and a copyable command.
function PrereqRow({
  label,
  ok,
  okDetail,
  installHint,
}: {
  label: string;
  ok: boolean;
  okDetail?: string;
  installHint: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`setup-perm ${ok ? "granted" : "idle"}`}>
      <span className="perm-label">
        {label}
        {okDetail ? <em>{okDetail}</em> : null}
      </span>
      {ok ? (
        <span className="setup-result ok">
          <Check size={13} />
          Detected
        </span>
      ) : (
        <button
          className="setup-btn ghost"
          title={installHint}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(installHint);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access can fail silently on some platforms; the
              // command is still visible in the title tooltip.
            }
          }}
        >
          {copied ? "Copied" : "Copy install command"}
        </button>
      )}
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
