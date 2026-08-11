import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenLedger } from "./token-ledger.mjs";

// The ledger writes one diagnostic line per counted run and one per detected
// counter restart (design D9). Silenced here so the suite's output stays
// readable; the lines themselves are not what these tests are about.
let logSpy;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

/** A clock that only moves when a test moves it, so `at` is assertable exactly. */
function fakeClock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

function make() {
  const clock = fakeClock();
  const changes = [];
  const ledger = createTokenLedger({ now: clock.now, onChange: (snap) => changes.push(snap) });
  return { ledger, clock, changes };
}

/** A finished run in the shape onFinalized hands over — usage nested one level under `usage`. */
function run(runId, usage, status = "completed") {
  return { run_id: runId, status, verb: "execute", usage: { cost_usd: 0.1, num_turns: 2, usage } };
}

describe("token-ledger: the voice engine's dual-regime accumulator", () => {
  it("does not sum a cumulative counter", () => {
    const { ledger } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 100 });
    ledger.recordGeminiUsage({ totalTokenCount: 250 });
    ledger.recordGeminiUsage({ totalTokenCount: 400 });
    // 400, not 750 — successive cumulative reports already include everything
    // reported before them.
    expect(ledger.snapshot().gemini.total).toBe(400);
    expect(ledger.snapshot().gemini.last).toBe(150);
  });

  it("sums a per-message stream", () => {
    const { ledger } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 100 });
    ledger.recordGeminiUsage({ totalTokenCount: 40 });
    ledger.recordGeminiUsage({ totalTokenCount: 30 });
    expect(ledger.snapshot().gemini.total).toBe(170);
  });

  it("keeps the total across a mid-session restart and keeps growing", () => {
    // The Live-reconnect case, and the most important behaviour in this file:
    // sockets rotate on a connection lifetime limit during ordinary use, and a
    // total dropping to zero mid-conversation would read as a broken panel.
    const { ledger } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 100 });
    ledger.recordGeminiUsage({ totalTokenCount: 250 });
    ledger.recordGeminiUsage({ totalTokenCount: 30 }); // new socket, counter back near zero
    expect(ledger.snapshot().gemini.total).toBe(280);
    ledger.recordGeminiUsage({ totalTokenCount: 80 });
    expect(ledger.snapshot().gemini.total).toBe(330);
  });

  it("never decreases across an arbitrary mixed stream", () => {
    // Monotone BY CONSTRUCTION rather than by a clamp: the assertion lives here
    // instead of in the code path, because a clamp would hide a real regression
    // in the arithmetic rather than reporting it.
    const { ledger } = make();
    let previous = 0;
    for (const reading of [10, 90, 5, 5, 300, 299, 1, 1200, 0, 7]) {
      ledger.recordGeminiUsage({ totalTokenCount: reading });
      const total = ledger.snapshot().gemini.total ?? 0;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });

  it("sums the parts when no totalTokenCount is sent, and never yields NaN", () => {
    const { ledger } = make();
    ledger.recordGeminiUsage({ promptTokenCount: 40, responseTokenCount: 12, thoughtsTokenCount: 8 });
    expect(ledger.snapshot().gemini.total).toBe(60);
  });

  it("ignores a message carrying no numeric figure at all", () => {
    const { ledger, changes } = make();
    ledger.recordGeminiUsage({});
    ledger.recordGeminiUsage({ totalTokenCount: "many" });
    ledger.recordGeminiUsage(null);
    expect(ledger.snapshot().gemini.total).toBeNull();
    expect(changes).toHaveLength(0);
  });

  it("does not restamp `at` when a repeated reading changes nothing", () => {
    const { ledger, clock, changes } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 100 });
    const first = ledger.snapshot().gemini.at;
    clock.advance(5_000);
    ledger.recordGeminiUsage({ totalTokenCount: 100 });
    expect(ledger.snapshot().gemini.at).toBe(first);
    expect(changes).toHaveLength(1);
  });
});

