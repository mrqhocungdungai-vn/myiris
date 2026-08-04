export type ReactorState = "idle" | "online" | "listening" | "speaking" | "replying" | "working";

// One Claude tool invocation, surfaced live from the DEV NDJSON / PO SDK
// event stream (see electron/claude-stream.mjs). Keyed by the tool_use id
// Claude itself assigns, so start/end pairing does not depend on tool name.
export type TaskStep = {
  id: string;
  tool: string;
  preview?: string;
  status: "running" | "done" | "error";
  duration?: number;
  ts: number;
};

// What a run cost, as the runtime reported it — never an estimate Iris
// constructs. Null until the run's result message lands.
export type TaskUsage = {
  costUsd: number | null;
  numTurns: number | null;
};

export type TaskCard = {
  id: string;
  task: string;
  status: string;
  output?: string;
  error?: string;
  verb?: Verb | null;
  model?: string | null;
  claudeSessionId?: string | null;
  usage?: TaskUsage | null;
  updatedAt: number;
  steps?: TaskStep[];
};

export type LogLine = {
  id: string;
  level: string;
  message: string;
  timestamp: number;
};

export type TranscriptLine = {
  id: string;
  speaker: string;
  text: string;
};

// Purely-visual delegation handoff effects (orb <-> Work Stream). These never
// touch task/voice logic; they only react to changes in the tasks array.
export type HandoffTone = "amber" | "success" | "error";

export type Pulse = {
  id: string;
  kind: "out" | "in";
  tone: HandoffTone;
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
  lift: number;
  angle: number;
};
