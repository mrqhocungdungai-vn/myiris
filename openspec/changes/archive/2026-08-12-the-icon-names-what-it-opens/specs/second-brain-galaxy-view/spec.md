## ADDED Requirements

### Requirement: The second-brain control identifies the feature, not the view

The Glass HUD control that opens and closes the second brain SHALL identify **the feature** — the user's vault of notes — rather than the rendering the feature currently uses. Its icon and its label SHALL therefore describe the same thing; a glyph depicting the graph rendering alongside a label naming the second brain SHALL NOT be used.

This is not a matter of taste. The rendering is generic and reusable, so a second feature drawn the same way is possible; at that point two controls would open visually similar views and the only thing distinguishing them is which feature they open. An icon that pictures the shared rendering identifies neither. The control SHALL therefore encode what differs between controls, which is always the feature.

The rule constrains what the control depicts, not which specific glyph is chosen: a later change may pick a different feature-naming icon without contradicting this requirement.

#### Scenario: The icon and the label name the same thing

- **WHEN** the user looks at the second-brain control in the Glass HUD
- **THEN** its icon depicts the feature the control opens, and its tooltip names that same feature — the two do not describe different things

#### Scenario: The icon does not depict the rendering

- **WHEN** the second-brain control is rendered
- **THEN** its glyph is not a depiction of the graph rendering (a node-and-edge diagram), because that rendering is not what distinguishes this control from another that used it