describe("token-ledger: the build engine, once per run", () => {
  it("counts the same run once, and does not move claude.at on the second observation", () => {
    const { ledger, clock, changes } = make();
    ledger.recordClaudeRun(run("r1", { input_tokens: 100, output_tokens: 50 }));
    const at = ledger.snapshot().claude.at;
    clock.advance(5_000);
    ledger.recordClaudeRun(run("r1", { input_tokens: 100, output_tokens: 50 }));
    expect(ledger.snapshot().claude.total).toBe(150);
    // If `at` moved, the ring would announce one finished run twice.
    expect(ledger.snapshot().claude.at).toBe(at);
    expect(changes).toHaveLength(1);
  });

  it("counts a run that ended badly on the same terms as one that succeeded", () => {
    const { ledger } = make();
    ledger.recordClaudeRun(run("a", { input_tokens: 10, output_tokens: 5 }, "failed"));
    ledger.recordClaudeRun(run("b", { input_tokens: 10, output_tokens: 5 }, "limited"));
    ledger.recordClaudeRun(run("c", { input_tokens: 10, output_tokens: 5 }, "unanswered"));
    expect(ledger.snapshot().claude.total).toBe(45);
  });

  it("keeps cache reads out of the headline and on their own figure", () => {
    const { ledger } = make();
    ledger.recordClaudeRun(
      run("r1", {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 90_000,
      }),
    );
    const snap = ledger.snapshot();
    expect(snap.claude.total).toBe(350);
    expect(snap.claude.last).toBe(350);
    expect(snap.claude.cacheRead).toBe(90_000);
  });

  it("is a no-op for a run with no usage, and records no id for it", () => {
    const { ledger, changes } = make();
    const started = { run_id: "r1", status: "failed", usage: null };
    ledger.recordClaudeRun(started);
    expect(ledger.snapshot().claude.total).toBeNull();
    expect(changes).toHaveLength(0);
    // The same run counts normally once its usage does arrive.
    ledger.recordClaudeRun(run("r1", { input_tokens: 7 }));
    expect(ledger.snapshot().claude.total).toBe(7);
  });

  it("reads missing usage keys as zero rather than NaN", () => {
    const { ledger } = make();
    ledger.recordClaudeRun(run("r1", { input_tokens: 12 }));
    expect(ledger.snapshot().claude.total).toBe(12);
    expect(ledger.snapshot().claude.cacheRead).toBe(0);
  });
});

describe("token-ledger: absence is not zero", () => {
  it("snapshots null for an engine that has reported nothing", () => {
    const { ledger } = make();
    const snap = ledger.snapshot();
    // The ordinary state of the build engine when no Claude credential exists.
    expect(snap.claude).toEqual({ total: null, last: null, cacheRead: null, at: null });
    expect(snap.gemini).toEqual({ total: null, last: null, at: null });
  });

  it("snapshots a reported zero as a figure", () => {
    const { ledger } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 0 });
    ledger.recordClaudeRun(run("r1", { input_tokens: 0, output_tokens: 0 }));
    expect(ledger.snapshot().gemini.total).toBe(0);
    expect(ledger.snapshot().claude.total).toBe(0);
  });

  it("keeps the two accounts separate and reports no combined figure", () => {
    const { ledger } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 500 });
    ledger.recordClaudeRun(run("r1", { input_tokens: 10 }));
    const snap = ledger.snapshot();
    expect(snap.gemini.total).toBe(500);
    expect(snap.claude.total).toBe(10);
    expect(Object.keys(snap).sort()).toEqual(["claude", "gemini"]);
  });

  it("snapshots plain scalars, so it survives structuredClone across IPC", () => {
    const { ledger } = make();
    ledger.recordGeminiUsage({ totalTokenCount: 500 });
    ledger.recordClaudeRun(run("r1", { input_tokens: 10, cache_read_input_tokens: 3 }));
    expect(structuredClone(ledger.snapshot())).toEqual(ledger.snapshot());
  });
});
