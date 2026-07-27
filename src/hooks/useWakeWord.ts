import { useEffect, useRef } from "react";
import * as ort from "onnxruntime-web";
import { createWakeGate, type WakeGate } from "../lib/wake-gate";
import { SYSTEM_DEFAULT_MIC, micConstraints } from "../lib/mic-device";

// Local "Hey Iris" wake word. Ports the livekit-wakeword / openWakeWord inference
// pipeline (mel-spectrogram -> speech embedding -> classifier) to the browser via
// onnxruntime-web. Fully on-device: audio never leaves the machine, and nothing is
// sent to Gemini/Claude until a wake fires. Models live in public/wakeword/.

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = SAMPLE_RATE * 2; // ~2s -> exactly 16 embeddings
const N_MEL = 32;
const EMB_WINDOW = 76; // mel frames per embedding
const EMB_STRIDE = 8; // mel frames between embeddings
const N_EMB = 16; // classifier input length
const PREDICT_INTERVAL_MS = 200;
const COOLDOWN_MS = 2500;
// A gap this much larger than the expected evaluation interval means two
// evaluations are no longer "adjacent" for run-confirmation purposes (design D3).
const MAX_GAP_MS = PREDICT_INTERVAL_MS * 3;
// Below-threshold scores at or above this fraction of the threshold are logged
// as near-misses when diagnostics are on (design D6) — fixed, not configurable.
const NEAR_MISS_FRACTION = 0.6;
const NEAR_MISS_LOG_INTERVAL_MS = 1000;

let ortConfigured = false;
function configureOrt() {
  if (ortConfigured) return;
  // Vendored under public/runtime/ort/ by scripts/vendor-runtime-assets.mjs
  // (renderer-content-security: no runtime-fetched script/WASM glue) — kept
  // in lockstep with the installed onnxruntime-web version by that script,
  // never a hand-copied CDN URL.
  //
  // onnxruntime-web loads its own wasm glue via a runtime `import(url)`.
  // Vite's dev server intercepts same-origin-relative dynamic imports and
  // refuses to serve public/ assets through them ("this file is in /public
  // ... should not be imported from source code") — a dev-server-only 500
  // that a fully-qualified absolute URL sidesteps (Vite treats any absolute
  // http(s) URL as already-resolved and leaves it alone, same as the CDN URL
  // this replaced always did). The relative BASE_URL path still runs in the
  // production build, where there is no dev transform pipeline to trip over.
  ort.env.wasm.wasmPaths = import.meta.env.DEV
    ? `${window.location.origin}/runtime/ort/`
    : `${import.meta.env.BASE_URL}runtime/ort/`;
  ort.env.wasm.numThreads = 1; // avoid SharedArrayBuffer / COOP-COEP requirements
  ortConfigured = true;
}

async function createSession(url: string): Promise<ort.InferenceSession> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
}

type WakeSessions = { mel: ort.InferenceSession; emb: ort.InferenceSession; cls: ort.InferenceSession };

// Load the three ONNX models once and reuse them across every arm/disarm cycle, so
// re-arming after Iris sleeps is instant (no "loading models" gap where a spoken
// "Hey Iris" would be missed).
let sessionsPromise: Promise<WakeSessions> | null = null;
function getSessions(): Promise<WakeSessions> {
  if (!sessionsPromise) {
    sessionsPromise = (async () => {
      configureOrt();
      const base = import.meta.env.BASE_URL;
      const [mel, emb, cls] = await Promise.all([
        createSession(`${base}wakeword/melspectrogram.onnx`),
        createSession(`${base}wakeword/embedding_model.onnx`),
        createSession(`${base}wakeword/hey_iris.onnx`),
      ]);
      return { mel, emb, cls };
    })().catch((error) => {
      sessionsPromise = null; // allow a retry on next arm if loading failed
      throw error;
    });
  }
  return sessionsPromise;
}

export type WakeWordSettings = {
  threshold: number;
  consecutive: number;
  debug: boolean;
};

