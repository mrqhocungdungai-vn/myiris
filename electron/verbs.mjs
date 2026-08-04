// The verb registry — the single definition of every kind of work Iris can hand
// to Claude.
//
// It replaces the PO/DEV role model. "PO" and "DEV" each bundled two unrelated
// properties: *who the worker is* (a persona) and *how the run behaves*
// (resident-and-may-ask vs one-shot-and-never-asks). Only the second matters to
// the runtime, and it is the one the names hid — so the axis here is
// **stateful vs stateless**, and `stateful` means one thing only: this verb's
// runs may pause mid-turn and ask the user by voice. It does **not** mean
// "remembers previous calls" — every verb resumes its own prior conversation
// (design.md D1).
//
// Three hand-wired copies of a verb's definition — one in the Gemini
// declaration, one in the dispatch gate, one in the `query()` options — is the
// exact mechanism that produced the silently-dropped `appendSystemPrompt`: two
// call sites building the same thing with nothing forcing them to agree. So
// `gemini-tools.mjs` derives its declarations from this table,
// `run-dispatch.mjs` derives the park label, and `run-exec.mjs` derives the
// `query()` options. A verb is defined here and nowhere else (design.md D2).
//
// Fields may be functions of project state where the value genuinely depends on
// it — `execute` forks its skills, persona clause, and structured-output
// setting on whether the project has an open change (design.md D4). Resolution
// is a pure function of `(verb, project state)`, so the whole table is testable
// without booting anything.
//
// Electron-free, no I/O, no `process.env`.
import {
  SHAPING_SKILLS,
  IMPLEMENTATION_SKILLS,
  ORDINARY_SKILLS,
  CLOSEOUT_SKILLS,
  INVESTIGATION_SKILLS,
  REVIEW_SKILLS,
  NOTE_SKILLS,
} from "./run-skills.mjs";

/**
 * When a verb's dispatch is parked for the user's review (design.md D6). The
 * park is a **declared property of the verb**, never a heuristic read off the
 * brief's text — the verb is the risk signal, and it is explicit, enumerable,
 * and inspectable.
 */
export const PARK = Object.freeze({
  // Every call. Each is a fresh one-shot run that writes to the repository, so
  // each call is a new risk and the consent unit is the run.
  ALWAYS: "always",
  // Only the call that OPENS the shared resident session. Once the user has
  // agreed to open a conversation, every steering turn into it dispatches
  // directly — the consent unit is the conversation. Parking each turn of a live
  // grilling conversation is friction with no safety gained: the session is
  // already alive and already spending.
  ON_OPEN: "on_open",
  // Never. These verbs neither write to the repository nor open a resident
  // session.
  NEVER: "never",
});

// The curated model choices, and which one each verb defaults to. Kept here
// rather than in the session store because "which model is this kind of work
// worth" is a property of the work — the store's job is only to remember a
// user's override.
// Not frozen: it is handed to the voice layer and the renderer as a plain
// list, and freezing it only makes every consumer's type readonly for no
// safety this module actually needs.
export const MODEL_CHOICES = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const STRONGEST = "claude-opus-5";
const FAST = "claude-sonnet-5";
const CHEAPEST = "claude-haiku-4-5-20251001";

// The two persona bodies. `stateful` may pause and ask; `stateless` never can.
// Each verb adds one short clause naming its own job — see resources/personas/
// and role-prompt.mjs, which is the only place prompt text is composed.
const STATEFUL = "stateful";
const STATELESS = "stateless";

// The single resident session the two shaping verbs share (design.md D3). They
// are the same conversation in two media, and switching to the canvas happens
// precisely when talking has stopped working — which is the moment the
// accumulated context matters most.
export const STATEFUL_SESSION_KEY = "stateful";

// The thin schema both stateful verbs take (design.md D7). The model on the
// other end is the strongest available, holds the session context, and can pause
// to ask by voice — so a thin brief is a starting point it repairs, not a loss.
// Forcing Gemini to enumerate details here would be *worse*: enumeration is
// summarization, and summarization drops things. The verbatim transcript reaches
// the run alongside these two fields.
const THIN_PARAMS = Object.freeze({
  type: "object",
  properties: {
    said: {
      type: "string",
      description:
        "What the user just said, in their own words and as close to verbatim as you can manage. Do not summarize it, do not tidy it, and do not turn it into a specification — that is this verb's job, not yours.",
    },
    reading: {
      type: "string",
      description: "One line: what you take them to be asking for. A reading, not a brief.",
    },
  },
  required: ["said", "reading"],
});

