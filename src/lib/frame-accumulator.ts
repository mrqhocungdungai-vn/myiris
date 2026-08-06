export type FrameAccumulator = {
  /**
   * Buffers `chunk` and emits every complete frame it completes, in order.
   * Frames are contiguous and non-overlapping: concatenating everything emitted
   * reproduces the pushed audio exactly, minus the trailing partial frame.
   */
  push(chunk: Float32Array, emit: (frame: Float32Array) => void): void;
  /** Drops the partial frame in hand, so the next frame starts fresh. */
  reset(): void;
};

// Re-chunks a stream of arbitrary-length audio buffers into fixed-size frames
// (speech-confirmed-wake-word). A recurrent model like Silero VAD carries state
// between calls, so it needs each frame to start exactly where the last one
// ended — unlike the phrase model's ring buffer, which is re-read in full every
// evaluation and would feed the same audio repeatedly.
//
// Pure: no audio API, no model, no browser global, so the re-chunking is
// testable on its own.
export function createFrameAccumulator(frameSamples: number): FrameAccumulator {
  const pending = new Float32Array(frameSamples);
  let filled = 0;

  return {
    push(chunk, emit) {
      let offset = 0;
      while (offset < chunk.length) {
        const take = Math.min(frameSamples - filled, chunk.length - offset);
        pending.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === frameSamples) {
          // A copy, not a view: the consumer holds the frame across an await
          // while this buffer is already being refilled by the next callback.
          emit(pending.slice(0));
          filled = 0;
        }
      }
    },
    reset() {
      filled = 0;
    },
  };
}
