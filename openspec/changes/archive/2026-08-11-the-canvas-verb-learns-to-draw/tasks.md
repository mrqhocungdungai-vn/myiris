## 0. Before touching anything

- [x] 0.1 Read `design.md` D4 first. The label element shape is **measured**, not
      guessed — implementing it from the excalidraw docs alone will get
      `fontFamily` wrong (it is `5` for a bound label, not the `1` that
      `buildTextElement` uses for free-standing text).
- [x] 0.2 Confirm the starting state is what this change describes:
      `node --input-type=module -e "import {buildElement} from './electron/canvas-mcp.mjs'; console.log(buildElement({type:'rectangle',id:'a',roundness:{type:3},groupIds:['g'],label:{text:'x'}},{index:'a0'}))"`
      — expect `roundness: null`, `groupIds: []`, and no label anywhere.

## 1. The element vocabulary stops dropping fields

- [x] 1.1 `electron/canvas-mcp.mjs` — `ELEMENT_SCHEMA`: declare `label`
      (`{ text, fontSize?, strokeColor? }`), `roundness`, `groupIds`, and
      `elbowed`. They are accepted-then-discarded today only because
      `.passthrough()` hides them; naming them is what makes the contract
      honest.
- [x] 1.2 `baseFields` — honour `skeleton.roundness` and `skeleton.groupIds`
      instead of the hardcoded `null` / `[]`. Two lines.
- [x] 1.3 `buildLinearElement` — honour `elbowed`, and keep a `points` array of
      more than two vertices instead of reading only `points[1]`. Width/height
      must be derived from the full route's extent, not from the last vertex.
- [x] 1.4 `buildShapeElement` / `buildLinearElement` — when a skeleton carries
      `label`, emit the bound text element alongside the container: text gets
      `containerId` = container id, `textAlign: "center"`,
      `verticalAlign: "middle"`, `fontFamily: 5`, `height = fontSize * 1.25`,
      and `x`/`y` centred in the container. The container gains
      `{ type: "text", id }` in `boundElements` — reuse `addBoundElement`
      (`canvas-mcp.mjs:224-229`), which already back-fills the same field for
      connector bindings.
- [x] 1.5 `applyAddElements` — the generated label is a **second** element with
      no entry in the caller's skeleton array. Its id must reach the
      per-element results so `changedIdsFrom` returns it, or the label will
      persist but never appear on an open canvas (design.md D5). Do not let it
      read as a second caller-requested element in whatever the result reports.
- [x] 1.6 `applyUpdateElements` — decide and state what updating a container's
      `label` means (patch the bound text, not create a second one). A patch
      that silently adds a duplicate label is the same class of defect this
      change closes.
- [x] 1.7 Tool descriptions for `add_elements` and `update_elements` — name the
      vocabulary, including labels. Required by the delta spec's "The
      vocabulary is declared, not latent" scenario.

## 2. The skill

- [x] 2.1 `resources/iris-plugin/skills/excalidraw-drawing/SKILL.md` — frontmatter
      `name` + `description` only, matching the other bundled skills
      (`grilling/SKILL.md:1-4`). Body kept short; long tables go to
      `references/` (precedent: `tdd/references/`).
- [x] 2.2 Content — the loop discipline: `get_canvas` before answering about the
      board or rearranging it; `get_canvas({ includeImage: true })` to check
      the result visually while the panel is open; read the per-element results
      and repair `rebound: dropped-binding` / `skipped: unknown-id`; re-read
      before a bulk rearrange, because concurrency is last-writer-wins per
      element.
- [x] 2.3 Content — connecting: always `start`/`end` `{ id }`, **never**
      hand-computed edge points. See design.md D3; this is where the upstream
      source is actively wrong for this codebase.
- [x] 2.4 Content — layout and text: spacing and column/row rules, box size
      tiers, font hierarchy, a text-width estimate that accounts for accented
      and CJK characters, always set `strokeColor` on text, and prefer `label`
      over a free-standing text element for anything that belongs to a shape.
