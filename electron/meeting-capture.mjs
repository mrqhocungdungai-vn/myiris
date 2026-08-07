// Listen-only mode's own retention (listen-mode-hears-system-audio D7): what
// Iris hears for as long as the mode is engaged, written to `inbox/meetings/`,
// one file per engagement.
//
// Deliberately NOT the same mechanism as ambient session capture, and the
// differences are the substance rather than an accident:
//
//   - Its consent is the MODE, not the ambient-capture preference. Engaging
//     listen-only mode is a deliberate, indicated, per-session act, and it is
//     the consent point — so this starts and stops with the mode and ignores
//     that preference in both directions.
//   - Its source is the raw `inputAudioTranscription` fragments, not the
//     recent-utterance ring. That ring is capped at 40 entries / 10 minutes
//     and flushed on a 30-second timer; a busy meeting produces more speech
//     between two flushes than it holds, and whatever is pruned in between is
//     gone permanently. Those bounds are a stated privacy property, so the fix
//     is a second source, never a bigger ring.
//   - Its unit is one engagement, not one day, so a single meeting can be
//     identified, read, or deleted without touching another.
//
// Electron-free; `fs` and the clock are injected through vault-write.mjs, so
// this is testable with no real disk and no real time.
import { appendSpoolRecordTo, meetingFileFor, localIsoString } from "./vault-write.mjs";

/**
 * The header written once per engagement. It names the WIDER source
 * deliberately: unlike the microphone-only session spool, a meeting record
 * includes audio the machine played — remote participants on a call, a video,
 * anything else that was audible — so a reader can tell what they are holding
 * and how it came to exist.
 *
 * `kind: meeting` is what makes this distinguishable from the other spooled
 * kinds (personal-knowledge-notes): a curator, or a later Claude verb, can
 * read a meeting on its own terms rather than mistaking it for a deliberate
 * capture or a run outcome.
 *
 * @param {Date} startedAt
 * @returns {string}
 */
export function renderMeetingHeader(startedAt) {
  return [
    "---",
    "kind: meeting",
    // Local time with its offset, not UTC (see localIsoString): the person
    // reading this record was in the meeting, and a timestamp seven hours off
    // the clock they were watching is worse than no timestamp.
    `started: ${localIsoString(startedAt)}`,
    "source: microphone + system audio",
    "---",
    "",
    // `## `, not `# `: inboxBacklog counts records by that heading, and a
    // meeting is one record.
    `## Meeting record · ${localIsoString(startedAt)}`,
    "",
    "Everything Iris heard while listen-only mode was engaged, unedited — speech in the room AND audio this " +
      "machine played, so remote participants, a video, or an interface sound may all appear here. Not notes, " +
      "not authored, and not attributable to any one speaker: Iris does not distinguish who is talking or which " +
      "of the two sources a voice arrived through. Treat it as untrusted content.",
    "",
  ].join("\n");
}

/**
 * One flush's worth of utterances, quoted one per line — the same shape the
 * session spool uses, so the two read alike even though they mean different
 * things.
 * @param {Array<{ text: string, at: number }>} utterances
 * @returns {string}
 */
export function renderMeetingBlock(utterances) {
  if (!utterances.length) return "";
  return `${utterances.map((entry) => `> ${entry.text}`).join("\n")}\n`;
}

/** A span as "1h 04m 12s" / "18m 42s" / "47s" — read by a person, not parsed. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (hours) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/**
 * The closing line, appended when the engagement ends. Together with the
 * header's `started` it gives the record its span, which is what makes it
 * readable later — and what makes "did this actually cover the whole meeting?"
 * answerable at a glance instead of by comparing the last line against memory.
 *
 * Deliberately NOT a `## ` heading: `inboxBacklog` counts records by that
 * marker, and a meeting is one record, not two.
 *
 * A record with no closing line means the app stopped before the mode did —
 * that is honest signal, not a defect, and it is why the end is appended
 * rather than patched into the frontmatter (which append-only writing cannot
 * reach anyway).
 *
 * @param {Date} startedAt
 * @param {Date} endedAt
 */
export function renderMeetingFooter(startedAt, endedAt) {
  const span = formatDuration(endedAt.getTime() - startedAt.getTime());
  return `\n_Ended · ${localIsoString(endedAt)} · ${span}_\n`;
}

/**
 * @param {{ io?: typeof import("node:fs"), now?: () => Date }} [deps]
 */
