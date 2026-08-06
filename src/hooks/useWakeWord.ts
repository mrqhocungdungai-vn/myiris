import { useEffect, useRef } from "react";
import * as ort from "onnxruntime-web";
import { createWakeGate, type WakeGate } from "../lib/wake-gate";
import { SYSTEM_DEFAULT_MIC, micConstraints } from "../lib/mic-device";
import { configureOrt, createSession } from "../lib/onnx-runtime";
import { createSpeechConfirmation, type SpeechConfirmation } from "../lib/speech-confirmation";

// Local "Hey Iris" wake word. Ports the livekit-wakeword / openWakeWord inference
// pipeline (mel-spectrogram -> speech embedding -> classifier) to the browser via
// onnxruntime-web. Fully on-device: audio never leaves the machine, and nothing is
// sent to Gemini/Claude until a wake fires. Models live in public/wakeword/.
//
// A wake needs two agreeing signals, not one thresholded harder
// (speech-confirmed-wake-word): the phrase chain above, and Silero VAD on the
// same mic stream confirming a human voice. The phrase classifier was trained
// on synthesized speech and scores confidently on non-speech sound, and no
// threshold on its own output can detect that, because it is the model that is
// wrong. The two run on different audio contracts — the phrase chain re-reads a
// 2s ring buffer every 200 ms, while the VAD is recurrent and needs contiguous
// non-overlapping 512-sample frames — so the VAD is fed through its own
// accumulator rather than the ring buffer.

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
// How far apart the phrase detection and the speech confirmation may be, in
// either direction. Sized off the phrase chain, not guessed: the classifier
// scores a 2s window and needs `consecutive` evaluations 200 ms apart to
// confirm, so a spoken "Hey Iris" is already over ~400-1200 ms before the
// detection lands. Anything tighter would drop real wakes, which is the failure
// mode that actually matters here.
const SPEECH_WINDOW_MS = 1500;
// After this many phrase detections in a row that speech never confirmed, the
// listener says so (speech-confirmed-wake-word). Silence has a specified
// meaning already; a VAD that loads fine and simply never agrees is a new way
// to be silent — armed, caption inviting the phrase, nothing happening.
const SPEECH_BLOCKED_NOTICE_COUNT = 3;

type WakeSessions = { mel: ort.InferenceSession; emb: ort.InferenceSession; cls: ort.InferenceSession };

