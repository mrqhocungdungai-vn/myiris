// The stateful STUDY module: one persistent Agent SDK session per workstream,
// kept alive across turns (single continuous context of the study sitting)
// instead of a one-shot spawn per note/verify request. STUDY is mechanically
// identical to PO (persistent query(), streaming user-message channel,
// canUseTool relay), but is a DELIBERATELY SEPARATE module — the PO and STUDY
// roles are expected to grow independent capabilities, so they never share a
// code path (see openspec/changes/study-note-role/design.md D3). This module
// keeps its OWN sessions Map, so a PO session and a STUDY session can be
// resident in the same workstream without colliding.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseClaudeStreamMessage } from "./claude-stream.mjs";

// The Agent SDK's `env` option REPLACES the subprocess environment entirely, so
// callers must spread process.env themselves. ANTHROPIC_API_KEY outranks
// CLAUDE_CODE_OAUTH_TOKEN in the SDK's own auth precedence, so a stray key would
// silently switch STUDY usage from subscription billing to metered API billing —
// strip it (and its bearer-token sibling) unconditionally for the STUDY session
// only. This scrubbing is STUDY-scoped: the DEV subprocess is never touched, and
// the PO module does its own identical scrub independently.
export function computeStudySessionEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function studyBillingStatus(env = process.env) {
  const token = String(env.CLAUDE_CODE_OAUTH_TOKEN || "").trim();
  return token ? { ok: true, mode: "subscription" } : { ok: false, mode: "missing" };
}

// A pull-based async channel: deliverStudyTurn() pushes one user message per
// turn, and the SDK's `for await` pulls from it whenever it's ready. Never
// completes on its own — that's what keeps the underlying query() call (and its
// context window) alive across turns instead of exiting after one.
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
  // resolves as an explicit allow — a no-op under bypassPermissions.
  return async function canUseTool(toolName, input) {
    if (toolName !== "AskUserQuestion") {
      return { behavior: "allow", updatedInput: input };
    }
    const questions = Array.isArray(input?.questions) ? input.questions : [];
    const answers = await onAskUserQuestion(state.workstreamId, questions);
    return { behavior: "allow", updatedInput: { ...input, answers } };
  };
}

function routeMessage(state, message) {
  parseClaudeStreamMessage(message, {
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
          output: String(result.result ?? result.subtype ?? "STUDY turn failed"),
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
    if (state.currentTurn) {
      state.currentTurn.reject(error);
      state.currentTurn = null;
    }
    state.error = error;
  } finally {
    state.ended = true;
  }
}

// Create-on-first-turn / reuse-on-follow-up: returns the existing resident
// STUDY session for this workstream, or opens a fresh one (resuming the stored
// on-disk Claude session id if one exists, so history from a prior app run is
// not lost).
export function getOrCreateStudySession(
  workstream,
  { agent, cwd, resumeSessionId, onAskUserQuestion, claudeExecutable, model } = {},
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
    currentModel: model || null,
  };

  const options = {
    agent,
    cwd,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Enable globally-installed skills (the open-second-brain skill STUDY uses,
    // plus grilling/tdd/etc.) for the live session. `settingSources` is left at
    // its default (all sources) so the `user` scope — ~/.claude, where the
    // agents/skills AND the enabled open-second-brain plugin live — loads
    // regardless of the workstream cwd. `strictMcpConfig` is intentionally NOT
    // set, so the plugin's MCP tools (brain_create_note, brain_search, …) load
    // from user settings the same way. See study-note-role/design.md D3.
    skills: "all",
    env: computeStudySessionEnv(process.env),
    canUseTool: buildCanUseTool(state, onAskUserQuestion),
    appendSystemPrompt:
      "You are invoked from Iris voice as a LIVE, continuous STUDY session — you are not a one-shot run. " +
      "You are the second-brain LIBRARIAN and FACT-CHECKER: record notes and verify notes only — never teach or explain, never write code. " +
      "Ask via AskUserQuestion at genuine filing/verification decision points and wait for the answer; " +
      "for lower-stakes calls, use sensible defaults and record them. Report concise, speakable final results in each turn.",
  };
  if (model) options.model = model;
  if (claudeExecutable) options.pathToClaudeCodeExecutable = claudeExecutable;
  if (resumeSessionId) options.resume = resumeSessionId;

  state.query = query({ prompt: channel.iterable, options });
  sessions.set(workstream.id, state);
  pump(state);
  return state;
}

// Switches an already-live session to a different model without closing or
// resuming it — the resident conversation and its context are untouched.
export async function setStudySessionModel(state, model) {
  if (!model || !state?.query?.setModel) return;
  await state.query.setModel(model);
  state.currentModel = model;
}

export function deliverStudyTurn(state, taskText, { onActivity, onSessionId, onToolStart, onToolEnd } = {}) {
  return new Promise((resolve, reject) => {
    if (state.ended) {
      reject(state.error || new Error("STUDY session has ended"));
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

export function getStudySessionState(workstreamId) {
  const state = sessions.get(workstreamId);
  return state && !state.ended ? state : null;
}

export function closeStudySession(workstreamId) {
  const state = sessions.get(workstreamId);
  if (!state) return;
  sessions.delete(workstreamId);
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

export function closeAllStudySessions() {
  for (const id of [...sessions.keys()]) closeStudySession(id);
}
