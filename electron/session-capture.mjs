// The opt-in ambient-session-capture policy (ambient-memory): the enabled
// flag, the per-session watermark that makes progressive flushing
// idempotent, and the self-describing room-transcript rendering.
//
// Deliberately dumb about WHY it is enabled or disabled — it holds no
// knowledge of the microphone, the renderer's preference, or any env var.
// The fail-closed gate (design D1) lives entirely in whatever calls enable(),
// never in this module inferring intent, and the watermark starting at the
// enable moment (never at zero) is what keeps a later enable from sweeping up
// speech the ring already held before consent existed (design D4, the
// no-retroactive-capture non-goal).
//
// Electron-free; `fs`/the clock are injected through vault-write.mjs's own
// appendSpoolRecord, so this is testable with no real disk and no real time.
import { appendSpoolRecord } from "./vault-write.mjs";

/**
 * The markdown for one flush's worth of utterances: a header naming it a
 * verbatim microphone record and its time span (oldest to newest), then each
 * utterance as a quoted line — so a reader, and the curator reading it later,
 * can tell this from an authored note at a glance (design D6). Untitled and
 * unlinked on purpose: it is a room transcript, not a page.
 * @param {Array<{ text: string, at: number }>} utterances
 * @returns {string}
 */
export function renderSessionBlock(utterances) {
  if (!utterances.length) return "";
  const start = new Date(utterances[0].at).toISOString();
  const end = new Date(utterances[utterances.length - 1].at).toISOString();
  const lines = [
    `## Automatic transcription of the microphone · ${start} – ${end}`,
    "",
    "Everything the microphone picked up during this span, unedited — not notes, and not necessarily this " +
      "user's own words; anyone near the microphone may appear here. " +
      // It says it is a transcript of the room, but not that it is a GUESS at
      // one. It is speech-recognition output made while the conversation
      // happened, and a mishearing here is silent: it reads as a sentence
      // somebody said. The curator weaving these into durable pages is the
      // only one who can catch that, and only if the spool tells them to.
      "These lines are automatic speech recognition, not a human transcript: names, numbers and " +
      "unfamiliar terms may be wrong, and a confident-looking sentence may never have been said. " +
      "Check anything load-bearing against another source before writing it into a durable page.",
    "",
    ...utterances.map((entry) => `> ${entry.text}`),
    "",
  ];
  return lines.join("\n");
}

/**
 * @param {{ io?: typeof import("node:fs"), now?: () => Date }} [deps]
 */
export function createSessionCapture({ io, now = () => new Date() } = {}) {
  // Off on every construction, matching main's own default-off-on-every-launch
  // (design D1) — nothing here reads a persisted or env-supplied value itself.
  let enabled = false;
  let watermark = 0;

  function isEnabled() {
    return enabled;
  }

  /** Starts (or restarts) capture with a fresh watermark — see the header above. */
  function enable(at = now().getTime()) {
    enabled = true;
    watermark = at;
  }

  function disable() {
    enabled = false;
  }

  /**
   * Writes only the utterances newer than the watermark, and advances it only
   * when the write actually lands — so a failed write is retried on the next
   * flush rather than silently skipped (spec: "Repeated flushes do not
   * duplicate" / "A failed flush does not disturb the conversation"). A no-op
   * — no write even attempted — while disabled or when nothing is new, so the
   * mechanism costs nothing when there is nothing to do.
   * @param {{ utterances?: Array<{ text: string, at: number }>, dir: string, onError?: (error: Error) => void }} input
   * @returns {Promise<{ ok: boolean, skipped?: boolean, file?: string, error?: string }>}
   */
  async function flush({ utterances = [], dir, onError }) {
    if (!enabled) return { ok: true, skipped: true };
    const fresh = utterances.filter((entry) => entry.at > watermark);
    if (!fresh.length) return { ok: true, skipped: true };
    const result = await appendSpoolRecord({ dir, content: renderSessionBlock(fresh), now, io });
    if (result.ok) {
      watermark = fresh[fresh.length - 1].at;
    } else {
      onError?.(new Error(result.error));
    }
    return result;
  }

  return { isEnabled, enable, disable, flush };
}
