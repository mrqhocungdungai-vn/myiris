// The HUD camera's date/time stamp (hud-rec-timestamp). Pure and here rather
// than in the component for the same reason as lib/eye-hud.ts: vitest's `unit`
// project runs under environment "node" with no DOM, so logic that must be
// verified has to be reachable without rendering — and a timestamp formatter
// is exactly where an off-by-one or a missing pad hides in plain sight
// (design D5).

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `DD/MM/YYYY · HH:MM:SS`, 24-hour, every field zero-padded.
 *
 * Day-first because that is how this app's user writes dates, and 24-hour so a
 * viewer never has to infer AM/PM from the footage. Zero-padding is not
 * cosmetic: with `font-variant-numeric: tabular-nums` it is what makes the
 * stamp a fixed width, so it cannot shift position as the seconds tick — the
 * same rule the eye readout's value column follows.
 *
 * Deliberately NOT `toLocaleString`: its output varies with the host's locale
 * and ICU version, which would make the stamp unpredictable across machines
 * and this function's tests unwritable without pinning a locale.
 *
 * Reads the date in local time, which is the wall clock the recording was made
 * against — no timezone is shown (design.md, Risks).
 */
export function formatRecStamp(date: Date): string {
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${day}/${month}/${year} · ${hours}:${minutes}:${seconds}`;
}
