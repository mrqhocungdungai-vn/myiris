## MODIFIED Requirements

### Requirement: The open canvas is a live conversation, not a series of errands

While the drawing surface is open and the pipeline is available, Iris SHALL hold a **resident shaping conversation** ready for it: the session, its project scaffold, and its canvas tools SHALL be prepared when the surface opens, so that the user's first sentence is answered by an existing conversation rather than paying to create one.

Closing the surface SHALL NOT end the conversation. Residency ends for the reasons it already ends for — a different conversation taking the session, the workstream or working directory changing, the credential changing, or the app quitting — and the passage of time is not one of them.

Entering canvas mode SHALL be announced **once**, and SHALL NOT be repeated while the mode remains entered. The panel may be activated many times for reasons unrelated to the user opening it; a greeting repeated mid-conversation is an interruption rather than a greeting.

The review gate SHALL be asked once, when the conversation opens, and SHALL NOT be re-asked per utterance. A conversation the user declined to open SHALL NOT be opened again by the next sentence without asking.

#### Scenario: The first sentence does not pay for a cold start

- **WHEN** the user opens the drawing surface with the pipeline available and then speaks about the canvas
- **THEN** the utterance is delivered into an already-open conversation, with the canvas tools already attached

#### Scenario: Closing and reopening the surface resumes the same conversation

- **WHEN** the user closes the drawing surface and reopens it
- **THEN** the same conversation continues, with its context intact and without asking the review gate again

#### Scenario: The mode is announced once

- **WHEN** the drawing surface activates repeatedly while canvas mode remains entered
- **THEN** the user is told once, and not again

#### Scenario: No credential, no warm session

- **WHEN** the drawing surface is opened while the pipeline is unavailable
- **THEN** no session is opened and no review is requested

#### Scenario: A pipeline that arrives late still gets the conversation ready

- **WHEN** the drawing surface is opened before Claude is reachable, and Claude becomes reachable while it is still open
- **THEN** the conversation is prepared then, rather than the first sentence paying for it

## ADDED Requirements

### Requirement: Speaking over Iris stops her speech, not the work

The signal that Iris's spoken turn was pre-empted SHALL NOT be treated as a request to cancel work. It fires whenever her audio is cut off, which in ordinary conversation is constant — an acknowledgement, a follow-up, the user thinking aloud over the answer — and cancelling an in-flight turn on it destroys work the user asked for and leaves them watching it stop for no stated reason.

The voice layer stops speaking on its own. Nothing about an interruption SHALL reach the run layer as a cancellation. Cancelling work on the user's behalf SHALL require a signal that means the user redirected the work, not one that means a sentence was cut off.

#### Scenario: Talking over the answer does not stop the answer

- **WHEN** the user speaks while Iris is talking and a turn is in flight
- **THEN** Iris stops speaking, the turn continues, and its result still arrives

#### Scenario: The record still closes

- **WHEN** an interruption occurs
- **THEN** what was said is flushed to the transcript and the app returns to listening

## REMOVED Requirements

### Requirement: Speaking over Iris ends the turn, not the conversation

**Reason**: Replaced by "Speaking over Iris stops her speech, not the work". The requirement read `interrupted` as "the user redirected me" and cancelled the in-flight turn on it. The first real session showed what that signal actually means: Iris's audio turn was pre-empted, which happens constantly in conversation. It killed a turn three seconds in while the user was still explaining what they wanted, and their next sentence asked what the error was. A requirement written from reasoning, corrected by measurement.
