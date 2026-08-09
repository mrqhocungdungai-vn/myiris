// The BUG A regression: a PO turn must always settle, even when the SDK
// stream ends without throwing (closePoSession's channel.close(), or a
// stream that just stops on its own). Driven through the Wave 0.0 injected
// `query` seam — a fake async iterator, no subprocess, no Electron. See
// openspec/changes/settle-and-attribute-po-turn/design.md D1/D2/D5.
import { describe, it, expect, vi } from "vitest";
import {
  getOrCreatePoSession,
  deliverPoTurn,
  cancelPoTurn,
  closePoSession,
  setPoSessionMcpServers,
  hasUsedPoSession,
} from "./po-session.mjs";
import { STATEFULNESS_CLAUSES, buildRunInstructions, buildSystemPrompt } from "./role-prompt.mjs";
import { resolveVerb } from "./verbs.mjs";

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

  // The live-session instruction travelled on a top-level `appendSystemPrompt`,
  // which the SDK destructures away and never reads — so the resident session
  // ran on the minimal prompt while the one-shot path got a full one. Confirmed
  // against the live SDK in the agent-sdk-conformance design.md D1b.
  //
  // This module no longer builds the prompt at all: it is handed one, so it
  // cannot be the place a second policy grows.
  it("delivers the caller's prompt on the field the SDK reads", () => {
    const verb = resolveVerb("shape_requirements");
    const options = captureOptions({ systemPrompt: buildSystemPrompt(verb) });

    expect(options.appendSystemPrompt).toBeUndefined();
    expect(options.systemPrompt).toEqual(buildSystemPrompt(verb));
    expect(options.systemPrompt.append).toContain("AskUserQuestion");
  });

  it("shares the base prompt with the stateless shape, one statefulness clause apart", () => {
    const shape = resolveVerb("shape_requirements");
    // WITH an open change — the fork that genuinely cannot ask, and so the one
    // that carries STATEFULNESS_CLAUSES.stateless (ask-when-unspecified D1).
    const execute = resolveVerb("execute", ["add-thing"]);
    const stateful = captureOptions({ systemPrompt: buildSystemPrompt(shape) }).systemPrompt.append;

    expect(stateful.replace(STATEFULNESS_CLAUSES.stateful, "<BASE>").replace(shape.clause, "<CLAUSE>")).toEqual(
      buildRunInstructions(execute).replace(STATEFULNESS_CLAUSES.stateless, "<BASE>").replace(execute.clause, "<CLAUSE>"),
    );
  });

  // A caller that forgets to pass a list must get a session that can reach
  // nothing, never one silently widened back to every skill the bundle ships.
  it("defaults to no skills rather than to all of them", () => {
    expect(captureOptions().skills).toEqual([]);
    expect(captureOptions({ skills: ["iris:grilling"] }).skills).toEqual(["iris:grilling"]);
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

// open-note-session design D2a: the regression 4.2 fixes — before this,
// getOrCreatePoSession returned any live session for the workstream without
// checking which conversation it belonged to.
describe("getOrCreatePoSession: sessionKey mismatch yields the resident slot", () => {
  it("delivers a turn for a different sessionKey into a NEW session, not the resident one", () => {
    const first = createFakeQuerySource();
    const second = createFakeQuerySource();
    const queries = [first.query, second.query];
    const workstream = makeWorkstream();

    const shaping = getOrCreatePoSession(workstream, { sessionKey: "stateful", query: () => queries.shift() });
    const note = getOrCreatePoSession(workstream, { sessionKey: "note:abc", query: () => queries.shift() });

    expect(note).not.toBe(shaping);
    expect(note.sessionKey).toBe("note:abc");
  });

  it("closes (yields) the incumbent rather than reusing it for a mismatched key", () => {
    const first = createFakeQuerySource();
    const second = createFakeQuerySource();
    const queries = [first.query, second.query];
    const workstream = makeWorkstream();

    const shaping = getOrCreatePoSession(workstream, { sessionKey: "stateful", query: () => queries.shift() });
    getOrCreatePoSession(workstream, { sessionKey: "note:abc", query: () => queries.shift() });

    // The outgoing conversation is torn down through the SAME path closePoSession
    // always uses (endReason set synchronously; `ended` itself flips once
    // pump's `for await` unwinds on a later microtask) — a handoff, not a
    // reset: `agent_sessions` is left untouched, so it stays resumable.
    expect(shaping.endReason).toEqual({ kind: "teardown" });
  });

  it("returns the SAME session on a matching sessionKey — no unnecessary churn", () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();

    const first = getOrCreatePoSession(workstream, { sessionKey: "note:abc", query: () => source.query });
    const second = getOrCreatePoSession(workstream, { sessionKey: "note:abc", query: () => source.query });

    expect(second).toBe(first);
  });

  it("two different notes yield two different sessions, keyed by their own note id", () => {
    const first = createFakeQuerySource();
    const second = createFakeQuerySource();
    const queries = [first.query, second.query];
    const workstream = makeWorkstream();

    const noteA = getOrCreatePoSession(workstream, { sessionKey: "note:a", query: () => queries.shift() });
    const noteB = getOrCreatePoSession(workstream, { sessionKey: "note:b", query: () => queries.shift() });

    expect(noteA).not.toBe(noteB);
    expect(noteA.sessionKey).toBe("note:a");
    expect(noteB.sessionKey).toBe("note:b");
  });

  // D2a: "note→note, note→shaping and shaping→note are one mechanism, not
  // three cases" — the handoff logic never checks WHAT kind of key it is,
  // only whether it matches, so all three directions behave identically.
  it("is symmetric: shaping→note, note→shaping, and note→note all yield the resident slot the same way", () => {
    const sources = [createFakeQuerySource(), createFakeQuerySource(), createFakeQuerySource()];
    const queries = sources.map((s) => s.query);
    const workstream = makeWorkstream();

    const shaping = getOrCreatePoSession(workstream, { sessionKey: "stateful", query: () => queries.shift() });
    const note = getOrCreatePoSession(workstream, { sessionKey: "note:a", query: () => queries.shift() });
    expect(note).not.toBe(shaping);
    expect(shaping.endReason).toEqual({ kind: "teardown" }); // shaping→note yielded

    const backToShaping = getOrCreatePoSession(workstream, { sessionKey: "stateful", query: () => queries.shift() });
    expect(backToShaping).not.toBe(note);
    expect(note.endReason).toEqual({ kind: "teardown" }); // note→shaping yielded, on the same terms
  });

  it("returning to note A's key after B took the slot resumes A's session identity, not B's", () => {
    const first = createFakeQuerySource();
    const second = createFakeQuerySource();
    const third = createFakeQuerySource();
    const queries = [first.query, second.query, third.query];
    const workstream = makeWorkstream();

    getOrCreatePoSession(workstream, { sessionKey: "note:a", resumeSessionId: "stored-a", query: () => queries.shift() });
    getOrCreatePoSession(workstream, { sessionKey: "note:b", query: () => queries.shift() });
    const backToA = getOrCreatePoSession(workstream, { sessionKey: "note:a", resumeSessionId: "stored-a", query: () => queries.shift() });

    expect(backToA.sessionKey).toBe("note:a");
    expect(backToA.sessionId).toBe("stored-a");
  });
});

// open-note-session design D6/8.2: the injected confirmWrite seam alongside
// onAskUserQuestion — po-session.mjs stays ignorant of notes/vaults/paths, it
// only forwards Edit/Write calls to whatever the caller supplied.
describe("po-session confirmWrite seam", () => {
  it("allows Edit/Write through canUseTool when confirmWrite is absent", async () => {
    const source = createFakeQuerySource();
    /** @type {any} */
    let options;
    getOrCreatePoSession(makeWorkstream(), {
      query: (args) => {
        options = args.options;
        return source.query;
      },
    });
    const result = await options.canUseTool("Edit", { file_path: "/x", old_string: "a", new_string: "b" });
    expect(result).toEqual({ behavior: "allow", updatedInput: { file_path: "/x", old_string: "a", new_string: "b" } });
  });

  it("calls the injected confirmWrite for Edit/Write and denies on its verdict", async () => {
    const source = createFakeQuerySource();
    const confirmWrite = async () => ({ behavior: "deny", message: "hold on" });
    /** @type {any} */
    let options;
    getOrCreatePoSession(makeWorkstream(), {
      confirmWrite,
      query: (args) => {
        options = args.options;
        return source.query;
      },
    });
    const result = await options.canUseTool("Write", { file_path: "/x", content: "y" });
    expect(result).toEqual({ behavior: "deny", message: "hold on" });
  });

  it("never calls confirmWrite for a tool other than Edit/Write", async () => {
    const source = createFakeQuerySource();
    const confirmWrite = vi.fn();
    /** @type {any} */
    let options;
    getOrCreatePoSession(makeWorkstream(), {
      confirmWrite,
      query: (args) => {
        options = args.options;
        return source.query;
      },
    });
    await options.canUseTool("Bash", { command: "ls" });
    expect(confirmWrite).not.toHaveBeenCalled();
  });
});

// open-note-session: the decisions schema's own "keep it to a few sentences"
// instruction would condense exactly what a verbatim reading must not
// condense — work_on_note opts out via an explicit `outputFormat: false`.
describe("po-session outputFormat override", () => {
  it("defaults to DECISION_OUTPUT_FORMAT when the caller passes nothing", async () => {
    const source = createFakeQuerySource();
    /** @type {any} */
    let options;
    getOrCreatePoSession(makeWorkstream(), {
      query: (args) => {
        options = args.options;
        return source.query;
      },
    });
    expect(options.outputFormat).toBeDefined();
  });

  it("omits outputFormat entirely when the caller passes false", async () => {
    const source = createFakeQuerySource();
    /** @type {any} */
    let options;
    getOrCreatePoSession(makeWorkstream(), {
      outputFormat: false,
      query: (args) => {
        options = args.options;
        return source.query;
      },
    });
    expect(options).not.toHaveProperty("outputFormat");
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

// the-canvas-becomes-a-conversation D1: warming opens a transport ahead of the
// first sentence. The trap it walks into, if the distinction is not kept, is
// the review gate: it parks on the call that OPENS a conversation and decides
// that by asking whether a live session exists. A warmed transport answering
// "yes" would send the user's very first sentence straight through, into a
// conversation they were never asked about.
describe("po-session: a warmed session is not yet a conversation", () => {
  it("reports a warmed session as not-yet-used", () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    getOrCreatePoSession(workstream, { warm: true, query: () => source.query });

    expect(hasUsedPoSession(workstream.id)).toBe(false);
  });

  it("counts as a conversation the moment a turn is delivered into it", () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { warm: true, query: () => source.query });

    // The promise is deliberately not awaited — the assertion is about the
    // state flipping on delivery, not about the turn's outcome — so its
    // rejection is absorbed rather than left to surface as an unhandled one.
    deliverPoTurn(state, "connect those two boxes").catch(() => {});

    expect(hasUsedPoSession(workstream.id)).toBe(true);
  });

  it("treats an ordinary session as a conversation from the start", () => {
    // Only a warm creates the in-between state; nothing else changes.
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    getOrCreatePoSession(workstream, { query: () => source.query });

    expect(hasUsedPoSession(workstream.id)).toBe(true);
  });

  it("reports no conversation once the session is closed", () => {
    const source = createFakeQuerySource();
    const workstream = makeWorkstream();
    const state = getOrCreatePoSession(workstream, { query: () => source.query });
    deliverPoTurn(state, "x").catch(() => {});
    closePoSession(workstream.id);

    expect(hasUsedPoSession(workstream.id)).toBe(false);
  });
});
