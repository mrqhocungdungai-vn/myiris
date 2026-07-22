// AudioWorkletProcessor for mic capture — downsamples the input channel to 16 kHz
// mono PCM and posts each chunk back to the main thread over the message port.
// Runs on the dedicated audio rendering thread, never the main/UI thread.
//
// Keep this algorithm line-for-line identical to src/lib/downsample.ts (design D3/D4,
// openspec/changes/unstall-render-and-audio) — an AudioWorklet runs in an isolated
// global scope and cannot import that module across all bundler/packaging setups, so
// the two are pinned together by a shared Vitest unit test on the lib copy instead.

function downsampleTo16k(input, inputRate) {
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

class MicDownsampleProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    const pcm = downsampleTo16k(input, sampleRate);
    if (pcm.byteLength > 0) {
      const bytes = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
      this.port.postMessage(bytes, [bytes]);
    }
    return true;
  }
}

registerProcessor("mic-downsample", MicDownsampleProcessor);
