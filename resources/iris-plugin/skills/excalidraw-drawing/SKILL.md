---
name: excalidraw-drawing
description: Draw on the user's Excalidraw canvas through the iris-canvas MCP tools. Use when asked to draw, diagram, sketch, map out, or rearrange something on the board.
---

# Drawing on the canvas

The board is a live surface the user is watching, not a file you write once. The
`iris-canvas` tools (`get_canvas`, `add_elements`, `update_elements`,
`delete_elements`) are the only way to touch it — never write a `.excalidraw`
file, never invent `seed`/`version`/`index` values, and never shell out to a
renderer. `add_elements` assigns ids and ordering itself.

## The loop

1. **`get_canvas` before you answer about the board, and before you rearrange
   it.** You cannot see the canvas. The user may have moved, added, or deleted
   things since your last write, and concurrent edits are last-writer-wins per
   element — a bulk rearrange computed from a stale read will undo their work.
2. **Draw.** One `add_elements` per section (see below).
3. **Read the per-element results.** They are not decoration:
   - `rebound: dropped-binding` — a `start`/`end` id did not resolve. The
     connector exists but floats. Fix the id and `update_elements` it.
   - `skipped: unknown-id` — that element is not on the canvas. Re-read before
     guessing again.
   - `persisted: false` — the scene is in memory only. Say so; do not claim it
     is saved.
   - A label you asked for comes back as its own result marked
     `boundTo: <container id>`. That is one element, not two.
4. **`get_canvas({ includeImage: true })` to check your work** when the panel is
   open. That is the only way to see overlap and crowding. If no image comes
   back, the panel is closed — say what you drew, do not claim you looked.

## Connecting shapes

Always `start: { id }` / `end: { id }`. Never compute endpoints yourself.

The server clips each end to the edge of the shape it binds to, facing the other
shape, and records a real binding — so the connector stays attached when the
user drags a box. Hand-computed coordinates are recomputed anyway, and they cost
you the binding. This is the one place where advice written for file-based
Excalidraw workflows is wrong here.

You may bind to a shape added in the *same* `add_elements` call, so a section
and its arrows go in one write.

For a connector that would cut through something, give `points` a route:
`[[0,0],[80,0],[80,120],[200,120]]` — every vertex is kept, and
`elbowed: true` asks for right-angle routing.

## Labels, not floating text

`label: { text }` on a rectangle, ellipse, diamond, arrow, or line binds the
text **inside** that element: the canvas centres, wraps, and re-measures it
against its container. Use it for anything that names a shape. A free-standing
`type: "text"` element is only for text that belongs to no shape — a title, an
annotation. Positioning text next to a box by arithmetic is how text ends up
beside its box instead of in it.

Two traps:

- **On a connector, keep the label short.** Excalidraw masks the connector
  behind the label's full bounding box, so a label as long as the arrow erases
  the arrow. One or two words: `"yes"`, `"on failure"`.
- **Never label a large background container.** The label centres in the
  container, which puts it on top of everything inside it. Title such a group
  with a separate `text` element at its top-left instead.

Sizing, spacing, colour, and the box-width arithmetic for accented and CJK text
are in [references/layout.md](references/layout.md). Read it before the first
`add_elements` of a diagram.

## While you draw

Build in **sections** — one `add_elements` per row, column, or cluster, then the
connectors joining it to what is already there. Place new work near the existing
content, not at the origin, unless asked to start fresh.

Say what you are drawing as you draw it. The user hears you while the tool calls
run; a long silent burst of writes followed by "done" tells them nothing about
what appeared. One short line per section — *"laying out the four steps"*,
*"connecting them left to right"* — is the right amount.
