// The stateful PO module: one persistent Agent SDK session per workstream,
// kept alive across turns (single continuous context window) instead of the
// stateless DEV module's one-shot `claude -p` spawn per issue. See
// openspec/changes/po-live-session/design.md (D1) for why these are two
// separate modules rather than one code path with a role flag.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseClaudeStreamMessage, runUsageFrom } from "./claude-stream.mjs";
import { readInFlightCostUsd } from "./run-hooks.mjs";
import { DECISION_OUTPUT_FORMAT, readRunOutput } from "./run-output-format.mjs";
import { computeClaudeWorkerEnv } from "./worker-env.mjs";

export const DEFAULT_PO_QUESTION_TIMEOUT_MS = 300000; // 5 minutes

// The Agent SDK's `env` option REPLACES the subprocess environment entirely
// (it does not merge with process.env), so callers must spread process.env
// themselves. Retained as a named PO-facing alias of the shared policy — both
// roles now run under exactly the same credential rules, so this is a
// re-export rather than a second policy that could drift from DEV's.
export function computePoSessionEnv(baseEnv = process.env) {
  return computeClaudeWorkerEnv(baseEnv);
}

// Whether PO has anything to authenticate with. A subscription token is still
// the preferred path (it is what the persona's long-running sessions are priced
// for), but an API key is a working credential and PO must not refuse a run the
// pipeline gate has already declared available — pipeline-probes.mjs accepts
// either, so refusing one here would strand API-key-only users with a live
// pipeline whose PO turns all fail.
export function poBillingStatus(env = process.env) {
  if (String(env.CLAUDE_CODE_OAUTH_TOKEN || "").trim()) return { ok: true, mode: "subscription" };
  if (String(env.ANTHROPIC_API_KEY || "").trim()) return { ok: true, mode: "api-key" };
  return { ok: false, mode: "missing" };
}

export function poQuestionTimeoutMs(env = process.env) {
  const raw = Number(env.IRIS_PO_QUESTION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PO_QUESTION_TIMEOUT_MS;
}

// A pull-based async channel: deliverPoTurn() pushes one user message per
// turn, and the SDK's `for await` pulls from it whenever it's ready. Never
// completes on its own — that's what keeps the underlying `query()` call (and
// its context window) alive across turns instead of exiting after one.
function createUserMessageChannel() {
  const queue = [];
  let waiter = null;
  let closed = false;
  function push(message) {
    if (closed) return;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: message, done: false });
    } else {
      queue.push(message);
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: undefined, done: true });
    }
  }
  async function* iterate() {
    while (true) {
      if (queue.length) {
        yield queue.shift();
        continue;
      }
      if (closed) return;
      // eslint-disable-next-line no-await-in-loop
      const result = await new Promise((resolve) => {
        waiter = resolve;
      });
      if (result.done) return;
      yield result.value;
    }
  }
  return { push, close, iterable: iterate() };
}

const sessions = new Map(); // workstreamId -> session state

function buildCanUseTool(state, onAskUserQuestion) {
  // Only AskUserQuestion is intercepted for the voice relay; every other tool
  // resolves as an explicit allow — a no-op under bypassPermissions, and the
  // fallback path (see design.md "Verified against the installed SDK") if a
  // future permissionMode change makes canUseTool the sole gate for everything.
  //
  // onAskUserQuestion resolves with a { behavior, answers?, message? }
  // descriptor, not a bare answers map — main.mjs's PendingQuestion decides
  // allow (voice/UI answer, or timeout default) vs deny (a deliberate session
  // reset abandoned the question) and this stays a thin translator, never
  // learning what "reset" vs "timeout" means.
  /**
   * @param {string} toolName
   * @param {any} input
   * @returns {Promise<import("@anthropic-ai/claude-agent-sdk").PermissionResult>}
   */
  return async function canUseTool(toolName, input) {
    if (toolName !== "AskUserQuestion") {
      return { behavior: "allow", updatedInput: input };
    }
    const questions = Array.isArray(input?.questions) ? input.questions : [];
    const result = await onAskUserQuestion(state.workstreamId, questions);
    if (result?.behavior === "deny") {
      return { behavior: "deny", message: result.message ?? "Question abandoned." };
    }
    return { behavior: "allow", updatedInput: { ...input, answers: result.answers ?? {} } };
  };
}

