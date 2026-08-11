import { useEffect, useMemo, useRef, useState } from "react";
import { railRoots, railNeighbours, railEntriesFromMatches } from "../lib/galaxy-rail";
import { RAIL_SEARCH_DEBOUNCE_MS, STEP_LOCK_MS } from "../lib/galaxy-graph";
import type { GalaxyNode, GalaxyLink } from "../lib/galaxy-types";

// The galaxy's step rail: what it lists, what is typed into it, and which note
// it is currently centred on.
//
// Two things here are load-bearing and were easy to lose among the WebGL wiring
// they sat in:
//
//   * **Matching happens in main, not here.** The trade is explicit (design D2):
//     one local IPC round trip per debounced keystroke instead of a synchronous
//     array filter, bought with the guarantee that what the user *hears* from
//     Iris and what the user *sees* in the rail cannot disagree. If it ever
//     reads as laggy the answer is a shorter debounce, never a second matcher.
//   * **A spoken answer must not re-ask.** When Iris answers a lookup by voice
//     the result is mirrored into the field; without the claim below that would
//     trip the debounce and spend a second vault scan — a filesystem walk, not a
//     cache read — to be told what Iris just said.

export type GalaxyRail = {
  /** Entry points. Depend on the graph alone, so stepping does not recompute them. */
  roots: ReturnType<typeof railRoots>;
  neighbours: ReturnType<typeof railNeighbours>;
  matches: ReturnType<typeof railEntriesFromMatches>;
  query: string;
  setQuery: (query: string) => void;
  centreTitle: string | null;
  /** True briefly after a step, so the rail does not re-target mid-flight. */
  locked: boolean;
  /** The camera stepped to a note: re-centre the rail and hold it. */
  markStepped: (id: string) => void;
};

export function useGalaxyRail({ graph }: { graph: { nodes: GalaxyNode[]; links: GalaxyLink[] } }): GalaxyRail {
  const [centreId, setCentreId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<NoteNameMatchResult[]>([]);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceAnsweredQueryRef = useRef<string | null>(null);

  // The lock timer must not outlive the galaxy.
  useEffect(() => () => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
  }, []);

  useEffect(() => {
    return window.iris.onSecondBrainNameMatches(({ query: spoken, matches: found }) => {
      voiceAnsweredQueryRef.current = spoken;
      setQuery(spoken);
      setMatches(found);
    });
  }, []);

  // Re-runs on `graph` too, so a note written while the galaxy is open joins the
  // matches for a query already typed rather than waiting for a keystroke.
  useEffect(() => {
    if (query.trim().length === 0) {
      setMatches([]);
      return;
    }
    // This exact query has just been answered by the spoken lookup; typing
    // anything else clears the claim and the field asks for itself again.
    if (voiceAnsweredQueryRef.current === query) {
      voiceAnsweredQueryRef.current = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      window.iris
        .findSecondBrainNotes(query)
        .then((result) => {
          // A late reply for a query the user has already moved past must not
          // overwrite the current one: the effect's cleanup runs before the next
          // one, so this flag is what makes the ordering safe.
          if (!cancelled) setMatches(result.matches);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, RAIL_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, graph]);

  // Memoised (design D7): both derivations are O(nodes + links) and the galaxy
  // re-renders on every focus change. The entry points depend on the graph
  // ALONE — deliberately the one part of the rail that stepping does not change.
  const roots = useMemo(() => railRoots({ nodes: graph.nodes, links: graph.links }), [graph]);
  const neighbours = useMemo(
    () => (centreId === null ? [] : railNeighbours({ centreId, nodes: graph.nodes, links: graph.links })),
    [graph, centreId],
  );
  // Colouring only — the order arrived decided (voice-finds-a-note D2).
  const entries = useMemo(() => railEntriesFromMatches(matches), [matches]);

  return {
    roots,
    neighbours,
    matches: entries,
    query,
    setQuery,
    centreTitle: centreId === null ? null : (graph.nodes.find((n) => n.id === centreId)?.title ?? centreId),
    locked,
    markStepped(id) {
      setCentreId(id);
      setLocked(true);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => setLocked(false), STEP_LOCK_MS);
    },
  };
}
