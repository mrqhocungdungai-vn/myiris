## ADDED Requirements

### Requirement: A decisions follow-up names the verb it should go to

When a completion announcement carries decisions a run deferred to the user, the
instruction telling Iris to submit the user's choices back SHALL name the verb
that produced them. It SHALL NOT direct the follow-up to an implicit addressee
such as "the same role", which has no referent on a surface where the verb is
chosen per request.

The verb is available: the announcement is built from a finalized run, and every
dispatch already records the verb it ran. Leaving the addressee implicit makes
Iris choose one by guesswork, and the wrong choice is not harmless — a decision
the user made while shaping a change can be handed to the implementing verb,
which acts on it rather than continuing to shape.

#### Scenario: Deferred decisions route back to the producing verb

- **WHEN** a run finalizes having deferred decisions, and the completion is announced
- **THEN** the instruction to submit the user's choices names the verb that produced the decisions

#### Scenario: The prose fallback names it too

- **WHEN** a run's result carries a "Decisions needed" section rather than structured decisions
- **THEN** the instruction to collect and submit the choices names the same verb, so the two paths do not differ in where the follow-up lands
