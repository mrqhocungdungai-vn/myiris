/// <reference types="vite/client" />

type SidecarMode = "none" | "camera" | "screen";

// Listen-only mode's pushed state (listen-mode-hears-system-audio 1.3): the
// mode itself plus the system-audio configuration main resolved for it. One
// payload for both the boot-time query and every later push, so a renderer
// seeded on mount and one updated by a push are configured identically.
// The permissions the Permissions step reports or routes for. System audio has
// a settings location but no readable state — the platform interface reports
// microphone, camera and screen only, and the screen state is not the one that
// governs system-audio capture, so it is tested rather than read.
type OsPermission = "microphone" | "camera" | "system-audio";

// Four states, because the action that resolves each one differs. `restricted`
// is refused by device policy: the user cannot grant it and an in-app prompt
// returns immediately without asking.
type OsPermissionState = "not-determined" | "granted" | "denied" | "restricted";

type OsPermissionSettingsLocation = {
  permission: OsPermission;
  url: string;
  writtenPath: string;
};

type OsPermissionsSnapshot = {
  states: Partial<Record<OsPermission, OsPermissionState>>;
  locations: Record<OsPermission, OsPermissionSettingsLocation | null>;
  // The OS product version, read in main — system-audio capture has a floor on
  // it, and the renderer's user agent reports a frozen major.
  osVersion: string | null;
};

type ListenOnlyState = {
  engaged: boolean;
  systemAudio: boolean;
  systemAudioGain: number;
  // The listening window's absolute deadline, null when no window is open
  // (listen-window-is-bounded D6). Main owns expiry; the renderer counts down
  // from this locally rather than being ticked over IPC, and nothing it does
  // with the value can extend or shorten the window.
  deadlineAt: number | null;
  // The window's full length, so the countdown can be shown against it.
  windowMs: number;
};

type SidecarEvent = {
  type: string;
  timestamp?: number;
  [key: string]: unknown;
};

type LiveAudioChunk = {
  data: string;
  mimeType?: string;
};

// The verbs Iris can hand work to. There is no "current" one: a verb is chosen
// per request by Iris itself, so this type names what RAN, never what is
// selected. Mirrors electron/verbs.mjs's VERB_NAMES.
type Verb =
  | "shape_requirements"
  | "shape_on_canvas"
  | "work_on_note"
  | "execute"
  | "finish"
  | "investigate"
  | "capture_learning";

type ClaudeSession = {
  id: string;
  label: string;
  agent_sessions: Partial<Record<string, string>>;
  last_verb_used: Verb | null;
  cwd: string | null;
  created_at: number;
  last_used_at: number;
  last_task: string;
};

type SessionsSnapshot = {
  active: string | null;
  sessions: ClaudeSession[];
};

type VerbInfo = {
  key: Verb;
  label: string;
  loadable: boolean;
  description: string;
  stateful: boolean;
  park: "always" | "on_open" | "never";
  model: string | null;
};

type VerbsSnapshot = {
  roster: VerbInfo[];
  loadable: boolean;
  hasProject: boolean;
  /** How far the project's current OpenSpec change has got. Display only — it
   *  is no longer a gate on who may run. */
  change: {
    slug: string | null;
    shaped: boolean;
    built: boolean;
  };
};

/** What an older Iris wrote into the user's ~/.claude. Nothing is installed
 *  there any more — skills and commands come from the bundled Iris plugin — so
 *  these are inert leftovers the user may choose to remove. */
type LegacyClaudeArtifacts = {
  count: number;
  paths: string[];
  dir: string;
};

type LegacyCleanupResult = {
  removed: string[];
  errors: string[];
};

type ClaudeQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

type ClaudeQuestion = {
  question: string;
  header: string;
  options: ClaudeQuestionOption[];
  // When true the user may choose several options. Reducing such a question to
  // one choice answers a different question than the one that was asked.
  multiSelect?: boolean;
};

type ClaudeQuestionAnswer = {
  question: string;
  // One label, or several for a multi-select question. Main encodes it into the
  // comma-separated string AskUserQuestion expects.
  choice: string | string[];
};

/** never = dispatch immediately; always = park everything; verb = park what the
 *  verb registry declares as reviewed (the default). */
type ReviewMode = "never" | "always" | "verb";

