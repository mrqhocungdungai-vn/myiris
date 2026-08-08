import { describe, it, expect, vi } from "vitest";
import { installLogTee, teeStream } from "./log-tee.mjs";

/** A stream that records what it was handed and what it returned. */
function fakeStream({ returns = true, throws = false } = {}) {
  const written = [];
  return {
    written,
    write: vi.fn((chunk, _encoding, callback) => {
      if (throws) throw new Error("stream is gone");
      written.push(chunk);
      callback?.();
      return returns;
    }),
  };
}

describe("teeStream", () => {
  it("emits one line per newline-terminated line", () => {
    const stream = fakeStream();
    const lines = [];
    teeStream(stream, (line) => lines.push(line));
    stream.write("first\nsecond\nthird\n");
    expect(lines).toEqual(["first", "second", "third"]);
  });

  it("holds a partial line until it completes", () => {
    const stream = fakeStream();
    const lines = [];
    teeStream(stream, (line) => lines.push(line));
    stream.write("half of ");
    expect(lines).toEqual([]);
    stream.write("a line\n");
    expect(lines).toEqual(["half of a line"]);
  });

  it("flushes a trailing partial line on uninstall rather than dropping it", () => {
    const stream = fakeStream();
    const lines = [];
    const uninstall = teeStream(stream, (line) => lines.push(line));
    stream.write("no newline at the end");
    expect(lines).toEqual([]);
    uninstall();
    expect(lines).toEqual(["no newline at the end"]);
  });

  it("skips blank lines rather than recording empty records", () => {
    const stream = fakeStream();
    const lines = [];
    teeStream(stream, (line) => lines.push(line));
    stream.write("\n\nreal\n\n");
    expect(lines).toEqual(["real"]);
  });

  it("decodes a Buffer chunk, honouring an explicit encoding", () => {
    const stream = fakeStream();
    const lines = [];
    teeStream(stream, (line) => lines.push(line));
    stream.write(Buffer.from("from a buffer\n", "utf8"));
    expect(lines).toEqual(["from a buffer"]);
  });

  // The three things the tee must not do to the app it is capturing.

  it("passes the original chunk through untouched", () => {
    const stream = fakeStream();
    teeStream(stream, () => {});
    const buffer = Buffer.from("exact bytes\n");
    stream.write(buffer);
    expect(stream.written[0]).toBe(buffer);
  });

  it("returns the original's return value, so backpressure still reaches the caller", () => {
    const stream = fakeStream({ returns: false });
    teeStream(stream, () => {});
    // Swallowing this would change the app's behavior for the log's benefit.
    expect(stream.write("x\n")).toBe(false);
  });

  it("forwards the callback", () => {
    const stream = fakeStream();
    teeStream(stream, () => {});
    const done = vi.fn();
    stream.write("x\n", "utf8", done);
    expect(done).toHaveBeenCalled();
  });

  it("still writes when the capture throws", () => {
    const stream = fakeStream();
    teeStream(stream, () => {
      throw new Error("sink exploded");
    });
    expect(() => stream.write("must still arrive\n")).not.toThrow();
    expect(stream.written).toHaveLength(1);
  });

  it("does not swallow a real stream error", () => {
    // A fault in the STREAM is the app's problem and must surface; only a
    // fault in the capture is absorbed.
    const stream = fakeStream({ throws: true });
    teeStream(stream, () => {});
    expect(() => stream.write("x\n")).toThrow("stream is gone");
  });

  it("cannot be installed twice on one stream", () => {
    const stream = fakeStream();
    const lines = [];
    expect(teeStream(stream, (line) => lines.push(line))).toBeTypeOf("function");
    expect(teeStream(stream, (line) => lines.push(line))).toBeNull();
    stream.write("once\n");
    expect(lines).toEqual(["once"]);
  });

  it("restores the original on uninstall, and can then be reinstalled", () => {
    const stream = fakeStream();
    const original = stream.write;
    const uninstall = teeStream(stream, () => {});
    expect(stream.write).not.toBe(original);
    uninstall();
    expect(stream.write).toBe(original);
    expect(teeStream(stream, () => {})).toBeTypeOf("function");
  });

  it("does not unhook someone else who wrapped write after us", () => {
    const stream = fakeStream();
    const uninstall = teeStream(stream, () => {});
    /** @type {any} */
    const somebodyElse = () => true;
    stream.write = somebodyElse;
    uninstall();
    expect(stream.write).toBe(somebodyElse);
  });

  it("declines a stream it cannot use", () => {
    expect(teeStream(null, () => {})).toBeNull();
    expect(teeStream(undefined, () => {})).toBeNull();
    expect(teeStream({}, () => {})).toBeNull();
  });
});

describe("installLogTee", () => {
  it("labels each stream, so a reader can tell them apart", () => {
    const stdout = fakeStream();
    const stderr = fakeStream();
    const seen = [];
    installLogTee({ stdout, stderr, onLine: (line, src) => seen.push([src, line]) });
    stdout.write("routine\n");
    stderr.write("a fault\n");
    expect(seen).toEqual([
      ["main.stdout", "routine"],
      ["main.stderr", "a fault"],
    ]);
  });

  it("uninstalls both", () => {
    const stdout = fakeStream();
    const stderr = fakeStream();
    const outWrite = stdout.write;
    const errWrite = stderr.write;
    const uninstall = installLogTee({ stdout, stderr, onLine: () => {} });
    uninstall();
    expect(stdout.write).toBe(outWrite);
    expect(stderr.write).toBe(errWrite);
  });

  it("survives a stream that does not exist — stdout can be null under some launch modes", () => {
    const stderr = fakeStream();
    const seen = [];
    const uninstall = installLogTee({ stdout: null, stderr, onLine: (line, src) => seen.push(src) });
    stderr.write("still captured\n");
    expect(seen).toEqual(["main.stderr"]);
    expect(() => uninstall()).not.toThrow();
  });
});
