## ADDED Requirements

### Requirement: The open canvas is a live conversation, not a series of errands

While the drawing surface is open and the pipeline is available, Iris SHALL hold a **resident shaping conversation** ready for it: the session, its project scaffold, and its canvas tools SHALL be prepared when the surface opens, so that the user's first sentence is answered by an existing conversation rather than paying to create one.

Closing the surface SHALL NOT end the conversation. Residency ends for the reasons it already ends for — a different conversation taking the session, the workstream or working directory changing, the credential changing, or the app quitting — and the passage of time is not one of them.

The review gate SHALL be asked once, when the conversation opens, and SHALL NOT be re-asked per utterance. A conversation the user declined to open SHALL NOT be opened again by the next sentence without asking.

#### Scenario: The first sentence does not pay for a cold start

- **WHEN** the user opens the drawing surface with the pipeline available and then speaks about the canvas
- **THEN** the utterance is delivered into an already-open conversation, with the canvas tools already attached

#### Scenario: Closing and reopening the surface resumes the same conversation

- **WHEN** the user closes the drawing surface and reopens it
- **THEN** the same conversation continues, with its context intact and without asking the review gate again

#### Scenario: No credential, no warm session

- **WHEN** the drawing surface is opened while the pipeline is unavailable
- **THEN** no session is opened and no review is requested

### Requirement: The user hears the work as it happens

While the canvas conversation is live, what Iris is doing SHALL reach the user **as it happens**, not only when a turn ends. Both what she draws (her acts on the canvas) and what she says (her answer as it forms) SHALL be spoken during the turn.

Speech in this mode SHALL relay Iris's own words rather than a re-summarization of them. Where speech cannot keep pace with the stream, the app SHALL degrade to reporting acts rather than falling behind or queueing stale speech.

#### Scenario: Drawing is narrated while it happens

- **WHEN** Iris adds elements to the canvas during a turn
- **THEN** the user hears what she is adding while she adds it, rather than a summary afterwards

#### Scenario: The same moment is not narrated twice

- **WHEN** the worker says what it is about to do and then does it
- **THEN** the user hears the worker's own sentence, and not a second, poorer restatement of it

#### Scenario: A short turn is narrated too

- **WHEN** a turn begins and ends faster than the interval that paces the narration
- **THEN** the user still hears what was being done, rather than silence

#### Scenario: The answer is spoken as it forms

- **WHEN** Iris composes an answer during a canvas turn
- **THEN** the user hears it as it forms, in her words

#### Scenario: Falling behind degrades to acts, not to lag

- **WHEN** speech cannot keep pace with the stream
- **THEN** the user continues to hear what is being done, and stale narration is dropped rather than queued

### Requirement: Speaking over Iris ends the turn, not the conversation

While a canvas turn is running, the user speaking SHALL end that turn and SHALL leave the conversation open, with its context and everything already drawn intact. The interrupted turn SHALL be reported as interrupted — never as completed, and never as failed.

#### Scenario: Barge-in stops the turn and keeps the thread

- **WHEN** the user speaks while Iris is mid-turn
- **THEN** the turn stops, what was already drawn remains, and the next sentence continues the same conversation

## MODIFIED Requirements

### Requirement: Claude reads the current canvas fresh on call
The MCP server SHALL expose a read tool returning the **current** canvas from Iris's in-memory scene cache (not a stale or debounce-delayed copy), safe to call whether or not the drawing panel is mounted. The result SHALL be the canonical excalidraw JSON (elements — including arrow `startBinding`/`endBinding` connectivity — and embedded `files`), and MAY optionally include a rendered image (PNG or SVG) of the canvas for visual layout.

Reading the canvas SHALL remain a tool the conversation calls when a turn needs it. The app SHALL NOT push the canvas into the conversation on every edit: a turn per stroke spends a conversation on transcription rather than on thought.

#### Scenario: Read reflects the latest edits

- **WHEN** the user (or a prior tool call) has changed the canvas and Claude then calls the read tool
- **THEN** the returned scene reflects those latest changes

#### Scenario: Read works while the panel is closed

- **WHEN** the read tool is called while the drawing panel is hidden/unmounted
- **THEN** the last known scene is returned without error

#### Scenario: Drawing does not itself start a turn

- **WHEN** the user draws on the canvas without saying anything
- **THEN** no turn is started and nothing is spent
