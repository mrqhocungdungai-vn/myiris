import { LOG_STRIP_LINES, levelTone, logClock, visibleLogLines } from "../lib/activity-log";
import type { LogLine } from "../types";

// The activity strip along the bottom of the camera frame (camera-activity-log):
// the app's own log, at a depth the build mode decides.
//
// Purely presentational — no state, no effects, no handlers. Every rule about
// WHICH lines these are lives in src/lib/activity-log.ts, where it is tested;
// what a production build hides is the one thing about this feature nobody would
// notice being wrong by looking at it.
//
// Deliberately NOT a per-frame overlay like the eye components beside it. Log
// lines arrive at human rates, so this is ordinary React that re-renders when
// the store changes (design D7).

export default function CameraLog({ logs }: { logs: LogLine[] }) {
  const lines = visibleLogLines(logs, import.meta.env.DEV);

  return (
    <div className="cam-log" aria-hidden="true">
      {/* The band is LOG_STRIP_LINES tall whether it holds that many or none:
          the gesture chip sits directly above it, and a strip that grew with its
          content would nudge the chip on every arriving line (design D4). The
          spacer is what reserves it — the lines themselves are pinned to the
          bottom and fill upward. */}
      <div className="rows" style={{ height: `calc(${LOG_STRIP_LINES} * var(--cam-log-line))` }}>
        {lines.map((line) => (
          // Keyed by the log line's own id, so React mounts exactly the new
          // line and the enter animation plays once for it rather than for the
          // whole band on every arrival.
          <div className={`line ${levelTone(line.level)}`} key={line.id}>
            <span className="at">{logClock(line.timestamp)}</span>
            <span className="msg">{line.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