/**
 * One record per verb. Every field is either a value or a function of the
 * resolved project state — see `resolveVerb`.
 *
 * @typedef {{ hasOpenChange: boolean, changes: string[] }} ProjectState
 */
const VERBS = Object.freeze({
  // ---- stateful: a resident session that may pause and ask by voice --------
  shape_requirements: {
    label: "Shape",
    description:
      "Settle what to build, by talking it through. Use for a NEW project or feature, for a request that is not yet pinned down, and for steering a shaping conversation that is already under way ('propose it now', 'what's the state of it'). This verb grills the user through you: it pauses mid-run to ask questions by voice, which arrive as SYSTEM_EVENT_PO_QUESTION and are answered with answer_claude_question. Do NOT write a specification yourself — pass on what was said and let it do the analysis.",
    stateful: true,
    park: PARK.ON_OPEN,
    sessionKey: STATEFUL_SESSION_KEY,
    model: STRONGEST,
    budget: "stateful",
    skills: SHAPING_SKILLS,
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    params: THIN_PARAMS,
    basePersona: STATEFUL,
    clause: "Settle what to build by talking it through, then turn it into an OpenSpec change with tasks.",
  },

  shape_on_canvas: {
    label: "Canvas",
    description:
      "Shape something on the drawing canvas — read what is on it, add to it, rearrange it, or answer a question about it. Use when the user says anything about the canvas/diagram/whiteboard ('draw it out', 'connect these two boxes', 'what should I add to my diagram'). You cannot see the canvas; this verb can. It continues the SAME conversation as shape_requirements, so it already knows whatever was discussed by voice.",
    stateful: true,
    park: PARK.ON_OPEN,
    // Shares the resident session, so it also shares its model while that
    // session is alive — declared here rather than pretending each verb owns
    // one (design.md D3).
    sessionKey: STATEFUL_SESSION_KEY,
    model: STRONGEST,
    budget: "stateful",
    skills: SHAPING_SKILLS,
    // Wired from the registry, not from a per-run special case — which is what
    // lets capabilities/canvas.mjs drop the workaround that steered Gemini away
    // from a worker for reasons unrelated to drawing.
    mcpServers: ["iris-canvas"],
    vault: false,
    structuredOutput: true,
    params: THIN_PARAMS,
    basePersona: STATEFUL,
    clause:
      "Work on the drawing canvas with the user. Read the canvas before answering about it, and draw on it rather than describing what you would draw.",
  },

  // ---- stateless: one-shot, autonomous, never asks -------------------------
  execute: {
    label: "Build",
    description:
      "Do the work. Implementing, fixing, writing, automating, looking something up and acting on it — anything the user asks to have DONE. In a project with an open change this implements its remaining tasks; with no open change it simply does the work, so a small request is not refused for lacking a specification. This runs autonomously and CANNOT ask you anything, so its parameters are the whole instruction.",
    stateful: false,
    park: PARK.ALWAYS,
    sessionKey: "execute",
    model: FAST,
    budget: "worker",
    // The fork (design.md D4): an open change with unchecked tasks means the
    // OpenSpec apply workflow; no open change means ordinary work with no
    // process skills loaded.
    skills: (state) => (state.hasOpenChange ? IMPLEMENTATION_SKILLS : ORDINARY_SKILLS),
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    params: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the user wants done, in one or two sentences." },
        details: {
          type: "string",
          description:
            "Every concrete detail the user gave — names, numbers, URLs, paths, dates, budgets, constraints — plus any default you are assuming. This run cannot hear the conversation and cannot ask you anything, so a detail you leave out is lost.",
        },
        expected_output: { type: "string", description: "What finishing looks like: the file, the change, the answer." },
        change: {
          type: "string",
          description: "The name of the OpenSpec change to implement, ONLY if the user named one. Omit otherwise — the run finds the open change itself.",
        },
      },
      required: ["goal", "details"],
    },
    basePersona: STATELESS,
    clause: (state) =>
      state.hasOpenChange
        ? "Implement the remaining tasks of the open OpenSpec change, test-first, and verify your own work against the specs' scenarios."
        : "Do the work you were asked to do, directly. There is no open change and none is wanted: do not propose one, do not create process artifacts, and do not ask for a specification first.",
  },

  finish: {
    label: "Finish",
    description:
      "Close out the open change: confirm its tasks are genuinely done, then archive it so the living spec absorbs what it changed. Use for 'archive it', 'wrap this up', 'we're done with that change'. Not for asking what is left — that is investigate.",
    stateful: false,
    park: PARK.ALWAYS,
    sessionKey: "finish",
    model: FAST,
    budget: "worker",
    skills: CLOSEOUT_SKILLS,
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    params: {
      type: "object",
      properties: {
        change: { type: "string", description: "The change to close out, ONLY if the user named one." },
        note: {
          type: "string",
          description: "Anything the user said that bears on closing it out — work to skip, something to check first.",
        },
      },
      required: [],
    },
    basePersona: STATELESS,
    clause:
      "Close out the open OpenSpec change: verify its tasks are genuinely complete, then archive it so its delta specs are synced into the living spec.",
  },

  investigate: {
    label: "Look",
    description:
      "Read the project and answer a question about it, changing nothing. Use for 'what's left', 'how does X work', 'is that done', 'why is this here'. This verb cannot write or edit — if the user wants something changed, that is execute.",
    stateful: false,
    park: PARK.NEVER,
    sessionKey: "investigate",
    model: FAST,
    budget: "light",
    skills: INVESTIGATION_SKILLS,
    mcpServers: [],
    vault: false,
    // A spoken answer, not a build report. Forcing it through a
    // summary/decisions schema would reshape an answer that has nothing to do
    // with a pipeline.
    structuredOutput: false,
    params: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to answer, as concretely as the user put it." },
        scope: { type: "string", description: "Where to look, if the user narrowed it — a change name, a folder, a feature." },
      },
      required: ["question"],
    },
    basePersona: STATELESS,
    clause:
      "Answer the question by reading the project. You have no ability to write or edit and must not try — report what you found, not what you would change.",
  },

  review: {
    label: "Review",
    description:
      "Judge work that already exists — a diff, a change, a file, the last thing that ran. Use for 'review that', 'is this any good', 'check what it just did'. Reports findings; it does not fix them.",
    stateful: false,
    park: PARK.NEVER,
    // The strongest model: a review is worth less than nothing if it misses
    // things, and it is a short run.
    model: STRONGEST,
    sessionKey: "review",
    budget: "light",
    skills: REVIEW_SKILLS,
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    params: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "What to review — a change name, a path, 'the work that just finished', 'the uncommitted changes'.",
        },
        concerns: { type: "string", description: "What the user is worried about, if they said." },
      },
      required: ["target"],
    },
    basePersona: STATELESS,
    clause: "Review the work you were pointed at and report findings, most serious first. Do not fix what you find.",
  },

  capture_learning: {
    label: "Notes",
    description:
      "Curate the user's second brain: weave accumulated captures and run records into linked wiki pages, write something up as a proper page, or answer a question from what is already there. Use for 'weave in what we've learned', 'write that up as a page', 'what do my notes say about X'. Do NOT use this for a plain 'note this down' / 'save that' / 'ghi chú lại' — that is the instant capture_note tool, not this verb. Only call this when the user asks — offer it, never run it on your own initiative.",
    stateful: false,
    park: PARK.NEVER,
    sessionKey: "capture_learning",
    // The cheapest model: this is bookkeeping over text that already exists.
    model: CHEAPEST,
    budget: "light",
    skills: NOTE_SKILLS,
    mcpServers: [],
    // The vault lives outside the project, so it has to be GRANTED as a working
    // directory rather than described in prose.
    vault: true,
    structuredOutput: false,
    params: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "What to concentrate on. Omit to process whatever has accumulated in the inbox since the last time.",
        },
        save: {
          type: "string",
          description:
            "Write this up as a curated, linked wiki page — distinct from a raw capture_note. Only set this for an explicit " +
            "'write this up as a page' request, in the user's own words.",
        },
      },
      required: [],
    },
    basePersona: STATELESS,
    clause:
      "Work in the personal-notes vault. Read BOTH run-inbox spools for what has happened since they were last processed — " +
      "inbox/runs (finished-run outcomes) and inbox/captures (raw captures awaiting curation) — then crystallize and integrate " +
      "it into linked wiki pages; failures are at least as worth keeping as successes.",
  },
});

