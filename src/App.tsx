import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Camera,
  ChevronRight,
  Hand,
  History,
  MessageSquare,
  Mic,
  MicOff,
  Power,
  Radio,
  Terminal,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ReactorCore from "./ReactorCore";
import BootSequence from "./BootSequence";
import { useHandControl, type HandState } from "./useHandControl";

type ReactorState = "idle" | "online" | "listening" | "speaking" | "working";

type TaskCard = {
  id: string;
  task: string;
  status: string;
  output?: string;
  error?: string;
  updatedAt: number;
};

type LogLine = {
  id: string;
  level: string;
  message: string;
  timestamp: number;
};

type TranscriptLine = {
  id: string;
  speaker: string;
  text: string;
};

const MAX_LOGS = 80;
const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "error"]);

// Static waveform silhouette: taller toward the center, with deterministic
// per-bar variation so it reads like an audio wave even at rest.
const PULSE_HEIGHTS = Array.from({ length: 56 }, (_, i) => {
  const envelope = Math.sin((Math.PI * i) / 55);
  const variation = 0.4 + 0.6 * Math.abs(Math.sin(i * 12.9898));
  return Math.max(0.12, envelope * variation);
});

function eventTime(event: SidecarEvent): number {
  return typeof event.timestamp === "number" ? event.timestamp * 1000 : Date.now();
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readStatusObject(value: unknown): {
  running?: boolean;
  pid?: number | null;
  model?: string;
  mode?: string;
} {
  if (!value || typeof value !== "object") return {};
  return value as { running?: boolean; pid?: number | null; model?: string; mode?: string };
}

function taskKeyFor(task: string): string {
  return `starting:${task.toLowerCase().trim()}`;
}

function shortRunId(id: string): string {
  if (!id || id === "pending") return "pending";
  if (id.startsWith("starting:")) return "starting";
  if (id.length <= 14) return id;
  return `${id.slice(0, 7)}…${id.slice(-5)}`;
}

function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const outputRate = 16000;
  if (inputRate === outputRate) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function parsePcmRate(mimeType?: string): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? "");
  return match ? Number(match[1]) : 24000;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeMarkdown(text?: string): string {
  if (!text) return "";
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ");
}