// Load the three ONNX models once and reuse them across every arm/disarm cycle, so
// re-arming after Iris sleeps is instant (no "loading models" gap where a spoken
// "Hey Iris" would be missed).
let sessionsPromise: Promise<WakeSessions> | null = null;
function getSessions(): Promise<WakeSessions> {
  if (!sessionsPromise) {
    sessionsPromise = (async () => {
      configureOrt();
      // Left relative, deliberately: fetch() resolves against the document's
      // base URL, not the importing module, so these already land on
      // dist/wakeword/ in both environments — unlike configureOrt()'s
      // dynamic-import path above, which needed the fix (design D5).
      // Confirmed by the observed failure being "no available backend
      // found" rather than a 404 from createSession's fetch check, i.e. all
      // three model loads succeeded even on the broken build.
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
  // Non-fatal only: the listener is running, but something about it is
  // degraded. Two cases today — the selected microphone was unavailable and it
  // fell back to System Default (fallbackDeviceId is present), or speech
  // confirmation could not be loaded and wake is running on the phrase signal
  // alone (no fallbackDeviceId). A fatal init failure — the listener is not
  // running — goes through onInitFailed instead, so one channel doesn't have to
  // carry two opposite meanings (design D3).
  onError?: (message: string, fallbackDeviceId?: string) => void,
  deviceId: string = SYSTEM_DEFAULT_MIC,
  // Fired once the prediction interval is installed and the effect has not
  // been cancelled in the meantime — the listener's only "armed" signal
  // (design D3). Recovery (clearing a prior init failure) depends on this;
  // without it, the only lever is the enabled/deviceId effect re-run, which
  // clears on re-arm *attempt* rather than on success.
  onReady?: () => void,
  // Fatal: the listener is not running. Kept separate from onError so a
  // permanent "failed" affordance can't land on a working listener whose
  // saved microphone merely fell back to System Default.
  onInitFailed?: (message: string) => void,
  // The listener is running and hearing the phrase, but speech confirmation
  // has withheld every wake for SPEECH_BLOCKED_NOTICE_COUNT detections in a
  // row. Fired once per arm. Not a fault — it is also what success looks like
  // when a television says "Hey Iris" — but it is indistinguishable from one
  // from where the user sits, and both have the same remedy, so it needs a
  // surface rather than a debug log (speech-confirmed-wake-word).
  onSpeechBlocked?: () => void,
) {
  const onWakeRef = useRef(onWake);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const onInitFailedRef = useRef(onInitFailed);
  const onSpeechBlockedRef = useRef(onSpeechBlocked);
  const settingsRef = useRef(settings);
  onWakeRef.current = onWake;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  onInitFailedRef.current = onInitFailed;
  onSpeechBlockedRef.current = onSpeechBlocked;
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
      speechWindowMs: SPEECH_WINDOW_MS,
    });

    // The gate's second input. `speechAvailable` and `lastSpeechAt` are
    // mirrored here for two reasons: a settings change builds a *new* gate, and
    // whether a detector exists is not a fact a sensitivity save should
    // silently revoke; and the diagnostics below need to name which signal was
    // missing without reading the decision back out of the gate.
    let speechAvailable = false;
    let lastSpeechAt: number | null = null;
    const speech: SpeechConfirmation = createSpeechConfirmation({
      onSpeech: (at) => {
        lastSpeechAt = at;
        gate.noteSpeech(at);
      },
      onAvailability: (available) => {
        speechAvailable = available;
        gate.setSpeechAvailable(available);
      },
      // Degraded, not fatal: the listener keeps running and the wake decision
      // continues on the phrase signal alone, so this goes to onError (the
      // "running but degraded" channel), never onInitFailed.
      onDegraded: (reason, error) => {
        console.error(`[wakeword] ${reason} — continuing on the phrase signal alone`, error);
        onErrorRef.current?.(`${reason} — wake is running on the phrase signal alone`);
      },
    });

    // Diagnostics-only bookkeeping (design D6): mirrors the gate's above-threshold
    // run length purely for the log line — it does not participate in the wake
    // decision, which stays the gate's sole responsibility.
    let diagRun = 0;
    let diagLastEvalAt: number | null = null;
    let lastNearMissLogAt = -Infinity;
    // Distinct phrase detections that speech never confirmed, counted since
    // this arm. Reset by a wake, since a wake proves the pairing works.
    let blockedCandidates = 0;
    let speechBlockedNotified = false;

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
            speechWindowMs: SPEECH_WINDOW_MS,
          });
          // A held candidate goes with the old gate, exactly as an in-flight
          // run does (design D2) — it was counted against the previous
          // threshold. The last-speech timestamp goes too, and is not restored:
          // verdicts arrive every ~32 ms, so it repopulates within one frame if
          // anyone is still speaking. Availability is not the gate's to
          // rediscover, so it is re-applied.
          gate.setSpeechAvailable(speechAvailable);
        }

        const now = performance.now();

        const diagGapTooLarge = diagLastEvalAt !== null && now - diagLastEvalAt > MAX_GAP_MS;
        diagLastEvalAt = now;
        diagRun = score >= gateThreshold ? (diagGapTooLarge ? 1 : diagRun + 1) : 0;

        // Which of the two signals was present, for diagnostics and for the
        // blocked-candidate notice. Derived from what this hook already knows
        // rather than read back out of the gate, so the decision stays the
        // gate's alone (design D6).
        const phraseHeard = diagRun >= gateConsecutive;
        const voiceHeard = lastSpeechAt !== null && now - lastSpeechAt <= SPEECH_WINDOW_MS;
        // How long ago the voice was last confirmed, not just whether it was
        // inside the window. "absent" alone cannot tell "you were not speaking"
        // from "the detector never fires at all", and those need opposite fixes.
        const voiceAge =
          !speechAvailable ? "no speech signal" : lastSpeechAt === null ? "voice never" : `voice ${Math.round(now - lastSpeechAt)}ms ago`;

        const fired = gate.step(score, now);
        if (fired) {
          onWakeRef.current();
          blockedCandidates = 0;
          if (settings.debug) console.log(`[wakeword] fired score=${score.toFixed(3)} run=${diagRun}`);
        } else if (phraseHeard && speechAvailable && !voiceHeard) {
          // The phrase without a voice: the case this second signal exists for.
          // Counted once per contiguous above-threshold run, since diagRun
          // returns to zero on any evaluation below the threshold.
          if (diagRun === gateConsecutive) blockedCandidates += 1;
          if (blockedCandidates >= SPEECH_BLOCKED_NOTICE_COUNT && !speechBlockedNotified) {
            speechBlockedNotified = true;
            onSpeechBlockedRef.current?.();
          }
          if (settings.debug && now - lastNearMissLogAt >= NEAR_MISS_LOG_INTERVAL_MS) {
            lastNearMissLogAt = now;
            console.log(
              `[wakeword] no wake: phrase heard (score=${score.toFixed(3)} run=${diagRun}) but no voice confirmed — ${voiceAge}`,
            );
          }
        } else if (
          settings.debug &&
          score < gateThreshold &&
          score >= gateThreshold * NEAR_MISS_FRACTION &&
          now - lastNearMissLogAt >= NEAR_MISS_LOG_INTERVAL_MS
        ) {
          lastNearMissLogAt = now;
          console.log(
            `[wakeword] near-miss score=${score.toFixed(3)} threshold=${gateThreshold} — phrase not heard (${voiceAge})`,
          );
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

          // Speech confirmation taps this same callback rather than opening a
          // second capture — no getUserMedia change, so the no-capture-gap rule
          // is untouched. It re-chunks internally; the ring buffer above cannot
          // be reused for it, since that deliberately re-presents overlapping
          // audio on every evaluation.
          speech.push(input);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        timer = window.setInterval(predict, PREDICT_INTERVAL_MS);
        if (!cancelled) onReadyRef.current?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[wakeword] init failed", error);
        onInitFailedRef.current?.(message);
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
      // The VAD's recurrent state and its half-filled frame both describe a
      // stream that has now ended, so neither may carry into the next arm —
      // stop() drops them, and the next arm builds a fresh detector over the
      // same cached session.
      speech.stop();
      // NOTE: ONNX sessions are cached module-level and intentionally NOT released
      // here, so re-arming after sleep is instant.
    };
    // Only enabled/deviceId belong here: a device change fundamentally cannot
    // apply to an already-open stream and must re-acquire, while settings
    // (threshold/consecutive/debug) are deliberately ref-threaded above so a
    // sensitivity save never tears down and re-acquires the microphone.
  }, [enabled, deviceId]);
}
