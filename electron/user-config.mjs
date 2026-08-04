// Env-file bootstrap, env-driven settings readers, and the SetupPanel's
// persisted-config read/write surface (config-persistence capability). Split
// out of electron/main.mjs (split-main-process-modules): Electron-free except
// for one read of `app.isPackaged` in userConfigPath(), which is received
// injected rather than imported.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GoogleGenAI } from "@google/genai";
import { closeAllPoSessions } from "./po-session.mjs";
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
export const PROMPT_REVIEW_MODES = Object.freeze(["never", "always", "verb"]);
export const DEFAULT_PROMPT_REVIEW_MODE = "verb";

// Accepts the three names, and still accepts the previous boolean values so an
// existing configuration is not silently reinterpreted: `1`/`true`/`on`/`yes`
// meant "park everything" and still does; `0`/`false`/`off`/`no` meant "never"
// and still does. Anything unrecognized falls back to the default rather than
// disabling the gate — the failure mode of a typo must be more review, not less.
/** @param {unknown} raw @returns {"never"|"always"|"verb"} */
export function parsePromptReviewMode(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return DEFAULT_PROMPT_REVIEW_MODE;
  if (PROMPT_REVIEW_MODES.includes(value)) return /** @type {any} */ (value);
  if (["1", "true", "on", "yes"].includes(value)) return "always";
  if (["0", "false", "off", "no"].includes(value)) return "never";
  return DEFAULT_PROMPT_REVIEW_MODE;
}

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
  // The metered alternative to the subscription token. Either one satisfies the
  // pipeline's credential gate (pipeline-probes.mjs's claudeCredentialStatus),
  // and it is the only credential a user without a Claude subscription can get.
  "ANTHROPIC_API_KEY",
  "IRIS_PROMPT_REVIEW",
  "IRIS_ENABLE_GOOGLE_SEARCH",
]);

// The SetupPanel's token/key inputs always render empty (the stored value
// never reaches the renderer), so a plain Save would otherwise blank them on
// every visit. Empty means "keep" for these keys only. See design D3/D11.
const KEEP_ON_EMPTY_CONFIG_KEYS = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"]);

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
 *   probePipelineAvailability?: () => Promise<any>,
 * }} deps
 */
export function createUserConfig({
  repoRoot,
  getIsPackaged,
  emitEvent,
  emitToRenderer,
  getLiveSession,
  runQueue,
  probePipelineAvailability,
}) {
  // Pre-dispatch review gate (prompt-review-gate spec), now three-valued:
  //
  //   "never"  — dispatch immediately (the old `off`)
  //   "always" — park everything (the old `on`)
  //   "verb"   — park what the verb registry says to park (the default)
  //
  // `verb` exists because "park everything" is what makes users disable the
  // gate: parking a read-only question, or every turn of a live conversation, is
  // friction with no safety gained. The registry declares which verbs write to
  // the repository, and those are the ones worth a human decision.
  //
  // Modeled exactly on pipelineAvailable (module flag, one mutation choke point
  // in setPromptReviewMode below, getter IPC + sidecar event on change).
  let promptReviewMode = parsePromptReviewMode(process.env.IRIS_PROMPT_REVIEW);

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
      // Presence only — the credential itself never crosses the IPC boundary
      // (design D2). Reported per-key rather than through poBillingStatus(),
      // which is now true for EITHER credential: the panel has a separate field
      // for each and must not show the API key as a saved subscription token.
      poTokenSet: Boolean((process.env.CLAUDE_CODE_OAUTH_TOKEN || "").trim()),
      anthropicApiKeySet: Boolean((process.env.ANTHROPIC_API_KEY || "").trim()),
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
    // Matching control characters is the entire point here: this is the .env
    // injection guard described above, and the class must stay literal to reject
    // exactly what parseEnvFile cannot survive. Hence the suppression below.
    // oxlint-disable-next-line no-control-regex
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
  // reaches this — only the UI control (PipelineBar) and the IRIS_PROMPT_REVIEW
  // startup default call it, so the flag is not disarmable by the model. The
  // control persists via the same IRIS_PROMPT_REVIEW key that seeds the startup
  // default, so it survives a restart. An unrecognized value is refused rather
  // than silently coerced — a typo must not quietly disarm the gate.
  function setPromptReviewMode(mode) {
    const next = /** @type {"never"|"always"|"verb"} */ (String(mode ?? "").trim().toLowerCase());
    if (!PROMPT_REVIEW_MODES.includes(next)) {
      return { status: "error", error: `Unknown review mode: ${mode}. One of ${PROMPT_REVIEW_MODES.join(", ")}.` };
    }
    if (next !== promptReviewMode) {
      promptReviewMode = next;
      writeUserConfig({ IRIS_PROMPT_REVIEW: promptReviewMode });
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

  // Set or clear a Claude credential from the SetupPanel — either the
  // subscription token or the metered API key, selected by `key`. Returns the
  // same config snapshot shape as config:save so the renderer can refresh in
  // place; the value is never echoed back and never logged (design D2/D6).
  const CLAUDE_CREDENTIAL_KEYS = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);

  function savePoToken(rawToken, { remove = false, key = "CLAUDE_CODE_OAUTH_TOKEN" } = {}) {
    if (!CLAUDE_CREDENTIAL_KEYS.has(key)) {
      return { ok: false, error: `${key} is not a Claude credential.`, config: getFullConfig() };
    }
    const token = String(rawToken ?? "").trim();
    if (!remove && !token) {
      return { ok: false, error: "No token provided.", config: getFullConfig() };
    }
    if (poTurnRunning()) {
      return {
        ok: false,
        error: "A PO turn is running right now. Wait for it to finish, then change the credential.",
        config: getFullConfig(),
      };
    }
    let config;
    try {
      config = remove ? writeUserConfig({}, { deleteKeys: [key] }) : writeUserConfig({ [key]: token });
    } catch (error) {
      return { ok: false, error: error.message, config: getFullConfig() };
    }
    closeAllPoSessions();
    // The pipeline gate is now a credential check, so adding or removing one
    // changes app-wide availability. Re-probe here rather than leaving the UI
    // stale until the user happens to hit "Test" or restarts — writeUserConfig
    // has already updated process.env, so the probe sees the new state.
    // Fire-and-forget: the returned config snapshot does not depend on it, and
    // the flip reaches the renderer through the probe's own event.
    Promise.resolve(probePipelineAvailability?.()).catch(() => {});
    console.log(`[IRIS][po-auth] ${key} ${remove ? "removed" : "updated"} from Settings.`);
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