export function useWakeWord(
  enabled: boolean,
  settings: WakeWordSettings,
  onWake: () => void,
  onError?: (message: string, fallbackDeviceId?: string) => void,
  deviceId: string = SYSTEM_DEFAULT_MIC,
) {
  const onWakeRef = useRef(onWake);
  const onErrorRef = useRef(onError);
  const settingsRef = useRef(settings);
  onWakeRef.current = onWake;
  onErrorRef.current = onError;
  settingsRef.current = settings;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let timer: number | null = null;

    let mel: ort.InferenceSession | null = null;
    let emb: ort.InferenceSession | null = null;
    let cls: ort.InferenceSession | null = null;

    const ring = new Float32Array(WINDOW_SAMPLES);
    let filled = 0;
    let busy = false;

    // The fire/hold/reset decision lives entirely in wake-gate (design D1-D3).
    // Settings can change live (via settingsRef) while this listener stays
    // armed; a settings change swaps in a freshly-constructed gate rather than
    // mutating the old one, which correctly discards any in-flight run counted
    // against the previous threshold (design D2).
    let gateThreshold = settingsRef.current.threshold;
    let gateConsecutive = settingsRef.current.consecutive;
    let gate: WakeGate = createWakeGate({
      threshold: gateThreshold,
      consecutive: gateConsecutive,
      cooldownMs: COOLDOWN_MS,
      maxGapMs: MAX_GAP_MS,
    });

    // Diagnostics-only bookkeeping (design D6): mirrors the gate's above-threshold
    // run length purely for the log line — it does not participate in the wake
    // decision, which stays the gate's sole responsibility.
    let diagRun = 0;
    let diagLastEvalAt: number | null = null;
    let lastNearMissLogAt = -Infinity;

    async function predict() {
      if (busy || cancelled || !mel || !emb || !cls || filled < WINDOW_SAMPLES) return;
      busy = true;
      try {
        // 1) Mel spectrogram over the 2s window -> [1, 1, T, 32], then x/10 + 2.
        const melInput = new ort.Tensor("float32", ring.slice(0), [1, WINDOW_SAMPLES]);
        const melResult = await mel.run({ [mel.inputNames[0]]: melInput });
        const melTensor = melResult[mel.outputNames[0]];
        const melData = melTensor.data as Float32Array;
        const frames = melTensor.dims[2] as number; // [1,1,T,32]

        const nWindows = Math.floor((frames - EMB_WINDOW) / EMB_STRIDE) + 1;
        if (nWindows < N_EMB) return;
        const startWindow = nWindows - N_EMB; // use the most recent 16 windows

        // 2) Build 16 mel windows -> embedding batch input [16, 76, 32, 1].
        const embInputData = new Float32Array(N_EMB * EMB_WINDOW * N_MEL);
        for (let w = 0; w < N_EMB; w++) {
          const winStartFrame = (startWindow + w) * EMB_STRIDE;
          for (let f = 0; f < EMB_WINDOW; f++) {
            const srcOffset = (winStartFrame + f) * N_MEL; // batch=ch=1 -> t*32 + m
            const dstOffset = (w * EMB_WINDOW + f) * N_MEL;
            for (let m = 0; m < N_MEL; m++) {
              embInputData[dstOffset + m] = melData[srcOffset + m] / 10 + 2;
            }
          }
        }
        const embInput = new ort.Tensor("float32", embInputData, [N_EMB, EMB_WINDOW, N_MEL, 1]);
        const embResult = await emb.run({ [emb.inputNames[0]]: embInput });
        const embData = embResult[emb.outputNames[0]].data as Float32Array; // [16,1,1,96] -> 16*96

        // 3) Classifier over the 16-embedding sequence -> score.
        const clsInput = new ort.Tensor("float32", embData.slice(0), [1, N_EMB, 96]);
        const clsResult = await cls.run({ [cls.inputNames[0]]: clsInput });
        const score = (clsResult[cls.outputNames[0]].data as Float32Array)[0];

        const settings = settingsRef.current;
        if (settings.threshold !== gateThreshold || settings.consecutive !== gateConsecutive) {
          gateThreshold = settings.threshold;
          gateConsecutive = settings.consecutive;
          gate = createWakeGate({
            threshold: gateThreshold,
            consecutive: gateConsecutive,
            cooldownMs: COOLDOWN_MS,
            maxGapMs: MAX_GAP_MS,
          });
        }

        const now = performance.now();

        const diagGapTooLarge = diagLastEvalAt !== null && now - diagLastEvalAt > MAX_GAP_MS;
        diagLastEvalAt = now;
        diagRun = score >= gateThreshold ? (diagGapTooLarge ? 1 : diagRun + 1) : 0;

        const fired = gate.step(score, now);
        if (fired) {
          onWakeRef.current();
          if (settings.debug) console.log(`[wakeword] fired score=${score.toFixed(3)} run=${diagRun}`);
        } else if (
          settings.debug &&
          score < gateThreshold &&
          score >= gateThreshold * NEAR_MISS_FRACTION &&
          now - lastNearMissLogAt >= NEAR_MISS_LOG_INTERVAL_MS
        ) {
          lastNearMissLogAt = now;
          console.log(`[wakeword] near-miss score=${score.toFixed(3)} threshold=${gateThreshold}`);
        }
      } catch (error) {
        // Best-effort: a single failed frame shouldn't kill the listener.
        console.error("[wakeword] predict failed", error);
      } finally {
        busy = false;
      }
    }

    async function init() {
      try {
        const sessions = await getSessions();
        mel = sessions.mel;
        emb = sessions.emb;
        cls = sessions.cls;
        if (cancelled) return;

        // AGC off (design D7): a quiet room otherwise gets normalised toward
        // full scale, feeding the model amplified ambient noise and distant
        // speech. Echo cancellation and noise suppression stay on. This is
        // the wake-word listener's own capture stream — useAudioPipeline's
        // conversation mic is untouched.
        const baseConstraints: MediaTrackConstraints = {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        };
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: micConstraints(baseConstraints, deviceId),
            video: false,
          });
        } catch (error) {
          if (deviceId === SYSTEM_DEFAULT_MIC) throw error;
          const message = error instanceof Error ? error.message : String(error);
          onErrorRef.current?.(
            `selected microphone unavailable (${message}), falling back to System Default`,
            SYSTEM_DEFAULT_MIC,
          );
          // Not epoch-guarded like useAudioPipeline's restartCapture: this
          // effect instance owns its own `cancelled` flag, and a deviceId
          // change tears down and re-runs the whole effect (dependency array
          // below), so there is no concurrent init() to race against here.
          stream = await navigator.mediaDevices.getUserMedia({
            audio: micConstraints(baseConstraints, SYSTEM_DEFAULT_MIC),
            video: false,
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        if (audioCtx.state === "suspended") await audioCtx.resume();
        source = audioCtx.createMediaStreamSource(stream);
        processor = audioCtx.createScriptProcessor(2048, 1, 1);

        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          event.outputBuffer.getChannelData(0).fill(0); // never echo mic to speakers
          const n = input.length;
          if (n >= ring.length) {
            ring.set(input.subarray(n - ring.length));
            filled = ring.length;
          } else {
            ring.copyWithin(0, n); // shift left by n
            ring.set(input, ring.length - n);
            filled = Math.min(ring.length, filled + n);
          }
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        timer = window.setInterval(predict, PREDICT_INTERVAL_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[wakeword] init failed", error);
        onErrorRef.current?.(message);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      try {
        processor?.disconnect();
        source?.disconnect();
      } catch {
        // best-effort
      }
      stream?.getTracks().forEach((track) => track.stop());
      audioCtx?.close().catch(() => undefined);
      gate.reset();
      // NOTE: ONNX sessions are cached module-level and intentionally NOT released
      // here, so re-arming after sleep is instant.
    };
    // Only enabled/deviceId belong here: a device change fundamentally cannot
    // apply to an already-open stream and must re-acquire, while settings
    // (threshold/consecutive/debug) are deliberately ref-threaded above so a
    // sensitivity save never tears down and re-acquires the microphone.
  }, [enabled, deviceId]);
}
