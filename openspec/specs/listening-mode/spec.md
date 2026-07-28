## Purpose

Iris's Gemini Live session normally treats every pause in speech as an invitation to answer, which breaks a user's train of thought when they are thinking aloud or presenting for an extended stretch rather than conversing. Listening mode puts the session into a listen-only configuration where Iris accumulates everything it hears and is structurally incapable of taking a turn the user did not ask for, until they end the mode and Iris synthesizes what it heard. Because the underlying Gemini Live connection only lasts about ten minutes, a listening session is chunked into rotations that are inaudible and invisible to the user.

## Requirements

### Requirement: Iris hears everything while listening mode is engaged and cannot speak

While listening mode is engaged, the app SHALL configure the Gemini Live session so that Iris receives
and retains everything the user says, and SHALL make it impossible for Iris to produce a spoken turn
the user did not ask for.

That impossibility SHALL be a property of the session configuration, not an instruction in the system
prompt: the session SHALL disable server-side automatic activity detection, and while a chunk's
activity is open the app SHALL NOT emit any signal that completes a user turn. A configuration in
which Iris merely *tends* not to interrupt — for example one that only lengthens the tolerated pause
before the server commits a turn — SHALL NOT satisfy this requirement, because a long enough silence
still produces speech.

The only turns the app itself drives are the entry confirmation, which completes before the first
activity is opened, and the chunk boundaries, whose output is suppressed. Neither is audible as an
interruption of the monologue.

Microphone capture and streaming SHALL be unchanged by this mode; only what the server does with the
audio it already receives changes.

#### Scenario: A monologue with pauses is never interrupted

- **WHEN** listening mode is engaged and the user speaks for an extended period with natural pauses
- **THEN** Iris produces no audible output for the whole period, no matter how long any individual
  pause lasts

#### Scenario: Silence does not depend on the prompt

- **WHEN** the listening system instruction is replaced with text that says nothing about staying quiet,
  and a chunk's activity is open
- **THEN** no turn completes, because the session's configuration is what prevents it

#### Scenario: Microphone behavior is unaffected

- **WHEN** listening mode is engaged or disengaged
- **THEN** the renderer's microphone capture constraints, device selection, and streaming are
  identical to what they were before

### Requirement: Retention requires an explicitly opened activity

Because the session disables automatic activity detection, streamed audio counts as user input only
inside an activity the client has explicitly opened. On entering listening mode, and again after every
chunk boundary, the app SHALL open an activity, so that everything the user says accumulates in the
model's context.

Driving a turn without an opened activity — for example by sending client content and relying on the
accumulated stream — SHALL NOT be used, because the server discards audio streamed outside an
activity. A mode that connects, stays quiet, and answers when asked while having retained nothing
SHALL be treated as a defect, not as working behavior.

#### Scenario: What was said during listening is recalled afterwards

- **WHEN** the user states specific details aloud while listening mode is engaged, and then ends the
  mode
- **THEN** Iris's synthesis references those specific details, demonstrating the audio reached the
  model's context

### Requirement: The whole stream counts, including pauses

The listening session SHALL be configured so that the user's turn includes all realtime input since
the last turn rather than only detected activity, so material separated by long pauses is retained
rather than dropped along with the silence between it.

#### Scenario: Material either side of a long pause is retained

- **WHEN** the user speaks, falls silent for a long stretch, then speaks again, all within one chunk
- **THEN** both stretches of speech are available to Iris when the mode ends

### Requirement: Listening is chunked, because one activity cannot outlive the connection

The Gemini Live connection has a lifetime of roughly ten minutes, which is shorter than the monologues
this mode exists for. The app SHALL therefore divide a listening session into chunks, rotating at a
configurable interval chosen with margin below that lifetime, and SHALL also rotate immediately if the
server signals an impending disconnect.

Rotation SHALL NOT be left to the server's disconnect signal alone, since the time that signal leaves
for the rotation to complete is not something the app can rely on.

The app SHALL NOT allow the session to close while an activity is open. A connection lost in that
state leaves the current chunk uncommitted and unrecoverable from the model's context.

#### Scenario: A monologue longer than the connection lifetime is retained whole

- **WHEN** the user speaks continuously for longer than one connection lifetime
- **THEN** the material from before the first rotation is still available to Iris when the mode ends

#### Scenario: An impending disconnect triggers an immediate rotation

- **WHEN** the server signals that the connection is about to be dropped while a chunk is open
- **THEN** the app rotates at once rather than waiting for its own interval to elapse

### Requirement: Every boundary captures a resumption handle before the session is disconnected

