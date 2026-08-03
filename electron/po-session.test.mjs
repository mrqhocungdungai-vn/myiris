// The BUG A regression: a PO turn must always settle, even when the SDK
// stream ends without throwing (closePoSession's channel.close(), or a
// stream that just stops on its own). Driven through the Wave 0.0 injected
// `query` seam — a fake async iterator, no subprocess, no Electron. See
// openspec/changes/settle-and-attribute-po-turn/design.md D1/D2/D5.
import { describe, it, expect } from "vitest";
import {
  getOrCreatePoSession,
  deliverPoTurn,
  cancelPoTurn,
  closePoSession,
  setPoSessionMcpServers,
} from "./po-session.mjs";
import { buildRoleInstructions, buildSystemPrompt, ROLE_CLAUSES } from "./role-prompt.mjs";

// A hand-rolled async iterator (not a generator function) so the test has
// direct control over `.return()` — mirroring exactly what
// `state.query?.return?.()` does in closePoSession, and what "the stream
// just stops" looks like when nothing calls `.return()` at all.
function createFakeQuerySource() {
  const pending = [];
  let resolveWait = null;
  let ended = false;
  let errorToThrow = null;

  function wake() {
    if (resolveWait) {
      const resolve = resolveWait;
      resolveWait = null;
      resolve();
    }
  }

  // Deliberately minimal: only the async-iterator surface po-session.mjs's
  // pump() drives plus return() for teardown. The real SDK Query interface
  // has ~29 more control-request methods (setModel, interrupt, etc.); this
  // fake omits them because po-session.mjs only ever calls them through
  // `state.query?.method?.()` optional chaining, so an untested method being
  // absent here is not a gap in what's being verified. Cast rather than
  // stub every member.
  const query = /** @type {any} */ ({
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      for (;;) {
        if (errorToThrow) {
          const error = errorToThrow;
          errorToThrow = null;
          throw error;
        }
        if (pending.length) {
          return { value: pending.shift(), done: false };
        }
        if (ended) {
          return { value: undefined, done: true };
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          resolveWait = resolve;
        });
      }
    },
    // What closePoSession calls: ends the iterator without throwing, exactly
    // like the real SDK query object when its channel is closed.
    async return(value) {
      ended = true;
      wake();
      return { value, done: true };
    },
  });

  return {
    query,
    pushMessage(message) {
      pending.push(message);
      wake();
    },
    // Simulates the stream stopping on its own (dead subprocess, silent
    // close) — nothing calls `.return()`, so no teardown marker exists.
    endSilently() {
      ended = true;
      wake();
    },
    throwError(error) {
      errorToThrow = error;
      wake();
    },
  };
}

function resultMessage(text = "done") {
  return { type: "result", subtype: "success", is_error: false, result: text, session_id: "sess-1" };
}

let nextWorkstreamId = 0;
function makeWorkstream() {
  nextWorkstreamId += 1;
  return { id: `ws-${nextWorkstreamId}` };
}

// Bounds a promise so a regression back to "never settles" fails the test
// fast instead of hanging the run.
function withTimeout(promise, ms = 1000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for settlement")), ms)),
  ]);
}

