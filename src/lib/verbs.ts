// The verbs Iris hands work to. **Display vocabulary only** — the renderer no
// longer offers a control for choosing one. A verb is selected per request by
// Iris, from what the user said and from the project's state; this module exists
// so a run card can say what ran and colour it consistently.
//
// The main process's electron/verbs.mjs is the single definition; anything here
// that could disagree with it (which model is effective, whether a verb parks,
// which skills it gets) is deliberately absent — the snapshot from
// `listVerbs()` carries those.

export const ALL_VERBS: Verb[] = [
  "shape_requirements",
  "shape_on_canvas",
  "execute",
  "finish",
  "investigate",
  "review",
  "capture_learning",
];

// Short enough for a badge. Mirrors each registry record's `label`.
export const VERB_LABELS: Record<Verb, string> = {
  shape_requirements: "Shape",
  shape_on_canvas: "Canvas",
  execute: "Build",
  finish: "Finish",
  investigate: "Look",
  review: "Review",
  capture_learning: "Notes",
};

// Per-verb identity colors, expressed as references to Deep Space's rgb tokens
// (rgba(var(--x), alpha) accepts a nested var()) so they stay themed. The two
// shaping verbs share a hue because they share a conversation.
export const VERB_COLORS: Record<Verb, string> = {
  shape_requirements: "var(--violet-rgb)",
  shape_on_canvas: "var(--violet-rgb)",
  execute: "var(--mint-rgb)",
  finish: "var(--mint-rgb)",
  investigate: "var(--cyan-rgb)",
  review: "var(--cyan-rgb)",
  capture_learning: "var(--amber-rgb)",
};

// Curated model choices — mirrors electron/verbs.mjs MODEL_CHOICES. The renderer
// never resolves which model is effective (env vars, defaults — that is the main
// process's job, via the snapshot's roster[].model); this is only the label
// lookup and the menu contents.
export const MODEL_CHOICES: { id: string; label: string }[] = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export function modelLabel(id?: string | null): string {
  if (!id) return "";
  return MODEL_CHOICES.find((choice) => choice.id === id)?.label ?? id;
}

export function isVerb(value: unknown): value is Verb {
  return typeof value === "string" && (ALL_VERBS as string[]).includes(value);
}

export function verbLabel(value: unknown): string {
  return isVerb(value) ? VERB_LABELS[value] : "";
}

// Which stored Claude conversation a verb resumes. Mirrors the registry's
// `sessionKey`: the two shaping verbs share one, because they are the same
// conversation in two media.
export function sessionKeyForVerb(verb: Verb): string {
  return verb === "shape_requirements" || verb === "shape_on_canvas" ? "stateful" : verb;
}