function routeMessage(state, message) {
  parseClaudeStreamMessage(message, {
    // 'init' only ever fires before the first turn's 'result', so the turn
    // that triggered process startup is always the current one.
    onSessionId: (sessionId) => {
      state.sessionId = sessionId;
      state.currentTurn?.onSessionId?.(sessionId);
    },
    onActivity: (text) => state.currentTurn?.onActivity(text),
    onToolStart: (toolId, toolName, detail) => state.currentTurn?.onToolStart(toolId, toolName, detail),
    onToolEnd: (toolId, isError) => state.currentTurn?.onToolEnd(toolId, isError),
    onResult: (result) => {
      if (result.session_id) state.sessionId = result.session_id;
      const turn = state.currentTurn;
      state.currentTurn = null;
      if (!turn) return;
      if (result.session_id) turn.onSessionId?.(result.session_id);
      // `subtype` and `usage` travel with every outcome so the caller can tell a
      // ceiling termination from a failure and record what the turn cost. This
      // module deliberately does not interpret either — run-exec.mjs owns the
      // budget policy, and PO must not grow a second copy of it.
      const common = { subtype: result.subtype, usage: runUsageFrom(result) };
      if (result.subtype === "success" && !result.is_error) {
        // Structured output when the turn produced it, prose otherwise — and in
        // the structured case `result.result` is the raw JSON string, which must
        // never be what a turn resolves with.
        const read = readRunOutput(result);
        turn.resolve({ ...common, status: "completed", output: read.text, decisions: read.decisions });
      } else {
        turn.resolve({
          ...common,
          status: "failed",
          output: String(result.result ?? result.subtype ?? "PO turn failed"),
        });
      }
    },
  });
}

async function pump(state) {
  try {
    for await (const message of state.query) {
      routeMessage(state, message);
    }
  } catch (error) {
    state.error = error;
  } finally {
    state.ended = true;
    // A turn already resolved by routeMessage's onResult has cleared
    // currentTurn, so this only settles a turn that would otherwise hang —
    // covers the stream ending without throwing (channel closed by
    // closePoSession, or the SDK stream simply stopping) as well as a throw.
    const turn = state.currentTurn;
    state.currentTurn = null;
    if (turn) {
      const error =
        state.error ||
        new Error(
          state.endReason?.kind === "teardown"
            ? "PO session was torn down before the turn completed"
            : "PO session ended before the turn completed",
        );
      if (state.endReason) error.poEndReason = state.endReason;
      turn.reject(error);
    }
  }
}

// Create-on-first-turn / reuse-on-follow-up: returns the existing resident
// session for this workstream, or opens a fresh one (resuming the stored
// on-disk Claude session id if one exists, so history from a prior app run —
// or from the pre-live-session `-p --resume` era — is not lost).
/**
 * @param {{ id: string, agent_sessions?: Record<string, string> }} workstream
 * @param {{
 *   agent?: string,
 *   agentDefinition?: { description: string, prompt: string, model?: string },
 *   plugins?: Array<{ type: "local", path: string, skipMcpDiscovery?: boolean }> | null,
 *   cwd?: string,
 *   sessionKey?: string,
 *   resumeSessionId?: string|null,
 *   onAskUserQuestion?: (workstreamId: string, questions: unknown[]) => Promise<{ behavior?: string, message?: string, answers?: Record<string, unknown> }>,
 *   claudeExecutable?: string,
 *   model?: string,
 *   mcpServers?: Record<string, unknown>,
 *   budget?: { maxTurns: number, maxBudgetUsd: number },
 *   skills?: string[],
 *   systemPrompt?: import("@anthropic-ai/claude-agent-sdk").Options["systemPrompt"],
 *   title?: string,
 *   buildHooks?: (seams: { costUsd: () => Promise<number|null>, onToolEnd: (toolId: string, isError: boolean) => void, onActivity: (line: string) => void }) => any,
 *   stderr?: (data: string) => void,
 *   query?: typeof query,
 * }} [options]
 */
