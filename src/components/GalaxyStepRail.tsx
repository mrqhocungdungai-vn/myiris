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
  entries,
  centreId,
  locked,
  onStep,
}: {
  /** `RAIL_ISLAND_CLASS` — composed in `galaxy-rail.ts` so the chrome class cannot be dropped unnoticed. */
  className: string;
  entries: RailEntry[];
  /** Null on a freshly-opened galaxy, where `entries` are the vault's most connected notes instead. */
  centreId: string | null;
  /** Inert for a moment after a step, so a still-held hand takes one step rather than a run of them (design.md D11). */
  locked: boolean;
  onStep: (id: string) => void;
}) {
  return (
    <nav className={className} aria-label="Galaxy step rail">
      <p className="hud-galaxy-rail-heading">{centreId === null ? "Start from" : "Step to"}</p>
      {entries.length === 0 ? (
        <p className="hud-galaxy-rail-empty">No linked notes</p>
      ) : (
        <ul className="hud-galaxy-rail-list">
          {entries.map((entry) => (
            // Keyed by note id so React never recycles one note's element for
            // another's — the dwell keys its fire-once guarantee on element
            // identity, and a recycled element would carry a stale `fired`
            // flag onto an unrelated note (design.md D11).
            <li key={entry.id}>
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
      )}
    </nav>
  );
}