The server issues no resumption checkpoint while an activity is open; a resumable handle becomes
available only once the activity has been closed and the resulting turn has completed. A boundary
SHALL therefore, in order: close the activity, wait for the resulting turn to complete, **wait for a
resumption handle issued after that activity was closed**, and only then disconnect.

The freshness condition is part of the requirement, not a detail. The app already holds a handle from
before the mode was entered, so a check for "a handle exists" is satisfied the instant the boundary
begins and disconnects immediately — reproducing the very failure this ordering prevents, while
appearing to implement it. The handle waited for SHALL be one that arrived after the `activityEnd` for
the chunk being committed.

Disconnecting at turn completion without waiting for a fresh handle SHALL NOT be done. It produces
total context loss that presents identically to a correctly working mode — sessions connect, Iris
stays quiet, Iris answers when asked — which is why the ordering is specified rather than left to
implementation.

The handle so captured SHALL be carried into the next connection, whether that is the next chunk or
the return to ordinary conversation.

#### Scenario: The boundary waits for a handle issued after the commit

- **WHEN** a chunk boundary occurs while the app already holds a handle from earlier in the session
- **THEN** the app still waits for a handle issued after this chunk's `activityEnd`, and disconnects
  only once it has one or a bounded wait has elapsed

#### Scenario: Context survives repeated rotations

- **WHEN** the user speaks across several chunk rotations and then ends the mode
- **THEN** Iris can answer a question that only the earliest chunk's content can answer

### Requirement: Every boundary turn is neither heard nor shown

A boundary forces a model turn the user did not ask for — this is true of the boundary that ends the
mode as much as of a rotation, because both are `activityEnd`. The app SHALL suppress every boundary
turn's audio and SHALL NOT surface its text as a transcript line, so no boundary is perceptible.

The app SHALL also ignore any tool call arriving during a boundary turn. The listening session
otherwise carries the same tool surface as conversation, so a forced turn could start real background
work the user never asked for; suppressing only audio and text would hide the speech while letting the
side effect through. Giving the listening configuration an empty tool set satisfies this, and costs
nothing, since no tool can be invoked during a chunk anyway.

Suppression SHALL happen in the main process, before any part of the turn is forwarded to the
renderer. Relying on the renderer's speaker-mute suppression is insufficient: the main process
independently accumulates the turn's text into the transcript it emits, and reports a speaking state
for each audio chunk, so a rotation would still produce a transcript line and a visible state change
even with every audio frame discarded downstream. Suppressing in main also keeps the behavior
independent of whether the renderer is alive and of what the user has muted.

The listening system instruction SHALL additionally ask Iris to answer a boundary as briefly as
possible, to keep the forced turn cheap. This is an optimisation only: a boundary reply that came back
long SHALL waste tokens rather than break the mode, because suppression does not depend on brevity and
silence during a chunk does not depend on the prompt.

Because every boundary turn is suppressed, the synthesis the user hears when the mode ends is **not** a
boundary turn. It is driven after the return to the conversation configuration — see the requirement on
ending the mode.

#### Scenario: A rotation passes unnoticed

- **WHEN** a rotation boundary occurs mid-monologue
- **THEN** the user hears nothing, no transcript line appears, and the orb does not change to a
  speaking state

#### Scenario: A boundary turn cannot start background work

- **WHEN** a boundary turn attempts a tool call
- **THEN** no tool runs and no background work starts

#### Scenario: Suppression does not depend on the renderer

- **WHEN** a rotation boundary occurs
- **THEN** the turn's audio and text are withheld in the main process, so no renderer state — mute or
  otherwise — can cause them to surface

#### Scenario: Suppression does not depend on the prompt

- **WHEN** a boundary turn returns more than the brief reply the instruction asked for
- **THEN** its audio is still suppressed and its text is still withheld

### Requirement: Segment records live in process memory only

The app SHALL accumulate each chunk's input transcription in process memory for the life of the
listening session, as the recovery path for material the model's own context may not have.

It has exactly two consumers, and no others SHALL be added without a stated reason:

1. The closing synthesis, when a boundary's bounded wait elapsed and the chunk may therefore not have
   been committed.
2. The synthesis produced when the mode ends because of an unexpected disconnect, where the model's
   context is missing everything since the last successful boundary.

That record SHALL NOT be written to disk, SHALL NOT be added to the user's notes vault, and SHALL be
discarded once the closing synthesis has been delivered, or when the app stops — whichever comes first.
Nothing SHALL depend on it being verbatim, since the transcription is normalised rather than literal.

