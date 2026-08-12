## REMOVED Requirements

This capability held two concepts joined by a hyphen — *what is drawn* (the second brain) and *how it is drawn* (a galaxy) — against `CLAUDE.md`'s one-capability-per-folder rule. Every requirement below moves intact to `second-brain-layer` or to `galaxy-view`; **none is retired and none changes meaning.** Each entry names its destination, so this delta is the mapping table a reviewer checks the split against.

Twelve requirements, not eleven: the last is the one `the-icon-names-what-it-opens` adds ahead of this change.

The capability's folder (`openspec/specs/second-brain-galaxy-view/`) is **deleted** at sync rather than left empty — `scripts/check-spec-drift.mjs` fails an empty capability, so `spec:check` is the gate that enforces it.

### Requirement: The second-brain vault is rendered as a 3D galaxy in the Glass HUD

**Reason**: Describes the *feature's* layer — its toggle, its exclusivity with the drawing canvas, and its HUD-only lifetime. None of it is about how a graph is drawn.

**Migration**: Moved to `second-brain-layer` as "The second-brain vault is shown as an exclusive HUD layer", unchanged in substance.

### Requirement: The second-brain control identifies the feature, not the view

**Reason**: A rule about what the *control* names, added by `the-icon-names-what-it-opens`. It is about the feature's identity, and it survives any change of rendering — indeed its whole justification is that the rendering may be shared.

**Migration**: Moved to `second-brain-layer` verbatim, with its cross-reference to the rendering repointed at `galaxy-view`.

### Requirement: The vault graph is owned and kept fresh by the main process

**Reason**: Vault scanning, `[[wikilink]]` resolution, ghost nodes, the `inbox/` spool exclusion and the live `fs.watch` are all properties of the notes vault, not of any rendering.

**Migration**: Moved to `second-brain-layer` verbatim.

### Requirement: Opening a node shows the note's content

**Reason**: The note reader, its raw-markdown editor, the revision-token save refusal and the open-externally route are all about notes. The only rendering-adjacent clause — that the reader cannot outlive the layer — is a lifetime rule of the layer.

**Migration**: Moved to `second-brain-layer` verbatim.

### Requirement: Untrusted note content is contained

**Reason**: A containment boundary around note content and vault paths — `secondbrain:read-note`'s symlink refusal has no meaning outside the vault.

**Migration**: Moved to `second-brain-layer` verbatim. The clause about an in-scene title reaching the view as drawn text is **also** restated in `galaxy-view`'s label requirement, because it is a property the renderer must hold for any label from any source; the two are deliberately consistent, not duplicated in substance.

### Requirement: The galaxy view is gated on the vault existing, independent of the Claude pipeline

**Reason**: Availability gating on `~/iris-second-brain` existing. A galaxy drawn from some other source would have its own precondition; this one is the vault's.

**Migration**: Moved to `second-brain-layer` verbatim.

### Requirement: The galaxy renders over an immersive opaque deep-space backdrop

**Reason**: Backdrop, vignette, starfield, the bloom path chosen by `webgl-quality-mode`, the sleep pause and the single-`three` constraint are all rendering. Nothing in it names a note.

**Migration**: Moved to `galaxy-view` verbatim.

### Requirement: The node being pointed at reveals its link cluster

**Reason**: A highlight-and-dim rule over graph nodes and links, with a precedence ordering against the focus. It speaks of nodes, one-hop neighbourhoods and inputs.

**Migration**: Moved to `galaxy-view`. Note vocabulary is replaced with node vocabulary where the predicate does not depend on a note ("note-node" → "node"); the ghost exclusion is preserved and now cites `second-brain-layer` for what makes a node a ghost, since that is the source's property, not the view's.

### Requirement: Note titles are always drawn in the galaxy, legible by camera proximity

**Reason**: Perspective scaling, the sprite pool and its ceiling, off-axis eligibility, elision, and the sleep pause are all rendering rules. The subject noun was the only note-specific part.

**Migration**: Moved to `galaxy-view` as "Node labels are always drawn, legible by camera proximity". Every normative clause is preserved with its stated reason; "note title" becomes "node label" and "the vault's note count" becomes "the graph's node count". The declutter clause continues to cite `second-brain-focus`.

### Requirement: The camera turns and dollies around a movable anchor

**Reason**: Camera navigation. The anchor is a point or a node; that a node is a note is incidental to every clause.

**Migration**: Moved to `galaxy-view`. Cited by `two-hand-gestures` and `second-brain-gesture-nav`, whose citations repoint here.

### Requirement: The camera is aimed by a sight that follows the hands

**Reason**: Where camera drives are aimed and why the sight is not fixed to the screen centre — rendering and input, with no note semantics.

**Migration**: Moved to `galaxy-view`. Cited by `second-brain-gesture-nav`, whose citation repoints here.

### Requirement: What a grab will take hold of is visible before the grab

**Reason**: The candidate and anchor marks, their rate limit, and their distinguishability from the highlight and the focus — all rendering affordances.

**Migration**: Moved to `galaxy-view` verbatim.
