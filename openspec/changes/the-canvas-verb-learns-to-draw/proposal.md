## Why

Iris draws badly, and the reports blame the wrong layer. The voice layer is
doing its job: Gemini hears "draw it out", picks `shape_on_canvas`, and passes
the utterance through the schema the registry declares. The verb is reached.
What arrives on the board is the problem — text floating beside its box instead
of inside it, boxes overlapping, connectors cutting through shapes.

There are **two** causes, and only one of them is a missing skill.

### 1. The write tools silently discard most of what a drawing needs

`ELEMENT_SCHEMA` ends in `.passthrough()` (`canvas-mcp.mjs:320-336`), so any
extra Excalidraw field validates cleanly. It is then thrown away: the builders
never spread the skeleton, and `baseFields` reads exactly eight style fields and
hardcodes the rest. Run through `buildElement` directly:

| Sent | Stored | Consequence |
| --- | --- | --- |
| `label: { text: "Auth" }` | dropped entirely | **a labelled box is impossible** |
| `roundness: { type: 3 }` | `null` (`canvas-mcp.mjs:73`) | corners can never be rounded |
| `groupIds: ["g1"]` | `[]` (`canvas-mcp.mjs:70`) | elements can never be grouped |
| `elbowed: true` | `false` (`canvas-mcp.mjs:207`) | no right-angle routing |
| `points` with 3 vertices | collapsed to a 2-point straight line | connectors cut through shapes |

Silent acceptance is worse than refusal. A model that sets `label` gets
`applied` back, has no way to learn the label never existed, and cannot correct
what it was not told about — the per-element result contract
(`canvas-claude-mcp`: "Invalid write is reported, not silently dropped") is
satisfied in letter and broken in spirit.

`label` is the expensive one. `buildTextElement` hardcodes `containerId: null`
(`canvas-mcp.mjs:113`), so every labelled shape must be two unrelated elements,
and the model must place the second one by guessing its width from
`text.length * fontSize * 0.6` (`canvas-mcp.mjs:105`). That estimate is wrong
for long strings and wrong for accented Vietnamese, which is exactly where the
observed overflow happens. No prompt can fix a field the server refuses to
store.

### 2. Nothing ever taught the verb how to draw

The entire drawing instruction reaching the worker is one sentence
(`verbs.mjs:222-223`): *"Work on the drawing canvas with the user. Read the
canvas before answering about it, and draw on it rather than describing what you
would draw."* No spacing, no sizing, no palette, no layout vocabulary, no
discipline about reading the board before rearranging it, no instruction to read
the per-element results and repair a dropped binding.

`SHAPING_SKILLS` (`run-skills.mjs:41-48`) is grilling plus the OpenSpec
workflow. Not one entry concerns drawing. And the code already says where this
belongs — `capabilities/canvas.mjs:207-215` explains that the voice instruction
covers how the *voice layer* behaves, because "putting these rules there would
be describing one agent's job in another agent's briefing." How-to-draw belongs
on Claude's side, as a skill.

## What Changes

- The write tools accept the element vocabulary Excalidraw itself accepts:
  labels bound inside shapes and arrows, corner rounding, grouping, and
  multi-vertex connector routing. A field the schema names is a field that is
  stored.
- A bundled `excalidraw-drawing` skill carries the drawing knowledge, scoped to
  the conversation that can reach the canvas.
- The tool descriptions name the vocabulary, so it is discoverable rather than
  latent behind `.passthrough()`.
- The constraint that forces the skill onto the *shared* conversation rather
  than onto one verb is written down, because it is invisible in the registry
  and a future reader will otherwise "fix" it back.

## Impact

- **Affected specs:** `canvas-claude-mcp` (the element vocabulary the write
  tools accept), `stateful-verb-session` (a shared conversation has one skill
  surface, fixed when it opens).
- **Affected code:** `electron/canvas-mcp.mjs` (schema and the three builders),
  `electron/run-skills.mjs` (one entry), `resources/iris-plugin/skills/` (a new
  skill), `resources/iris-plugin/ATTRIBUTION.md` plus a vendored licence.
- **Not affected:** packaging (`extraResources` already ships the whole plugin
  directory), `verbs.mjs` (`shape_on_canvas` keeps `skills: SHAPING_SKILLS`),
  and every gating, persistence, and concurrency requirement in
  `canvas-claude-mcp`.
- **Compatibility:** additive. Every skeleton that works today produces the same
  element; scenes already on disk are untouched.
