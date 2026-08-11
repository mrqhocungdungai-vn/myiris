## ADDED Requirements

### Requirement: The write tools accept the element vocabulary excalidraw accepts

An element field the write tools' schema admits SHALL be a field the scene
stores. Where a skeleton field is accepted by validation and then discarded by
construction, the tool SHALL either honour it or reject it — never report the
write as applied while dropping part of it.

Specifically, the write tools SHALL support: a **label bound inside a shape or a
connector**, corner **rounding**, **grouping**, and **multi-vertex connector
routing**. A bound label SHALL be expressed as excalidraw itself expresses it —
a text element whose container is named, and a container that names the text
among its bound elements — so the canvas centres, wraps, and re-measures the
label against its container rather than the model placing it by arithmetic.

Silent acceptance is the failure this closes. The per-element result already
distinguishes an applied element from a skipped one so a bad write can be
corrected; a field accepted, dropped, and reported `applied` gives the model
nothing to correct and no way to learn it needs to.

The tools' own descriptions SHALL name this vocabulary. A capability discoverable
only by guessing which undeclared fields survive is not available to the model
that has to use it.

#### Scenario: A labelled shape is one shape carrying its label

- **WHEN** Claude adds a shape with a label
- **THEN** the label is bound inside that shape — centred and wrapped against it by the canvas — rather than added as a separate free-standing text element positioned by estimate

#### Scenario: A labelled connector does not erase itself

- **WHEN** Claude adds a connector carrying a label
- **THEN** the label is bound to the connector and sized to its own text, so the connector remains visible behind it

#### Scenario: The bound label reaches the open canvas

- **WHEN** a labelled element is written while the drawing panel is mounted
- **THEN** both the container and its bound label appear on the live canvas, and the scene on screen matches the scene that was persisted

#### Scenario: An accepted field is a stored field

- **WHEN** Claude adds an element declaring rounding, grouping, or a connector route through several vertices
- **THEN** the stored element carries what was declared, rather than a default that silently replaced it

#### Scenario: The vocabulary is declared, not latent

- **WHEN** the write tools are offered to a run
- **THEN** their descriptions state the element vocabulary available, including labels

### Requirement: The canvas conversation is taught how to draw

The runs that can reach the canvas SHALL be given drawing guidance as a scoped
skill, not as a sentence in the verb's clause and not as an instruction to the
voice layer.

The guidance SHALL cover what the tool surface cannot enforce: reading the board
before answering about it or rearranging it, connecting shapes through element
references rather than hand-computed endpoints, spacing and sizing, text that
fits, colour used to carry meaning, and reading the per-element results to repair
a dropped binding or an unknown id.

It SHALL NOT instruct the model to compute connector endpoints at the boundary of
a shape. The server clips a bound connector to the shapes it joins; endpoints
computed by the model would be recomputed and the binding that keeps the
connector attached when the user drags a shape would be lost.

Guidance SHALL NOT be placed in the voice layer's instruction. The voice layer
cannot see the canvas, and describing one agent's work in another agent's
briefing is what the canvas capability already declines to do.

#### Scenario: Drawing guidance is available to the canvas conversation

- **WHEN** a conversation that can reach the canvas tools is configured
- **THEN** the drawing skill is among the skills it may invoke

#### Scenario: Guidance is not routed through the voice layer

- **WHEN** the canvas capability's contribution to the voice layer is built
- **THEN** it contains no instruction on how to compose a drawing
