import { describe, it, expect } from "vitest";
import { downsampleTo16k } from "./downsample";

describe("downsampleTo16k", () => {
  it("averages 48 kHz input down to 16 kHz (3:1 ratio)", () => {
    const input = new Float32Array([0.5, 0.5, 0.5, -0.5, -0.5, -0.5]);
    const output = downsampleTo16k(input, 48000);
    expect(output.length).toBe(2);
    expect(output[0]).toBe(16383); // 0.5 * 0x7fff, truncated
    expect(output[1]).toBe(-16384); // -0.5 * 0x8000
  });

  it("passes 16 kHz input through unchanged (identity rate)", () => {
    const input = new Float32Array([1, -1, 0.25, -0.25]);
    const output = downsampleTo16k(input, 16000);
    expect(output.length).toBe(4);
    expect(output[0]).toBe(0x7fff);
    expect(output[1]).toBe(-0x8000);
    expect(output[2]).toBe(Math.trunc(0.25 * 0x7fff));
    expect(output[3]).toBe(Math.trunc(-0.25 * 0x8000));
  });

  it("returns an empty buffer when input is shorter than one output sample", () => {
    const input = new Float32Array([0.1, 0.2]);
    const output = downsampleTo16k(input, 48000);
    expect(output.length).toBe(0);
  });
});