export default function App() {
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [sidecarPid, setSidecarPid] = useState<number | null>(null);
  const [geminiStatus, setGeminiStatus] = useState("offline");
  const [hermesStatus, setHermesStatus] = useState("offline");
  const [audioState, setAudioState] = useState("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [muted, setMuted] = useState(false);
  const [handControl, setHandControl] = useState(false);

  const hasBridge = typeof window.iris !== "undefined";
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    if (!hasBridge) return;
    window.iris.getSidecarStatus().then((status) => {
      setSidecarRunning(status.running);
      setSidecarPid(status.pid);
    });
    return window.iris.onSidecarEvent((event) => handleSidecarEvent(event));
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) return;
    const offAudio = window.iris.onAudioChunk((chunk) => playGeminiAudio(chunk));
    const offInterrupt = window.iris.onAudioInterrupt(() => flushPlayback());
    return () => {
      offAudio();
      offInterrupt();
    };
  }, [hasBridge]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const key = event.key.toLowerCase();
      if (key === "w" && !sidecarRunning) {
        event.preventDefault();
        start();
      } else if (key === "s" && sidecarRunning) {
        event.preventDefault();
        stop();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidecarRunning, hasBridge]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const working = useMemo(
    () => tasks.some((task) => !TERMINAL.has(task.status.toLowerCase())) && tasks.length > 0,
    [tasks],
  );

  const booting = sidecarRunning && geminiStatus !== "connected";

  const reactorState: ReactorState = useMemo(() => {
    if (!sidecarRunning) return "idle";
    if (audioState === "speaking") return "speaking";
    if (audioState === "listening") return "listening";
    if (working) return "working";
    if (geminiStatus === "connected") return "online";
    return "idle";
  }, [audioState, geminiStatus, sidecarRunning, working]);

  function pushLog(level: string, message: string, timestamp = Date.now()) {
    setLogs((current) =>
      [{ id: crypto.randomUUID(), level, message, timestamp }, ...current].slice(0, MAX_LOGS),
    );
  }

  async function startAudioCapture() {
    if (!hasBridge || inputContextRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(1024, 1, 1);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      const pcm = downsampleTo16k(input, context.sampleRate);
      if (pcm.byteLength > 0) {
        const chunk = new ArrayBuffer(pcm.byteLength);
        new Uint8Array(chunk).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        window.iris.sendAudioChunk(chunk);
      }
    };

    source.connect(processor);
    processor.connect(context.destination);

    inputContextRef.current = context;
    inputStreamRef.current = stream;
    inputSourceRef.current = source;
    inputProcessorRef.current = processor;
    pushLog("info", "WebRTC echo cancellation enabled for microphone.");
  }

  async function stopAudioCapture() {
    inputProcessorRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    await inputContextRef.current?.close().catch(() => undefined);

    inputProcessorRef.current = null;
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    inputContextRef.current = null;
  }

  function flushPlayback() {
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    playbackSourcesRef.current = [];
    if (outputContextRef.current) {
      playbackTimeRef.current = outputContextRef.current.currentTime;
    }
  }

  async function playGeminiAudio(chunk: LiveAudioChunk) {
    const rate = parsePcmRate(chunk.mimeType);
    const bytes = base64ToBytes(chunk.data);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;

    const context = outputContextRef.current ?? new AudioContext();
    outputContextRef.current = context;
    if (context.state === "suspended") await context.resume();

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const buffer = context.createBuffer(1, sampleCount, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((item) => item !== source);
    };

    const startAt = Math.max(context.currentTime + 0.03, playbackTimeRef.current || 0);
    source.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
  }

  function handleSidecarEvent(event: SidecarEvent) {
    if (event.type === "sidecar_status") {
      const status = readStatusObject(event.status);
      setSidecarRunning(Boolean(status.running));
      setSidecarPid(typeof status.pid === "number" ? status.pid : null);
      return;
    }

    if (event.type === "gemini_status") {
      setGeminiStatus(readString(event.status, "unknown"));
      return;
    }

    if (event.type === "hermes_status") {
      const status = readString(event.status, "unknown");
      setHermesStatus(status);
      pushLog(
        status === "error" ? "error" : "info",
        `Hermes ${status}${event.error ? `: ${readString(event.error)}` : ""}`,
        eventTime(event),
      );
      return;
    }

    if (event.type === "audio_state") {
      setAudioState(readString(event.state, "idle"));
      return;
    }

    if (event.type === "transcript") {
      const speaker = readString(event.speaker, "unknown");
      const text = readString(event.text);
      if (text.trim()) {
        setTranscript((current) =>
          [...current, { id: crypto.randomUUID(), speaker, text }].slice(-40),
        );
      }
      return;
    }

    if (event.type === "hermes_task_update") {
      const task = readString(event.task, "Hermes task");
      const rawRunId = readString(event.run_id);
      const runId = rawRunId || taskKeyFor(task);
      const status = readString(event.status, "unknown");
      const output = readString(event.output);
      const error = readString(event.error);

      setTasks((current) => {
        const existing = current.find((item) => item.id === runId);
        const placeholderId = taskKeyFor(task);
        const next: TaskCard = {
          id: runId,
          task,
          status,
          output: output || existing?.output,
          error: error || existing?.error,
          updatedAt: eventTime(event),
        };
        return [
          next,
          ...current.filter((item) => item.id !== runId && item.id !== placeholderId),
        ].slice(0, 20);
      });
      return;
    }

    if (event.type === "hermes_completion") {
      pushLog("info", `Hermes returned: ${readString(event.task, "task complete")}`, eventTime(event));
      return;
    }

    if (event.type === "tool_call") {
      pushLog("info", `Gemini invoked ${readString(event.name, "tool")}`, eventTime(event));
      return;
    }

    if (event.type === "fatal") {
      pushLog("error", readString(event.message, "Fatal sidecar error"), eventTime(event));
      return;
    }

    if (event.type === "log") {
      pushLog(readString(event.level, "info"), readString(event.message), eventTime(event));
    }
  }

  async function start() {
    if (!hasBridge) {
      pushLog("error", "Electron bridge unavailable. Launch with `npm run dev`.");
      return;
    }
    const status = await window.iris.startSidecar({ mode: "none" });
    setSidecarRunning(status.running);
    setSidecarPid(status.pid);
    await startAudioCapture();
    setHandControl(true);
  }

  async function stop() {
    if (!hasBridge) return;
    await stopAudioCapture();
    flushPlayback();
    await window.iris.stopSidecar();
    setGeminiStatus("offline");
    setHermesStatus("offline");
    setAudioState("idle");
    setMuted(false);
    setHandControl(false);
  }

  function dotState(value: string, goodValues: string[]) {
    if (!sidecarRunning) return "off";
    if (value === "error") return "err";
    return goodValues.includes(value) ? "on" : "warn";
  }

  const expandedTask = useMemo(
    () => tasks.find((task) => task.id === expandedTaskId) ?? null,
    [tasks, expandedTaskId],
  );
  const dwellRef = useRef<{ id: string; startedAt: number } | null>(null);

  const { state: hand, error: handError, stream: handStream } = useHandControl(handControl);
  const handCamRef = useRef<HTMLVideoElement | null>(null);
  const workScrollRef = useRef<HTMLDivElement | null>(null);
  const liveHandRef = useRef<HandState | null>(hand);
  liveHandRef.current = hand;

  useEffect(() => {
    if (handError) pushLog("error", `Hand control: ${handError}`);
  }, [handError]);

  useEffect(() => {
    if (handCamRef.current) {
      handCamRef.current.srcObject = handStream;
    }
  }, [handStream]);

  useEffect(() => {
    if (!handControl || !hand.present || !hand.point || !hand.pointing || expandedTaskId) {
      dwellRef.current = null;
      return;
    }

    const el = document.elementFromPoint(hand.point.x, hand.point.y);
    const card = el?.closest<HTMLElement>("[data-task-id]");
    const taskId = card?.dataset.taskId;
    if (!taskId || !card) {
      dwellRef.current = null;
      return;
    }

    const now = performance.now();
    if (dwellRef.current?.id !== taskId) {
      dwellRef.current = { id: taskId, startedAt: now };
      return;
    }

    if (now - dwellRef.current.startedAt > 850) {
      const task = tasks.find((item) => item.id === taskId);
      if (task) openTask(task);
      dwellRef.current = null;
    }
  }, [handControl, hand.present, hand.point?.x, hand.point?.y, expandedTaskId, tasks]);

  // Open-palm hold-to-scroll for the Work Stream column (same joystick model as
  // the reader): hold the hand high to scroll up, low to scroll down.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const h = liveHandRef.current;
      const body = workScrollRef.current;
      if (handControl && h?.openPalm && h.point && body && !expandedTaskId && !showHistory) {
        const rect = body.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const deadZone = Math.max(40, rect.height * 0.12);
        const delta = h.point.y - center;
        if (Math.abs(delta) > deadZone) {
          const reach = rect.height / 2 - deadZone;
          const norm = Math.max(-1, Math.min(1, (delta - Math.sign(delta) * deadZone) / reach));
          body.scrollTop += norm * 26;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [handControl, expandedTaskId, showHistory]);

  const handAction = useMemo(() => {
    if (!hand.present) return { label: "Show your hand", tone: "idle" };
    if (hand.fist) return { label: "Closed_Fist · close", tone: "fist" };
    if (hand.openPalm) return { label: "Open_Palm · scroll", tone: "open" };
    if (!hand.pointing) return { label: `${hand.gesture} · idle`, tone: "idle" };
    if (dwellRef.current) return { label: "Hold · opening", tone: "move" };
    return { label: "Pointing_Up · hover", tone: "move" };
  }, [hand.present, hand.fist, hand.openPalm, hand.pointing, hand.gesture, hand.point?.x, hand.point?.y]);

  function toggleMute() {
    const stream = inputStreamRef.current;
    const next = !muted;
    stream?.getAudioTracks().forEach((track) => (track.enabled = !next));
    setMuted(next);
  }

  const sortedTasks = useMemo(() => {
    const isActive = (task: TaskCard) => !TERMINAL.has(task.status.toLowerCase());
    return [...tasks].sort((a, b) => {
      const activeDelta = Number(isActive(b)) - Number(isActive(a));
      if (activeDelta !== 0) return activeDelta;
      return b.updatedAt - a.updatedAt;
    });
  }, [tasks]);

  const caption = useMemo(() => {
    if (!sidecarRunning) return { text: "Press W to wake Iris", dim: true };
    if (audioState === "speaking") return { text: "Speaking…", dim: false };
    if (audioState === "listening") return { text: "Listening…", dim: false };
    if (working) return { text: "Working on it…", dim: false };
    const last = transcript[transcript.length - 1];
    if (last) return { text: last.text, dim: false };
    if (geminiStatus === "connected") return { text: "How can I help?", dim: true };
    return { text: "Connecting…", dim: true };
  }, [sidecarRunning, audioState, working, transcript, geminiStatus]);

  const pulseActive = sidecarRunning && (audioState === "listening" || audioState === "speaking");

  function openTask(task: TaskCard) {
    if (!(task.output || task.error)) return;
    setExpandedTaskId(task.id);
    setShowHistory(false);
  }

  function closeReader() {
    setExpandedTaskId(null);
  }

  return (
    <>
    <div className="deck">
      <div className="hud-aurora" />
      <div className="hud-vignette" />

      <header className="deck-top">
        <div className="deck-top-left">
          <div className="deck-status">
            <StatusDot tone="gemini" state={dotState(geminiStatus, ["connected"])} label="Gemini" />
            <StatusDot tone="hermes" state={dotState(hermesStatus, ["ready"])} label="Hermes" />
            <StatusDot
              tone="audio"
              state={
                !sidecarRunning
                  ? "off"
                  : muted
                    ? "warn"
                    : audioState === "speaking"
                      ? "speaking"
                      : audioState === "idle"
                        ? "warn"
                        : "on"
              }
              label="Audio"
            />
          </div>
        </div>
        <div className="deck-brand">
          <span className="brand-mark">I.R.I.S</span>
        </div>
        <div className="deck-top-right">
          <button
            className={`theme-toggle ${handControl ? "active" : ""}`}
            onClick={() => setHandControl((current) => !current)}
            title={handControl ? "Disable hand control" : "Enable hand control (camera)"}
          >
            <Hand size={16} />
          </button>
          <span
            className={`link-indicator ${sidecarRunning ? "on" : "off"}`}
            title={sidecarRunning ? `Linked${sidecarPid ? ` · ${sidecarPid}` : ""}` : "Offline"}
          >
            <Radio size={16} />
          </span>
        </div>
      </header>

      <div className="deck-body">
        {/* LEFT — You */}
        <div className="deck-left">
          <section className="deck-panel comms">
            <div className="col-head">
              <MessageSquare size={14} />
              <span>Comms</span>
            </div>
            <div className="comms-scroll">
              {transcript.length === 0 ? (
                <p className="empty">No conversation yet. Wake Iris and start talking.</p>
              ) : (
                transcript.map((line) => {
                  const self = /you|user/i.test(line.speaker);
                  return (
                    <div className={`bubble ${self ? "self" : "iris"}`} key={line.id}>
                      <span className="who">{self ? "You" : "Iris"}</span>
                      {line.text}
                    </div>
                  );
                })
              )}
              <div ref={transcriptEndRef} />
            </div>
          </section>

          <section className="deck-panel camera-dock">
            <div className="col-head">
              <Camera size={14} />
              <span>Camera / Gesture</span>
            </div>
            {handControl ? (
              <div className="camera-frame">
                <video ref={handCamRef} autoPlay playsInline muted />
                <div className="cam-scan" />
                <span className="cam-status">
                  <i />
                  {hand.present ? "tracking" : "no hand"}
                </span>
                <span className={`gesture-chip ${handAction.tone}`}>
                  <span className="dot" />
                  {handAction.label}
                </span>
              </div>
            ) : (
              <div className="camera-off">
                Gesture control is off. Tap the hand icon to enable the camera.
              </div>
            )}
          </section>
        </div>

        {/* CENTER — Iris */}
        <div className="deck-center">
          <div className="orb-stage">
            <ReactorCore state={reactorState} />
          </div>
          <div className={`caption ${caption.dim ? "dim" : ""}`}>{caption.text}</div>
          <div
            className={`pulse ${pulseActive ? "active" : ""} ${audioState === "speaking" ? "speaking" : ""}`}
          >
            {PULSE_HEIGHTS.map((height, index) => (
              <span key={index} style={{ "--h": height } as CSSProperties} />
            ))}
          </div>
          {sidecarRunning ? (
            <div className="transport">
              <button
                className={`t-btn small ${muted ? "muted" : ""}`}
                onClick={toggleMute}
                title={muted ? "Unmute microphone" : "Mute microphone"}
              >
                {muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button className="t-btn small danger" onClick={stop} title="Sleep (S)">
                <Power size={18} />
              </button>
            </div>
          ) : (
            <div className="transport-hint">
              <span className="key">W</span> wake · <span className="key">S</span> sleep
            </div>
          )}
        </div>

        {/* RIGHT — Work */}
        <aside className="deck-panel deck-right">
          <div className="col-head">
            <Terminal size={14} />
            <span>Work Stream</span>
            {tasks.length > 0 ? <span className="count">{tasks.length}</span> : null}
            {tasks.length > 3 ? (
              <button className="view-all" onClick={() => setShowHistory(true)}>
                View all <ChevronRight size={12} />
              </button>
            ) : null}
          </div>
          <div className="work-scroll" ref={workScrollRef}>
            {tasks.length === 0 ? (
              <p className="empty">No Hermes runs yet. Ask Iris to take on a task.</p>
            ) : (
              sortedTasks.map((task) => (
                <WorkCard key={task.id} task={task} onOpen={() => openTask(task)} />
              ))
            )}
          </div>
        </aside>
      </div>

      <footer className="deck-foot">
        {logs[0] ? (
          <span className={`log ${logs[0].level}`}>
            <em>{new Date(logs[0].timestamp).toLocaleTimeString([], { hour12: false })}</em>
            {logs[0].message}
          </span>
        ) : (
          <span>system feed idle</span>
        )}
        <span className="build">IRIS · build 0.1.0</span>
      </footer>

      {booting && <BootSequence visible={booting} />}
    </div>

    {expandedTask ? (
      <ExpandedReader
        task={expandedTask}
        hand={handControl ? hand : null}
        onClose={closeReader}
      />
    ) : null}

    {showHistory ? (
      <HistoryDrawer
        tasks={sortedTasks}
        onOpen={openTask}
        onClose={() => setShowHistory(false)}
      />
    ) : null}

    {handControl && hand.present && hand.point ? (
      <div
        className={`hand-reticle ${dwellRef.current ? "dwell" : ""} ${hand.openPalm ? "open" : ""} ${hand.fist ? "fist" : ""}`}
        style={{ transform: `translate(${hand.point.x}px, ${hand.point.y}px)` }}
      >
        <span className="hand-ring" />
        <span className="hand-dot" />
      </div>
    ) : null}
    </>
  );
}

function StatusDot({ tone, state, label }: { tone: string; state: string; label: string }) {
  return (
    <span className={`status-dot ${tone} ${state}`}>
      <i />
      {label}
    </span>
  );
}

function WorkCard({ task, onOpen }: { task: TaskCard; onOpen: () => void }) {
  const expandable = Boolean(task.output || task.error);
  const status = task.status.toLowerCase();
  const active = !TERMINAL.has(status);
  return (
    <article
      className={`wcard ${active ? "working" : ""} ${expandable ? "expandable" : ""}`}
      data-task-id={expandable ? task.id : undefined}
      onClick={onOpen}
    >
      <div className="wcard-top">
        <span className={`badge ${status}`}>{task.status}</span>
        <code title={task.id}>{shortRunId(task.id)}</code>
      </div>
      <p className="wcard-task">{task.task}</p>
      {expandable ? (
        <div className="wcard-preview">{normalizeMarkdown(task.error || task.output)}</div>
      ) : null}
      {active ? (
        <div className="wcard-progress">
          <i />
        </div>
      ) : null}
    </article>
  );
}

function HistoryDrawer({
  tasks,
  onOpen,
  onClose,
}: {
  tasks: TaskCard[];
  onOpen: (task: TaskCard) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="history-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="history-card">
        <div className="history-head">
          <History size={15} />
          <span>Hermes History · {tasks.length}</span>
          <button className="reader-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="history-grid">
          {tasks.map((task) => (
            <WorkCard key={task.id} task={task} onOpen={() => onOpen(task)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpandedReader({
  task,
  hand,
  onClose,
}: {
  task: TaskCard;
  hand: HandState | null;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const handRef = useRef<HandState | null>(hand);
  handRef.current = hand;

  const CLOSE_DISTANCE = 160;

  function closeWithSnap() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeWithSnap();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing, onClose]);

  useEffect(() => {
    if (hand?.fist) closeWithSnap();
  }, [hand?.fist]);

  // Joystick-style hold-to-scroll: with an open palm, holding the hand above the
  // card's center scrolls up, below scrolls down, and the middle is a dead zone.
  // Speed is proportional to the distance from center and continues while held.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const h = handRef.current;
      const body = bodyRef.current;
      if (h?.openPalm && h.point && body) {
        const rect = body.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const deadZone = Math.max(40, rect.height * 0.12);
        const delta = h.point.y - center;
        if (Math.abs(delta) > deadZone) {
          const reach = rect.height / 2 - deadZone;
          const norm = Math.max(-1, Math.min(1, (delta - Math.sign(delta) * deadZone) / reach));
          body.scrollTop += norm * 26;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function beginDrag(clientX: number, clientY: number, target: HTMLElement, pointerId: number) {
    startRef.current = { x: clientX, y: clientY };
    setDragging(true);
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!startRef.current) return;
    setOffset({ x: clientX - startRef.current.x, y: clientY - startRef.current.y });
  }

  function endDrag() {
    if (!startRef.current) return;
    const distance = Math.hypot(offset.x, offset.y);
    startRef.current = null;
    setDragging(false);
    if (distance > CLOSE_DISTANCE) {
      closeWithSnap();
    } else {
      setOffset({ x: 0, y: 0 });
    }
  }

  const dim = Math.min(1, Math.hypot(offset.x, offset.y) / (CLOSE_DISTANCE * 2));

  return (
    <div
      className={`reader-backdrop ${closing ? "closing" : ""}`}
      style={{ opacity: 1 - dim * 0.6 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeWithSnap();
      }}
    >
      <article
        className={`reader-card ${dragging ? "dragging" : ""} ${closing ? "closing" : ""}`}
        style={{
          "--reader-transform": `translate(${offset.x}px, ${offset.y}px) scale(${1 - dim * 0.08})`,
        } as CSSProperties}
      >
        <header
          className="reader-grab"
          onPointerDown={(event) =>
            beginDrag(event.clientX, event.clientY, event.currentTarget, event.pointerId)
          }
          onPointerMove={(event) => dragging && moveDrag(event.clientX, event.clientY)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="reader-grip" />
          <span className={`badge ${task.status.toLowerCase()}`}>{task.status}</span>
          <code title={task.id}>{shortRunId(task.id)}</code>
          <button className="reader-close" onClick={closeWithSnap} title="Close">
            <X size={16} />
          </button>
        </header>
        <h2 className="reader-title">{task.task}</h2>
        <div className="reader-body" ref={bodyRef}>
          <div className={`markdown-body ${task.error ? "error" : ""}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {normalizeMarkdown(task.error || task.output)}
            </ReactMarkdown>
          </div>
        </div>
        <div className="reader-hint">
          {hand
            ? "Open palm — hold high to scroll up, low to scroll down · Fist to close"
            : "Scroll to read · Esc or × to close"}
        </div>
      </article>
    </div>
  );
}
