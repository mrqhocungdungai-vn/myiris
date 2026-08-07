// How a note is coloured in the galaxy, in one place.
//
// Lifted out of `VaultGalaxy.tsx` by galaxy-note-reachable-by-hand: the step
// rail names notes the user has not yet flown to, and it shows each entry in
// the same colour that note's dot has in the view behind it — so the rail and
// the graph must derive it from one function rather than two that agree today.

export const TAG_COLORS = ["#5ec8ff", "#ff8a5e", "#8affc1", "#c98aff", "#ffe45e", "#ff5ec8"];

// An unresolved `[[wikilink]]` target: named but not openable, so it reads as
// present-but-inert rather than as another tagged note.
export const GHOST_COLOR = "rgba(200, 210, 230, 0.35)";

// A note with no tags at all — a neutral blue that is not one of TAG_COLORS.
export const UNTAGGED_COLOR = "#9fb4ff";

/**
 * A note's colour: its first tag hashed into `TAG_COLORS`, so the same tag is
 * always the same colour within a vault without anyone assigning one.
 */
export function colorForNode(node: { tags: string[]; ghost?: boolean }): string {
  if (node.ghost) return GHOST_COLOR;
  const tag = node.tags[0];
  if (!tag) return UNTAGGED_COLOR;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}
