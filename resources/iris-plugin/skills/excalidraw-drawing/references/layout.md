# Layout, sizing, text and colour

Numbers, not taste. A diagram reads badly for measurable reasons: boxes too
close, text wider than the box holding it, six colours meaning nothing.

## Spacing

| Between | Gap |
| --- | --- |
| Boxes in a row (left → right flow) | 120 |
| Boxes in a column (top → bottom flow) | 80 |
| Parallel branches of the same decision | 60 |
| A group and the next group | 200 |
| Anything and a title above it | 60 |

Keep one axis fixed per run of shapes: a row shares `y`, a column shares `x`.
Uneven alignment reads as a mistake even when nothing overlaps.

Lay a flow out **left to right** when the steps are sequential, **top to bottom**
when they are hierarchical. Do not mix directions in one diagram.

## Box sizes

| Tier | Size | For |
| --- | --- | --- |
| Small | 140 × 60 | a step, a state, a node in a graph |
| Standard | 200 × 80 | the default — a labelled component |
| Wide | 280 × 80 | a long label, or a name plus a qualifier |
| Tall | 200 × 120 | two lines of label |
| Background group | fits contents + 40 padding | a container drawn *first* so it sits behind |

Shapes carry meaning — keep it consistent within one diagram: rectangle for a
step or component, diamond for a decision, ellipse for a start/end terminal.

`roundness: { type: 3 }` rounds the corners of a rectangle or diamond. Use it
for everything or nothing.

## Text that fits

The canvas re-measures a **bound label** and wraps it inside its container, so a
label never spills. What you must get right is the **container width**, or the
label wraps to three lines in a box built for one.

Estimate the rendered width of a string as the sum of its characters:

| Character class | Width per character |
| --- | --- |
| Latin, including accented (`á à ạ ă ê ơ ư đ`, `é ü ñ ç`) | `fontSize × 0.6` |
| CJK (Chinese, Japanese, Korean) | `fontSize × 1.0` |
| Spaces and narrow punctuation (`i l . ,`) | `fontSize × 0.3` |

Then **add 32** for the container's padding, and round up to a tier above.

Accented Vietnamese is the case that catches people out: the accents add height,
not width, so `"Xác thực người dùng"` is 19 characters ≈ 19 × 20 × 0.6 + 32 ≈
260 → a **wide** box, not a standard one. Counting bytes, or assuming an accent
costs extra width, both give the wrong tier.

If a label needs more than about 25 characters, shorten the label rather than
widening the box past 280.

### Fonts

| Role | `fontSize` |
| --- | --- |
| Diagram title | 28 |
| Section / group heading | 24 |
| Box label | 20 (the default) |
| Connector label, annotation | 16 |

Font family is not yours to set — bound labels use the canvas's label family
automatically.

**Always set `strokeColor` on a free-standing `text` element.** It is the text's
colour, and the default (`#1e1e1e`) is only right on a light board.

## Colour

Colour carries meaning or it is noise. Pick one role per colour and hold it for
the whole diagram — at most three besides the default.

| Colour | `strokeColor` | `backgroundColor` | Conventional role |
| --- | --- | --- | --- |
| Default | `#1e1e1e` | `transparent` | ordinary step |
| Blue | `#1971c2` | `#a5d8ff` | the happy path, the primary subject |
| Green | `#2f9e44` | `#b2f2bb` | success, output, done |
| Red | `#e03131` | `#ffc9c9` | failure, error, the thing being warned about |
| Yellow | `#f08c00` | `#ffec99` | a decision, or something needing attention |
| Grey | `#868e96` | `#f1f3f5` | out of scope, external system, background group |

`backgroundColor` is the fill; leaving it `transparent` is fine and often
better. A filled box needs a `strokeColor` from the same row, not a third
colour.

## Anti-patterns

- **A background group with a `label`.** The label centres in the container —
  i.e. on top of its contents. Draw the group first (so it is behind), then a
  separate `text` element at its top-left as the group's title.
- **A connector label longer than a couple of words.** It masks the connector.
- **Boxes sized to their text.** Size to the tier table; a row of
  different-width boxes reads as a mistake.
- **Redrawing the whole board to move one thing.** `update_elements` patches by
  id. Deleting and re-adding loses every binding pointing at the old id.
- **A second `add_elements` starting back at the origin.** New work goes beside
  the existing content — `get_canvas` first to find out where that is.