type PromptReviewStatus = {
  reviewMode: ReviewMode;
};

// A request parked for Approve/Edit/Cancel before any Claude tokens are spent
// (prompt-review-gate spec).
type PendingTaskReview = {
  workstreamId: string;
  task: string;
  urgency: string;
  verb: Verb | null;
};

type PromptReviewResolveAction = "approve" | "cancel";

type IrisConfig = {
  /** Presence only — the Gemini API key itself never reaches the renderer. */
  geminiApiKeySet: boolean;
  geminiModel: string;
  geminiVoice: string;
  userName: string;
  loadTestData: boolean;
  wakeWord: boolean;
  wakeThreshold: number;
  wakeConsecutive: number;
  wakeDebug: boolean;
  googleSearch: boolean;
  /** The global wake accelerator actually registered, e.g. "Alt+Shift+W". */
  wakeHotkey: string;
  /** The global sleep accelerator actually registered, e.g. "Alt+Shift+S". */
  sleepHotkey: string;
  /** Presence only — the subscription token itself never reaches the renderer. */
  claudeTokenSet: boolean;
  /** Presence only — the metered API key itself never reaches the renderer. */
  anthropicApiKeySet: boolean;
  configured: boolean;
  voices: string[];
  models: string[];
  configPath: string;
};

type ClaudeTokenResult = {
  ok: boolean;
  error?: string;
  config: IrisConfig;
};

/** Which Claude credential a SetupPanel action targets. */
type ClaudeCredentialKey = "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";

type ClaudeHealth = {
  reachable: boolean;
  pipelineAvailable: boolean;
  binaryPath?: string;
  credentialOk: boolean;
  credentialKind: "subscription" | "api-key" | null;
  version?: string;
  error?: string;
  billingOk: boolean;
  billingError?: string;
  openspecOk: boolean;
  openspecVersion?: string;
  openspecBrokenHint: string;
  skillsOk: boolean;
  missingSkills: string[];
  skillsDetail?: string;
  skillsBrokenHint: string;
  notesSkillsOk: boolean;
  missingNotesSkills: string[];
  notesSkillsBrokenHint: string;
};

type PipelineStatus = {
  available: boolean;
};

type UiActionPayload = {
  action: string;
  target_id?: string;
  query?: string;
};

type UiMode = "deck" | "hud";

// The canonical excalidraw scene JSON (serializeAsJSON's shape) — main only
// caches/persists it, never inspects `elements`/`appState` contents, so this
// stays loosely typed (hud-drawing-canvas design.md D5).
type CanvasScene = {
  type: string;
  version?: number;
  source?: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  // The cache's monotonic revision, stamped onto the served scene by main
  // (the-canvas-stops-fighting-back). It rides INSIDE the scene object rather
  // than beside it so `canvas:get-scene` keeps its shape and excalidraw's
  // `restore()` keeps receiving the object it already understood; the renderer
  // reads it and strips it before restoring.
  irisRevision?: number;
};

// What the renderer pushes over `canvas:scene`: the scene plus the revision it
// was derived from, so main can tell a fresh write from one that raced a write
// it has already accepted (null = the renderer has not seen a revision yet).
type CanvasScenePush = { scene: CanvasScene; baseRevision: number | null };

type NativeFileResult = { canceled: true } | { canceled: false; filePath: string };

// second-brain-galaxy-view (design.md D3): position-free — the renderer's
// force simulation owns x/y/z. `path` is never sent over the wire (D8/L-1);
// a ghost node (unresolved wikilink target) is not openable.
type VaultGraphNode = {
  id: string;
  title: string;
  tags: string[];
  ghost: boolean;
  malformed: boolean;
};

type VaultGraphLink = {
  source: string;
  target: string;
};

type VaultGraph = {
  nodes: VaultGraphNode[];
  links: VaultGraphLink[];
};

type SecondBrainAvailability = {
  available: boolean;
};

// ambient-memory: `enabled` is the renderer's own last-sent preference,
// `live` is whether retention is actually happening right now (enabled AND
// awake), and `forcedOff` mirrors IRIS_AMBIENT_CAPTURE=off — when true the
// toggle is not offered at all.
type AmbientCaptureState = {
  enabled: boolean;
  live: boolean;
  forcedOff: boolean;
};