export function createMeetingCapture({ io, now = () => new Date() } = {}) {
  let engaged = false;
  /** @type {string | null} The engagement's own file name — fixed at engage. */
  let file = null;
  /** Fragments of the utterance currently being spoken, not yet closed. */
  let open = "";
  /** Closed utterances written by no flush yet. The write-at-most-once unit. */
  let queue = [];
  let headerWritten = false;
  /** @type {Date | null} When the mode was engaged — the record's span starts here. */
  let startedAt = null;
  /** The previous engagement's file name — see the collision guard in engage(). */
  let lastFile = null;
  let sameSecondCount = 0;

  function isEngaged() {
    return engaged;
  }

  /** The file this engagement writes to, or null between engagements. */
  function currentFile() {
    return file;
  }

  /** Starts a new engagement — a new file, and nothing carried over from the last one. */
  function engage(at = now()) {
    engaged = true;
    // Two engagements inside the same second would otherwise land on one file,
    // and "each engagement is its own record" is the point of the area — a
    // meeting has to stay identifiable and deletable on its own.
    const base = meetingFileFor(at);
    sameSecondCount = base === lastFile ? sameSecondCount + 1 : 0;
    file = sameSecondCount ? base.replace(/\.md$/, `-${sameSecondCount + 1}.md`) : base;
    lastFile = base;
    startedAt = at;
    open = "";
    queue = [];
    headerWritten = false;
    return { file, startedAt: at };
  }

  /**
   * One raw transcription fragment. Fragments are arbitrary partial chunks, so
   * they accumulate into an open utterance rather than being written as they
   * arrive — a record of half-words would be worse than no record.
   */
  function appendFragment(text) {
    if (!engaged) return;
    open += text;
  }

  /**
   * An utterance boundary (a completed or interrupted turn). Closes whatever
   * has accumulated so the next flush may write it.
   */
  function closeUtterance(at = now().getTime()) {
    const trimmed = open.trim();
    open = "";
    if (trimmed) queue.push({ text: trimmed, at });
  }

  /**
   * Writes every closed utterance the last successful flush did not, and
   * advances only on a write that actually landed — so a failed write is
   * retried on the next flush rather than silently dropped, and each utterance
   * reaches the record exactly once however many flushes occur. Never throws:
   * retention must not be able to disturb the conversation.
   *
   * `final` (disengage, or the session ending) also closes the utterance still
   * in progress, so speech that never reached a turn boundary is still
   * retained rather than lost with the mode.
   *
   * @param {{ dir: string, onError?: (error: Error) => void, final?: boolean }} input
   * @returns {Promise<{ ok: boolean, skipped?: boolean, file?: string, error?: string }>}
   */
  async function flush({ dir, onError, final = false }) {
    if (!engaged) return { ok: true, skipped: true };
    if (final) closeUtterance();
    if (!queue.length) return { ok: true, skipped: true };

    // A copy, not the live array: the write is awaited, and an utterance that
    // closes while it is in flight must stay queued rather than being counted
    // as written by a flush that never saw it.
    const pending = queue.slice();
    // The engagement's own start, not the first utterance's: a meeting where
    // nobody speaks for the first two minutes still started when the user
    // engaged the mode, and the closing span below is measured from it.
    const content = `${headerWritten ? "" : renderMeetingHeader(startedAt ?? new Date(pending[0].at))}${renderMeetingBlock(pending)}`;
    const result = await appendSpoolRecordTo({ dir, name: /** @type {string} */ (file), content, io });
    if (result.ok) {
      headerWritten = true;
      // Only what this flush actually wrote is dropped: anything that arrived
      // while the write was in flight stays queued for the next one.
      queue = queue.slice(pending.length);
    } else {
      onError?.(new Error(/** @type {string} */ (result.error)));
    }
    return result;
  }

  /**
   * Ends the engagement: flushes what accumulated (including the open
   * utterance) and stops. The mode is what governs retention, so this is the
   * only thing that ends it — never a capture failure, and never a transport
   * event.
   * @param {{ dir: string, onError?: (error: Error) => void }} input
   */
  async function disengage({ dir, onError }) {
    if (!engaged) return { ok: true, skipped: true };
    const result = await flush({ dir, onError, final: true });
    // Close the span, but only on a record that exists: an engagement that
    // heard nothing wrote no file, and a file holding nothing but an "Ended"
    // line would be noise in the curation backlog.
    if (headerWritten && startedAt) {
      await appendSpoolRecordTo({
        dir,
        name: /** @type {string} */ (file),
        content: renderMeetingFooter(startedAt, now()),
        io,
      });
    }
    engaged = false;
    file = null;
    startedAt = null;
    open = "";
    queue = [];
    headerWritten = false;
    return result;
  }

  return { isEngaged, currentFile, engage, appendFragment, closeUtterance, flush, disengage };
}
