import { describe, it, expect } from "vitest";
import { appendLog, appendTranscript, MAX_LOGS, MAX_TRANSCRIPT } from "./streams";
import type { LogLine, TranscriptLine } from "../types";

const log = (message: string): LogLine => ({ id: message, level: "info", message, timestamp: 0 });
const line = (text: string): TranscriptLine => ({ id: text, speaker: "you", text });

// The two streams cap in OPPOSITE directions. Getting either backwards is not
// a crash — it silently shows the wrong end, which reads as "nothing is
// happening" while everything is.
describe("appendLog — newest first", () => {
  it("puts the newest line at the front", () => {
    const result = appendLog([log("older")], log("newer"));
    expect(result.map((l) => l.message)).toEqual(["newer", "older"]);
  });

  it("drops the OLDEST once the cap is reached", () => {
    let logs: LogLine[] = [];
    for (let i = 0; i < MAX_LOGS + 5; i += 1) logs = appendLog(logs, log(`m${i}`));
    expect(logs).toHaveLength(MAX_LOGS);
    // The newest survives at the front; the first few are gone.
    expect(logs[0].message).toBe(`m${MAX_LOGS + 4}`);
    expect(logs.map((l) => l.message)).not.toContain("m0");
  });

  it("does not mutate the list it was given", () => {
    const original = [log("a")];
    appendLog(original, log("b"));
    expect(original).toHaveLength(1);
  });
});

describe("appendTranscript — conversation order", () => {
  it("puts the newest line at the END, so it reads in order", () => {
    const result = appendTranscript([line("first")], line("second"));
    expect(result.map((l) => l.text)).toEqual(["first", "second"]);
  });

  it("drops the OLDEST once the cap is reached", () => {
    let lines: TranscriptLine[] = [];
    for (let i = 0; i < MAX_TRANSCRIPT + 5; i += 1) lines = appendTranscript(lines, line(`t${i}`));
    expect(lines).toHaveLength(MAX_TRANSCRIPT);
    // The newest survives at the end; the first few are gone.
    expect(lines[lines.length - 1].text).toBe(`t${MAX_TRANSCRIPT + 4}`);
    expect(lines.map((l) => l.text)).not.toContain("t0");
  });

  it("does not mutate the list it was given", () => {
    const original = [line("a")];
    appendTranscript(original, line("b"));
    expect(original).toHaveLength(1);
  });
});

// Stated explicitly so a future edit cannot quietly align them.
describe("the two directions are opposite on purpose", () => {
  it("keeps the newest at opposite ends", () => {
    const logs = appendLog([log("old")], log("new"));
    const lines = appendTranscript([line("old")], line("new"));
    expect(logs[0].message).toBe("new");
    expect(lines[lines.length - 1].text).toBe("new");
  });
});
