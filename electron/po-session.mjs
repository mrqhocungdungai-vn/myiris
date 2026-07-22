// The stateful PO module: one persistent Agent SDK session per workstream,
// kept alive across turns (single continuous context window) instead of the
// stateless DEV module's one-shot `claude -p` spawn per issue. See
// openspec/changes/po-live-session/design.md (D1) for why these are two
// separate modules rather than one code path with a role flag.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseClaudeStreamMessage } from "./claude-stream.mjs";

export const DEFAULT_PO_QUESTION_TIMEOUT_MS = 300000; // 5 minutes

// The Agent SDK's `env` option REPLACES the subprocess environment entirely
// (it does not merge with process.env), so callers must spread process.env
// themselves. ANTHROPIC_API_KEY outranks CLAUDE_CODE_OAUTH_TOKEN in the SDK's
// own auth precedence, so a stray key left in the environment would silently
// switch PO usage from subscription billing to metered API billing — strip
// it (and its bearer-token sibling) unconditionally for the PO session only.
// This scrubbing is intentionally PO-scoped: the DEV subprocess keeps using
// process.env untouched, per design D3.
export function computePoSessionEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function poBillingStatus(env = process.env) {
  const token = String(env.CLAUDE_CODE_OAUTH_TOKEN || "").trim();
  return token ? { ok: true, mode: "subscription" } : { ok: false, mode: "missing" };
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
      if (result.subtype === "success" && !result.is_error) {
        turn.resolve({ status: "completed", output: String(result.result ?? "") });
      } else {
        turn.resolve({
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
export function getOrCreatePoSession(
  workstream,
  { agent, cwd, resumeSessionId, onAskUserQuestion, claudeExecutable, model, query: queryFn = query } = {},
) {
  const existing = sessions.get(workstream.id);
  if (existing && !existing.ended) return existing;

  const channel = createUserMessageChannel();
  const state = {
    workstreamId: workstream.id,
    sessionId: resumeSessionId || null,
    currentTurn: null,
    ended: false,
    channel,
    // Tracks the model the live SDK session is actually running on, so callers
    // can tell whether a `setModel()` round-trip is needed before the next turn.
    currentModel: model || null,
  };

  const options = {
    agent,
    cwd,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Enable the globally-installed skills (grilling, the OpenSpec workflow
    // skills, tdd/verify/code-review) for the live PO session explicitly.
    // `settingSources` is intentionally left at its default (all sources) so
    // the `user` scope — i.e. ~/.claude, where the agents and skills live — is
    // loaded regardless of the workstream `cwd`. Verified against SDK 0.3.210:
    // `skills: 'all'` + default settingSources surfaces every ~/.claude/skills
    // even from a cwd with no local skills. See the po-voice-controller change.
    skills: "all",
    env: computePoSessionEnv(process.env),
    canUseTool: buildCanUseTool(state, onAskUserQuestion),
    appendSystemPrompt:
      "You are invoked from Iris voice as a LIVE, continuous session — you are not a one-shot run. " +
      "Ask via AskUserQuestion at real decision points and wait for the answer; for lower-stakes calls, " +
      "use sensible defaults and record them. Report concise final results in each turn.",
  };
  if (model) options.model = model;
  if (claudeExecutable) options.pathToClaudeCodeExecutable = claudeExecutable;
  if (resumeSessionId) options.resume = resumeSessionId;

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

export function closePoSession(workstreamId) {
  const state = sessions.get(workstreamId);
  if (!state) return;
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
    state.query?.return?.();
  } catch {
    /* subprocess already gone */
  }
}

export function closeAllPoSessions() {
  for (const id of [...sessions.keys()]) closePoSession(id);
}
