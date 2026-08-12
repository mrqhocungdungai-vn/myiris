## ADDED Requirements

### Requirement: A renderer identifier is named for the feature or for the view, never for the other one

A renderer identifier — a type, a union member, a hook's returned field, a prop, a module — SHALL be named for **what it is**, decided by one test:

> If the view it belongs to were handed a different data source tomorrow, would this name still be true?

Still true ⇒ it is named for the **view** (`galaxy`, `deck`, `orb`). Its meaning depends on notes, a vault, `[[wikilinks]]` or tags ⇒ it is named for the **feature** (`secondBrain`, `drawing`). This applies in both directions: naming a rendering module after the feature it currently serves is the same error as naming a feature after the rendering it currently uses.

**No boundary in the renderer SHALL restate one fact in two vocabularies.** A line whose only work is assigning one name's value to the other name (`secondBrainActive: hud.galaxyActive`) is the observable symptom of this requirement being violated, and its presence is what makes the violation checkable rather than a matter of taste.

The consequence this protects is specific. A resolver that takes feature state in and returns a view name out (`if (secondBrainActive) return "galaxy"`) is correct only while exactly one feature uses that view. The moment a second one does, the resolver must answer the same view name for two features whose bindings differ, and the fix is no longer a rename — it is a change of logic with a live user-facing defect in front of it. Naming per this test keeps that fix a rename indefinitely.

`src/lib/webgl-quality.ts` is the worked example on the view side — its `galaxy` key sits beside `orb` and `deck` as a peer WebGL surface and is about render quality, so `galaxy` is correct there and SHALL NOT be renamed toward the feature.

**This requirement governs code identifiers only.** It does not govern prose — in a spec, a comment, or a user-facing string — and it does not govern capability folder names. The distinction is deliberate rather than an omission: an identifier is a name a compiler and every call site must agree on, so an ambiguous one becomes a defect the moment two things answer to it, whereas prose describing what a user currently sees stays true for as long as that is what they see. A requirement written wide enough to cover prose would be violated by the living spec on the day it landed — `second-brain-gesture-nav` alone contains 36 sentences of the form "the galaxy is active" — and a rule the tree does not satisfy is worse than no rule, because it stops being read.

#### Scenario: The name survives a change of data source

- **WHEN** a renderer identifier belonging to a view is read
- **THEN** its name is still true if that view were given a different data source, or else it names the feature whose data it depends on

#### Scenario: No boundary translates between two names for one thing

- **WHEN** a value crosses between a hook, a router and a component
- **THEN** it keeps one name, and no call site exists whose only work is renaming it

#### Scenario: A context resolver's input and output share one vocabulary

- **WHEN** a resolver derives an interaction context from feature state
- **THEN** the context values it returns are interaction contexts named on the same axis as its inputs, not the name of a rendering technique

#### Scenario: A rendering module keeps its view name

- **WHEN** a module speaks only in nodes, links, camera, geometry or render quality
- **THEN** it keeps its view name and is not renamed after whichever feature currently supplies its data
