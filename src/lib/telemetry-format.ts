// Pure presentation math for the eye HUD's readout panel: fixed-width value
// formatting, meter scaling, the display ease, and the load ladder. No DOM, so
// all of it is testable under vitest's node environment — the same reasoning
// eye-hud.ts records for itself, and for the same reason: it is the only way
// anything in this capability can be tested at all.
//
// Everything here takes `number | null`, because `null` is the single absence
// signal the sampler emits for every reason a measurement can be missing. None
// of it ever substitutes zero for absence: zero is a claim about the machine,
// and the spec requires the two never be conflated.

/**
 * U+2007 FIGURE SPACE — as wide as a digit, and NOT collapsed the way a leading
 * U+0020 is when a string is assigned through `textContent` under the panel's
 * whitespace handling. Padding with a normal space is the silent way to lose the
 * fixed width these formatters exist to guarantee.
 */
export const FIGURE_SPACE = " ";

/**
 * The absent form. Its length must equal the formatted length of every value in
 * its column, or a row twitches at exactly the moment a probe fails — which is
 * the moment it is most likely to be watched.
 */
const ABSENT_CHAR = "–"; // en dash

/** Every `formatPercent` result is exactly this wide. */
export const PERCENT_WIDTH = 4;
/** Every `formatRate` result is exactly this wide. */
export const RATE_WIDTH = 6;

function pad(text: string, width: number): string {
  return text.length >= width ? text : FIGURE_SPACE.repeat(width - text.length) + text;
}

function absent(width: number): string {
  return pad(ABSENT_CHAR, width);
}

/**
 * A 0..1 fraction as a percentage, ALWAYS exactly PERCENT_WIDTH characters:
 * "␣␣0%" through "100%", and the absent form at the same width.
 *
 * No decimal place. At a one-second sample rate a tenth is precision the
 * measurement does not have, and the per-frame ease already supplies the
 * sub-second motion a decimal would have been reached for.
 */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return absent(PERCENT_WIDTH);
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return pad(`${percent}%`, PERCENT_WIDTH);
}

const RATE_UNITS = ["B", "K", "M", "G", "T"] as const;

/**
 * Bytes per second, ALWAYS exactly RATE_WIDTH characters: a three-character
 * mantissa, one unit letter, then "/s". "␣␣0B/s", "842K/s", "9.4M/s", "␣12M/s".
 *
 * Decimal decades (1000), not binary (1024) — that is the convention for rates,
 * and it also removes the boundary where a mantissa of "1023" would be four
 * characters wide.
 *
 * THE BRANCH BOUNDS ARE THE TRAP. They are 9.95 and 999.5, not 10 and 1000,
 * because `(9.96).toFixed(1)` is "10.0" (four characters) and
 * `Math.round(999.6)` is 1000 (four characters). Either naive bound is a silent
 * width bug that only appears at one value in a thousand, and the width sweep in
 * the test file is what holds this honest.
 */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return absent(RATE_WIDTH);
  let value = Math.max(0, bytesPerSecond);
  let unit = 0;
  while (value >= 999.5 && unit < RATE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // Out of units and still over the mantissa's range: pin it rather than let a
  // fourth digit widen the string. Only reachable at absurd rates, but "only
  // reachable absurdly" is how the other two width bugs would have shipped too.
  if (value >= 999.5) value = 999;
  // No decimal in the byte unit — a tenth of a byte per second is not a
  // quantity, and the integer form keeps the smallest rates honest.
  const mantissa = unit > 0 && value < 9.95 ? value.toFixed(1) : String(Math.round(value));
  return `${pad(mantissa, 3)}${RATE_UNITS[unit]}/s`;
}

const TOKEN_UNITS = ["", "k", "M", "G"] as const;

/**
 * Every `formatTokens` result is exactly this wide, absent form included.
 * Four is the maximum the formatter can produce — a three-character mantissa
 * plus at most one unit letter — and the panel is only ~13 characters across at
 * deck scale, so a wider fixed field would cost a column for nothing.
 */
export const TOKEN_WIDTH = 4;
/** Every `formatTokens(value, { signed: true })` result is exactly this wide. */
export const TOKEN_SIGNED_WIDTH = TOKEN_WIDTH + 1;

/**
 * A token count, ALWAYS exactly TOKEN_WIDTH characters (TOKEN_SIGNED_WIDTH when
 * signed): "␣412", "412k", "1.8M", and the absent form at the same width.
 * The signed variant prefixes "+" for the delta — "+3.1k".
 *
 * One formatter for every token figure in the app: the panel's rows, its cache
 * line, and the badge beside the ring all render through this, so a figure
 * cannot read one way in one place and another way three inches away.
 *
 * Decimal decades, and THE BOUNDS ARE THE SAME TRAP formatRate documents:
 * 9.95 and 999.5 rather than 10 and 1000, because `(9.96).toFixed(1)` is "10.0"
 * and `Math.round(999.6)` is 1000 — either naive bound widens the string at one
 * value in a thousand. The width sweep in the test file is what holds it honest.
 *
 * Counts are integers, so the base unit has no decimal: a tenth of a token is
 * not a quantity.
 */
