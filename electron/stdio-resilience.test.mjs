import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ignoreBrokenPipe, isBrokenPipe } from "./stdio-resilience.mjs";

// A stream stands in for process.stdout: the only thing that matters here is
// that it emits 'error' the way a Socket does when its read end is gone.
function fakeStream() {
  return new EventEmitter();
}

// Node system errors carry `code`, which a plain Error does not declare — so it
// is attached the way Node itself produces one.
function errorWithCode(code) {
  return Object.assign(new Error(`write ${code}`), { code });
}

describe("isBrokenPipe", () => {
  it("recognizes the write errors that mean nothing is reading", () => {
    for (const code of ["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]) {
      expect(isBrokenPipe(errorWithCode(code))).toBe(true);
    }
  });

  it("does not treat a real fault as a broken pipe", () => {
    expect(isBrokenPipe(errorWithCode("ENOSPC"))).toBe(false);
    expect(isBrokenPipe(new Error("no code at all"))).toBe(false);
    expect(isBrokenPipe(null)).toBe(false);
    expect(isBrokenPipe(undefined)).toBe(false);
  });
});

describe("ignoreBrokenPipe", () => {
  it("swallows EPIPE instead of letting it become an uncaught exception", () => {
    // The regression this exists for: console.log to a pipe whose reader has
    // gone away crashed the main process and showed Electron's error dialog.
    const stream = fakeStream();
    const rethrow = vi.fn();
    ignoreBrokenPipe([stream], { rethrow });

    expect(() => stream.emit("error", errorWithCode("EPIPE"))).not.toThrow();
    expect(rethrow).not.toHaveBeenCalled();
  });

  it("still surfaces an error that is not a broken pipe", () => {
    // A write failure that is NOT "nobody is listening" must stay loud —
    // swallowing every stream error would hide real faults.
    const stream = fakeStream();
    const rethrow = vi.fn();
    ignoreBrokenPipe([stream], { rethrow });

    const real = errorWithCode("ENOSPC");
    stream.emit("error", real);

    expect(rethrow).toHaveBeenCalledWith(real);
  });

  it("installs on every stream it is given", () => {
    const out = fakeStream();
    const err = fakeStream();
    expect(ignoreBrokenPipe([out, err])).toBe(2);
    expect(out.listenerCount("error")).toBe(1);
    expect(err.listenerCount("error")).toBe(1);
  });

  it("is idempotent, so a second call cannot stack listeners", () => {
    const stream = fakeStream();
    ignoreBrokenPipe([stream]);
    expect(ignoreBrokenPipe([stream])).toBe(0);
    expect(stream.listenerCount("error")).toBe(1);
  });

  it("ignores anything that is not a stream", () => {
    expect(ignoreBrokenPipe([null, undefined, {}, 42])).toBe(0);
  });
});