export function getOrCreatePoSession(
  workstream,
  {
    agent,
    agentDefinition,
    plugins,
    cwd,
    sessionKey,
    resumeSessionId,
    onAskUserQuestion,
    claudeExecutable,
    model,
    mcpServers,
    budget,
    stderr,
    skills,
    systemPrompt,
    buildHooks,
    title,
    query: queryFn = query,
  } = {},
) {
  const existing = sessions.get(workstream.id);
  if (existing && !existing.ended) return existing;

  const channel = createUserMessageChannel();
  const state = {
    workstreamId: workstream.id,
    // Which stored conversation this resident session writes back to. Both
    // stateful verbs resolve to the same key, which is what makes moving from
    // voice to the canvas continue one conversation rather than opening a
    // second (design.md D3).
    sessionKey: sessionKey || "stateful",
    sessionId: resumeSessionId || null,
    currentTurn: null,
    ended: false,
    channel,
    // Tracks the model the live SDK session is actually running on, so callers
    // can tell whether a `setModel()` round-trip is needed before the next turn.
    currentModel: model || null,
    // Tracks whether the canvas MCP has already been wired into this live
    // session (design.md D8 of canvas-claude-mcp) — set true here when it's
    // supplied at creation, or by setPoSessionMcpServers on a follow-up turn.
    // po-session.mjs never learns anything about canvas beyond this opaque
    // record; it stays canvas-ignorant.
    currentMcp: mcpServers ? true : null,
    // The session-level hard stop, matching what DEV has always had. Not used
    // to cancel a *turn* — that is interrupt()'s job, and aborting here would
    // take the whole resident conversation down with it. This is closePoSession's
    // backstop for a subprocess that will not unwind on its own.
    abortController: new AbortController(),
  };

  const options = {
    agent,
    cwd,
    abortController: state.abortController,
    permissionMode: /** @type {"bypassPermissions"} */ ("bypassPermissions"),
    allowDangerouslySkipPermissions: true,
    // The skills PO invokes come from the plugin Iris ships — NOT from
    // ~/.claude. `settingSources` therefore excludes the `user` scope: Iris
    // brings its own skills and must neither depend on nor disturb whatever the
    // user has in their own Claude Code install. `project` is kept so a session
    // still picks up the settings of the repository it is working in.
    settingSources: /** @type {Array<"project">} */ (["project"]),
    // Supplied by the caller rather than fixed at "all" here, so the list is a
    // property of the verb and not of this module (verbs.mjs declares it,
    // run-skills.mjs holds the lists). The fallback is the empty list, not
    // "all": a caller that forgets to pass one should get a session that can
    // reach nothing, never one silently widened to every skill the bundle ships.
    skills: skills ?? [],
    env: computePoSessionEnv(process.env),
    canUseTool: buildCanUseTool(state, onAskUserQuestion),
    // Built by the caller through the one policy in role-prompt.mjs, on the one
    // field the SDK actually honours. It used to travel on a top-level
    // `appendSystemPrompt`, which the SDK destructures away and never reads — so
    // the live session ran with no base prompt at all while the one-shot path got
    // a full one. This module no longer knows what a persona is; it is handed
    // one. See the agent-sdk-conformance design.md D1b.
    systemPrompt,
    // Decisions come back as validated data rather than a markdown heading the
    // voice layer has to find. Applies to the whole resident session, so every
    // turn reports in this shape — which is why the schema keeps `summary` as
    // its only required field (design.md D6).
    outputFormat: DECISION_OUTPUT_FORMAT,
  };
  if (model) options.model = model;
  // The ceilings come from the caller (run-exec.mjs → run-budget.mjs) rather
  // than being read here, so both run shapes resolve their budget through one
  // policy.
  // A resident session applies them per `query()`, i.e. across the session's
  // whole lifetime rather than per turn — see design.md D3.
  if (budget) {
    options.maxTurns = budget.maxTurns;
    options.maxBudgetUsd = budget.maxBudgetUsd;
  }
  // Subprocess diagnostics. Without this the SDK discards stderr entirely and a
  // transport failure reaches the user as one message with nothing behind it.
  if (stderr) options.stderr = stderr;
  // The workstream's own name, so PO's transcript is identifiable. Applies to a
  // NEW session only — a resumed one keeps its persisted title, which is what
  // renameSession exists for (run-sessions.mjs).
  if (title) options.title = title;
  // The same hooks DEV installs, bound to whichever turn is currently in flight
  // rather than to a run record: this session outlives every individual turn, so
  // closing over one would send a later turn's tool boundaries to the first
  // turn's callbacks. Routed through `state.currentTurn` exactly as
  // routeMessage's stream callbacks already are, so a hook firing between turns
  // is a no-op instead of a crash.
  if (buildHooks) {
    options.hooks = buildHooks({
      costUsd: () => readInFlightCostUsd(state.query),
      onToolEnd: (toolId, isError) => state.currentTurn?.onToolEnd(toolId, isError),
      onActivity: (line) => state.currentTurn?.onActivity(line),
    });
  }
  // Handed over by value: the persona lives in the app bundle, not in
  // ~/.claude/agents (see agent-definitions.mjs).
  if (agentDefinition) options.agents = { [agent]: agentDefinition };
  if (plugins) options.plugins = plugins;
  if (claudeExecutable) options.pathToClaudeCodeExecutable = claudeExecutable;
  if (resumeSessionId) options.resume = resumeSessionId;
  if (mcpServers) options.mcpServers = mcpServers;

  state.query = queryFn({ prompt: channel.iterable, options });
  sessions.set(workstream.id, state);
  pump(state);
  return state;
}

// Switches an already-live session to a different model without closing or
// resuming it — the resident conversation and its context are untouched, only
// the model backing the next turn changes. No-op if the SDK query object
// doesn't expose setModel (defensive; the installed SDK always does).
export async function setPoSessionModel(state, model) {
  if (!model || !state?.query?.setModel) return;
  await state.query.setModel(model);
  state.currentModel = model;
}

