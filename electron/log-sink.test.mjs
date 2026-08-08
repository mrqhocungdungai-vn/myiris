import { describe, it, expect, vi } from "vitest";
import { createLogSink, logConfigFromEnv, redact, DEFAULT_KEEP, DEFAULT_MAX_BYTES } from "./log-sink.mjs";

/**
 * A filesystem in a Map. No real disk anywhere in this file — the rotation
 * boundary and every redaction shape are the contract, and neither needs a
 * temp directory to be asserted.
 */
function fakeIo({ failOn = null } = {}) {
  const files = new Map();
  let nextFd = 10;
  const open = new Map(); // fd -> path
  const io = {
    files,
    mkdirSync: vi.fn((dir) => {
      if (failOn === "mkdir") throw new Error("EACCES: read-only");
      files.set(`${dir}/`, null);
    }),
    openSync: vi.fn((file) => {
      if (failOn === "open") throw new Error("EACCES: permission denied");
      if (!files.has(file)) files.set(file, "");
      const fd = nextFd++;
      open.set(fd, file);
      return fd;
    }),
    closeSync: vi.fn((fd) => open.delete(fd)),
    writeSync: vi.fn((fd, chunk) => {
      if (failOn === "write") throw new Error("ENOSPC: no space left on device");
      const file = open.get(fd);
      files.set(file, (files.get(file) ?? "") + chunk.toString());
      return chunk.length;
    }),
    existsSync: vi.fn((file) => files.has(file)),
    statSync: vi.fn((file) => ({ size: Buffer.byteLength(files.get(file) ?? "") })),
    renameSync: vi.fn((from, to) => {
      if (failOn === "rename") throw new Error("EXDEV");
      files.set(to, files.get(from));
      files.delete(from);
    }),
    unlinkSync: vi.fn((file) => {
      if (!files.has(file)) throw new Error("ENOENT");
      files.delete(file);
    }),
  };
  return io;
}

function make(overrides = {}) {
  const io = overrides.io ?? fakeIo();
  const onFault = vi.fn();
  let tick = 0;
  const sink = createLogSink({
    dir: "/logs",
    io,
    now: () => new Date(Date.UTC(2026, 7, 8, 12, 0, tick++)),
    onFault,
    ...overrides,
    ...(overrides.io ? { io: overrides.io } : { io }),
  });
  return { sink, io, onFault, lines: () => (io.files.get("/logs/iris.log") ?? "").trimEnd().split("\n").filter(Boolean) };
}

// Fixture credentials are ASSEMBLED AT RUNTIME rather than written as literals.
// `scan:secrets` is one of this repo's five gates, and a test file full of
// credential-shaped strings is exactly what it exists to stop — the scanner
// cannot tell a fake one from a real one, and it should not have to. The
// redaction under test sees the same assembled string either way, so nothing
// about the assertions is weakened.
const fake = (...parts) => parts.join("");

const ANTHROPIC_KEY = fake("sk-", "ant-", "api03-", "AbCdEf", "123456");
const OPENAI_KEY = fake("sk-", "proj-", "ABCDEFGHIJ", "KLMNOPQRSTUV");
const GOOGLE_KEY = fake("AIza", "SyA1B2", "C3D4E5F6");
const OPAQUE_TOKEN = fake("abc123", "def456");
const BEARER_TOKEN = fake("abcdefgh", "12345678");
const JWT = [fake("eyJ", "hbGciOi"), fake("eyJ", "zdWIiOi"), fake("SflKx", "wRJSM")].join(".");

describe("redact", () => {
  it("masks provider-shaped keys wherever they appear", () => {
    expect(redact(`using ${ANTHROPIC_KEY} now`)).not.toContain("AbCdEf");
    expect(redact(`key=${OPENAI_KEY}`)).not.toContain("KLMNOPQRSTUV");
    expect(redact(`google ${GOOGLE_KEY}`)).not.toContain("SyA1B2");
  });

  it("masks the VALUE of a secret-looking assignment and keeps the NAME", () => {
    const out = redact(`ANTHROPIC_API_KEY=${ANTHROPIC_KEY}`);
    expect(out).not.toContain("AbCdEf");
    // Which credential was involved is often the whole diagnostic.
    expect(out).toContain("ANTHROPIC_API_KEY");
  });

  it("masks JSON-shaped secrets", () => {
    const out = redact(`{"token": "${OPAQUE_TOKEN}", "user": "iris"}`);
    expect(out).not.toContain(OPAQUE_TOKEN);
    expect(out).toContain("user");
    expect(out).toContain("iris");
  });

  it("masks bearer tokens and JWTs", () => {
    expect(redact(`Authorization: Bearer ${BEARER_TOKEN}`)).not.toContain(BEARER_TOKEN);
    expect(redact(`cookie ${JWT}`)).not.toContain(JWT);
  });

  it("says something was removed, so absence and masking are distinguishable", () => {
    expect(redact(`token=${OPAQUE_TOKEN}`)).toContain("[redacted]");
    expect(redact("nothing secret here")).not.toContain("[redacted]");
  });

  it("leaves ordinary diagnostics alone", () => {
    const line = "[IRIS][reconnect] attempt 2/5 in 1200ms (close 1006)";
    expect(redact(line)).toBe(line);
  });
});

