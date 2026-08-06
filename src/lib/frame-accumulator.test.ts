import { describe, it, expect } from "vitest";
import { createFrameAccumulator } from "./frame-accumulator";

function collect(chunks: Float32Array[], frameSamples: number): number[][] {
  const acc = createFrameAccumulator(frameSamples);
  const frames: number[][] = [];
  for (const chunk of chunks) acc.push(chunk, (frame) => frames.push([...frame]));
  return frames;
}

// A ramp makes both properties that matter visible at a glance: contiguity
// (each frame starts where the last ended) and non-overlap (no value twice).
function ramp(start: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => start + i);
}

describe("createFrameAccumulator", () => {
  it("emits nothing until a full frame has arrived", () => {
    expect(collect([ramp(0, 3)], 4)).toEqual([]);
    expect(collect([ramp(0, 4)], 4)).toEqual([[0, 1, 2, 3]]);
  });

  it("emits contiguous, non-overlapping frames when a chunk spans several", () => {
    expect(collect([ramp(0, 10)], 4)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it("carries a partial frame across chunk boundaries", () => {
    // 3 + 3 + 3 = 9 samples with no chunk aligned to the 4-sample frame.
    expect(collect([ramp(0, 3), ramp(3, 3), ramp(6, 3)], 4)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it("reproduces the input exactly across a run of ragged chunks", () => {
    const sizes = [1, 7, 2, 13, 4, 5, 100, 3];
    const chunks: Float32Array[] = [];
    let next = 0;
    for (const size of sizes) {
      chunks.push(ramp(next, size));
      next += size;
    }
    const frames = collect(chunks, 8);
    const flat = frames.flat();
    const total = sizes.reduce((a, b) => a + b, 0);
    expect(frames).toHaveLength(Math.floor(total / 8));
    expect(flat).toEqual([...ramp(0, frames.length * 8)]);
  });

  it("emits frames the caller can hold: each is its own buffer", () => {
    const acc = createFrameAccumulator(4);
    const frames: Float32Array[] = [];
    acc.push(ramp(0, 8), (frame) => frames.push(frame));
    // Both frames were emitted from the same internal buffer; if they were
    // views onto it, the first would now read as the second.
    expect([...frames[0]]).toEqual([0, 1, 2, 3]);
    expect([...frames[1]]).toEqual([4, 5, 6, 7]);
  });

  it("reset() drops the partial frame rather than splicing across it", () => {
    const acc = createFrameAccumulator(4);
    const frames: number[][] = [];
    acc.push(ramp(0, 3), (frame) => frames.push([...frame]));
    acc.reset();
    acc.push(ramp(100, 4), (frame) => frames.push([...frame]));
    expect(frames).toEqual([[100, 101, 102, 103]]);
  });
});
