// The BUG A regression: a PO turn must always settle, even when the SDK
// stream ends without throwing (closePoSession's channel.close(), or a
// stream that just stops on its own). Driven through the Wave 0.0 injected
// `query` seam — a fake async iterator, no subprocess, no Electron. See
// openspec/changes/settle-and-attribute-po-turn/design.md D1/D2/D5.
import { describe, it, expect } from "vitest";
import { getOrCreatePoSession, deliverPoTurn, closePoSession } from "./po-session.mjs";

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

  const query = {
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
  };

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

    await expect(withTimeout(turnPromise)).resolves.toEqual({ status: "completed", output: "all good" });

    // Ending the stream afterwards must not throw or reject anything — the
    // turn already resolved and currentTurn is already cleared.
    source.endSilently();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