/** Every verb name, in declaration order. */
export const VERB_NAMES = Object.freeze(Object.keys(VERBS));

/** The verbs whose runs may pause and ask by voice. */
export const STATEFUL_VERBS = Object.freeze(VERB_NAMES.filter((name) => VERBS[name].stateful));

/**
 * True when `name` is a verb this build knows.
 * @param {unknown} name
 */
export function isVerb(name) {
  return typeof name === "string" && Object.hasOwn(VERBS, name);
}

/** The empty project state, for a call site that has no project to read. */
export const NO_PROJECT_STATE = Object.freeze({ hasOpenChange: false, changes: [] });

/**
 * Normalizes whatever a caller knows about the project into the shape the
 * registry's functions read. Accepts the raw `openChangesWithTasks()` array so a
 * call site never has to build the object by hand.
 * @param {{ changes?: string[] } | string[] | null | undefined} input
 * @returns {ProjectState}
 */
export function projectState(input) {
  const changes = Array.isArray(input) ? input : Array.isArray(input?.changes) ? input.changes : [];
  return { hasOpenChange: changes.length > 0, changes: [...changes] };
}

// A field may be a function of the project state; everything else passes
// through. Arrays are copied so a resolved configuration can never be mutated
// back into the table.
function resolveField(value, state) {
  const resolved = typeof value === "function" ? value(state) : value;
  return Array.isArray(resolved) ? [...resolved] : resolved;
}

