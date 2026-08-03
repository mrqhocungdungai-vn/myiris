// The single system-prompt policy every run routes through — PO, DEV, and plain
// Claude. Mirrors worker-env.mjs's shape deliberately: one policy both roles
// call, so the two cannot drift apart.
//
// They had drifted. PO and DEV each built their own base prompt at their own
// call site, and nothing forced them to agree; PO's was passed through a field
// the SDK does not read (`appendSystemPrompt` at the top level of `Options`),
// so PO's live-session instruction never reached the model at all. Measured
// against the installed SDK, not read off the type — see design.md D1b.
//
// Two facts about the SDK this module encodes, both measured (design.md D1):
//
//   1. `systemPrompt: { type: "preset", … , append }` is the ONLY delivery
//      mechanism the SDK reads. A top-level `appendSystemPrompt` is destructured
//      into the rest object and dropped. This module never emits that field, and
//      a test asserts no caller can smuggle one in.
//   2. When `agent` names a main-thread AgentDefinition — every PO and DEV run —
//      the definition's prompt REPLACES the base prompt, so the `claude_code`
//      preset is not applied; only the `append` half survives. The preset form
//      is still used for all three because plain-Claude runs (no `agent`) do get
//      the preset, and it is inert rather than harmful for role runs.
//
// Electron-free, no I/O, no `process.env` — everything comes in as an argument.

// Identical for every role. Anything that is not genuinely role-specific belongs
// here, so the roles' prompts stay one clause apart.
const PREAMBLE = "You are invoked from Iris voice.";
const CLOSING = "Report concise final results.";

// The one documented role-specific clause. `worker` covers both DEV and plain
// Claude: neither has a caller listening for a question, so the instruction is
// the same one, and only PO's differs.
export const ROLE_CLAUSES = {
  po:
    "This is a LIVE, continuous session, not a one-shot run: each turn is one exchange in a " +
    "conversation that stays open. Ask via AskUserQuestion at real decision points and wait for " +
    "the answer; for lower-stakes calls, use sensible defaults and record them.",
  worker:
    "This is a one-shot headless run: nobody is listening for a question, and the question tool " +
    "is not available to you. Work autonomously, never ask for clarification, and use sensible " +
    "defaults, recording them.",
};

/** @typedef {"po" | "dev" | "plain"} PromptRole */

// PO is the only role with its own clause; DEV and plain Claude share the
// headless one.
function clauseFor(role) {
  return role === "po" ? ROLE_CLAUSES.po : ROLE_CLAUSES.worker;
}

// The personal-knowledge-notes capability, plain-Claude runs only. PO and DEV
// must never see this (design.md D3/D5 of the llm-wiki change) — passing a
// notesVault for a role is a caller bug, so it is ignored rather than honoured.
function notesVaultClause({ dir, skillsInstalled }) {
  if (skillsInstalled) {
    // States a fact, and no longer pleads. Access to the vault is granted
    // structurally through `additionalDirectories` (run-exec.mjs), so this only
    // has to say WHERE it is and WHICH skills operate on it — things a granted
    // directory cannot convey on its own. The old wording ("never ask the user
    // for the wiki root path or wait for a reply — proceed directly") was
    // compensating for the absence of a real grant.
    return (
      ` The personal-notes / LLM-Wiki vault root is ${dir}. It is granted to this run as a working` +
      " directory alongside the project, so you can read and write it directly regardless of the current" +
      " working directory. Use the wiki skills there for any note-taking or second-brain request;" +
      " wiki-config.md and wiki-schema.md already exist in it."
    );
  }
  // The vault and the skills are installed on independent schedules, so the
  // vault can exist before "Install missing" is ever clicked. Without this
  // branch the directive above would send Claude looking for skills that are not
  // there, and it would invent an ungoverned note format rather than say so.
  return (
    " The personal-notes / LLM-Wiki skills are not installed on this machine yet. If the user asks" +
    " to capture, save, or retrieve a personal note or second-brain entry, tell them the notes" +
    ' capability needs to be installed first (Iris\'s setup panel, "Install missing") — do not' +
    " attempt an ad-hoc note file in its place."
  );
}

/**
 * The Iris-runtime instruction text for a role. Exported separately from
 * buildSystemPrompt so a test can assert the two roles differ by exactly one
 * clause without reaching through the options wrapper.
 * @param {PromptRole} role
 * @param {{ notesVault?: { dir: string, skillsInstalled: boolean } | null }} [options]
 * @returns {string}
 */
export function buildRoleInstructions(role, { notesVault = null } = {}) {
  let text = `${PREAMBLE} ${clauseFor(role)} ${CLOSING}`;
  if (role === "plain" && notesVault) text += notesVaultClause(notesVault);
  return text;
}

/**
 * The `systemPrompt` value to hand to `query()` for a role. This is the whole
 * public surface: no call site builds prompt text, and no call site chooses the
 * delivery mechanism.
 * @param {PromptRole} role
 * @param {{ notesVault?: { dir: string, skillsInstalled: boolean } | null }} [options]
 * @returns {{ type: "preset", preset: "claude_code", append: string }}
 */
export function buildSystemPrompt(role, options = {}) {
  return {
    type: /** @type {"preset"} */ ("preset"),
    preset: /** @type {"claude_code"} */ ("claude_code"),
    append: buildRoleInstructions(role, options),
  };
}
