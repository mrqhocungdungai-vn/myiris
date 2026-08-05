// The single system-prompt policy every run routes through. Mirrors
// worker-env.mjs's shape deliberately: one policy every verb calls, so they
// cannot drift apart.
//
// They had drifted. PO and DEV each built their own base prompt at their own
// call site, and nothing forced them to agree; PO's was passed through a field
// the SDK does not read (`appendSystemPrompt` at the top level of `Options`),
// so PO's live-session instruction never reached the model at all. Measured
// against the installed SDK, not read off the type — see the agent-sdk-
// conformance design.md D1b.
//
// Two facts about the SDK this module encodes, both measured (that change's D1):
//
//   1. `systemPrompt: { type: "preset", … , append }` is the ONLY delivery
//      mechanism the SDK reads. A top-level `appendSystemPrompt` is destructured
//      into the rest object and dropped. This module never emits that field, and
//      a test asserts no caller can smuggle one in.
//   2. When `agent` names a main-thread AgentDefinition — every verb run — the
//      definition's prompt REPLACES the base prompt, so the `claude_code` preset
//      is not applied; only the `append` half survives. The preset form is kept
//      anyway because it is inert rather than harmful, and dropping it would
//      make the mechanism depend on fact 2 continuing to hold.
//
// What is composed here is `base + clause`: the base is what every run of a
// given statefulness is told, and the clause is the verb's own one-line job,
// declared in electron/verbs.mjs. **No prompt text is assembled at a call
// site** — that is the whole point of this module existing.
//
// Electron-free, no I/O, no `process.env` — everything comes in as an argument.

// Identical for every verb. Anything that is not genuinely per-verb belongs
// here, so two verbs' prompts stay one clause apart.
const PREAMBLE = "You are invoked from Iris voice.";
const CLOSING = "Report concise final results.";

// The one documented statefulness-specific clause. This is the *only* thing two
// verbs differ by at the base level.
//
// There are three, not two, because statelessness and ask-ability are separate
// properties (ask-when-unspecified): a one-shot run whose work was settled
// upstream cannot ask, and a one-shot run given no specification at all can.
// Which base a run gets is read off the run's own EFFECTIVE `disallowedTools`
// (see `mayAsk` below) — so the prose can never promise a tool the run was not
// given, nor withhold one it was. A verb told it may ask but not given the tool,
// and a verb given the tool but told not to ask, are the same defect: a promise
// in a prompt with nothing behind it.
export const STATEFULNESS_CLAUSES = {
  stateful:
    "This is a LIVE, continuous session, not a one-shot run: each turn is one exchange in a " +
    "conversation that stays open. Ask via AskUserQuestion at real decision points and wait for " +
    "the answer; for lower-stakes calls, use sensible defaults and record them.",
  stateless:
    "This is a one-shot headless run: nobody is listening for a question, and the question tool " +
    "is not available to you. Work autonomously, never ask for clarification, and use sensible " +
    "defaults, recording them.",
  // A one-shot run that MAY ask. Still one-shot: pausing on a question is not
  // residency, and this run ends when the task does. The bar for asking, and the
  // consequence of an unanswered question, are both stated here because the
  // configuration can decide whether asking is possible and nothing about
  // whether it is warranted (design D5).
  statelessMayAsk:
    "This is a one-shot headless run, but the user is listening and AskUserQuestion IS available " +
    "to you: nothing upstream settled what you were asked for, so there is no earlier answer to " +
    "look up. Use it only where a wrong assumption would have to be undone — ask once, with " +
    "options, and wait. Everywhere else, apply a sensible default and say which one you applied. " +
    "Never ask to confirm work you were plainly asked to do. If a question goes unanswered this " +
    "run stops and writes nothing further, so never ask about something you could reasonably default.",
};

// Whether this run may ask, read off its own resolved capability bound rather
// than inferred from its shape. Fails closed: a caller that supplied no list at
// all gets the prose for a run that cannot ask, never the promise of a tool it
// may not have.
/** @param {PromptVerb} verb */
function mayAsk(verb) {
  if (verb.stateful) return true;
  return Array.isArray(verb.disallowedTools) && !verb.disallowedTools.includes("AskUserQuestion");
}

