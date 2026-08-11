## Context

This change was scoped by exploration on a machine that does not build the app.
Everything below that claims a fact about the current behaviour was **executed**,
not read — the field-dropping table in `proposal.md` comes from calling
`buildElement` directly, and the target shapes in D4 come from running the real
`convertToExcalidrawElements` under the existing golden test's jsdom harness.
The implementing machine should not have to rediscover any of it.

## Decisions

### D1 — The skill goes on `SHAPING_SKILLS`, not on a canvas-only list

The obvious move is a new `CANVAS_SKILLS = [...SHAPING_SKILLS, q("excalidraw-drawing")]`
bound to `shape_on_canvas` alone. **It does not work**, and the reason is not
visible from the registry.

`shape_on_canvas` and `shape_requirements` share one resident session
(`sessionKey: STATEFUL_SESSION_KEY`). Session options are supplied **once, when
the session is created** — `skills: verb.skills` at `run-exec.mjs:755`, inside
`statefulSessionOptions`. The comment immediately below it
(`run-exec.mjs:762-767`) already records the consequence for the system prompt:
"the clause baked in here is whichever verb opened it — which is why each turn
also carries its own verb's clause in its prompt below."

Skills have no such per-turn repair. MCP servers do: `setPoSessionMcpServers`
(`run-exec.mjs:876-881`) patches a live session so a canvas turn into a
voice-opened conversation still gets its tool server. There is **no
`setPoSessionSkills`**, and the Agent SDK exposes no equivalent.

So a canvas-only list would load the drawing skill only when the user opens the
board *before* saying anything — and silently omit it on the far more common
path where they talk first and move to the canvas when talking stops being
enough. That path is not an edge case; `canvas-claude-mcp` has a requirement
devoted to it ("Moving to the canvas continues the conversation").

Putting the skill on the shared list costs roughly 120 input tokens per session
on voice-shaping turns (`run-skills.mjs:16-19` records the measurement). That is
the correct trade, and it is also *honest*: the shared conversation genuinely can
draw, because the canvas tool server is attached to it live.

**Rejected alternative:** adding `setPoSessionSkills`. It would need SDK support
that does not exist, and it would make a conversation's capability surface
change underneath it mid-conversation — a worse property than paying 120 tokens.

### D2 — The skill is authored for Iris, not vendored

Both repositories named in the request were examined.

| | `coleam00/excalidraw-diagram-skill` | `Agents365-ai/excalidraw-skill` |
| --- | --- | --- |
| Licence | **none** (`license: null`, no LICENSE file) | **MIT** |
| Usable | ideas only — its prose must not be copied | yes, with attribution |
| Content | mostly design philosophy; almost no layout arithmetic | concrete: sizing formulas, spacing table, palette, arrowhead catalogue |

`coleam00`'s repository carries no licence at all, so no text from it may enter
this repo. Nothing is lost: every idea worth having from it (concept-to-layout
mapping, a bias against putting text in boxes) has an independently-written
equivalent in the MIT repository.

Neither can be vendored as a snapshot, because **both are file-based**: the
model hand-writes a `.excalidraw` file and shells out to Playwright, Kroki, or a
CLI to render it. Against an MCP surface roughly 40% of each is wrong or
meaningless — the render toolchain, the file skeleton (`type`/`version`/`source`/
`appState`), and the instructions to invent `seed` and `id` values that
`applyAddElements` already assigns (`canvas-mcp.mjs:242-246`).

This also settles the form: `ATTRIBUTION.md` requires vendored snapshots be
refreshed rather than edited, so a heavily-adapted file must not be recorded as
a snapshot. It is an Iris-authored skill that credits its MIT source.

### D3 — One inherited rule must be inverted, not copied

The MIT skill states that connector endpoints must be computed edge-to-edge
because `startBinding`/`endBinding` "do not clip the line when exporting via
Kroki or the local CLI."

That is true of a **static export** and false here. `buildLinearElement` already
clips each endpoint to the boundary of the bound shape facing the other
(`clipToRect`, `canvas-mcp.mjs:126-143`) and sets real bindings. Copying the
rule would instruct the model to hand-compute endpoints that the server then
recomputes, and would forfeit the bindings that keep a connector attached when
the user drags a box.