// Wires the canvas MCP into an already-live session — mirrors
// setPoSessionModel's shape exactly, but there is no "different servers"
// case to react to (the canvas MCP's url/token are stable for the server's
// whole lifetime), so this is applied at most once per session: callers
// check state.currentMcp first and only call this when it's still falsy
// (canvas-claude-mcp design.md D6/D8's "lazily per turn" wiring).
export async function setPoSessionMcpServers(state, servers) {
  if (!servers || !state?.query?.setMcpServers) return;
  await state.query.setMcpServers(servers);
  state.currentMcp = true;
}

/**
 * @param {any} state
 * @param {string} taskText
 * @param {{ onActivity?: (text: string) => void, onSessionId?: (sessionId: string) => void, onToolStart?: (toolId: string, toolName: string, detail: unknown) => void, onToolEnd?: (toolId: string, isError: boolean) => void }} [callbacks]
 */
export function deliverPoTurn(state, taskText, { onActivity, onSessionId, onToolStart, onToolEnd } = {}) {
  return new Promise((resolve, reject) => {
    if (state.ended) {
      reject(state.error || new Error("PO session has ended"));
      return;
    }
    state.currentTurn = {
      resolve,
      reject,
      onActivity: onActivity || (() => {}),
      onSessionId: onSessionId || (() => {}),
      onToolStart: onToolStart || (() => {}),
      onToolEnd: onToolEnd || (() => {}),
    };
    state.channel.push({
      type: "user",
      message: { role: "user", content: taskText },
      parent_tool_use_id: null,
    });
  });
}

export function getPoSessionState(workstreamId) {
  const state = sessions.get(workstreamId);
  return state && !state.ended ? state : null;
}

// Ends the turn currently in progress on `state`, leaving the session itself
// alive: it is NOT removed from the in-memory `sessions` map, and the on-disk
// stored session id is untouched, so the next PO turn resumes the same
// conversation. Only the cancelled turn's in-flight work is discarded. Differs
// from closePoSession in that and in endReason.kind ("cancelled" vs "teardown").
//
// Two mechanisms, preferring the one that keeps the live context: `interrupt()`
// ends the turn without touching the transport, so the session's context window
// survives. The channel-close teardown is the fallback for a CLI that does not
// support it. See design.md D2 for why endReason is always set before the
// channel closes on that path.
export async function cancelPoTurn(state) {
  if (!state || state.ended) return;
  state.endReason = { kind: "cancelled" };

  // Interrupt first, and keep the session alive if it works. `interrupt()` ends
  // the turn in progress and leaves the resident conversation — and its context
  // window — intact, which is the whole point of PO being a live session; tearing
  // the transport down to stop one turn threw away everything the session knew.
  //
  // It also reports which queued work SURVIVED the interrupt. Iris must not tell
  // the user something was cancelled when it is still going to run, so that list
  // is recorded on the state for the caller to report.
  try {
    const receipt = await state.query?.interrupt?.();
    const survived = Array.isArray(receipt?.still_queued) ? receipt.still_queued : [];
    state.endReason = { kind: "cancelled", survived };
    // The turn settles through pump's `finally` only when the stream ends. An
    // interrupt does not end it, so settle the waiting turn here.
    const turn = state.currentTurn;
    state.currentTurn = null;
    if (turn) {
      const error = /** @type {any} */ (new Error("PO turn was interrupted"));
      error.poEndReason = state.endReason;
      turn.reject(error);
    }
    return;
  } catch {
    /* no interrupt support, or the turn was already past interrupting — fall through */
  }

  // The pre-interrupt path, unchanged, as the fallback: close the channel (which
  // makes pump's `for await` exit and settle the turn) and end the query. See
  // design.md D2 — endReason must be set BEFORE the channel closes, which it is.
  try {
    state.channel.close();
  } catch {
    /* already closed */
  }
  try {
    state.query?.return?.();
  } catch {
    /* subprocess already gone */
  }
}

export function closePoSession(workstreamId) {
  const state = sessions.get(workstreamId);
  if (!state) return undefined;
  sessions.delete(workstreamId);
  // Set BEFORE closing the channel: closing is what makes pump's `for await`
  // exit (on a later microtask), so this is always visible by the time its
  // `finally` reads it — see design.md D2 "Ordering must be exact".
  state.endReason = { kind: "teardown" };
  try {
    state.channel.close();
  } catch {
    /* already closed */
  }
  try {
    return state.query?.return?.();
  } catch {
    /* subprocess already gone */
    return undefined;
  } finally {
    // The backstop for a subprocess that does not unwind when its stream is
    // returned. Safe unconditionally: the session is being torn down either way,
    // and aborting an already-finished query is a no-op.
    try {
      state.abortController?.abort();
    } catch {
      /* nothing left to abort */
    }
  }
}

export function closeAllPoSessions() {
  return Promise.all([...sessions.keys()].map(closePoSession));
}