type SecondBrainGraphResult = {
  graph: VaultGraph;
  available: boolean;
};

// voice-finds-a-note: one name match, as `electron/note-name-match.mjs` ranks
// it. `tags`/`ghost` travel so the renderer can colour the entry with the same
// `colorForNode` the node's own dot uses — main decides the order, never the
// colour. The array's order IS the answer; nothing downstream re-ranks it.
type NoteNameMatchResult = {
  id: string;
  title: string;
  tags: string[];
  ghost: boolean;
  linkCount: number;
  openable: boolean;
};

type SecondBrainFindNotesResult = {
  matches: NoteNameMatchResult[];
  available: boolean;
};

// `revision` is the token the note editor hands back on save
// (add-manual-note-editing): a hash of the exact content served, so main can
// refuse a write when the file no longer holds those bytes.
type SecondBrainReadNoteResult = { ok: true; content: string; revision: string } | { ok: false };

// `stale` means the file changed since it was read — the caller keeps the
// user's draft and may re-issue with `force`. `refused` means the write was
// rejected outright (unknown/ghost id, escaped the vault, unacceptable content).
type SecondBrainWriteNoteResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "stale" | "refused" };

// second-brain-focus (design D1/D2): resolved fresh against the live graph on
// every read — never a cached title/tag snapshot, so a renamed or deleted
// note just resolves differently the next time this is read.
type FocusedNote = {
  id: string;
  title: string;
  tags: string[];
};

type SecondBrainFocusState = {
  ids: string[];
  notes: FocusedNote[];
};

type SecondBrainToggleFocusResult = { ok: false } | ({ ok: true } & SecondBrainFocusState);

// canvas-claude-mcp (design.md D3/D4): a Claude-originated write, applied to
// the live scene while the panel is mounted. Always the FULL post-write
// element set (updateScene replaces the whole array — see DrawingCanvas.tsx).
type CanvasApplyPayload = {
  elements: unknown[];
  // The cache revision this apply produced, and the ids Claude actually
  // added/changed/deleted. `changedIds` is what makes an apply a MERGE rather
  // than a whole-scene replace: every other element on the live canvas is the
  // user's and is left exactly as it is. Both optional so a renderer built
  // against the older payload still applies.
  revision?: number;
  changedIds?: string[];
};

// The reply to a `canvas:scene` push: the revision the cache now holds, and
// whether it reached disk (the size guard may drop it).
type CanvasSceneAck = { revision: number; persisted: boolean };

type CanvasImageRequestPayload = {
  id: string;
};