#### Scenario: A chunk not committed before a drop is still synthesized

- **WHEN** the connection is lost while an activity is open, ending the mode
- **THEN** the synthesis that follows reflects what was said in the uncommitted chunk, from the
  in-memory record

#### Scenario: Nothing is written to disk

- **WHEN** a listening session runs and ends
- **THEN** no transcript, audio, or summary of it is written to disk or added to the notes vault

#### Scenario: The record does not outlive its purpose

- **WHEN** the closing synthesis has been delivered
- **THEN** the accumulated segment record is discarded

### Requirement: Ending listening mode commits what was heard and Iris speaks its synthesis

Ending listening mode SHALL, in order: perform a final boundary exactly like a rotation — including
suppressing its turn — then reconnect into the ordinary conversation configuration carrying the
captured handle, and only then drive the turn in which Iris speaks its synthesis of everything it heard
across all chunks.

The synthesis SHALL NOT be driven at the boundary. At that moment the session still carries the
listening system instruction, which asks for the briefest possible reply, and nothing distinguishes the
final boundary from a rotation for the model — so a synthesis requested there would be answered with
the same one-word acknowledgement a rotation gets. Driving it after the reconnect also means the
synthesis is an ordinary conversation turn, so speaker mute, barge-in, and transcript rendering all
behave as they normally do with no special handling.

Committing is **required, not optional**: closing the session without closing the activity discards the
current chunk. There SHALL therefore be no path out of the mode that skips the boundary, and any future
change that adds one SHALL first establish another way to commit the context.

#### Scenario: Ending the mode produces a synthesis

- **WHEN** the user ends listening mode after having spoken during it
- **THEN** the session returns to ordinary conversation first, and Iris then speaks a synthesis of what
  it heard

#### Scenario: The final boundary itself is silent

- **WHEN** the final boundary's turn arrives
- **THEN** it is suppressed exactly as a rotation's is, so the user hears the synthesis once and not a
  boundary acknowledgement before it

#### Scenario: A follow-up question after the mode ends still has the context

- **WHEN** the user asks a follow-up question about their monologue after listening mode has ended
- **THEN** Iris answers from what it heard during the mode, without the user restating it

#### Scenario: The mode never ends by discarding what was heard

- **WHEN** listening mode ends by any route
- **THEN** the open activity is closed first, so the current chunk is committed rather than lost

#### Scenario: Speaker mute still silences the synthesis

- **WHEN** the user ends listening mode while speaker mute is engaged
- **THEN** the synthesis is generated and the context is committed, and the audio is suppressed by
  speaker mute exactly as any other Gemini output would be

### Requirement: Entering listening mode is confirmed once, then Iris goes silent

On entering listening mode the app SHALL have Iris speak one short confirmation that it is now
listening and will synthesize when the mode ends, and SHALL then fall silent for the rest of the mode.
The confirmation SHALL complete before the first activity is opened, so it does not consume the user's
opening words.

#### Scenario: Entry is confirmed aloud exactly once

- **WHEN** the user engages listening mode
- **THEN** Iris speaks one short confirmation and then produces no audible speech until the mode ends

#### Scenario: The confirmation does not swallow the user's first words

- **WHEN** the entry confirmation is still being spoken
- **THEN** the activity has not yet been opened, and it is opened only once the confirmation's turn
  has completed

### Requirement: Mode transitions are atomic

Entering, exiting, and rotating are each multi-step asynchronous sequences. While one is in progress
the app SHALL ignore further toggle requests from every control surface, so a transition cannot be
interleaved with another and leave an activity opened after the mode has already been turned off, or
two reconnects racing each other.

#### Scenario: A toggle during a transition is ignored

- **WHEN** the user toggles listening mode from any surface while a transition is still in progress
- **THEN** the request is ignored and the in-progress transition completes normally

#### Scenario: A toggle during a rotation is ignored

- **WHEN** the user ends listening mode at the moment a rotation boundary is executing
- **THEN** the request is ignored, the rotation completes, and the mode remains engaged with a new
  activity open — the user's next toggle ends it normally

### Requirement: A failed transition leaves a coherent state

If connecting into the listening configuration fails, the app SHALL leave listening mode disengaged
with ordinary conversation restored, rather than reporting the mode engaged over a session that is not
listening. If a boundary's turn or its resumable handle does not arrive within a bounded wait, the app
SHALL proceed with the remaining steps rather than waiting indefinitely, and SHALL record what was
missing.

