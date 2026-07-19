/// <reference types="vite/client" />

type SidecarMode = "none" | "camera" | "screen";

type SidecarEvent = {
  type: string;
  timestamp?: number;
  [key: string]: unknown;
};

type LiveAudioChunk = {
  data: string;
  mimeType?: string;
};

type AgentRole = "po" | "dev" | "study";

type ClaudeSession = {
  id: string;
  label: string;
  agent_sessions: Partial<Record<AgentRole | "default", string>>;
  active_agent: AgentRole | null;
  last_agent_used: AgentRole | null;
  cwd: string | null;
  created_at: number;
  last_used_at: number;
  last_task: string;
};

type SessionsSnapshot = {
  active: string | null;
  sessions: ClaudeSession[];
};

type AgentInfo = {
  key: AgentRole;
  label: string;
  installed: boolean;
  description: string;
  model: string | null;
};

type AgentsSnapshot = {
  roster: AgentInfo[];
  installed: boolean;
  hasProject: boolean;
  gates: {
    slug: string | null;
    byRole: Partial<Record<AgentRole, boolean>>;
  };
};

type AgentsInstallResult = {
  status: "ok" | "partial" | "error";
  error?: string;
  installed: string[];
  skipped: string[];
  removed?: string[];
  errors: string[];
};

type PoQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

type PoQuestion = {
  question: string;
  header: string;
  options: PoQuestionOption[];
};

type PoQuestionAnswer = {
  question: string;
  choice: string;
};

type IrisConfig = {
  geminiApiKey: string;
  geminiModel: string;
  geminiVoice: string;
  userName: string;
  loadTestData: boolean;
  wakeWord: boolean;
  configured: boolean;
  voices: string[];
  models: string[];
  configPath: string;
};

type ClaudeHealth = {
  reachable: boolean;
  version?: string;
  error?: string;
  billingOk: boolean;
  billingError?: string;
};

type UiActionPayload = {
  action: string;
  target_id?: string;
  query?: string;
};

type UiMode = "deck" | "hud";

type UiContextSnapshot = {
  expandedTaskId: string | null;
  focusedTaskId: string | null;
  latestResultTaskId: string | null;
  pendingTaskMatches: Array<{ index: number; id: string; task: string; status: string }>;
  showHistory: boolean;
  tasks: Array<{
    id: string;
    task: string;
    status: string;
    hasResult: boolean;
    stepCount: number;
    stepsOpen: boolean;
    updatedAt: number;
  }>;
  uiMode: UiMode;
};

type IrisApi = {
  startSidecar: (options?: { mode?: SidecarMode }) => Promise<{ running: boolean; pid: number | null }>;
  stopSidecar: () => Promise<{ running: boolean; pid: number | null }>;
  getSidecarStatus: () => Promise<{ running: boolean; pid: number | null }>;
  sendCommand: (command: Record<string, unknown>) => Promise<void>;
  getSessions: () => Promise<SessionsSnapshot>;
  selectSession: (id: string) => Promise<SessionsSnapshot & { status?: string }>;
  newSession: (label?: string) => Promise<SessionsSnapshot & { status?: string }>;
  chooseProjectFolder: (
    id?: string,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string }>;
  listAgents: (workstreamId?: string) => Promise<AgentsSnapshot>;
  selectAgent: (
    workstreamId: string,
    agent: AgentRole | null,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string }>;
  installAgents: () => Promise<AgentsInstallResult>;
  setAgentModel: (
    workstreamId: string,
    role: AgentRole,
    model: string,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string }>;
  answerPoQuestion: (answers: PoQuestionAnswer[]) => Promise<{ status: string; error?: string }>;
  sendContextSupplement: (text: string) => Promise<{ status: string; error?: string }>;
  toggleHud: () => Promise<{ mode: UiMode }>;
  setHudInteractive: (on: boolean) => void;
  windowControl: (action: "close" | "minimize") => void;
  onHudMode: (callback: (payload: { mode: UiMode }) => void) => () => void;
  onWakeRequest: (callback: () => void) => () => void;
  getConfig: () => Promise<IrisConfig>;
  saveConfig: (updates: Partial<Record<string, string>>) => Promise<IrisConfig>;
  testGemini: (key: string) => Promise<{ ok: boolean; error?: string }>;
  testClaude: () => Promise<ClaudeHealth>;
  previewVoice: (payload: { voice: string; key: string }) => Promise<{ ok: boolean; error?: string }>;
  sendUiContext: (context: UiContextSnapshot) => void;
  notifyBootDone: () => void;
  onUiAction: (callback: (payload: UiActionPayload) => void) => () => void;
  onSleepRequest: (callback: () => void) => () => void;
  sendAudioChunk: (chunk: ArrayBuffer) => void;
  onAudioChunk: (callback: (chunk: LiveAudioChunk) => void) => () => void;
  onAudioInterrupt: (callback: () => void) => () => void;
  onSidecarEvent: (callback: (event: SidecarEvent) => void) => () => void;
};

interface Window {
  iris: IrisApi;
}