export function formatTokens(value: number | null, { signed = false } = {}): string {
  const width = signed ? TOKEN_SIGNED_WIDTH : TOKEN_WIDTH;
  if (value === null || !Number.isFinite(value)) return absent(width);
  let scaled = Math.max(0, value);
  let unit = 0;
  while (scaled >= 999.5 && unit < TOKEN_UNITS.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  // Out of units and still over the mantissa's range. Only reachable at absurd
  // counts, but "only reachable absurdly" is how a width bug ships.
  if (scaled >= 999.5) scaled = 999;
  const mantissa = unit > 0 && scaled < 9.95 ? scaled.toFixed(1) : String(Math.round(scaled));
  return pad(`${signed ? "+" : ""}${mantissa}${TOKEN_UNITS[unit]}`, width);
}

/** A 0..1 fraction, straight through, clamped. Absence reads as an empty meter. */
export function meterLevel(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Floor and ceiling of the network meter's scale, in bytes per second. */
export const RATE_METER_FLOOR = 1_000;
export const RATE_METER_CEILING = 100_000_000;

/**
 * A byte rate onto a 0..1 meter position, logarithmically.
 *
 * Linear is unusable here: ordinary traffic is five decades below a saturated
 * link, so a linear bar sits at zero more than 99% of the time and the meter
 * shows nothing. On a log scale each decade is a constant span, so the bar
 * visibly moves on everyday traffic — which is the entire point of having it.
 */
export function logMeterLevel(
  bytesPerSecond: number | null,
  floor = RATE_METER_FLOOR,
  ceiling = RATE_METER_CEILING,
): number {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= floor) return 0;
  const span = Math.log10(ceiling / floor);
  return Math.max(0, Math.min(1, Math.log10(bytesPerSecond / floor) / span));
}

/** A 0..1 level onto one of `steps` discrete positions, 0..steps. */
export function quantize(level: number, steps: number): number {
  return Math.max(0, Math.min(steps, Math.round(Math.max(0, Math.min(1, level)) * steps)));
}

/**
 * Frame-rate-independent exponential approach: the fraction of the remaining
 * distance covered depends on elapsed time, not on how many frames elapsed. No
 * overshoot, monotone toward the target, and it reaches ~98% of a sample before
 * the next one arrives at the default time constants.
 */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
  if (!(dtMs > 0) || !(tauMs > 0)) return target;
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

// ---------------------------------------------------------------------------
// The load ladder. One function over the higher of the two utilizations, and
// the only thing in the readout that decides a *state* rather than a value.
//
// It reads raw samples, never eased ones: an eased value crawling across a
// threshold would strobe the accent, which reads as malfunctioning rather than
// as a machine under load.
// ---------------------------------------------------------------------------

export type LoadBand = "nom" | "elv" | "sat";

/**
 * Separate rise and fall levels, because a value sitting on a bare threshold
 * alternates on every sample. The gap is wide enough that ordinary jitter
 * cannot cross it in either direction.
 */
export const LOAD_THRESHOLDS = {
  elvRise: 0.6,
  elvFall: 0.52,
  satRise: 0.85,
  satFall: 0.78,
} as const;

/**
 * Minimum time in a band before it may change again. Hysteresis alone is not
 * enough at a one-second sample rate: a load genuinely oscillating across the
 * whole gap would still flip the panel every second.
 */
export const BAND_DWELL_MS = 1500;

/**
 * The next band, given the current one, a raw 0..1 value, and how long the
 * current band has been held.
 *
 * Absence holds the band rather than dropping it to nominal — a measurement
 * that failed says nothing about the load, and quietly reporting "all clear"
 * because a probe broke is the wrong direction to fail in.
 */
export function nextLoadBand(current: LoadBand, value: number | null, msInBand: number): LoadBand {
  if (value === null || !Number.isFinite(value)) return current;
  if (msInBand < BAND_DWELL_MS) return current;
  if (value >= LOAD_THRESHOLDS.satRise) return "sat";
  if (current === "sat" && value >= LOAD_THRESHOLDS.satFall) return "sat";
  if (value >= LOAD_THRESHOLDS.elvRise) return "elv";
  if (current !== "nom" && value >= LOAD_THRESHOLDS.elvFall) return "elv";
  return "nom";
}

/** The higher of two possibly-absent values, or null if neither is present. */
export function higherOf(a: number | null, b: number | null): number | null {
  if (a === null || !Number.isFinite(a)) return b === null || !Number.isFinite(b) ? null : b;
  if (b === null || !Number.isFinite(b)) return a;
  return Math.max(a, b);
}

// ---------------------------------------------------------------------------
// The history strip. Discrete DOM bars rather than block glyphs: the font stack
// falls back, and fallback glyphs can carry different advance widths, so a
// data-driven glyph strip would change width with its data — exactly the reflow
// the spec forbids. The current foot ships those glyphs STATICALLY, which is the
// only reason that bug cannot surface today.
// ---------------------------------------------------------------------------

/**
 * Fourteen real samples, one per bar — fourteen seconds of history at 1 Hz, and
 * deliberately the SAME COUNT as the meters' cells above it. At the deck dock's
 * width twenty bars come out under a pixel wide each and read as noise; at
 * fourteen they share the meters' column grid exactly, so the strip reads as
 * another row of the same instrument rather than as a different kind of graphic.
 * Keep the two counts equal.
 */
export const HISTORY_BUCKETS = 14;
/** Bar heights available, excluding the empty one. */
export const HISTORY_LEVELS = 8;

/**
 * Precomputed class strings indexed by quantized level, so updating the strip
 * never builds a string at runtime — 20 assignments of existing constants,
 * once a second, and nothing on the frame path.
 */
export const BAR_CLASS: readonly string[] = Array.from(
  { length: HISTORY_LEVELS + 1 },
  (_unused, level) => `bar h${level}`,
);

/**
 * A history bucket's stored level: 0 for "no measurement", 1..HISTORY_LEVELS for
 * a real one. Absence is a gap in the strip rather than a bar at the floor —
 * the same rule as everywhere else, applied to the one element that keeps a past.
 */
export function historyLevel(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(1, quantize(value, HISTORY_LEVELS));
}
