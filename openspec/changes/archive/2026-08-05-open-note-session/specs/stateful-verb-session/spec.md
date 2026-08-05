## MODIFIED Requirements

### Requirement: The live session's lifecycle is user-controlled

The live session's **conversation** SHALL persist until an explicit user-controlled reset. Reset — ending a conversation, so that the next turn starts a fresh one with nothing carried over — SHALL occur only on the existing triggers: the UI "New" session action, a voice new-session request, or selecting a different project folder.

**Residency** is a separate thing from the conversation, and SHALL be specified separately. Exactly one conversation is resident at a time. A conversation that is asked for while a different one is resident SHALL take the resident slot, and the outgoing conversation SHALL be **retained and resumable**: its stored session id SHALL survive, so the next turn addressed to it continues it with its context intact.

Losing residency is therefore NOT a reset, and SHALL NOT be described or implemented as one. A reset discards a conversation; a handoff only stops holding a subprocess open for a conversation nothing is currently talking to. The two are distinguished by what happens to the stored session id: a reset clears it, a handoff leaves it alone.

A conversation SHALL NOT be torn down automatically **as a way of ending it**. It MAY lose residency automatically, on a request for a different conversation — and this SHALL be the only automatic cause. Time passing, unrelated activity, and a stateless run executing in between SHALL NOT end residency.

A resident conversation SHALL NEVER be delivered a turn belonging to a different conversation. Reusing whichever session happens to be resident, without checking that it is the conversation being addressed, would run that turn with the wrong context, the wrong model, and the wrong scoped skills, and would record it against the wrong stored conversation. Which conversation a resident session belongs to SHALL be checked before a turn is delivered into it, not assumed from the fact that a session exists.

#### Scenario: Session survives across unrelated activity

- **WHEN** other activity occurs between two stateful turns (e.g. a stateless run executes, or time passes)
- **THEN** the live session remains resident and the next stateful turn continues the same conversation

#### Scenario: User resets the session

- **WHEN** the user starts a new session, requests a new session by voice, or picks a different project folder
- **THEN** the current live session is ended and the next stateful turn opens a fresh session

#### Scenario: Live session ends cleanly on app shutdown

- **WHEN** the app quits while a live session is resident
- **THEN** the session is closed without leaving an orphaned Claude process

#### Scenario: A different conversation takes the resident slot

- **WHEN** a turn is submitted for a conversation other than the one currently resident
- **THEN** the incoming conversation becomes resident, and the outgoing one keeps its stored session id so it can be resumed

#### Scenario: A handoff is not a reset

- **WHEN** a conversation has lost residency to another and is then addressed again
- **THEN** it resumes with its own context intact, having lost nothing but the subprocess

#### Scenario: A turn is never delivered into the wrong conversation

- **WHEN** a turn is submitted for one conversation while a different one is resident
- **THEN** it is not delivered into the resident session, and the conversation it belongs to is the one that receives it

#### Scenario: Losing residency is not reported as an ended session

- **WHEN** a conversation loses residency to another
- **THEN** nothing reports it as reset, ended, or lost, because its conversation was not
