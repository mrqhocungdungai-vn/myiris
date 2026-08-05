// The shared focus (second-brain-focus design D1/D2): the set of vault notes
// the user currently has selected in the galaxy, produced by the hand and the
// mouse, read by the voice layer and by Claude's runs. Owned by the main
// process (electron/capabilities/second-brain.mjs holds the one instance);
// this module is just the pure state transitions plus resolution.
//
// Electron-free, no I/O, no import of vault-graph.mjs — resolve() takes the
// graph cache as an argument, so the module is a pure function of (focus,
// graph) and testable with a literal graph object. Ids only, never a cached
// title/tag snapshot: a note renamed or deleted after being selected just
// resolves differently (or drops out) the next time someone reads the focus.

// How many notes the focus may hold. Selecting past this drops the OLDEST id,
// not the new one — the user's most recent gesture is the one that expresses
// their current intent. A guess, tunable here alone.
export const FOCUS_BOUND = 8;

// A separate, tighter bound applied only when the focus reaches the voice
// layer's context or a run's prompt — attached on EVERY turn, so an unbounded
// one would grow the cost of a conversation turn after turn. Mirrors
// run-context.mjs's transcript bound, which is enforced at the point of use
// rather than at the point of retention for the same reason.
export const FOCUS_PROMPT_BOUND = 4;

/** @type {{ ids: string[], at: number }} */
export const INITIAL_FOCUS = Object.freeze({ ids: [], at: 0 });

function bounded(ids) {
  return ids.length > FOCUS_BOUND ? ids.slice(ids.length - FOCUS_BOUND) : ids;
}

/** True when `graph` has a real (non-ghost) node for `id`; no graph means "don't check". */
function isSelectable(id, graph) {
  if (!graph) return true;
  const node = (graph.nodes ?? []).find((n) => n.id === id);
  return Boolean(node) && !node.ghost;
}

/**
 * Toggles `id`: removes it if already selected, otherwise adds it — unless
 * `graph` is supplied and `id` resolves to no node or a ghost node, in which
 * case the focus is returned unchanged (there is no note to select). Removal
 * is always allowed regardless of `graph`, so a selection can always be
 * cleared even if the note it names has since become unresolvable.
 *
 * @param {{ ids: string[], at: number }} focus
 * @param {string} id
 * @param {{ nodes: Array<{ id: string, ghost?: boolean }> } | null} [graph]
 * @param {number} [now]
 */
export function toggle(focus, id, graph = null, now = Date.now()) {
  const withoutId = focus.ids.filter((existing) => existing !== id);
  if (withoutId.length < focus.ids.length) return { ids: withoutId, at: now };
  if (!isSelectable(id, graph)) return focus;
  return { ids: bounded([...withoutId, id]), at: now };
}

/**
 * Replaces the whole selection, de-duplicated and bounded the same way
 * `toggle` is.
 * @param {{ ids: string[], at: number }} focus
 * @param {string[]} ids
 * @param {number} [now]
 */
export function set(focus, ids, now = Date.now()) {
  return { ids: bounded([...new Set(ids)]), at: now };
}

/** Empties the focus. */
export function clear(now = Date.now()) {
  return { ids: [], at: now };
}

/**
 * Resolves `focus`'s ids against the live graph, in selection order, to
 * `{ id, title, tags }` — never a cached snapshot (design D2). An id that no
 * longer resolves (renamed away, deleted, or now a ghost) drops out silently
 * rather than surfacing as a phantom.
 *
 * @param {{ ids: string[], at: number }} focus
 * @param {{ nodes: Array<{ id: string, title: string, tags?: string[], ghost?: boolean }> } | null | undefined} graph
 * @param {number} [limit] - keep only the most recently selected this many, independent of the retention bound
 * @returns {Array<{ id: string, title: string, tags: string[] }>}
 */
export function resolve(focus, graph, limit) {
  const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const resolved = [];
  for (const id of focus.ids) {
    const node = byId.get(id);
    if (!node || node.ghost) continue;
    resolved.push({ id: node.id, title: node.title, tags: node.tags ?? [] });
  }
  return typeof limit === "number" ? resolved.slice(-limit) : resolved;
}
