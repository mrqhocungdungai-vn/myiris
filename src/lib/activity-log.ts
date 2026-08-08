import type { LogLine } from "../types";

// Pure selection rules for the camera preview's activity strip: which of the
// app's log entries are drawn, and in what order. No DOM, no React, so the one
// thing about this feature nobody would notice being wrong — what a production
// build HIDES — is testable rather than merely inspectable (design D3).
//
// A threshold off by one level draws a strip that looks entirely plausible while
// omitting every warning. There is no visual check for that.

/** Lines drawn at once. The band is this tall whether it is full or empty. */
export const LOG_STRIP_LINES = 5;

/**
 * The three levels the app actually emits. `pushLog` is also handed
 * `event.level` straight off the wire, so this is a floor on what can arrive,
 * not a closed set — see `levelRank`.
 */
const LEVEL_RANK: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * An unrecognized level ranks as routine — visible in development, hidden in
 * production — rather than below everything.
 *
 * The alternative fails in the direction that costs something: rank an unknown
 * level at 0 and a level added later would be silently invisible everywhere,
 * with the symptom being an absence nobody can see. Ranking it as routine means
 * the worst case is a line showing up somewhere slightly unexpected, which is
 * noticed and fixed.
 */
export function levelRank(level: string): number {
  const known = LEVEL_RANK[String(level).toLowerCase()];
  return known === undefined ? LEVEL_RANK.info : known;
}

/**
 * The depth the build draws at. Development shows routine progress; production
 * shows only what warrants attention.
 *
 * `import.meta.env.DEV` and nothing else — no env override, no setting, no
 * persistence (design D2). A depth that can be changed is a preference, a
 * preference invites persisting it, and a persisted one lets a production build
 * be left permanently verbose by an experiment somebody forgot about, with the
 * failure showing up on a livestream rather than at a desk.
 */
export function stripThreshold(isDev: boolean): number {
  return isDev ? LEVEL_RANK.info : LEVEL_RANK.warn;
}

/**
 * The lines to draw, oldest first.
 *
 * The store is newest-first — `pushLog` prepends — and the strip reads
 * newest-last, because a log that grows downward is the only convention anybody
 * has for one. That flip lives here rather than in the component so it is
 * asserted rather than assumed.
 *
 * Filtering happens at DRAW time, deliberately: entries below the threshold are
 * still collected on exactly the same terms as any other, so this stays a rule
 * about display and can be changed without changing what the app records.
 */
export function visibleLogLines(
  store: readonly LogLine[],
  isDev: boolean,
  lines: number = LOG_STRIP_LINES,
): LogLine[] {
  if (lines <= 0) return [];
  const threshold = stripThreshold(isDev);
  const drawn: LogLine[] = [];
  // The store is newest-first, so walking forward finds the newest survivors
  // first and stops as soon as the band is full — no scan of all eighty.
  for (const line of store) {
    if (levelRank(line.level) < threshold) continue;
    drawn.push(line);
    if (drawn.length === lines) break;
  }
  return drawn.reverse();
}

/** Class suffix for an entry's severity, so the tone is decided in one place. */
export function levelTone(level: string): "routine" | "warn" | "error" {
  const rank = levelRank(level);
  if (rank >= LEVEL_RANK.error) return "error";
  if (rank >= LEVEL_RANK.warn) return "warn";
  return "routine";
}

/**
 * `HH:MM:SS`, fixed width — the strip's one column that must never change width,
 * since everything after it would shift.
 */
export function logClock(timestamp: number, now = new Date(timestamp)): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