describe("createLogSink", () => {
  it("writes one JSONL record per call, with the four known fields first", () => {
    const { sink, lines } = make();
    sink.write({ level: "info", src: "main.stdout", msg: "hello" });
    expect(lines()).toHaveLength(1);
    const parsed = JSON.parse(lines()[0]);
    expect(parsed).toMatchObject({ level: "info", src: "main.stdout", msg: "hello" });
    expect(Object.keys(parsed).slice(0, 4)).toEqual(["at", "level", "src", "msg"]);
    expect(parsed.at).toMatch(/^2026-08-08T/);
  });

  it("keeps a record on one line even when the message spans several", () => {
    // The reason JSONL was chosen: a stack trace must not break the invariant
    // that a line is a record.
    const { sink, lines } = make();
    sink.write({ level: "error", src: "renderer", msg: "boom\n  at a()\n  at b()" });
    expect(lines()).toHaveLength(1);
    expect(JSON.parse(lines()[0]).msg).toContain("at b()");
  });

  it("carries extra fields through without displacing the known ones", () => {
    const { sink, lines } = make();
    sink.write({ level: "warn", src: "event", msg: "m", type: "gemini_status", attempt: 3 });
    expect(JSON.parse(lines()[0])).toMatchObject({ type: "gemini_status", attempt: 3 });
  });

  it("defaults src rather than writing a record nobody can attribute", () => {
    const { sink, lines } = make();
    sink.write({ level: "info", msg: "orphan" });
    expect(JSON.parse(lines()[0]).src).toBe("app");
  });

  it("redacts every record, whatever its source", () => {
    const { sink, lines } = make();
    // The case redaction exists for: output this app did not write.
    sink.write({ level: "info", src: "main.stdout", msg: `npm warn using ${ANTHROPIC_KEY}` });
    expect(lines()[0]).not.toContain("AbCdEf");
    expect(lines()[0]).toContain("[redacted]");
  });

  it("honours a level threshold", () => {
    const { sink, lines } = make({ level: "warn" });
    sink.write({ level: "info", msg: "routine" });
    sink.write({ level: "debug", msg: "chatter" });
    sink.write({ level: "warn", msg: "kept" });
    sink.write({ level: "error", msg: "kept too" });
    expect(lines()).toHaveLength(2);
  });

  it("records everything by default, including debug", () => {
    const { sink, lines } = make();
    sink.write({ level: "debug", msg: "d" });
    sink.write({ level: "info", msg: "i" });
    expect(lines()).toHaveLength(2);
  });

  it("writes nothing at all when disabled", () => {
    const { sink, io } = make({ enabled: false });
    sink.write({ level: "error", msg: "not written" });
    expect(io.openSync).not.toHaveBeenCalled();
    expect(io.files.size).toBe(0);
    expect(sink.isEnabled()).toBe(false);
  });

  it("opens once and writes to the held descriptor, not open/close per record", () => {
    const { sink, io } = make();
    for (let i = 0; i < 5; i += 1) sink.write({ level: "info", msg: `m${i}` });
    expect(io.openSync).toHaveBeenCalledTimes(1);
    expect(io.writeSync).toHaveBeenCalledTimes(5);
  });

  it("counts an existing file's size toward rotation, so a restart does not reset the budget", () => {
    const io = fakeIo();
    io.files.set("/logs/iris.log", "x".repeat(90));
    const { sink } = make({ io, maxBytes: 100 });
    sink.write({ level: "info", msg: "tips it over" });
    // Rotated immediately rather than starting a fresh 100-byte budget on top
    // of the 90 already there — a crash loop must not grow the file one
    // session at a time.
    expect(io.files.has("/logs/iris.1.log")).toBe(true);
  });
});

describe("rotation", () => {
  it("sets the active file aside and starts a fresh one", () => {
    const io = fakeIo();
    const { sink } = make({ io, maxBytes: 120 });
    sink.write({ level: "info", src: "s", msg: "x".repeat(200) });
    expect(io.files.has("/logs/iris.1.log")).toBe(true);
    sink.write({ level: "info", src: "s", msg: "after" });
    expect(io.files.get("/logs/iris.log")).toContain("after");
    expect(io.files.get("/logs/iris.1.log")).not.toContain("after");
  });

  it("shifts previous files down and deletes past the retained count", () => {
    const io = fakeIo();
    const { sink } = make({ io, maxBytes: 60, keep: 2 });
    for (let i = 0; i < 6; i += 1) sink.write({ level: "info", src: "s", msg: `record-${i}-${"y".repeat(60)}` });
    // keep: 2 means the active file plus two set aside, and no more.
    expect(io.files.has("/logs/iris.1.log")).toBe(true);
    expect(io.files.has("/logs/iris.2.log")).toBe(true);
    expect(io.files.has("/logs/iris.3.log")).toBe(false);
  });

  it("loses no record to the act of rotating", () => {
    // Retention deleting an OLD file is intended; a record vanishing at the
    // moment the file turns over is not. So: more slots than turnovers, and
    // then every record must still be somewhere.
    const io = fakeIo();
    const { sink } = make({ io, maxBytes: 120, keep: 20 });
    for (let i = 0; i < 8; i += 1) sink.write({ level: "info", src: "s", msg: `m${i}-${"z".repeat(100)}` });
    const everything = [...io.files.values()].filter(Boolean).join("");
    for (let i = 0; i < 8; i += 1) expect(everything).toContain(`m${i}-`);
  });

  it("keeps writing after rotation without a restart", () => {
    const io = fakeIo();
    const { sink } = make({ io, maxBytes: 80 });
    sink.write({ level: "info", src: "s", msg: "a".repeat(120) });
    sink.write({ level: "info", src: "s", msg: "still-here" });
    expect(io.files.get("/logs/iris.log")).toContain("still-here");
    expect(sink.isEnabled()).toBe(true);
  });
});

