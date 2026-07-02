export function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
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

export function parsePcmRate(mimeType?: string): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? "");
  return match ? Number(match[1]) : 24000;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