A toggle from any surface SHALL run the full ending sequence. **Sleep and app quit SHALL NOT**: they end
the mode and drop the session, and the current chunk is lost. Committing on those routes would
accomplish nothing observable — the resumption handle does not outlive the process, quit runs under a
bounded teardown deadline shared with other subsystems, and at sleep the renderer's audio pipeline is
torn down before the session is stopped, so no synthesis could be heard. Requiring a commit there would
be a rule whose only evidence of being followed is the code that follows it.

#### Scenario: Entry fails and the mode does not engage

- **WHEN** the reconnect into the listening configuration fails
- **THEN** listening mode reports disengaged, ordinary conversation is restored, and the failure is
  surfaced rather than leaving the control showing an engaged mode

#### Scenario: A boundary's handle never arrives

- **WHEN** a boundary's resumable handle does not arrive within the bounded wait
- **THEN** the app continues with the reconnect rather than hanging, and records that the handle was
  missing

#### Scenario: Sleeping ends the mode

- **WHEN** the user sleeps Iris by hotkey or tray while listening mode is engaged
- **THEN** the mode ends with the session, and the next wake starts in ordinary conversation

### Requirement: An unexpected disconnect ends listening mode

If the Live session closes unexpectedly while listening mode is engaged — the machine slept, the
network dropped, the server terminated the connection — the app SHALL end listening mode: reset the
state to disengaged, let the existing failure-reconnect path restore ordinary conversation, and make
the change visible on every control surface.

The mode SHALL NOT be silently carried across such a disconnect. Both alternatives are broken and
neither is detectable by the user: reconnecting in the conversation configuration leaves the mode
reporting engaged while Iris resumes interrupting, and reconnecting in the listening configuration
without opening an activity means every subsequent byte is discarded, taking the input transcription
— and therefore the segment record — with it.

Once ordinary conversation is restored, Iris SHALL speak a synthesis drawn from the segment record, so
the user is told what was captured rather than silently losing the session. The model's own context is
missing everything since the last successful boundary, which is what the record exists for.

This requirement is why the mode needs no protection against the machine sleeping: a sleep that
outlives the connection ends the mode, so neither the rotation timer's behavior across suspension nor
any power-management API is load-bearing.

#### Scenario: The machine sleeps mid-monologue

- **WHEN** the machine sleeps while listening mode is engaged, and the connection is lost
- **THEN** on reconnect the mode is disengaged, ordinary conversation is restored, and the controls no
  longer show a listening state

#### Scenario: The mode never survives a disconnect silently

- **WHEN** the session closes unexpectedly while engaged
- **THEN** the app does not continue reporting the mode engaged over the reconnected session

#### Scenario: What was heard before the disconnect is not discarded

- **WHEN** listening mode ends because of an unexpected disconnect
- **THEN** once conversation is restored Iris speaks a synthesis drawn from the segment record, rather
  than the session being lost without a word

### Requirement: No announcement text is injected while the mode is engaged

While listening mode is engaged, the app SHALL NOT send announcement text into the Live session. Text
realtime input is not gated by activity detection, so an injected announcement either completes a turn
and interrupts the monologue or is discarded and lost.

This constrains announcements only. The mode's own signals — the entry confirmation, `activityStart`,
`activityEnd`, and the synthesis driven after the return to conversation — are how the mode works and
are governed by their own requirements.

#### Scenario: An announcement raised while engaged does not interrupt

- **WHEN** an app-side state change would announce itself to the voice layer while listening mode is
  engaged
- **THEN** nothing is sent into the listening session and the monologue is not interrupted

#### Scenario: A rotation does not flush pending announcements

- **WHEN** a rotation boundary reconnects while announcements are pending
- **THEN** they remain pending rather than being delivered into the listening session

### Requirement: Listening mode is ephemeral per session

Listening mode SHALL reset to disengaged whenever the session ends — by explicit user stop or by a
server-initiated teardown — so it resets on the transition to not-running rather than only on an
explicit stop. Toggling it SHALL be a no-op while the session is asleep, so a wake always starts in
ordinary conversation. It SHALL NOT be persisted to configuration; a fresh launch always starts
disengaged.

#### Scenario: A session ending clears listening mode

- **WHEN** the session ends while listening mode is engaged, whether by user stop or server-initiated
  teardown
- **THEN** listening mode resets to disengaged and the next wake starts in ordinary conversation

#### Scenario: Toggling while asleep does nothing

- **WHEN** the user triggers a listening-mode toggle from any surface while the session is asleep
- **THEN** the state does not change

#### Scenario: Listening mode is never persisted

