import * as ort from "onnxruntime-web";

// Silero VAD v5 — the speech half of the wake decision
// (speech-confirmed-wake-word). An independent second opinion on whether the
// audio that made the phrase classifier spike actually contained a human
// voice; the classifier cannot answer that about itself, because being wrong
// about non-speech sound is the error inside it.
//
// v5's signature, read off the pinned model rather than assumed:
//   input float32[1,512]  state float32[2,1,128]  sr int64 scalar
//   -> output float32[1,1] (speech probability)   stateN float32[2,1,128]
// v4 is a different graph (separate h/c [2,1,64]), which is why
// scripts/vendor-runtime-assets.mjs pins a tag and not `master`.

/** Fixed by the model: 512 samples at 16 kHz, ~32 ms per verdict. */
export const VAD_FRAME_SAMPLES = 512;
export const VAD_SAMPLE_RATE = 16000;
/** Under public/, so it resolves the same way the phrase models do. */
export const SILERO_VAD_MODEL_SUBPATH = "runtime/wakeword/silero_vad.onnx";
/**
 * Speech probability at or above this counts as a voice. Silero's own
 * recommended operating point; left at the default deliberately, since this
 * change is about adding a signal rather than tuning one.
 */
export const VAD_SPEECH_THRESHOLD = 0.5;

const STATE_DIMS = [2, 1, 128];
const STATE_SIZE = STATE_DIMS.reduce((a, b) => a * b, 1);

export type SileroVad = {
  /** Speech probability for one contiguous frame of `VAD_FRAME_SAMPLES`. */
  process(frame: Float32Array): Promise<number>;
  /** Forgets the recurrent state, for a stream that is starting over. */
  reset(): void;
};

// The state tensor is threaded call to call and is what makes frame contiguity
// matter: feeding overlapping or out-of-order audio does not error, it just
// makes the verdict quietly wrong.
export function createSileroVad(session: ort.InferenceSession): SileroVad {
  // ArrayBufferLike, not ArrayBuffer: `stateN` comes back off a tensor whose
  // buffer type ORT leaves open, and it is fed straight back in as `state`.
  let state: Float32Array<ArrayBufferLike> = new Float32Array(STATE_SIZE);
  const sr = new ort.Tensor("int64", BigInt64Array.of(BigInt(VAD_SAMPLE_RATE)), []);

  return {
    async process(frame) {
      const outputs = await session.run({
        input: new ort.Tensor("float32", frame, [1, frame.length]),
        state: new ort.Tensor("float32", state, STATE_DIMS),
        sr,
      });
      state = outputs.stateN.data as Float32Array;
      return (outputs.output.data as Float32Array)[0];
    },
    reset() {
      state = new Float32Array(STATE_SIZE);
    },
  };
}
