## ADDED Requirements

### Requirement: Verbs sharing a conversation declare one skill surface

The skills of a resident session SHALL be resolved when the session opens, and
SHALL NOT be assumed to change on a later turn. Where two verbs share one
resident conversation, the skills that conversation can invoke are those of
whichever verb **opened** it — so the verbs sharing it SHALL declare a skill
surface that serves the conversation, not one that serves whichever verb the
skill was written for.

A skill declared on only one of two verbs sharing a session is present or absent
depending on which medium the user happened to start in. That is not a scoping
decision; it is a coin toss, and it fails on the path the shared session exists
to serve — a conversation that begins by voice and moves to the shared visual
medium when talking stops being enough.

This is distinct from the tool servers a verb declares, which are attached to a
live session on the turn that needs them. No equivalent repair exists for skills,
and the skill surface SHALL NOT be described as if one did.

#### Scenario: The drawing conversation is equipped whichever medium opened it

- **WHEN** a conversation begins by voice and a later turn moves it to the shared visual medium
- **THEN** that turn can invoke the same skills it could have invoked had the visual medium opened the conversation

#### Scenario: A shared surface is declared, not inherited by accident

- **WHEN** the skills for verbs sharing one resident conversation are resolved
- **THEN** each declares the same surface, rather than one carrying a skill the other lacks