The skill therefore teaches the opposite: **always connect with `start`/`end`
`{ id }` and never hand-compute endpoints.** Recorded here because it is the one
place where the upstream source is actively misleading for this codebase.

### D4 — `label` mirrors `convertToExcalidrawElements`, field for field

The target is not invented. Running the real converter on
`{ type: "rectangle", id: "r", x: 10, y: 20, width: 200, height: 80, label: { text: "Auth Service" } }`
produces **two** elements:

- the container, gaining `boundElements: [{ type: "text", id: <textId> }]`
- a text element with `containerId: "r"`, `textAlign: "center"`,
  `verticalAlign: "middle"`, `fontFamily: 5`, `fontSize: 20`,
  `height: 25` (`fontSize * 1.25`), and `x`/`y` centred in the container
  (`x = 10 + (200 - width) / 2`, `y = 20 + (80 - 25) / 2 = 47.5`)

Two details are easy to get wrong. `fontFamily` is **5**, not the `1` that
`buildTextElement` defaults to for free-standing text (`canvas-mcp.mjs:110`).
And the real converter measures text to size it; the builder cannot, so it keeps
its existing estimate — the estimate is acceptable *here* precisely because a
bound label is re-measured and re-wrapped by excalidraw against the container
when it renders, which is the whole reason binding beats hand-placement.

A labelled arrow behaves the same way (`containerId` pointing at the arrow), with
one hazard the MIT source flags and that is real on a live canvas: excalidraw
masks the connector behind the label's full bounding box, so a label sized to the
arrow's length erases the arrow. The label's width must fit its text.

### D5 — The generated label element must be visible to the reconciler

This is the defect most likely to be introduced while implementing D4.

A label produces an element that is **not** in the caller's skeleton array. The
renderer applies external writes by reconciling only the elements a write touched
(`canvas-claude-mcp`: "never by replacing the whole scene"), driven by
`changedIdsFrom(results)` (`canvas-mcp.mjs:376-378`). If the label's id never
enters `results`, the container appears on the open canvas and its label does
not — and the scene on disk and the scene on screen disagree until the next
reopen.

The label's id must therefore reach the per-element results, and it must do so
without being mistaken for a second caller-requested element in the counts the
tool result reports.

### D6 — Why these four fields and no more

`roundness`, `groupIds`, and `elbowed` are each one hardcoded literal in
`baseFields`/`buildLinearElement`, and multi-vertex `points` is one discarded
array. They are included with `label` because they are the same defect — a
skeleton field accepted and dropped — and separating them would mean a second
change touching the same four lines.

The line is drawn at fields excalidraw's own converter accepts for these six
element types. Not included: `image`, `frame`, and `embeddable` element types
(the converter's support for them is a different surface with its own asset
handling), and free-form `customData`.

### D7 — Provenance and probes, deliberately left alone

- **No `skills-lock.json` entry.** The provenance check only hashes files under
  `.claude/` (`check-plugin-sync.mjs:162-173`). This skill is plugin-only, like
  the six `wiki-*` skills, which likewise have no entry. Recording an entry that
  the checker cannot verify would be the exact failure `skills-lock.json`'s own
  `_readme` describes: a guarantee nothing checks.
- **Not added to `pipeline-probes.mjs:21-29`.** Those seven skills are what the
  pipeline needs to *function*; a missing drawing skill degrades quality without
  breaking anything, and a bundle-integrity alarm should mean the bundle is
  broken.

## Risks

- **The 120-token cost lands on voice-shaping turns too** (D1). Accepted, and
  measurable: the `skills [...]` line in the run log (`run-exec.mjs:329`) shows
  what each session loaded.
- **The golden test is the only thing tying the label shape to excalidraw.** It
  compares field *keys*, not values, so a future version bump that renames a
  value convention would pass. Mitigated by extending it with the labelled cases
  rather than testing labels only against hand-written fixtures.
- **The skill can grow into a manual.** Long reference material belongs in
  `references/` (precedent: `tdd/references/`), which loads only when the skill
  reaches for it; the body stays short.
