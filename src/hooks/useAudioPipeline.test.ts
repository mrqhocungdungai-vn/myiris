import { describe, it, expect } from "vitest";
import { shouldDropChunk } from "./useAudioPipeline";

describe("shouldDropChunk", () => {
  it("drops when muted, even with matching epochs", () => {
    expect(shouldDropChunk({ muted: true, chunkEpoch: 1, currentEpoch: 1 })).toBe(true);
  });

  it("drops when the chunk's epoch is stale", () => {
    expect(shouldDropChunk({ muted: false, chunkEpoch: 1, currentEpoch: 2 })).toBe(true);
  });

  it("plays when unmuted and epochs match", () => {
    expect(shouldDropChunk({ muted: false, chunkEpoch: 1, currentEpoch: 1 })).toBe(false);
  });
});