- [x] 2.5 Content — the label-on-a-connector width rule (a label sized to the
      connector's length masks the connector), and the anti-pattern of putting
      a label on a large background container (it centres over the contents).
- [x] 2.6 Content — build in sections, one `add_elements` per section; keep new
      work near existing content; say what is being drawn while drawing it
      (the verb sets `speakWhileWorking`, so a long silent burst of tool calls
      is the wrong shape).
- [x] 2.7 `resources/iris-plugin/LICENSE-agents365-excalidraw-skill` — the MIT
      text from `Agents365-ai/excalidraw-skill`.
- [x] 2.8 `resources/iris-plugin/ATTRIBUTION.md` — add a row marked **adapted
      from, not a verbatim snapshot**, with the reason (this surface is an MCP
      server, not a file plus an export toolchain). Nothing from
      `coleam00/excalidraw-diagram-skill` may be used: it carries no licence.
- [x] 2.9 Do **not** add a `skills-lock.json` entry and do **not** add the skill
      to `pipeline-probes.mjs`'s `REQUIRED_SKILLS` — design.md D7 states why for
      each.

## 3. Wiring

- [x] 3.1 `electron/run-skills.mjs` — add `q("excalidraw-drawing")` to
      `SHAPING_SKILLS`, with the reason recorded beside it as every other entry
      is: the shared resident session fixes its skills at open and there is no
      `setPoSessionSkills`, so a canvas-only list is present or absent depending
      on which medium opened the conversation (design.md D1).
- [x] 3.2 `electron/verbs.mjs` — no change. `shape_on_canvas` keeps
      `skills: SHAPING_SKILLS`. Confirm this deliberately rather than by
      omission.
- [x] 3.3 No packaging change — `extraResources` already ships
      `resources/iris-plugin` wholesale (`package.json`). Verify, do not edit.

## 4. Tests

- [x] 4.1 `electron/canvas-mcp.golden.test.mjs` — add a labelled rectangle and a
      labelled arrow, run both through the real `convertToExcalidrawElements`,
      and assert the builder's output is a field-key superset for **both** the
      container and the generated label. This is the only mechanism tying the
      label shape to excalidraw's own.
- [x] 4.2 `electron/canvas-mcp.test.mjs` — the label's id appears in the results
      and in `changedIdsFrom`; the container's `boundElements` names the label;
      `roundness`, `groupIds`, `elbowed`, and a multi-vertex `points` route
      survive a round trip.
- [x] 4.3 `electron/canvas-mcp.test.mjs` — updating a labelled container's label
      patches the existing bound text rather than adding a second one (1.6).
- [x] 4.4 Already covered, no new test needed — confirm they still pass:
      `verbs.test.mjs:256-263` (every declared skill is a real directory in the
      bundled plugin) and `run-skills.test.mjs:16-20` (no verb reaches the whole
      bundle; `SHAPING_SKILLS` goes 6 → 7, against 19 shipped).

## 5. Gates and real-app verification

- [x] 5.1 `npm run build` (runs `plugin-sync`), `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check` — or `/gates`.
- [x] 5.2 `npm run dev`, open the canvas, say *"vẽ luồng đăng nhập gồm 4 bước"*.
      Expect labels **inside** their boxes, connectors meeting box edges, even
      spacing, and narration while the drawing happens.
- [x] 5.3 Accented-text case, which is where the old width estimate failed:
      a label such as "Xác thực người dùng" must sit inside its box, not overflow
      it.
- [x] 5.4 **The regression case that matters** — talk to Iris by voice *first*,
      then open the canvas and ask for a drawing. This is the path a
      canvas-only skills list breaks (design.md D1); the drawing skill must be
      loaded here too. Check the `skills [...]` line in
      `~/.myiris/logs/iris.log` (`run-exec.mjs:329`).
- [x] 5.5 Confirm the token cost is the expected ~120 per session and nothing
      more, via the token ledger.

## 6. Close out

- [x] 6.1 Archive the change so the two delta specs land in `openspec/specs/`.