- **WHEN** the app is relaunched after having been in listening mode
- **THEN** it starts in ordinary conversation, since the state was never written to configuration

### Requirement: Listening mode is reachable from three control surfaces

Listening mode SHALL be toggleable three ways with identical effect: (1) a renderer control shown
beside the existing microphone-mute and speaker-mute controls in both the deck and the HUD, rendered
as a human-ear icon that is crossed out while the mode is disengaged, (2) a tray item whose label
reflects the current state and which SHALL be disabled while the session is asleep, and (3) a global
hotkey configurable via `IRIS_LISTEN_HOTKEY`, which SHALL have a working default so the shortcut
exists without configuration.

The main process SHALL be the sole owner of the mode's state. The tray item and the global hotkey
SHALL act on the main process directly, **not** by dispatching to the renderer. The main process owns
the session, the rotation timer, and the transitions, and the window can be closed while the app keeps
running, so a control that routes through the renderer stops working exactly when the mode is still
active and the user most needs to end it.

The renderer SHALL NOT report the mode's state back to the main process. It displays what the main
process pushes and requests a toggle; it never asserts the value. A renderer that reported state would
be a second writer for state it does not own, and would overwrite the authoritative value on mount or
after a reload while a chunk was still open.

The renderer SHALL be able to query the current state, so a window opened or reloaded while the mode is
engaged shows it correctly rather than defaulting to disengaged.

This control is the mode's only affordance. There SHALL NOT be a separate "answer now" control:
ending the mode is what permits Iris to speak.

#### Scenario: Toggle from the renderer control

- **WHEN** the user clicks the ear control in the deck or the HUD
- **THEN** listening mode toggles and the control reflects the new state

#### Scenario: Hotkey toggle from another app

- **WHEN** the user presses the configured listening hotkey while a different application has focus
- **THEN** listening mode toggles

#### Scenario: The mode can be ended with no window open

- **WHEN** listening mode is engaged and the user closes the window, leaving the app running
- **THEN** the tray item and the global hotkey still end the mode

#### Scenario: A reopened or reloaded window shows the true state

- **WHEN** the window is opened or reloaded while listening mode is engaged
- **THEN** the ear control shows the mode as engaged, having queried the main process rather than
  assuming a default

#### Scenario: The renderer never overwrites the state

- **WHEN** the renderer mounts or reloads while listening mode is engaged
- **THEN** the main process's state is unchanged by that mount

#### Scenario: Tray item reflects and toggles state

- **WHEN** the user opens the tray menu while the session is running
- **THEN** the item's label reflects whether listening mode is engaged, and selecting it toggles the
  mode

#### Scenario: Tray item is disabled while asleep

- **WHEN** the user opens the tray menu while the session is asleep
- **THEN** the listening-mode item is disabled and cannot be triggered

#### Scenario: Hotkey registration failure degrades gracefully

- **WHEN** the configured listening hotkey cannot be registered because of a conflict
- **THEN** a log event records the failure, the app continues normally, and the mode remains reachable
  via the renderer control and the tray item

### Requirement: The mode's reconnects are distinct from failure reconnects

Reconnecting to change configuration or to rotate a chunk is a deliberate transition, not a failure.
The app SHALL NOT let these reconnects trigger the failure-reconnect path, whose retry policy
discards the resumption handle after repeated attempts and would therefore destroy the listening
context. A deliberate reconnect SHALL also not re-trigger the welcome greeting.

#### Scenario: A deliberate reconnect does not enter failure backoff

- **WHEN** the session is closed to change configuration or to rotate a chunk
- **THEN** the failure-reconnect path does not run, and the resumption handle is preserved

#### Scenario: Toggling does not re-greet

- **WHEN** the user toggles listening mode on or off, or a rotation occurs
- **THEN** Iris does not repeat the welcome greeting

### Requirement: Ordinary conversation is unchanged when listening mode is off

While listening mode is disengaged, the Live session SHALL be configured exactly as it was before this
capability existed, with server-side automatic activity detection active and no realtime input
configuration overriding turn coverage. Conversation latency, barge-in, and turn-taking SHALL be
indistinguishable from their behavior before listening mode was introduced.

#### Scenario: Conversation behaves as before

- **WHEN** listening mode has never been engaged in a session
- **THEN** the session's configuration and Iris's conversational turn-taking are identical to their
  pre-existing behavior

#### Scenario: Conversation behaves as before after a listening cycle

- **WHEN** the user engages listening mode and later ends it
- **THEN** the resulting conversation session is configured for ordinary conversation, with automatic
  activity detection active again
