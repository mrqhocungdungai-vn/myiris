import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Play, Wand2, X } from "lucide-react";
import { acceleratorParts } from "../lib/accelerator-label";
import Keycaps from "./Keycaps";
import PermissionsStep from "./PermissionsStep";
import ClaudeSection from "./ClaudeSection";
import {
  BooleanSetting,
  Section,
  TestBadge,
  ThemedSelect,
  type Option,
  type TestState,
} from "./SetupControls";

type Mode = "onboarding" | "settings";

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
    // The stored key never reaches the renderer (design D11, mirrors the
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
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(config.geminiApiKeySet);
  const [preview, setPreview] = useState<TestState>({ status: "idle" });
  const [micGranted, setMicGranted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  // The wizard's closing summary names the microphone, and it reports the OS's
  // answer for the same reason every row does — the renderer's own permission
  // store answers with the app's unconditional internal grant. Read here
  // because the summary renders on the finish step, where the Permissions step
  // is no longer mounted.
  useEffect(() => {
    let cancelled = false;
    window.iris.queryOsPermissions().then((snapshot) => {
      if (!cancelled) setMicGranted(snapshot.states.microphone === "granted");
    });
    return () => {
      cancelled = true;
    };
  }, [step]);


  async function testGemini() {
    setGemini({ status: "testing" });
    const result = await window.iris.testGemini(draft.GEMINI_API_KEY.trim());
    setGemini(result.ok ? { status: "ok", message: "Key works." } : { status: "error", message: result.error });
  }


  async function doPreview() {
    setPreview({ status: "testing" });
    const result = await window.iris.previewVoice({
      voice: draft.GEMINI_LIVE_VOICE,
      key: draft.GEMINI_API_KEY.trim(),
    });
    setPreview(result.ok ? { status: "idle" } : { status: "error", message: result.error });
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
      <BooleanSetting
        label="Google Search"
        value={draft.IRIS_ENABLE_GOOGLE_SEARCH === "true"}
        onChange={(next) => set("IRIS_ENABLE_GOOGLE_SEARCH", String(next))}
        note="Lets Iris search the web directly for quick facts. Needs a paid Gemini key — on a free-tier key, enabling this disconnects the live session with a 1011 quota error. Applies on the next reconnect (no need to restart Iris)."
      />
    </Section>
  );

  // Everything about whether the pipeline can run — the runtime probe, both
  // credentials, and the legacy-artifact cleanup — lives in ClaudeSection,
  // which owns that state rather than receiving it.
  const claudeSection = <ClaudeSection config={config} onSaved={onSaved} />;

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
      <BooleanSetting
        label="Wake word — “Hey Iris”"
        ariaLabel="Wake word"
        value={draft.IRIS_WAKE_WORD === "true"}
        onChange={(next) => set("IRIS_WAKE_WORD", String(next))}
        note="When on, Iris listens locally for “Hey Iris” and wakes hands-free (same as pressing W). Runs fully on-device — no audio leaves your machine. Needs microphone permission."
      />
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
      <BooleanSetting
        label="Interface sounds"
        value={soundsEnabled}
        onChange={(next) => {
          if (next !== soundsEnabled) onToggleSounds();
        }}
        note="Subtle audio cues for wake, sleep, task sent, and task done. Synthesized locally — quiet by design."
      />
      <BooleanSetting
        label="WebGL quality"
        value={webglHighFidelity}
        onChange={(next) => {
          if (next !== webglHighFidelity) onToggleWebglQuality();
        }}
        note="On restores full visual effects (bloom, sharper rendering) at a materially higher GPU cost. Off by default so Iris runs smoothly on a modest machine. Applies immediately — no Save, no relaunch."
      />
      {ambientCaptureForcedOff ? null : (
        <BooleanSetting
          label="Ambient session capture — retains a transcript of speech near the microphone, which may include other people"
          ariaLabel="Ambient session capture"
          value={ambientCaptureEnabled}
          onChange={(next) => {
            if (next !== ambientCaptureEnabled) onToggleAmbientCapture();
          }}
          note="Off by default. When on, ordinary conversation — text only, never audio, and only while Iris is awake and listening — is saved into your second brain, so it accumulates from what you already talk about instead of only from deliberate notes. A recording indicator with a stop button appears whenever this is actually retaining. Applies immediately — no Save, no relaunch."
        />
      )}
    </Section>
  );

  // The Permissions step owns its own OS-permission state and device
  // enumeration (setup-panel-reports-real-permissions D7) — the panel passes
  // only the device-selector props it already computes. Rendered from two call
  // sites: the settings body and the wizard step.
  const permissionsSection = (
    <PermissionsStep
      cameraDeviceId={cameraDeviceId}
      onChangeCameraDevice={onChangeCameraDevice}
      micDeviceId={micDeviceId}
      onChangeMicDevice={onChangeMicDevice}
    />
  );

  const advancedSection = (
    <Section title="Advanced" hint="Demo data lets you explore Iris without dispatching real Claude work.">
      <BooleanSetting
        label="Load demo / test data"
        ariaLabel="Load demo data"
        value={draft.IRIS_LOAD_TEST_DATA === "true"}
        onChange={(next) => set("IRIS_LOAD_TEST_DATA", String(next))}
        note="Fills the Work Stream with sample task cards for exploring the UI. Turn off for normal use."
      />
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
          Iris, so adding a Claude credential also unlocks an optional build pipeline for real work —
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
          <li>Mic · {micGranted ? "granted" : "ask on start"}</li>
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