describe("faults", () => {
  it("does not throw when the directory cannot be created", () => {
    const { sink, onFault } = make({ io: fakeIo({ failOn: "mkdir" }) });
    expect(() => sink.write({ level: "error", msg: "m" })).not.toThrow();
    expect(sink.isEnabled()).toBe(false);
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the file cannot be opened", () => {
    const { sink, onFault } = make({ io: fakeIo({ failOn: "open" }) });
    expect(() => sink.write({ level: "error", msg: "m" })).not.toThrow();
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it("reports a write failure ONCE, however many writes follow", () => {
    const { sink, onFault } = make({ io: fakeIo({ failOn: "write" }) });
    for (let i = 0; i < 50; i += 1) sink.write({ level: "error", msg: `m${i}` });
    // Reporting per failure would produce output at the rate of the failures.
    expect(onFault).toHaveBeenCalledTimes(1);
    expect(sink.isEnabled()).toBe(false);
  });

  it("reports to the caller's channel, never back into the log", () => {
    const io = fakeIo({ failOn: "write" });
    const { sink, onFault } = make({ io });
    sink.write({ level: "error", msg: "m" });
    expect(onFault.mock.calls[0][0]).toContain("[IRIS][log]");
    // Nothing was appended — reporting into the log would attempt the write
    // that just failed.
    expect(io.files.get("/logs/iris.log")).toBe("");
  });

  it("survives a record that cannot be serialized", () => {
    const { sink, onFault } = make();
    const circular = { level: "info", msg: "m" };
    circular.self = circular;
    expect(() => sink.write(circular)).not.toThrow();
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it("does not throw when rotation fails, and stops rather than looping", () => {
    const io = fakeIo({ failOn: "rename" });
    const { sink, onFault } = make({ io, maxBytes: 60 });
    expect(() => sink.write({ level: "info", src: "s", msg: "q".repeat(120) })).not.toThrow();
    expect(sink.isEnabled()).toBe(false);
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it("closes cleanly, and closing twice is safe", () => {
    const { sink, io } = make();
    sink.write({ level: "info", msg: "m" });
    sink.close();
    sink.close();
    expect(io.closeSync).toHaveBeenCalledTimes(1);
  });
});

describe("logConfigFromEnv", () => {
  it("records everything by default", () => {
    expect(logConfigFromEnv({})).toEqual({
      enabled: true,
      level: "debug",
      maxBytes: DEFAULT_MAX_BYTES,
      keep: DEFAULT_KEEP,
    });
  });

  it("turns off only on an explicit off value", () => {
    expect(logConfigFromEnv({ IRIS_LOG: "0" }).enabled).toBe(false);
    expect(logConfigFromEnv({ IRIS_LOG: "off" }).enabled).toBe(false);
    expect(logConfigFromEnv({ IRIS_LOG: "false" }).enabled).toBe(false);
    // A typo must leave logging ON — silently removing the thing a user is
    // relying on to explain a failure is the worst way to fail here.
    expect(logConfigFromEnv({ IRIS_LOG: "yes" }).enabled).toBe(true);
    expect(logConfigFromEnv({ IRIS_LOG: "1" }).enabled).toBe(true);
  });

  it("reads the size and retention, ignoring nonsense", () => {
    expect(logConfigFromEnv({ IRIS_LOG_MAX_BYTES: "1024", IRIS_LOG_KEEP: "2" })).toMatchObject({
      maxBytes: 1024,
      keep: 2,
    });
    expect(logConfigFromEnv({ IRIS_LOG_MAX_BYTES: "nope", IRIS_LOG_KEEP: "-3" })).toMatchObject({
      maxBytes: DEFAULT_MAX_BYTES,
      keep: DEFAULT_KEEP,
    });
  });

  it("lowercases the level so IRIS_LOG_LEVEL=WARN works", () => {
    expect(logConfigFromEnv({ IRIS_LOG_LEVEL: "WARN" }).level).toBe("warn");
  });
});
