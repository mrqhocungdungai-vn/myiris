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
// `disallowedTools` is one of those fields (ask-when-unspecified D1). It used
// to be the single exception: computed inside `resolveVerb` from a hardcoded
// `name === "investigate"` check, which is a verb's capability bound living
// somewhere other than the verb — a fourth hand-wired copy in miniature. It is
// declared here now, per verb, like everything else.
//
// Electron-free, no I/O, no `process.env`.
// The table itself is `verb-table.mjs` and the shared constants are
// `verb-constants.mjs`; both are re-exported below, so a caller still imports
// everything about verbs from this one module. The split is by size only — a
// verb is still defined in exactly one place, and that place is the table.
import { VERBS, STATEFUL, STATELESS, NOTE } from "./verb-table.mjs";
import { PARK, MODEL_CHOICES, STATEFUL_SESSION_KEY } from "./verb-constants.mjs";

export { PARK, MODEL_CHOICES, STATEFUL_SESSION_KEY };
export { VERBS, STATEFUL, STATELESS, NOTE };

/**
 * @typedef {{ hasOpenChange: boolean, changes: string[], openNoteId: string|null, depth: string|null }} ProjectState
 * @typedef {{ changes?: string[], openNoteId?: string|null, depth?: string|null } | string[] | null | undefined} ProjectStateInput
 * A caller's raw shorthand for a project state — anything `projectState()` can
 * normalize. `openNoteId` is optional here (unlike on the resolved
 * `ProjectState`) because most callers have no note to report at all.
 */

/** Every verb name, in declaration order. */
export const VERB_NAMES = Object.freeze(Object.keys(VERBS));

/** The verbs whose runs may pause and ask by voice. */
export const STATEFUL_VERBS = Object.freeze(VERB_NAMES.filter((name) => VERBS[name].stateful));

// The subset of STATEFUL_VERBS that share STATEFUL_SESSION_KEY — the same
// conversation in two media (design.md D3). Distinct from STATEFUL_VERBS
// itself since open-note-session D2: work_on_note is ALSO stateful but
// deliberately keeps its own per-note session, so "may pause and ask" and
// "shares this one conversation" are no longer the same set.
export const SHARED_SESSION_VERBS = Object.freeze(
  STATEFUL_VERBS.filter((name) => VERBS[name].sessionKey === STATEFUL_SESSION_KEY),
);

/**
 * True when `name` is a verb this build knows.
 * @param {unknown} name
 */
export function isVerb(name) {
  return typeof name === "string" && Object.hasOwn(VERBS, name);
}

/** The empty project state, for a call site that has no project to read. */
export const NO_PROJECT_STATE = Object.freeze({ hasOpenChange: false, changes: [], openNoteId: null });

/**
 * Normalizes whatever a caller knows about the project into the shape the
 * registry's functions read. Accepts the raw `openChangesWithTasks()` array so a
 * call site never has to build the object by hand. `openNoteId` (open-note-
 * session design D2) is only ever read from the object form — a caller
 * passing the bare changes array has no note to report, which is what every
 * existing call site does.
 * @param {ProjectStateInput} input
 * @returns {ProjectState}
 */
export function projectState(input) {
  const changes = Array.isArray(input) ? input : Array.isArray(input?.changes) ? input.changes : [];
  const openNoteId = Array.isArray(input) ? null : input?.openNoteId ?? null;
  // `depth` is not project state — it is a property of the CALL, carried here
  // because it selects configuration the same way project state does, and a
  // second resolution mechanism for one field would be a second place a verb
  // is defined. Absent (an older parked run, or any verb that has no depth) it
  // is null, and every field that reads it falls to its own default.
  const depth = Array.isArray(input) ? null : (input?.depth ?? null);
  return { hasOpenChange: changes.length > 0, changes: [...changes], openNoteId, depth };
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
 * @param {ProjectStateInput} [state]
 * @returns {{
 *   verb: string, label: string, description: string, stateful: boolean,
 *   park: string, sessionKey: string, model: string, budget: string,
 *   skills: string[], mcpServers: string[], vault: boolean,
 *   structuredOutput: boolean, disallowedTools: string[], params: object,
 *   basePersona: string, clause: string, guardOpenNoteWrites: boolean,
 *   spokenResult: "summary"|"verbatim",
 *   speakWhileWorking: boolean, projectState: ProjectState,
 * }}
 */
export function resolveVerb(name, state = NO_PROJECT_STATE) {
  if (!isVerb(name)) {
    throw new Error(`Unknown verb: ${name}. Known verbs: ${VERB_NAMES.join(", ")}.`);
  }
  const record = VERBS[name];
  const resolvedState = projectState(state);
  // A capability bound must never DEFAULT to permissive: a record that forgot
  // to declare its list would otherwise resolve to "withholds nothing", which
  // is the one failure mode this field cannot be allowed to have. So it is
  // resolved and checked rather than defaulted (ask-when-unspecified D1).
  const disallowedTools = resolveField(record.disallowedTools, resolvedState);
  if (!Array.isArray(disallowedTools)) {
    throw new Error(
      `Verb ${name} declares no disallowedTools. Every verb states its own capability bound — see electron/verbs.mjs.`,
    );
  }
  return {
    verb: name,
    label: record.label,
    description: record.description,
    stateful: record.stateful,
    park: record.park,
    // A verb's own identity is dynamic for exactly one verb today (open-note-
    // session D2: work_on_note derives it per note) — resolved through the
    // same field-or-function policy as every other field, not read raw.
    sessionKey: resolveField(record.sessionKey, resolvedState),
    model: resolveField(record.model, resolvedState),
    budget: record.budget,
    skills: resolveField(record.skills, resolvedState),
    mcpServers: resolveField(record.mcpServers, resolvedState),
    vault: record.vault,
    structuredOutput: resolveField(record.structuredOutput, resolvedState),
    // open-note-session D6: declared per verb, read by run-exec.mjs to decide
    // whether to wire the destructive-write confirmation seam — never a
    // hardcoded verb-name check outside the registry.
    guardOpenNoteWrites: Boolean(record.guardOpenNoteWrites),
    // How the voice layer is told to SPEAK this verb's result: "summary" (the
    // 1-3 sentence précis that suits a long piece of work the user did not
    // watch happen) or "verbatim" (read out as written). Declared here rather
    // than as a verb-name check in the announcement path, which is where it
    // used to live for `work_on_note` — a second place a verb was defined.
    // Defaults to "summary", so a verb that says nothing keeps today's
    // behaviour instead of silently becoming loud.
    spokenResult: record.spokenResult === "verbatim" ? "verbatim" : "summary",
    // Whether the user hears this verb WORKING — both what it is doing and
    // what it is saying — rather than only what it concluded. True for work
    // the user is watching happen in front of them, like a shape appearing on
    // a canvas they are looking at, and false for everything else, where
    // narrating machinery is noise nobody asked to hear.
    speakWhileWorking: Boolean(record.speakWhileWorking),
    // Declared on the verb and resolved against project state like every other
    // field — never a verb-name conditional here (ask-when-unspecified D1).
    // What this list bounds is what the run may DO; who decides is not
    // negotiable, and it is not the caller: the value is derived here, from
    // state the voice layer neither supplies nor controls.
    disallowedTools,
    params: record.params,
    basePersona: record.basePersona,
    clause: resolveField(record.clause, resolvedState),
    projectState: resolvedState,
  };
}

/**
 * Every verb resolved against one project state, in declaration order — what
 * `gemini-tools.mjs` builds its declarations from.
 * @param {ProjectStateInput} [state]
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
