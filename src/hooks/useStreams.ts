import { useState } from "react";
import type { LogLine, TranscriptLine } from "../types";
import { appendLog, appendTranscript } from "../lib/streams";

// The transcript and the diagnostic log — two append-and-cap streams that are
// written from many places and read only for display.
//
// Extracted from `App.tsx` under `decompose-app-orchestrator`. The cap rules
// themselves live in `lib/streams.ts`, where they are tested; this owns the
// state and hands out the two writers.

export type Streams = {
  transcript: TranscriptLine[];
  logs: LogLine[];
  /** `level` is the log's own vocabulary ("info" / "error"), not a type. */
  pushLog: (level: string, message: string, timestamp?: number) => void;
  pushTranscript: (speaker: string, text: string) => void;
};

export function useStreams(): Streams {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  // Read at last. This was `const [, setLogs]` — written on every event and
  // discarded — until camera-activity-log gave the stream somewhere to go.
  const [logs, setLogs] = useState<LogLine[]>([]);

  return {
    transcript,
    logs,
    pushLog(level, message, timestamp = Date.now()) {
      setLogs((current) => appendLog(current, { id: crypto.randomUUID(), level, message, timestamp }));
    },
    pushTranscript(speaker, text) {
      setTranscript((current) => appendTranscript(current, { id: crypto.randomUUID(), speaker, text }));
    },
  };
}
