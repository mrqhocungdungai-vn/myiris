// Which notes a name matches, in one place (voice-finds-a-note design.md D2).
//
// This module answers exactly one question — "does this name match that note,
// and in what order do the matches come" — for both routes that ask it: the
// galaxy's typed find field, over IPC, and Iris's spoken lookup, in the
// capability. `personal-knowledge-notes` requires those two to agree ("A user
// who says a title and a user who types it SHALL get the same notes back, in
// the same order"), and the only way to guarantee that rather than intend it is
// for there to be one implementation.
//
// It lives here rather than inside `capabilities/second-brain.mjs` because it is
// a pure comparison over a `{ nodes, links }` graph: no state, no filesystem, no
// knowledge of spools, focus, ambient capture or the run inbox. That module is
// already the largest non-test file in the repo; this one is readable, testable
// and changeable without loading any of it — the same reasoning that keeps
// `vault-graph.mjs` separate.
//
// Electron-free by construction, so `electron-graph.supply.test.mjs` loads it
// and `note-name-match.test.mjs` imports it in a plain node environment.

/**
 * How many matches the lookup returns.
 *
 * Capped without apology, unlike the rail's other lists: a search's job is to
 * narrow, and a query broad enough to return more than this has not narrowed
 * anything — the answer is a better query, not a longer list. Spoken, the cap
 * matters more still, since Iris names candidates aloud.
 */
export const NOTE_NAME_MATCH_LIMIT = 20;

/**
 * Lowercased with diacritics stripped.
 *
 * NFD splits a letter from its combining marks and the range below is exactly
 * those marks, so "Ghi chú" is found by saying or typing "ghi chu" — which is
 * the whole point of folding at all. `personal-knowledge-notes` requires it for
 * the spoken route (a title arrives with whatever accents the transcription
 * chose) and `second-brain-gesture-nav` requires it for the typed one; one fold
 * serves both.
 */
export function foldNoteName(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Link count per node id, counting a link once for each endpoint it touches.
 *
 * Computed here rather than taken as an argument so a caller cannot supply a
 * different notion of "how connected" and change the order the two routes are
 * required to share. The renderer has its own `linkDegrees` for the rail's
 * roots and neighbours; it does not feed this one, and matches carry their
 * `linkCount` back so the renderer never recomputes it for a search result.
 */
function linkDegrees(links) {
  const degrees = new Map();
  for (const link of links) {
    degrees.set(link.source, (degrees.get(link.source) ?? 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) ?? 0) + 1);
  }
  return degrees;
}

// Most-connected first, then by title, then by id — the last two only so the
// order is total and equally-connected notes do not reshuffle between two calls
// that asked the same thing.
function byConnectedness(a, b) {
  if (a.linkCount !== b.linkCount) return b.linkCount - a.linkCount;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * The notes whose title matches `query`, best first.
 *
 * Ranked exact, then prefix, then substring — someone who gives a whole title
 * means that note, and someone who gives a first word means the notes beginning
 * with it. Within a rank the most connected come first, on the same reasoning
 * the rail's entry points use.
 *
 * Returns the note's own fields rather than anything presentational: `tags` and
 * `ghost` travel so the renderer can derive each entry's colour with the one
 * `colorForNode` the graph behind the rail already uses. Deciding what colour a
 * note is drawn in is not this process's job.
 *
 * An empty or whitespace-only query matches nothing rather than everything: it
 * is the state the find field sits in before anyone has asked for something, and
 * offering the whole vault for it would bury the entry points beneath it.
 *
 * @param {{ query?: string, nodes?: Iterable<{id: string, title: string, tags?: string[], ghost?: boolean}>, links?: Iterable<{source: string, target: string}>, limit?: number }} params
 * @returns {{ id: string, title: string, tags: string[], ghost: boolean, linkCount: number, openable: boolean }[]}
 */
export function matchNotesByName({ query, nodes = [], links = [], limit = NOTE_NAME_MATCH_LIMIT } = {}) {
  const needle = foldNoteName(query);
  if (needle.length === 0) return [];

  const degrees = linkDegrees(links);
  const ranked = [];
  for (const node of nodes) {
    const title = foldNoteName(node.title);
    const rank = title === needle ? 0 : title.startsWith(needle) ? 1 : title.includes(needle) ? 2 : -1;
    if (rank < 0) continue;
    ranked.push({
      rank,
      match: {
        id: node.id,
        title: node.title,
        tags: node.tags ?? [],
        ghost: Boolean(node.ghost),
        linkCount: degrees.get(node.id) ?? 0,
        // An unresolved `[[wikilink]]` target is offered, because flying to it
        // is meaningful, but there is no file behind it to read.
        openable: !node.ghost,
      },
    });
  }

  ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : byConnectedness(a.match, b.match)));
  return ranked.slice(0, Math.max(0, limit)).map((item) => item.match);
}
