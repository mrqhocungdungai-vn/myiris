## ADDED Requirements

### Requirement: A turn's transcript is current when it is composed

The verbatim record SHALL be flushed before a tool call is dispatched, so that the sentence which caused the turn is present in the transcript the turn is composed from. A turn SHALL NOT be composed from a transcript that is missing its own trigger.

This survives the removal of the rule that made that transcript lead. Attaching a transcript that stops one sentence short of the request is worse than attaching none: a run reading it sees the conversation up to the moment of interest and nothing at the moment itself, which reads as though the request was never made. Corroboration that is systematically missing the thing it should corroborate is not corroboration.

Fencing is unchanged, and so is standing: the flushed transcript accompanies the call, it does not outrank it.

#### Scenario: The triggering sentence is in the turn

- **WHEN** the user says something that causes a canvas turn to start
- **THEN** that sentence is present in the transcript material the turn carries

#### Scenario: Being current does not make it the instruction

- **WHEN** the flushed transcript differs from the call's parameters
- **THEN** the turn follows the parameters, with the transcript carried as material that may be mistaken

## REMOVED Requirements

### Requirement: In a live canvas conversation, the user's own words lead

**Reason**: It rests on a premise about the voice layer that does not hold. The rule treats the transcript as "the user's own words" and the voice layer's parameters as a paraphrase to be outranked. But the voice layer is a speech model reasoning over the audio directly; the transcript is a separate, optional recognizer pass over the same audio, and it is the one that fails silently. The rule therefore gave authority to the less reliable of the two, and named it the more reliable one.

The failure it produced was not subtle once the two diverged structurally rather than by mishearing. Overheard speech is deliberately withheld from the recent-utterance ring, while the ring's retention window outlasts a listening window — so after a listen-only engagement the block promoted to "the instruction" was speech from before the interruption, unrelated to the request, with the run explicitly told to prefer it over the call that had just been made. The drawing that came back was faithful to what the run was told to trust.

**Migration**: The instruction is now the call's parameters, for every verb, under `verb-tool-surface`'s "The voice layer's tool call carries the instruction". Where a canvas turn previously depended on the verbatim block to carry detail the call had dropped, that detail is now carried by the call itself — the schema was widened for exactly this, and it is where thinness is fixed. The flush-before-dispatch half of the removed requirement is kept above, on its own terms.
