// The verb registry's shared constants — the small, stable values that both
// the verb table and the resolution engine need.
//
// They live in their own module for one mechanical reason: `verb-table.mjs`
// declares the records and `verbs.mjs` resolves them, so a constant either of
// them imports from the other would make the two circular. Nothing here has
// behavior; `verbs.mjs` re-exports all of it, so no caller outside these three
// files imports this module directly.

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

// The single resident session the two shaping verbs share (design.md D3). They
// are the same conversation in two media, and switching to the canvas happens
// precisely when talking has stopped working — which is the moment the
// accumulated context matters most.
export const STATEFUL_SESSION_KEY = "stateful";


/** Named model tiers, exported so the verb table can state its defaults. */
export { STRONGEST, FAST, CHEAPEST };
