// Turns an Electron accelerator string ("Alt+Shift+W") into the glyphs a macOS
// user recognises ("⌥", "⇧", "W"), so the UI can name a hotkey the way the OS
// does. Pure and separate from any component because two surfaces need it —
// the asleep caption, which wants one string, and the setup panel, which wants
// one keycap per part (wake-sleep-voice).
//
// Iris is macOS-only, so the mapping is macOS-only too. Anything unrecognised
// passes through as-is: a user's own accelerator should still be readable
// rather than silently dropped, and a name we don't have a glyph for is still
// better shown than hidden.

const MODIFIER_GLYPHS: Record<string, string> = {
  command: "⌘",
  cmd: "⌘",
  cmdorctrl: "⌘",
  commandorcontrol: "⌘",
  control: "⌃",
  ctrl: "⌃",
  alt: "⌥",
  option: "⌥",
  altgr: "⌥",
  shift: "⇧",
  super: "⌘",
  meta: "⌘",
};

const KEY_GLYPHS: Record<string, string> = {
  space: "Space",
  plus: "+",
  return: "↩",
  enter: "↩",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  escape: "⎋",
  esc: "⎋",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

/**
 * Split an accelerator into its display parts, in press order.
 * `"Alt+Shift+W"` → `["⌥", "⇧", "W"]`. An empty or unusable value yields `[]`,
 * so a caller can fall back rather than render an empty keycap.
 */
export function acceleratorParts(accelerator: string): string[] {
  if (!accelerator) return [];
  // "Plus" is Electron's escape for a literal +, so splitting on "+" is safe
  // only after the separator has done its job — hence split first, map after.
  return accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const key = part.toLowerCase();
      return MODIFIER_GLYPHS[key] ?? KEY_GLYPHS[key] ?? (part.length === 1 ? part.toUpperCase() : part);
    });
}

/**
 * The same chord as one compact string for prose: `"Alt+Shift+W"` → `"⌥⇧W"`.
 * Multi-character parts keep a separating space so "⌥⇧Space" doesn't read as
 * one word.
 */
export function acceleratorLabel(accelerator: string): string {
  const parts = acceleratorParts(accelerator);
  if (!parts.length) return "";
  return parts.reduce((text, part, index) => {
    if (index === 0) return part;
    const needsSpace = part.length > 1 || parts[index - 1].length > 1;
    return `${text}${needsSpace ? " " : ""}${part}`;
  }, "");
}