describe("po-session pump settlement", () => {
  it("settles (rejects) a delivered turn when the session is torn down mid-turn", async () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    closePoSession(workstream.id);

    await expect(withTimeout(turnPromise)).rejects.toBeInstanceOf(Error);
  });

  it("tags the rejection with the teardown reason after closePoSession", async () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    closePoSession(workstream.id);

    await expect(withTimeout(turnPromise)).rejects.toMatchObject({ poEndReason: { kind: "teardown" } });
  });

  it("rejects without a teardown reason when the stream ends on its own", async () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    source.endSilently();

    const error = await withTimeout(turnPromise.catch((e) => e));
    expect(error).toBeInstanceOf(Error);
    expect(error.poEndReason).toBeUndefined();
  });

  it("resolves normally on a result message, and finally does not re-settle it", async () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    source.pushMessage(resultMessage("all good"));

    // `subtype` and `usage` ride along on every outcome so run-exec can tell a
    // ceiling from a failure and record what the turn cost; po-session itself
    // interprets neither.
    await expect(withTimeout(turnPromise)).resolves.toEqual({
      status: "completed",
      output: "all good",
      subtype: "success",
      usage: { cost_usd: null, num_turns: null, usage: null, model_usage: null },
      decisions: [],
    });

    // Ending the stream afterwards must not throw or reject anything — the
    // turn already resolved and currentTurn is already cleared.
    source.endSilently();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

// canvas-claude-mcp wiring (design.md D8, task 5.1): po-session.mjs forwards
// an opaque mcpServers record into the SDK session without knowing anything
// about canvas.
describe("po-session system prompt", () => {
  function captureOptions(overrides = {}) {
    const source = createFakeQuerySource();
    /** @type {any} */
    let captured;
    getOrCreatePoSession(makeWorkstream(), {
      query: ({ options }) => {
        captured = options;
        return source.query;
      },
      ...overrides,
    });
    return captured;
  }

  // F1: PO's live-session instruction travelled on a top-level
  // `appendSystemPrompt`, which the SDK destructures away and never reads — so
  // PO ran on the minimal prompt while DEV got a full one. Confirmed against
  // the live SDK in design.md D1b.
  it("delivers the live-session instruction on the field the SDK reads", () => {
    const options = captureOptions();

    expect(options.appendSystemPrompt).toBeUndefined();
    expect(options.systemPrompt).toEqual(buildSystemPrompt("po"));
    expect(options.systemPrompt.append).toContain("AskUserQuestion");
  });

  it("shares the base prompt with the headless role, one clause apart", () => {
    const po = captureOptions().systemPrompt.append;

    expect(po.replace(ROLE_CLAUSES.po, "<CLAUSE>")).toEqual(
      buildRoleInstructions("dev").replace(ROLE_CLAUSES.worker, "<CLAUSE>"),
    );
  });
});

describe("po-session canvas MCP wiring", () => {
  const record = { "iris-canvas": { type: "http", url: "http://127.0.0.1:1234/mcp", headers: { Authorization: "Bearer tok" }, alwaysLoad: true } };

  it("passes mcpServers through to the SDK query() options at session creation", () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    /** @type {any} */
    let capturedOptions;
    /** @param {{ options?: any }} params */
    const queryFn = ({ options }) => {
      capturedOptions = options;
      return source.query;
    };

    const state = getOrCreatePoSession(workstream, { mcpServers: record, query: queryFn });

    expect(capturedOptions.mcpServers).toBe(record);
    expect(state.currentMcp).toBe(true);
  });

  it("omits mcpServers entirely when the canvas MCP is not available", () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    /** @type {any} */
    let capturedOptions;
    /** @param {{ options?: any }} params */
    const queryFn = ({ options }) => {
      capturedOptions = options;
      return source.query;
    };

    const state = getOrCreatePoSession(workstream, { query: queryFn });

    expect(capturedOptions.mcpServers).toBeUndefined();
    expect(state.currentMcp).toBeNull();
  });

  it("setPoSessionMcpServers wires an already-live session via query.setMcpServers", async () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { query: () => source.query });
    let calledWith;
    state.query.setMcpServers = async (servers) => {
      calledWith = servers;
    };

    await setPoSessionMcpServers(state, record);

    expect(calledWith).toBe(record);
    expect(state.currentMcp).toBe(true);
  });
});

// Cancellation: interrupt the turn, keep the resident conversation. Tearing the
// transport down to stop one turn threw away the context window that is the
// whole reason PO is a live session.
describe("cancelPoTurn", () => {
  function withInterrupt(source, receipt) {
    source.query.interrupt = async () => receipt;
    return source;
  }

  it("interrupts the turn instead of closing the transport", async () => {
    const source = createFakeQuerySource();
    let returned = false;
    source.query.return = async () => {
      returned = true;
    };
    withInterrupt(source, { still_queued: [] });
    const state = getOrCreatePoSession(makeWorkstream(), { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    await cancelPoTurn(state);

    await expect(withTimeout(turnPromise)).rejects.toMatchObject({
      poEndReason: { kind: "cancelled" },
    });
    expect(returned).toBe(false);
    // The session survives, so the next turn resumes the same conversation.
    expect(state.ended).toBe(false);
  });

  // Telling the user something was cancelled when it will still run is a lie
  // the receipt exists to prevent.
  it("records the queued work that survived the interrupt", async () => {
    const source = withInterrupt(createFakeQuerySource(), { still_queued: ["u1", "u2"] });
    const state = getOrCreatePoSession(makeWorkstream(), { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    await cancelPoTurn(state);

    await expect(withTimeout(turnPromise)).rejects.toMatchObject({
      poEndReason: { kind: "cancelled", survived: ["u1", "u2"] },
    });
  });

  it("falls back to the teardown path when the CLI cannot interrupt", async () => {
    const source = createFakeQuerySource();
    source.query.interrupt = async () => {
      throw new Error("unsupported");
    };
    const state = getOrCreatePoSession(makeWorkstream(), { query: () => source.query });

    const turnPromise = deliverPoTurn(state, "do the thing");
    await cancelPoTurn(state);

    await expect(withTimeout(turnPromise)).rejects.toMatchObject({
      poEndReason: { kind: "cancelled" },
    });
  });

  it("is a no-op on a session that has already ended", async () => {
    const source = createFakeQuerySource();
    const state = getOrCreatePoSession(makeWorkstream(), { query: () => source.query });
    state.ended = true;
    await expect(cancelPoTurn(state)).resolves.toBeUndefined();
  });
});

describe("the PO session's own abort controller", () => {
  it("is handed to the SDK and fired on teardown, not on a turn cancel", async () => {
    const source = createFakeQuerySource();
    withInterruptNoop(source);
    /** @type {any} */
    let captured;
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, {
      query: ({ options }) => {
        captured = options;
        return source.query;
      },
    });

    expect(captured.abortController).toBe(state.abortController);

    // Cancelling a turn must NOT abort the session — that would take the whole
    // resident conversation down with it.
    await cancelPoTurn(state);
    expect(state.abortController.signal.aborted).toBe(false);

    closePoSession(workstream.id);
    expect(state.abortController.signal.aborted).toBe(true);
  });

  function withInterruptNoop(source) {
    source.query.interrupt = async () => ({ still_queued: [] });
  }
});
