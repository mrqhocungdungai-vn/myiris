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

  return (
    <nav className={className} aria-label="Galaxy step rail">
      {/* Always present, and deliberately unchanged by stepping: a fixed frame
          of reference the user can leave any cloud from, rather than a second
          thing to keep track of. Without it, a set of notes linking to nothing
          in the main body could not be reached by stepping at all. */}
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
    </nav>
  );
}