/**
 * @typedef {{ stateful: boolean, clause: string, vault?: boolean, verb?: string, disallowedTools?: string[] }} PromptVerb
 * The fields of a resolved verb (electron/verbs.mjs) this policy reads. Taking
 * the resolved record rather than a name is what keeps the registry the single
 * definition — this module composes, it does not decide.
 */

// The personal-knowledge-notes capability, for the verb that declares `vault`.
// Access to the vault is granted structurally through `additionalDirectories`
// (run-exec.mjs), so this only has to say WHERE it is and WHICH skills operate
// on it — things a granted directory cannot convey on its own.
/** @param {{ dir: string, skillsInstalled: boolean, inbox?: string }} vault */
function notesVaultClause({ dir, skillsInstalled, inbox }) {
  if (!skillsInstalled) {
    // The vault and the skills are installed on independent schedules, so the
    // vault can exist before the bundle provides the skills. Without this
    // branch the directive below would send Claude looking for skills that are
    // not there, and it would invent an ungoverned note format rather than say
    // so.
    return (
      " The personal-notes / LLM-Wiki skills are not available in this build. Tell the user the notes" +
      ' capability needs to be repaired (Iris\'s setup panel, "Install missing") — do not attempt an' +
      " ad-hoc note file in its place."
    );
  }
  let text =
    ` The personal-notes / LLM-Wiki vault root is ${dir}. It is granted to this run as a working` +
    " directory alongside the project, so you can read and write it directly regardless of the current" +
    " working directory. wiki-config.md and wiki-schema.md already exist in it.";
  if (inbox) {
    // The run inbox is the raw log every finished run appends to (design.md
    // D5). Naming it here is what turns "synthesis is deliberate" into
    // something the run can actually act on.
    text +=
      ` Raw records of what Iris has run are appended to ${inbox}, newest file last; read what has not` +
      " been woven in yet, crystallize it, integrate it, and note in the vault how far you got.";
  }
  return text;
}

/**
 * The Iris-runtime instruction text for one verb. Exported separately from
 * buildSystemPrompt so a test can assert two verbs differ by exactly their
 * clause without reaching through the options wrapper.
 * @param {PromptVerb} verb
 * @param {{ notesVault?: { dir: string, skillsInstalled: boolean, inbox?: string } | null }} [options]
 * @returns {string}
 */
export function buildRunInstructions(verb, { notesVault = null } = {}) {
  if (!verb || typeof verb.clause !== "string" || !verb.clause) {
    throw new Error("role-prompt: a resolved verb with a clause is required — see electron/verbs.mjs.");
  }
  const base = verb.stateful
    ? STATEFULNESS_CLAUSES.stateful
    : mayAsk(verb)
      ? STATEFULNESS_CLAUSES.statelessMayAsk
      : STATEFULNESS_CLAUSES.stateless;
  let text = `${PREAMBLE} ${base} ${verb.clause} ${CLOSING}`;
  // Passing a vault for a verb that does not declare one is a caller bug, so it
  // is ignored rather than honoured — the grant and the prose must agree.
  if (verb.vault && notesVault) text += notesVaultClause(notesVault);
  return text;
}

/**
 * The `systemPrompt` value to hand to `query()` for a verb. This is the whole
 * public surface: no call site builds prompt text, and no call site chooses the
 * delivery mechanism.
 * @param {PromptVerb} verb
 * @param {{ notesVault?: { dir: string, skillsInstalled: boolean, inbox?: string } | null }} [options]
 * @returns {{ type: "preset", preset: "claude_code", append: string }}
 */
export function buildSystemPrompt(verb, options = {}) {
  return {
    type: /** @type {"preset"} */ ("preset"),
    preset: /** @type {"claude_code"} */ ("claude_code"),
    append: buildRunInstructions(verb, options),
  };
}
