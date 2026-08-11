import type { LogLine, TranscriptLine } from "../types";

// The two append-and-cap streams the deck shows: the diagnostic log and the
// conversation transcript.
//
// They cap in **opposite directions**, and that is the whole reason they are
// worth stating here rather than being two inline `.slice()` calls:
//
//   * the **log** is newest-first, so a new line goes on the front and the cap
//     drops the oldest off the tail;
//   * the **transcript** reads in conversation order, so a new line goes on the
//     end and the cap drops the oldest off the front.
//
// Getting either backwards is not a crash — it silently shows the wrong end of
// the stream, which reads as "nothing is happening" while everything is.
//
// Note these bounds are the *renderer's* display window, not retention. The
// diagnostic log on disk (`~/.myiris/logs/iris.log`) keeps everything; this is
// only what the on-screen strip holds.

/** How many diagnostic lines the on-screen strip holds. */
export const MAX_LOGS = 80;
/** How many transcript lines the comms panel holds. */
export const MAX_TRANSCRIPT = 40;

/** Adds a log line at the front, dropping the oldest past the cap. */
export function appendLog(current: LogLine[], line: LogLine): LogLine[] {
  return [line, ...current].slice(0, MAX_LOGS);
}

/** Adds a transcript line at the end, dropping the oldest past the cap. */
export function appendTranscript(current: TranscriptLine[], line: TranscriptLine): TranscriptLine[] {
  return [...current, line].slice(-MAX_TRANSCRIPT);
}