type CanvasImagePayload = {
  mimeType: string;
  data: string;
} | null;

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
  listVerbs: (workstreamId?: string) => Promise<VerbsSnapshot>;
  getLegacyClaudeArtifacts: () => Promise<LegacyClaudeArtifacts>;
  removeLegacyClaudeArtifacts: () => Promise<LegacyCleanupResult>;
  setVerbModel: (
    workstreamId: string,
    verb: Verb,
    model: string,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string; verbs?: Verb[]; shared?: boolean }>;
  answerClaudeQuestion: (answers: ClaudeQuestionAnswer[]) => Promise<{ status: string; error?: string }>;
  getPromptStatus: () => Promise<PromptReviewStatus>;
  resolvePromptReview: (payload: {
    action: PromptReviewResolveAction;
    editedTask?: string;
  }) => Promise<{ status: string; error?: string }>;
  setPromptReviewMode: (mode: ReviewMode) => Promise<{ status: string; reviewMode: ReviewMode; error?: string }>;
  sendContextSupplement: (text: string) => Promise<{ status: string; error?: string }>;
  toggleHud: () => Promise<{ mode: UiMode }>;
  setHudInteractive: (on: boolean) => void;
  activateDrawingCanvas: () => void;
  // Fire-and-forget today (`ipcRenderer.send`), so the return is `undefined`.
  // Typed as optionally-a-promise because the main-side seam acknowledges a
  // push with the revision it produced; the renderer consumes the ack when one
  // is there and carries on when it is not.
  saveCanvasScene: (push: CanvasScenePush) => Promise<CanvasSceneAck> | undefined;
  getCanvasScene: () => Promise<CanvasScene | null>;
  nativeOpenCanvasFile: () => Promise<{ canceled: true } | { canceled: false; content: string }>;
  nativeSaveCanvasFile: (content: string, suggestedName?: string) => Promise<NativeFileResult>;
  nativeExportCanvasImage: (
    data: string,
    format: "png" | "svg",
    suggestedName?: string,
  ) => Promise<NativeFileResult>;
  onCanvasApply: (callback: (payload: CanvasApplyPayload) => void) => () => void;
  /** Main asking the panel to push what it is still holding, before a run reads it. */
  onCanvasFlushRequest: (callback: () => void) => () => void;
  onCanvasImageRequest: (callback: (payload: CanvasImageRequestPayload) => void) => () => void;
  replyCanvasImage: (id: string, image: CanvasImagePayload) => void;
  windowControl: (action: "close" | "minimize") => void;
  onHudMode: (callback: (payload: { mode: UiMode }) => void) => () => void;
  onWindowFocus: (callback: (payload: { focused: boolean }) => void) => () => void;
  onWakeRequest: (callback: () => void) => () => void;
  requestListenOnlyToggle: () => void;
  // The payload carries main's RESOLVED system-audio configuration alongside
  // the mode state (listen-mode-hears-system-audio 1.3), so the renderer's
  // capture graph never reads the environment a second time and never attempts
  // a capture the main-side escape hatch disabled.
  getListenOnlyState: () => Promise<ListenOnlyState>;
  onListenOnlyState: (callback: (payload: ListenOnlyState) => void) => () => void;
  // A capture that could not be acquired at all is REPORTED to main, which
  // owns the mode and decides to disengage. Never a report of mode state.
  reportSystemAudioUnavailable: (reason: string) => void;
  // The OS's own permission answer, read in main. Never
  // navigator.permissions.query: the app grants its own document capture
  // unconditionally, so the renderer's store reports the app's decision back
  // as the user's (setup-panel: "The Permissions step reports the operating
  // system's answer").
  queryOsPermissions: () => Promise<OsPermissionsSnapshot>;
  requestOsPermission: (
    permission: OsPermission,
  ) => Promise<{ state: OsPermissionState; prompted: boolean }>;
  openPermissionSettings: (
    permission: OsPermission,
  ) => Promise<{ opened: boolean; writtenPath?: string }>;
  armSystemAudioSelfTest: () => Promise<{ armed: boolean; expiresAt?: number }>;
  disarmSystemAudioSelfTest: () => void;
  getConfig: () => Promise<IrisConfig>;
  saveConfig: (updates: Partial<Record<string, string>>) => Promise<IrisConfig>;
  saveClaudeToken: (token: string, key?: ClaudeCredentialKey) => Promise<ClaudeTokenResult>;
  removeClaudeToken: (key?: ClaudeCredentialKey) => Promise<ClaudeTokenResult>;
  testGemini: (key: string) => Promise<{ ok: boolean; error?: string }>;
  testClaude: () => Promise<ClaudeHealth>;
  getPipelineStatus: () => Promise<PipelineStatus>;
  previewVoice: (payload: { voice: string; key: string }) => Promise<{ ok: boolean; error?: string }>;
  sendUiContext: (context: UiContextSnapshot) => void;
  notifyBootDone: () => void;
  onUiAction: (callback: (payload: UiActionPayload) => void) => () => void;
  onSleepRequest: (callback: () => void) => () => void;
  sendAudioChunk: (chunk: ArrayBuffer) => void;
  onAudioChunk: (callback: (chunk: LiveAudioChunk) => void) => () => void;
  onAudioInterrupt: (callback: () => void) => () => void;
  onSidecarEvent: (callback: (event: SidecarEvent) => void) => () => void;
  getSecondBrainAvailability: () => Promise<SecondBrainAvailability>;
  getSecondBrainGraph: () => Promise<SecondBrainGraphResult>;
  readSecondBrainNote: (id: string) => Promise<SecondBrainReadNoteResult>;
  findSecondBrainNotes: (query: string) => Promise<SecondBrainFindNotesResult>;
  writeSecondBrainNote: (
    id: string,
    content: string,
    revision: string,
    force?: boolean,
  ) => Promise<SecondBrainWriteNoteResult>;
  openSecondBrainNoteExternally: (id: string) => Promise<{ ok: boolean }>;
  activateSecondBrain: () => void;
  deactivateSecondBrain: () => void;
  onSecondBrainGraphUpdated: (callback: (graph: VaultGraph) => void) => () => void;
  onSecondBrainNameMatches: (
    callback: (payload: { query: string; matches: NoteNameMatchResult[] }) => void,
  ) => () => void;
  onSecondBrainOpenNote: (callback: (payload: { id: string; title: string }) => void) => () => void;
  // open-note-session: reports the note reader's open/close lifecycle to
  // main, which is the single authority on which note is open.
  reportNoteOpened: (id: string) => void;
  reportNoteClosed: () => void;
  // second-brain-focus: toggles one node's membership in the shared focus —
  // the hand's tap and a mouse click both call this the same way.
  toggleSecondBrainFocus: (id: string) => Promise<SecondBrainToggleFocusResult>;
  getSecondBrainFocus: () => Promise<SecondBrainFocusState>;
  clearSecondBrainFocus: () => Promise<SecondBrainFocusState>;
  // ambient-memory: the renderer's persisted preference is the only way main
  // ever turns retention on (design D1) — a one-way send, mirroring
  // requestListenOnlyToggle's shape. Whether it is actually LIVE right now
  // (also gated on being awake) arrives over the query/push pair below.
  setAmbientCaptureEnabled: (enabled: boolean) => void;
  getAmbientCaptureState: () => Promise<AmbientCaptureState>;
  onAmbientCaptureState: (callback: (payload: { live: boolean }) => void) => () => void;
  // eye-tracking-hud: host measurements for the readout panel. Sampling runs
  // only while the camera is on, so the renderer starts and stops it — but it
  // never reports a value back, and nothing outside the camera overlays reads
  // one.
  startSystemTelemetry: () => void;
  stopSystemTelemetry: () => void;
  onSystemTelemetrySample: (callback: (sample: TelemetrySample) => void) => () => void;
  // token-accounting: what each paid engine has reported consuming this app
  // session. A pull as well as a push, because counting is never gated on the
  // camera — only the delivery is, so a panel opening late has to be able to
  // ask for the session so far. Nothing outside the camera overlays reads these
  // figures, and nothing in the app acts on them.
  getTokenUsage: () => Promise<TokenUsageSnapshot>;
  subscribeTokenUsage: () => void;
  onTokenUsage: (callback: (snapshot: TokenUsageSnapshot) => void) => () => void;
};

