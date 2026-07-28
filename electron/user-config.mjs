// Env-file bootstrap, env-driven settings readers, and the SetupPanel's
// persisted-config read/write surface (config-persistence capability). Split
// out of electron/main.mjs (split-main-process-modules): Electron-free except
// for one read of `app.isPackaged` in userConfigPath(), which is received
// injected rather than imported.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GoogleGenAI } from "@google/genai";
import { poBillingStatus, closeAllPoSessions } from "./po-session.mjs";
import { RUN_STATUS } from "./run-queue.mjs";
import { writeFileAtomicSync } from "./atomic-file.mjs";

// Look for .env in several places so both the dev repo run and a packaged
// Iris.app can find credentials. First match for a given key wins.
export function parseEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key]) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** @param {{ repoRoot: string }} deps */
export function loadEnvFile({ repoRoot }) {
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(os.homedir(), ".iris", ".env"),
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : null,
  ];
  for (const candidate of candidates) parseEnvFile(candidate);
}

export function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

// Shared numeric-config parser (harden-wake-word-detection D4): a malformed
// `.env` must fall back to the default rather than disabling detection or
// throwing, so any missing, non-numeric, non-integer (when required), or
// out-of-range value is treated the same as absent.
export function envNumber(name, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (integer && !Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

export function sleepDelayMs() {
  const parsed = Number(process.env.IRIS_SLEEP_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
}

export function activityEmitIntervalMs() {
  const parsed = Number(process.env.IRIS_ACTIVITY_EMIT_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 150;
}

// Hard backstop for before-quit's teardown race (design.md D3 of
// bound-shutdown-teardown) — generous enough for a SIGTERM/SIGKILL grace
// cycle plus PO query.return() settle, but bounded so a stuck transport can
// never wedge quit.
export function shutdownDeadlineMs() {
  const parsed = Number(process.env.IRIS_SHUTDOWN_DEADLINE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 8000;
}

// How long a parked review waits for Approve/Cancel before it is cancelled
// (never auto-approved — see PendingReview.expire).
export function promptReviewTimeoutMs() {
  const parsed = Number(process.env.IRIS_PROMPT_REVIEW_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300000;
}

const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede",
  "Leda", "Orus", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
];
const GEMINI_LIVE_MODELS = ["models/gemini-3.1-flash-live-preview"];
const ALLOWED_CONFIG_KEYS = new Set([
  "GEMINI_API_KEY",
  "GEMINI_LIVE_MODEL",
  "GEMINI_LIVE_VOICE",
  "IRIS_USER_NAME",
  "IRIS_LOAD_TEST_DATA",
  "IRIS_WAKE_WORD",
  "IRIS_WAKE_THRESHOLD",
  "IRIS_WAKE_CONSECUTIVE",
  "IRIS_WAKE_DEBUG",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "IRIS_PROMPT_REVIEW",
  "IRIS_ENABLE_GOOGLE_SEARCH",
]);

// The SetupPanel's token/key inputs always render empty (the stored value
// never reaches the renderer), so a plain Save would otherwise blank them on
// every visit. Empty means "keep" for these keys only. See design D3/D11.
const KEEP_ON_EMPTY_CONFIG_KEYS = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "GEMINI_API_KEY"]);

function ensureIncludes(list, value) {
  if (value && !list.includes(value)) return [value, ...list];
  return list;
}

/**
 * @param {{
 *   repoRoot: string,
 *   getIsPackaged: () => boolean,
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   getLiveSession: () => any,
 *   runQueue: { list: () => Array<{ agent: string, status: string }> },
 * }} deps
 */
export function createUserConfig({ repoRoot, getIsPackaged, emitEvent, emitToRenderer, getLiveSession, runQueue }) {
  // Pre-dispatch review gate (prompt-review-gate spec): when on, submit_claude_task
  // parks a brief for Approve/Edit/Cancel instead of dispatching it immediately —
  // modeled exactly on pipelineAvailable (module flag, one mutation choke point
  // in setPromptReviewMode below, getter IPC + sidecar event on change).
  // Default on: an unreviewed brief should never burn tokens unless the user
  // opts out (design.md D5).
  let promptReviewMode = envFlag("IRIS_PROMPT_REVIEW", true);

  function getPromptReviewMode() {
    return promptReviewMode;
  }

  // Repo .env in dev, ~/.iris/.env in a packaged build — the same location
  // loadEnvFile() already reads from, so a save takes effect without restart.
  function userConfigPath() {
    return getIsPackaged() ? path.join(os.homedir(), ".iris", ".env") : path.join(repoRoot, ".env");
  }

  // Full settings snapshot for the SetupPanel. Values come from process.env
  // (populated from .env at boot and updated live on save).
  function getFullConfig() {
    return {
      // Presence only — the key itself never crosses the IPC boundary (design
      // D11, mirrors poTokenSet below): setup-panel's secrets contract already
      // required this for CLAUDE_CODE_OAUTH_TOKEN, and applies here too.
      geminiApiKeySet: Boolean((process.env.GEMINI_API_KEY || "").trim()),
      geminiModel: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview",
      geminiVoice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
      userName: process.env.IRIS_USER_NAME || "",
      loadTestData: envFlag("IRIS_LOAD_TEST_DATA", false),
      wakeWord: envFlag("IRIS_WAKE_WORD", true),
      wakeThreshold: envNumber("IRIS_WAKE_THRESHOLD", 0.15, { min: 0, max: 1 }),
      wakeConsecutive: envNumber("IRIS_WAKE_CONSECUTIVE", 2, { min: 1, max: 10, integer: true }),
      wakeDebug: envFlag("IRIS_WAKE_DEBUG", false),
      googleSearch: envFlag("IRIS_ENABLE_GOOGLE_SEARCH", false),
      // Presence only — the token itself never crosses the IPC boundary (design D2).
      poTokenSet: poBillingStatus().ok,
      configured: Boolean((process.env.GEMINI_API_KEY || "").trim()),
      voices: GEMINI_VOICES,
      models: ensureIncludes(GEMINI_LIVE_MODELS, process.env.GEMINI_LIVE_MODEL),
      configPath: userConfigPath(),
    };
  }

  function serializeConfigValue(value) {
    const str = String(value ?? "").trim();
    return /[\s"#]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
  }

  // D4: parseEnvFile is line-oriented and has no multi-line support, so a value
  // carrying a newline (or any other control character) reads back as two+
  // variables — including keys outside ALLOWED_CONFIG_KEYS. No allowlisted key
  // has a legitimate multi-line value, so rejection costs nothing real.
  function assertConfigValueIsSafe(key, value) {
    if (/[\x00-\x1f\x7f]/.test(String(value ?? ""))) {
      throw new Error(`Config value for ${key} contains a line break or control character and was rejected.`);
    }
  }

  // Merge updates into the effective .env (preserving comments/other keys) and
  // apply them to process.env so they take effect on the next wake without a
  // full restart. Never logs secret values (design.md D4).
  // `deleteKeys` drops a key's line from the file entirely rather than writing an
  // empty value, so a removed credential leaves nothing behind for the next boot
  // to load as an empty-but-present variable.
  function writeUserConfig(rawUpdates, { deleteKeys = [] } = {}) {
    const deletions = new Set(deleteKeys.filter((key) => ALLOWED_CONFIG_KEYS.has(key)));
    const updates = {};
    for (const [key, value] of Object.entries(rawUpdates || {})) {
      if (!ALLOWED_CONFIG_KEYS.has(key) || deletions.has(key)) continue;
      if (KEEP_ON_EMPTY_CONFIG_KEYS.has(key) && !String(value ?? "").trim()) continue;
      assertConfigValueIsSafe(key, value);
      updates[key] = value;
    }
    if (!Object.keys(updates).length && !deletions.size) return getFullConfig();

    const file = userConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
    const remaining = new Set(Object.keys(updates));
    const out = [];
    for (const line of existing) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        out.push(line);
        continue;
      }
      const eq = trimmed.indexOf("=");
      const key = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();
      if (deletions.has(key)) continue;
      if (remaining.has(key)) {
        out.push(`${key}=${serializeConfigValue(updates[key])}`);
        remaining.delete(key);
      } else {
        out.push(line);
      }
    }
    for (const key of remaining) out.push(`${key}=${serializeConfigValue(updates[key])}`);

    writeFileAtomicSync(file, `${out.join("\n").replace(/\n+$/, "")}\n`, "utf8");
    for (const [key, value] of Object.entries(updates)) process.env[key] = String(value ?? "").trim();
    for (const key of deletions) delete process.env[key];
    return getFullConfig();
  }

  // Sole mutation point for promptReviewMode. The voice model has no tool that
  // reaches this — only the UI toggle (PipelineBar) and the IRIS_PROMPT_REVIEW
  // startup default call it, so the flag is not disarmable by the model
  // (design.md D3, mirrors setAgentModel). The toggle persists via the
  // same IRIS_PROMPT_REVIEW key that seeds the startup default, so it survives
  // a restart.
  function setPromptReviewMode(enabled) {
    const next = Boolean(enabled);
    if (next !== promptReviewMode) {
      promptReviewMode = next;
      writeUserConfig({ IRIS_PROMPT_REVIEW: promptReviewMode ? "1" : "0" });
      emitEvent({ type: "prompt_review_mode", reviewMode: promptReviewMode });
    }
    return { status: "ok", reviewMode: promptReviewMode };
  }

  // The live PO session captures its environment once, at creation
  // (computePoSessionEnv), so a token written to process.env is invisible to a
  // session that is already alive — every resident session has to go. The stored
  // session ids in claude-sessions.json are untouched, so the next PO turn
  // resumes the same conversation with the new credential (design D5).
  function poTurnRunning() {
    return runQueue.list().some((run) => run.agent === "po" && run.status === RUN_STATUS.RUNNING);
  }

  // Set or clear CLAUDE_CODE_OAUTH_TOKEN from the SetupPanel. Returns the same
  // config snapshot shape as config:save so the renderer can refresh in place;
  // the token value is never echoed back and never logged (design D2/D6).
  function savePoToken(rawToken, { remove = false } = {}) {
    const token = String(rawToken ?? "").trim();
    if (!remove && !token) {
      return { ok: false, error: "No token provided.", config: getFullConfig() };
    }
    if (poTurnRunning()) {
      return {
        ok: false,
        error: "A PO turn is running right now. Wait for it to finish, then change the token.",
        config: getFullConfig(),
      };
    }
    let config;
    try {
      config = remove
        ? writeUserConfig({}, { deleteKeys: ["CLAUDE_CODE_OAUTH_TOKEN"] })
        : writeUserConfig({ CLAUDE_CODE_OAUTH_TOKEN: token });
    } catch (error) {
      return { ok: false, error: error.message, config: getFullConfig() };
    }
    closeAllPoSessions();
    console.log(`[IRIS][po-auth] Subscription token ${remove ? "removed" : "updated"} from Settings.`);
    return { ok: true, config };
  }

  // Validate a Gemini key by forcing one authenticated round-trip (ListModels).
  // candidateKey is what the user just typed (renderer state, not yet saved);
  // falling back to the stored env value lets the SetupPanel test an already-
  // configured key with the input left empty, without that key ever being
  // sent back to the renderer to populate the input (design D11).
  async function testGeminiKey(candidateKey) {
    const key = (candidateKey || process.env.GEMINI_API_KEY || "").trim();
    if (!key) return { ok: false, error: "No API key provided." };
    try {
      const testAi = new GoogleGenAI({ apiKey: key });
      const pager = await testAi.models.list();
      for await (const _model of pager) break;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  // Speak a short sample with the chosen voice via a throwaway Live session. Audio
  // streams to the renderer over the existing live:audio channel.
  let previewSession = null;
  async function previewVoice(payload = {}) {
    if (getLiveSession()) return { ok: false, error: "Sleep Iris before previewing a voice." };
    const apiKey = (payload.key || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) return { ok: false, error: "Save your Gemini key first." };
    const voiceName = payload.voice || process.env.GEMINI_LIVE_VOICE || "Zephyr";
    const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
    try {
      if (previewSession) {
        try { previewSession.close(); } catch { /* ignore */ }
        previewSession = null;
      }
      const previewAi = new GoogleGenAI({ apiKey });
      previewSession = await previewAi.live.connect({
        model,
        config: /** @type {import("@google/genai").LiveConnectConfig} */ ({
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: {
            parts: [{ text: "You are a short voice sample. Say exactly the line you are asked to say, nothing more." }],
          },
        }),
        callbacks: {
          onmessage(message) {
            const content = message.serverContent;
            if (!content) return;
            for (const part of content.modelTurn?.parts || []) {
              const inlineData = part.inlineData;
              if (inlineData?.data && (inlineData.mimeType || "").startsWith("audio/")) {
                emitToRenderer("live:audio", { data: inlineData.data, mimeType: inlineData.mimeType });
              }
            }
            if (content.turnComplete) {
              try { previewSession?.close(); } catch { /* ignore */ }
              previewSession = null;
            }
          },
          onerror() { previewSession = null; },
          onclose() { previewSession = null; },
        },
      });
      // Send AFTER connect resolves: onopen can fire before the session variable is
      // assigned, so triggering inside onopen would no-op (silent preview).
      previewSession.sendRealtimeInput({
        text: `Say exactly: Hi, I'm Iris. This is the ${voiceName} voice.`,
      });
      return { ok: true };
    } catch (error) {
      previewSession = null;
      return { ok: false, error: error?.message || String(error) };
    }
  }

  return {
    getPromptReviewMode,
    userConfigPath,
    getFullConfig,
    writeUserConfig,
    assertConfigValueIsSafe,
    setPromptReviewMode,
    savePoToken,
    testGeminiKey,
    previewVoice,
  };
}
