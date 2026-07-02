export type ReactorState = "idle" | "online" | "listening" | "speaking" | "working";

// One Hermes tool invocation, surfaced live from the SSE event stream.
export type TaskStep = {
  id: string;
  tool: string;
  preview?: string;
  status: "running" | "done" | "error";
  duration?: number;
  ts: number;
};

export type TaskCard = {
  id: string;
  task: string;
  status: string;
  output?: string;
  error?: string;
  updatedAt: number;
  steps?: TaskStep[];
  notes?: string;
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