/**
 * The full configuration for one verb against one project state. Pure: no I/O,
 * no environment, no clock — so every consumer's behaviour is assertable
 * directly.
 *
 * @param {string} name
 * @param {ProjectState | string[] | null} [state]
 * @returns {{
 *   verb: string, label: string, description: string, stateful: boolean,
 *   park: string, sessionKey: string, model: string, budget: string,
 *   skills: string[], mcpServers: string[], vault: boolean,
 *   structuredOutput: boolean, disallowedTools: string[], params: object,
 *   basePersona: string, clause: string, projectState: ProjectState,
 * }}
 */
export function resolveVerb(name, state = NO_PROJECT_STATE) {
  if (!isVerb(name)) {
    throw new Error(`Unknown verb: ${name}. Known verbs: ${VERB_NAMES.join(", ")}.`);
  }
  const record = VERBS[name];
  const resolvedState = projectState(state);
  return {
    verb: name,
    label: record.label,
    description: record.description,
    stateful: record.stateful,
    park: record.park,
    sessionKey: record.sessionKey,
    model: resolveField(record.model, resolvedState),
    budget: record.budget,
    skills: resolveField(record.skills, resolvedState),
    mcpServers: resolveField(record.mcpServers, resolvedState),
    vault: record.vault,
    structuredOutput: resolveField(record.structuredOutput, resolvedState),
    // A stateless verb's inability to ask is enforced by the run's
    // configuration, not by instruction — "DEV never asks" was a prompt promise
    // with nothing behind it. `investigate` additionally cannot modify: a verb
    // that reads and reports has no business holding an edit tool.
    disallowedTools: record.stateful
      ? []
      : name === "investigate"
        ? ["AskUserQuestion", "Write", "Edit", "NotebookEdit"]
        : ["AskUserQuestion"],
    params: record.params,
    basePersona: record.basePersona,
    clause: resolveField(record.clause, resolvedState),
    projectState: resolvedState,
  };
}

/**
 * Every verb resolved against one project state, in declaration order — what
 * `gemini-tools.mjs` builds its declarations from.
 * @param {ProjectState | string[] | null} [state]
 */
export function resolveAllVerbs(state = NO_PROJECT_STATE) {
  return VERB_NAMES.map((name) => resolveVerb(name, state));
}

/**
 * The default model for a verb, with no project state and no user override —
 * what the session store falls back to.
 * @param {string} name
 */
export function defaultModelFor(name) {
  return isVerb(name) ? resolveVerb(name).model : null;
}
