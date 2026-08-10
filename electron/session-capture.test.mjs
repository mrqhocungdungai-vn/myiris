// Electron-free coverage of the ambient-session-capture policy
// (ambient-memory): the default-off gate, the watermark's no-retroactive-
// capture and no-duplicate guarantees, and the self-describing room-
// transcript rendering.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionCapture, renderSessionBlock } from "./session-capture.mjs";
import { buildRunPrompt } from "./run-context.mjs";
import { resolveVerb } from "./verbs.mjs";

async function withTempDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-session-capture-"));
  try {
    return await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("createSessionCapture: default state", () => {
  it("starts disabled regardless of what anything else says (design D1)", () => {
    const sc = createSessionCapture();
    expect(sc.isEnabled()).toBe(false);
  });

  it("flush is a no-op while disabled — no write is even attempted", async () => {
    await withTempDir(async (dir) => {
      const sc = createSessionCapture();
      const result = await sc.flush({ utterances: [{ text: "a", at: 1 }], dir });
      expect(result).toEqual({ ok: true, skipped: true });
      expect(fs.existsSync(dir) && fs.readdirSync(dir).length > 0).toBe(false);
    });
  });
});

describe("createSessionCapture: watermark", () => {
  it("initializes the watermark at enable time, excluding ring entries already older than it", async () => {
    await withTempDir(async (dir) => {
      const sc = createSessionCapture();
      sc.enable(1000);
      const result = await sc.flush({ utterances: [{ text: "said before enabling", at: 500 }], dir });
      expect(result).toEqual({ ok: true, skipped: true });
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });
  });

  it("writes each utterance exactly once across two flushes over one conversation", async () => {
    await withTempDir(async (dir) => {
      const sc = createSessionCapture({ now: () => new Date(9999) });
      sc.enable(0);
      await sc.flush({ utterances: [{ text: "a", at: 1 }], dir });
      await sc.flush({ utterances: [{ text: "a", at: 1 }, { text: "b", at: 2 }], dir });
      const [file] = fs.readdirSync(dir);
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      expect(text.match(/^> a$/gm)).toHaveLength(1);
      expect(text.match(/^> b$/gm)).toHaveLength(1);
    });
  });

  it("writes no file when a flush has nothing new", async () => {
    await withTempDir(async (dir) => {
      const sc = createSessionCapture();
      sc.enable(100);
      const result = await sc.flush({ utterances: [{ text: "old", at: 1 }], dir });
      expect(result).toEqual({ ok: true, skipped: true });
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });
  });

  it("advances the watermark only on a successful write, so a failed flush is retried", async () => {
    const io = /** @type {any} */ ({
      promises: { mkdir: () => Promise.reject(new Error("ENOSPC")) },
    });
    const sc = createSessionCapture({ io });
    sc.enable(0);
    const onError = vi.fn();
    await sc.flush({ utterances: [{ text: "a", at: 1 }], dir: "/nowhere", onError });
    await sc.flush({ utterances: [{ text: "a", at: 1 }], dir: "/nowhere", onError });
    // Both flushes actually attempted a write — the watermark never moved
    // past the failure, so the same utterance was retried, not skipped.
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected write rather than throwing", async () => {
    const io = /** @type {any} */ ({
      promises: { mkdir: () => Promise.reject(new Error("ENOSPC")) },
    });
    const sc = createSessionCapture({ io });
    sc.enable(0);
    await expect(sc.flush({ utterances: [{ text: "a", at: 1 }], dir: "/nowhere" })).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("ENOSPC"),
    });
  });
});

describe("createSessionCapture: disable", () => {
  it("stops flushing once disabled, even with fresh utterances waiting", async () => {
    await withTempDir(async (dir) => {
      const sc = createSessionCapture();
      sc.enable(0);
      sc.disable();
      const result = await sc.flush({ utterances: [{ text: "a", at: 1 }], dir });
      expect(result).toEqual({ ok: true, skipped: true });
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });
  });
});

describe("renderSessionBlock", () => {
  it("headers the block as an automatic transcription, naming its time span", () => {
    const block = renderSessionBlock([
      { text: "hello", at: Date.UTC(2026, 7, 5, 10, 0, 0) },
      { text: "world", at: Date.UTC(2026, 7, 5, 10, 5, 0) },
    ]);
    expect(block).toContain("Automatic transcription");
    expect(block).toContain("2026-08-05T10:00:00.000Z");
    expect(block).toContain("2026-08-05T10:05:00.000Z");
    expect(block).toContain("> hello");
    expect(block).toContain("> world");
  });

  // The spool said it was a transcript of the room, but not that it was a
  // GUESS at one. A mishearing here is silent — it reads as a sentence somebody
  // said — and the curator weaving these into durable pages is the only one who
  // can catch it.
  it("warns that the text is speech recognition and may be wrong", () => {
    const block = renderSessionBlock([{ text: "hi", at: 0 }]).toLowerCase();
    expect(block).toContain("automatic speech recognition");
    expect(block).toContain("may never have been said");
  });

  it("states plainly that this is not necessarily the user's own words", () => {
    const block = renderSessionBlock([{ text: "hi", at: 0 }]);
    expect(block.toLowerCase()).toContain("not necessarily");
  });

  it("returns an empty string for no utterances", () => {
    expect(renderSessionBlock([])).toBe("");
  });
});

// design D6/spec "Spooled speech is untrusted downstream": there is no
// separate recording path — a flush spools exactly the ring's own utterances
// (`recentUtterances()`), and those SAME utterances are what run-context.mjs
// unconditionally fences before any run ever sees them. Confirms the shared
// source rather than duplicating run-context.test.mjs's own fencing coverage.
describe("session-capture: utterances reach a run through the same fenced path as the live transcript", () => {
  it("the exact utterances a flush would spool are fenced as untrusted content on every run, including capture_learning's own", () => {
    const utterances = [{ text: "hello", at: 1 }, { text: "world", at: 2 }];
    const block = renderSessionBlock(utterances);
    expect(block).toContain("hello");

    const prompt = buildRunPrompt(resolveVerb("capture_learning"), { brief: "Focus: everything", utterances });
    expect(prompt).toMatch(/<<<IRIS_UNTRUSTED_[0-9a-f]+>>>/);
    expect(prompt).toContain("hello");
    expect(prompt).toContain("world");
  });
});
