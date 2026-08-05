## Purpose

The shared referent between the user's hands and their voice: which vault notes are currently selected in the galaxy, so that "connect these two" resolves to actual notes. Owned by the main process because the renderer produces it while the voice layer and Claude's runs both consume it.

## ADDED Requirements

### Requirement: One authoritative focus is shared by the hand, the voice, and the runs

Iris SHALL maintain a single authoritative **focus** — the set of vault notes the user currently has selected — owned by the main process. The renderer SHALL produce it (from hand gestures and from the mouse); the voice layer and Claude's runs SHALL consume it. There SHALL NOT be a second, separately-maintained notion of what is selected.

The focus SHALL be stored as note **identities only**, and resolved to titles and tags at the moment of use against the live vault graph. It SHALL NOT store a snapshot of note metadata: a title captured at selection time goes stale the moment the note is renamed or deleted, and a selection that names a note which no longer exists SHALL resolve to nothing rather than to a phantom.

The focus SHALL survive the galaxy layer remounting, and SHALL be readable whether or not the galaxy is currently mounted, so a mutation or a run that lands slightly after a re-render still acts on what the user selected.

#### Scenario: One focus, many readers

- **WHEN** the user selects two notes and both the voice layer's context and a run's prompt are then built
- **THEN** both describe the same two notes, resolved from the same single focus

#### Scenario: A renamed note resolves to its current title

- **WHEN** a selected note is renamed on disk and the focus is then read
- **THEN** it resolves to the note's current title, not the title it had when selected

#### Scenario: A deleted note drops out of the focus

- **WHEN** a selected note is deleted from the vault and the focus is then read
- **THEN** that note is absent from the resolved focus, and the remaining selections are unaffected

#### Scenario: The focus survives a remount

- **WHEN** the galaxy layer remounts (for example after a re-render) while notes are selected
- **THEN** the selection is still in effect and is not silently emptied

### Requirement: The focus is bounded

The number of notes the focus may hold SHALL be bounded, and what reaches the voice layer's context and a run's prompt SHALL be bounded independently and more tightly.

The focus is injected into the voice layer's context on **every turn**, so an unbounded focus would grow the cost of a conversation turn after turn — the same reason the recent-transcript block carries its own bound at the point of use. Selecting past the bound SHALL drop the oldest selection rather than refusing the new one, because the user's most recent gesture is the one that expresses their current intent.

#### Scenario: Selecting past the bound drops the oldest

- **WHEN** the user selects one more note than the bound allows
- **THEN** the newest selection is held and the oldest is released, rather than the new selection being ignored

#### Scenario: A large focus does not grow the per-turn cost without limit

- **WHEN** the focus is at its bound and the voice layer's context is built
- **THEN** what is included is capped, independently of how many notes the focus holds

### Requirement: The focus is visible before it is spoken about

While the galaxy is active, Iris SHALL show which notes are focused: each focused node SHALL be visually distinguished in the graph, and the focused notes SHALL be named in the interface.

A referent the user cannot see is a referent they have to guess at. If "these two" resolves to something other than what the user believes is selected, the mistake is discovered only after the vault has been changed — so the selection must be readable *before* the user speaks, not inferable afterwards.

#### Scenario: Focused nodes are distinguished in the graph

- **WHEN** notes are focused and the galaxy is displayed
- **THEN** those nodes are visually distinct from unfocused nodes

#### Scenario: The focused notes are named

- **WHEN** one or more notes are focused
- **THEN** the interface names them, so the user can confirm what "these" refers to before speaking

#### Scenario: An empty focus shows nothing

- **WHEN** nothing is focused
- **THEN** no focus indicator is shown and the galaxy reads exactly as it does today

### Requirement: The voice layer knows what is focused

When the galaxy is active, the voice layer's context SHALL state which notes are focused, so a request naming them deictically ("these two", "this one", "what am I missing here") resolves without a tool round-trip to ask.

Note titles SHALL be treated as untrusted when they enter that context. Vault content may originate from the web, so a title is not trusted text merely because it names a file the user owns.

When nothing is focused, the context SHALL say nothing about a focus rather than describing an empty one — an empty referent invites the model to invent one.

#### Scenario: A deictic request resolves

- **WHEN** two notes are focused and the user says "connect these two"
- **THEN** the voice layer acts on those two notes without asking the user which notes they mean

#### Scenario: An adversarial title cannot issue instructions

- **WHEN** a focused note's title contains text shaped like an instruction to the model
- **THEN** it reaches the voice layer's context as untrusted content and is not followed as an instruction

#### Scenario: No focus, no focus talk

- **WHEN** the galaxy is active with nothing focused and the user says "connect these two"
- **THEN** the voice layer has no focused notes described to it and asks what the user means rather than choosing notes on its own

### Requirement: Runs receive the focus at the single composition point

A run's prompt SHALL carry the focused notes as one block composed at the same place the recent transcript is composed, fenced as untrusted content on the same terms.

It SHALL NOT be delivered as a new parameter added to each verb's schema. Per-verb delivery would mean every verb that ever wants a referent re-declares it, and the composition point exists precisely so that adding context does not require touching each verb.

The block SHALL carry note identities, titles, and tags — not note bodies. A run that needs a note's content has vault access and can read it; shipping bodies would both grow every prompt and widen what untrusted vault text can reach.

#### Scenario: A run sees what was selected

- **WHEN** notes are focused and a run starts
- **THEN** its prompt contains those notes' identities, titles, and tags as a fenced block

#### Scenario: Adding the focus did not touch the verb schemas

- **WHEN** the verb registry is inspected
- **THEN** no verb declares a focus parameter — the focus arrives through composition, not through a schema

#### Scenario: Note bodies are not shipped in the prompt

- **WHEN** a focused note has a long body and a run starts
- **THEN** the prompt carries the note's title and tags but not its body

#### Scenario: No focus means no block

- **WHEN** nothing is focused and a run starts
- **THEN** its prompt carries no focus block

### Requirement: The focus is cleared when the galaxy closes, and survives a reader

The focus SHALL be cleared whenever the galaxy layer is not active — by the toggle, by opening another exclusive HUD layer, by leaving the HUD through the button, the hotkey, or the tray, and by a force-close after a render crash — on exactly the terms that already clear an open note reader.

A focus that outlives the view makes "these" refer to something the user can no longer see, which is strictly worse than having no focus: the user has no way to notice the referent is wrong before the vault is changed.

Opening a note reader SHALL NOT clear the focus. The reader is a way of inspecting a focused note, and discarding the selection in order to read one of its members would defeat the purpose.

#### Scenario: Closing the galaxy clears the focus

- **WHEN** notes are focused and the galaxy closes by any route
- **THEN** the focus is emptied, and reopening the galaxy starts with nothing focused

#### Scenario: Reading a focused note keeps the focus

- **WHEN** notes are focused and the user opens one of them in the note reader
- **THEN** the focus is unchanged, and closing the reader returns to the galaxy with the same notes still focused

#### Scenario: A crash does not leave a stale focus

- **WHEN** the galaxy force-closes after a render crash while notes are focused
- **THEN** the focus is emptied along with the layer
