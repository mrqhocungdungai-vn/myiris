import * as ort from "onnxruntime-web";
import { configureOrt, createSession } from "./onnx-runtime";
import { createFrameAccumulator } from "./frame-accumulator";
import {
  createSileroVad,
  SILERO_VAD_MODEL_SUBPATH,
  VAD_FRAME_SAMPLES,
  VAD_SPEECH_THRESHOLD,
  type SileroVad,
} from "./silero-vad";

// The speech half of the wake decision (speech-confirmed-wake-word): loads
// Silero VAD, re-chunks whatever audio it is handed into the contiguous frames
// a recurrent model needs, and reports the times a human voice was confirmed.
// Owns nothing about audio capture and nothing about the wake decision — the
// caller taps its own mic stream in, and feeds the timestamps out to the gate.
//
// Everything here fails toward waking. A model that will not load, or an
// inference that throws, degrades this to inert and says so; the caller then
// decides on the phrase signal alone rather than losing hands-free wake.

// Bounded backlog of frames. Inference is async and frames arrive from an
// audio callback, so a slow frame must not grow an unbounded queue whose
// verdicts describe audio from seconds ago. ~256 ms; the oldest is dropped.
const MAX_PENDING_FRAMES = 8;

export type SpeechConfirmationHandlers = {
  /** A human voice was confirmed, at this `performance.now()` timestamp. */
  onSpeech(at: number): void;
  /**
   * The detector became live, or stopped being one. Distinct from "no voice
   * right now": only a live detector's silence may block a wake.
   */
  onAvailability(available: boolean): void;
  /** Degraded to inert, with a reason worth surfacing. Fired at most once. */
  onDegraded(reason: string, error: unknown): void;
};

export type SpeechConfirmation = {
  /** Feed raw mic audio of any length; frames are cut from it internally. */
  push(chunk: Float32Array): void;
  /** Detach permanently: no further verdicts, and a pending load is ignored. */
  stop(): void;
};

// Deliberately its own cached promise rather than joining the phrase models'
// shared Promise.all in useWakeWord: in there, a failure to load this model
// would null the shared cache, rethrow, reach onInitFailed and take down the
// whole listener — turning "speech confirmation is unavailable" into
// "hands-free wake is unavailable", the exact inverse of failing open.
let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      configureOrt();
      // Relative deliberately: fetch() resolves against the document's base
      // URL, not the importing module, so this lands on dist/runtime/wakeword/
      // in dev and packaged alike. Only onnxruntime-web's own dynamic-import
      // path needed absolute resolution (renderer-content-security, design D5).
      return createSession(`${import.meta.env.BASE_URL}${SILERO_VAD_MODEL_SUBPATH}`);
    })().catch((error) => {
      sessionPromise = null; // allow a retry on the next arm
      throw error;
    });
  }
  return sessionPromise;
}

export function createSpeechConfirmation(handlers: SpeechConfirmationHandlers): SpeechConfirmation {
  const frames = createFrameAccumulator(VAD_FRAME_SAMPLES);
  const pending: Float32Array[] = [];
  let vad: SileroVad | null = null;
  let busy = false;
  let stopped = false;
  let degraded = false;
  let warnedBehind = false;

  function degrade(reason: string, error: unknown) {
    if (degraded || stopped) return;
    degraded = true;
    vad = null;
    pending.length = 0;
    handlers.onAvailability(false);
    handlers.onDegraded(reason, error);
  }

  async function drain() {
    if (busy || stopped || !vad) return;
    busy = true;
    try {
      while (pending.length > 0 && !stopped && vad) {
        const frame = pending.shift() as Float32Array;
        const probability = await vad.process(frame);
        if (probability >= VAD_SPEECH_THRESHOLD) handlers.onSpeech(performance.now());
      }
    } catch (error) {
      degrade("speech confirmation failed", error);
    } finally {
      busy = false;
    }
  }

  // Started at construction and never awaited: the caller arms on its own
  // models and picks this up whenever it is ready. Blocking on it would add
  // this model's load time to every arm — the window in which a spoken wake
  // word is missed — to buy nothing, since a wake during that window is
  // decided exactly as it was before this signal existed.
  getSession().then(
    (session) => {
      if (stopped) return;
      vad = createSileroVad(session);
      handlers.onAvailability(true);
    },
    (error) => {
      degrade("speech confirmation model could not be loaded", error);
    },
  );

  return {
    push(chunk) {
      if (!vad || stopped) return;
      frames.push(chunk, (frame) => {
        if (pending.length >= MAX_PENDING_FRAMES) {
          // Inference has fallen behind. Drop the oldest rather than queueing
          // verdicts about audio from seconds ago; the recurrent state goes
          // briefly stale, which Silero recovers from within a few frames, and
          // stale beats late for a signal that is only read against a window.
          pending.shift();
          if (!warnedBehind) {
            warnedBehind = true;
            console.warn("[wakeword] speech confirmation fell behind; dropping frames to stay current");
          }
        }
        pending.push(frame);
      });
      void drain();
    },
    stop() {
      stopped = true;
      vad = null;
      pending.length = 0;
      frames.reset();
    },
  };
}
