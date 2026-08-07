import type { RailEntry } from "../lib/galaxy-rail";

// The step rail (second-brain-gesture-nav: "A note is reachable by stepping
// through its neighbours"). Ordinary DOM buttons over the galaxy, because a
// note's dot is a few pixels across in a view that occludes itself and webcam
// hand tracking is imprecise by an order of magnitude more than that. The rail
// replaces "aim at a 4 px target" with "choose one of a handful of big ones".
//
// Every hands-free property it has comes from being HUD chrome (design.md D9):
// the island's class list is composed in `galaxy-rail.ts` and carries
// `HUD_CHROME_CLASS`, which is both why it paints above the galaxy and why the
// universal point-and-hold dwell in `App.tsx` reaches it. Entries are plain
// `<button>`s, which that dwell's own `button, a, [data-task-id],
// [role="button"]` selector already finds — no gesture rule was edited to make
// any of this work, and editing one is exactly what the chrome rule forbids.
//
// They are NOT marked `[data-no-dwell]`: a step moves the camera and is
// trivially reversible, which is not what that marker is for.

export default function GalaxyStepRail({
  className,
  roots,
  neighbours,
  matches,
  query,
  onQueryChange,
  centreTitle,
  locked,
  onStep,
}: {
  /** `RAIL_ISLAND_CLASS` — composed in `galaxy-rail.ts` so the chrome class cannot be dropped unnoticed. */
  className: string;
  /** Entry points, always offered: one per disconnected region, then the most connected notes overall (design.md D7b). */
  roots: RailEntry[];
  /** The centre note's one-hop neighbours. Empty while the rail is centred on nothing. */
  neighbours: RailEntry[];
  /** Notes whose title matches `query`. Non-empty only while a query is typed. */
  matches: RailEntry[];
  query: string;
  onQueryChange: (next: string) => void;
  /** The note the rail is centred on, so the user can see where they are. Null on a freshly-opened galaxy. */
  centreTitle: string | null;
  /** Inert for a moment after a step, so a still-held hand takes one step rather than a run of them (design.md D11). */
  locked: boolean;
  onStep: (id: string) => void;
}) {
  // Entries are keyed by note id so React never recycles one note's element for
  // another's — the dwell keys its fire-once guarantee on element identity, and
  // a recycled element would carry a stale `fired` flag onto an unrelated note
  // (design.md D11). The key is prefixed per section because a note can legally
  // appear in both: an entry point is often its own region's hub, and a hub is
  // routinely a neighbour of whatever the user just stepped to.
  function entryList(section: string, entries: RailEntry[]) {
    return (
      <ul className="hud-galaxy-rail-list">
        {entries.map((entry) => (
          <li key={`${section}:${entry.id}`}>
            <button
              type="button"
              className={`hud-galaxy-rail-entry${entry.openable ? "" : " ghost"}`}
              disabled={locked}
              onClick={() => onStep(entry.id)}
              title={entry.openable ? entry.title : `${entry.title} — no note file yet`}
            >
              <span className="tag-dot" style={{ background: entry.tagColor }} aria-hidden="true" />
              <span className="title">{entry.title}</span>
              <span className="links">{entry.linkCount}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const searching = query.trim().length > 0;

  return (
    <nav className={className} aria-label="Galaxy step rail">
      {/* Finding a note by NAME. Stepping is only as good as the reachability of
          a starting point, and link topology cannot supply one — a user looking
          for a note is thinking about its subject, not about what it links to.
          Typed, so it needs a keyboard; the hands-free half is voice, which is a
          separate change because it adds a tool to the voice surface. */}
      <input
        className="hud-galaxy-rail-search"
        type="search"
        value={query}
        placeholder="Find a note…"
        aria-label="Find a note by name"
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {searching ? (
        <>
          <p className="hud-galaxy-rail-heading">Matches</p>
          {matches.length === 0 ? (
            <p className="hud-galaxy-rail-empty">Nothing by that name</p>
          ) : (
            entryList("find", matches)
          )}
        </>
      ) : (
        <>
          {/* Always present, and deliberately unchanged by stepping: a fixed
              frame of reference the user can leave any cloud from, rather than a
              second thing to keep track of. Without it, a set of notes linking
              to nothing in the main body could not be reached by stepping at
              all. Hidden only while a query is up, since a search IS a way of
              choosing a starting point and two competing lists would just be
              noise. */}
          <p className="hud-galaxy-rail-heading">Start from</p>
          {roots.length === 0 ? <p className="hud-galaxy-rail-empty">No linked notes</p> : entryList("root", roots)}
          {centreTitle === null ? null : (
            <>
              <p className="hud-galaxy-rail-heading">
                Step from <span className="centre">{centreTitle}</span>
              </p>
              {neighbours.length === 0 ? (
                <p className="hud-galaxy-rail-empty">No neighbours</p>
              ) : (
                entryList("hop", neighbours)
              )}
            </>
          )}
        </>
      )}
    </nav>
  );
}