/**
 * One host measurement. `cpu`/`gpu` are 0..1 fractions, `netRx`/`netTx` bytes
 * per second, `at` a wall-clock timestamp from the main process.
 *
 * `null` is the single absence signal for every reason a value can be missing —
 * no delta computable yet, the probe failed or timed out, this host has no such
 * counter, or the platform offers no such measurement. It is never zero: zero is
 * a claim about the machine, and absence is the truth.
 */
type TelemetrySample = {
  at: number;
  cpu: number | null;
  gpu: number | null;
  netRx: number | null;
  netTx: number | null;
};

/**
 * The token account, per app session: one figure set per paid engine, never a
 * combined total across the two. `total` is the session's running total, `last`
 * what the most recent call added, `at` when that account last CHANGED — which
 * is also the event signal the ring's alert detects a finished run by, so it is
 * never restamped when nothing changed.
 *
 * `null` is absence throughout, on the same rule as TelemetrySample and for a
 * sharper reason here: a reported zero is a real value (an exchange that
 * consumed nothing countable), while absence means the engine has not been used
 * or is not configured at all — the ordinary state of the build engine with no
 * Claude credential.
 *
 * `cacheRead` is Claude's alone and is never added into its `total`: cached
 * reads routinely exceed everything else by an order of magnitude while costing
 * a fraction per token.
 */
type TokenUsageAccount = {
  total: number | null;
  last: number | null;
  at: number | null;
};

type TokenUsageSnapshot = {
  gemini: TokenUsageAccount;
  claude: TokenUsageAccount & { cacheRead: number | null };
};

interface Window {
  iris: IrisApi;
  // Read by @excalidraw/excalidraw to resolve its fonts locally instead of
  // its default CDN (hud-drawing-canvas design.md D1).
  EXCALIDRAW_ASSET_PATH?: string;
}
