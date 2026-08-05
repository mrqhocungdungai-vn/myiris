## Purpose

The open note as a shared work object between the user and Iris: while a note is open in the reader, both sides attend to that one note — it is what a deictic request resolves to, and it has its own resident working session that reads it aloud and edits it by conversation. Closing it returns attention to the vault as a whole.

## ADDED Requirements

### Requirement: The open note is owned by the main process

Which note is open in the note reader SHALL be owned by the main process, on the same terms the focus already is. The renderer SHALL report opening and closing; main SHALL hold the identity and be the single authority every consumer reads.

It SHALL be stored as a note **identity only**, and resolved to a title, tags, and a file at the moment of use against the live vault graph — never as a snapshot of metadata captured when the note was opened. A note renamed while open SHALL resolve to its current title; a note deleted while open SHALL resolve to nothing rather than to a phantom.

There SHALL NOT be a second notion of "the note we are working on" maintained anywhere else. A renderer that believes a note is open while main does not is exactly how a request would act on the wrong file.

#### Scenario: Opening a note tells the main process

- **WHEN** the user opens a note in the reader
- **THEN** the main process holds that note's identity as the open note

#### Scenario: Closing a note tells the main process

- **WHEN** the note reader closes by any route — its close control, Esc, a fist, the galaxy closing, or the HUD being left
- **THEN** the main process holds no open note

#### Scenario: A renamed open note resolves to its current title

- **WHEN** the open note is renamed on disk and the open note is then read
- **THEN** it resolves to the note's current title

#### Scenario: A deleted open note resolves to nothing

- **WHEN** the open note is deleted from the vault and the open note is then read
- **THEN** it resolves to nothing, and no consumer is handed a note that no longer exists

### Requirement: The open note outranks the focus as the voice referent

While a note is open, what the voice layer is told about the second brain SHALL describe that note and SHALL NOT describe the focus. While no note is open, it SHALL describe the focus as it does today.

Exactly one referent SHALL ever be described. Two — an open note plus a set of focused notes — would leave "this one" and "these two" to be guessed at, and the cost of guessing wrong is the user's vault changed in a way they did not ask for.

The focus SHALL NOT be cleared by a note opening. It is retained by the main process and becomes the described referent again the moment the note closes, so opening a note to read it never costs the user a selection they built deliberately.

What reaches the voice layer SHALL be the open note's identity, title, and tags — **not its body**, on exactly the terms that already keep note bodies out of what a run's prompt carries. Titles and tags SHALL be treated as untrusted, because vault content may originate from the web.

The voice layer SHALL be told when the open note changes, rather than only at connect. The open note changes mid-conversation, and a system instruction built once at connect cannot describe it.

#### Scenario: A deictic request resolves to the open note

- **WHEN** a note is open and the user says "tag this infra"
- **THEN** the request acts on the open note, without asking which note is meant

#### Scenario: The focus is not described while a note is open

- **WHEN** two notes are focused, a third is opened, and what the voice layer knows is then built
- **THEN** it describes only the open note and says nothing about the two focused notes

#### Scenario: Closing the note restores the focus as the referent

- **WHEN** the note closes with two notes still focused
- **THEN** the focus is described again and a deictic request resolves against those two notes

#### Scenario: The open note's body is not shipped to the voice layer

- **WHEN** a long note is open and what the voice layer knows is built
- **THEN** it carries the note's title and tags but not its body

#### Scenario: An adversarial title cannot issue instructions

- **WHEN** the open note's title contains text shaped like an instruction to the model
- **THEN** it arrives as untrusted content and is not followed as an instruction

#### Scenario: Opening a note is announced mid-conversation

- **WHEN** a note is opened during a live conversation
- **THEN** the voice layer is told about it at that moment, not only at the next connect

### Requirement: Working on a note is a resident session, not a one-shot run

Reading a note back and then changing it by conversation SHALL be served by a **stateful** verb — a resident session that holds one continuous context across turns.

This is what makes a follow-up resolvable. "Drop the second paragraph" is answerable only by something that already numbered the paragraphs, and it must still know a turn later. A one-shot run re-derives that numbering from scratch every turn, so the same words can mean different paragraphs on consecutive turns.

The verb SHALL be scoped to note-keeping skills and granted the vault as a working directory, because the vault lives outside any project folder.

Curation — weaving accumulated spool into linked pages, writing something up as a page, answering a question from what is already there — SHALL remain the existing stateless notes verb's work, unchanged. The two are distinguished by **lifetime and by whether the user is in the loop**, not by subject: one is a conversation about one note, the other is bookkeeping over everything that accumulated.

#### Scenario: A follow-up resolves against the earlier turn

- **WHEN** the session has read a note back with its paragraphs identified and the user then says "drop the second one"
- **THEN** it removes the paragraph it itself identified as the second, without re-deriving or asking

#### Scenario: The conversation survives an unrelated turn

- **WHEN** something else happens between two turns about the same note
- **THEN** the next turn continues the same conversation with its context intact

#### Scenario: Curation still goes to the notes verb

- **WHEN** the user asks to weave in what has accumulated, or what their notes say about a topic
- **THEN** that is served by the existing stateless notes verb, not by this session

#### Scenario: The session is scoped to note-keeping

- **WHEN** a note working session runs
- **THEN** it has the note-keeping skills available, has the vault as a working directory, and does not have skills belonging to unrelated workflows

### Requirement: One conversation per note

Each note SHALL have its own conversation. Returning to a note SHALL resume what was already said about it rather than starting over.

Exactly one session SHALL be resident at a time. Opening a different note SHALL yield the resident slot: the outgoing conversation is retained so it can be resumed, and the incoming note's own conversation is resumed if it has one or started if it does not. Closing a note SHALL end nothing — glancing at the galaxy and reopening the same note SHALL find the conversation exactly as it was.

A single conversation spanning every note would accumulate several notes' context in one window, which is the opposite of knowing what is being worked on. Discarding a conversation on every switch would punish moving between two notes, which is ordinary.

#### Scenario: Returning to a note resumes its conversation

- **WHEN** the user works on note A, switches to note B, and later returns to A
- **THEN** the conversation about A continues with what was said about it still in context

#### Scenario: A different note is a different conversation

- **WHEN** the user opens note B after working on note A
- **THEN** B's conversation does not carry A's context

#### Scenario: Closing and reopening keeps the conversation

- **WHEN** the user closes a note, looks at the galaxy, and reopens the same note
- **THEN** the conversation is exactly as it was — nothing was ended

#### Scenario: Only one session is resident

- **WHEN** the user has worked on several notes in turn
- **THEN** only the current note's session is resident; the others are retained as resumable rather than kept alive

### Requirement: The note is read back verbatim, by the session that will edit it

When the user asks to hear a note, the working session SHALL produce the reading and the voice layer SHALL speak it **as written** — it SHALL NOT be summarized, condensed, or re-rendered.

The reading and the editing SHALL come from the same session. If one model renders the note and another edits it, each has divided the text into paragraphs independently, and a request naming a paragraph is resolved against two different divisions — a mistake that only becomes visible after the vault has been changed.

A reading SHALL identify the note's parts in a way the user can refer back to, so a follow-up can name one.

#### Scenario: A note is read out as written

- **WHEN** the user asks to hear the open note
- **THEN** its content is spoken as the session rendered it, not summarized into a few sentences

#### Scenario: The reader and the editor are the same session

- **WHEN** the user hears a note read back and then asks for a change to a named part of it
- **THEN** the change is applied by the same session that produced that reading

#### Scenario: A reading can be referred back to

- **WHEN** a note has been read back and the user names one of its parts
- **THEN** that part is identified without the user being asked to describe it again

### Requirement: Structural edits target the open note when there is one

An operation that links, unlinks, or retags notes SHALL default to the open note when one is open, and to the focus when none is. It SHALL continue to accept notes named explicitly by title, which SHALL take precedence over both.

This follows the referent rule rather than restating it: whatever the user is being told is the current work object is what an unqualified request acts on.

Every target SHALL still be resolved from a note identity to a file by Iris itself, re-asserting after symlink resolution that the file is inside the vault, exactly as it is today. The open note SHALL be no exception, and SHALL NOT become a path accepted from the renderer or from a model.

#### Scenario: An unqualified retag hits the open note

- **WHEN** a note is open, other notes are focused, and the user asks to tag "this"
- **THEN** the open note is retagged and the focused notes are untouched

#### Scenario: Named notes still win

- **WHEN** a note is open and the user names two other notes by title and asks to connect them
- **THEN** those two are connected and the open note is untouched

#### Scenario: The focus is used when no note is open

- **WHEN** no note is open, two notes are focused, and the user asks to connect them
- **THEN** the two focused notes are connected, exactly as before this capability existed

#### Scenario: The open note is still resolved by identity

- **WHEN** an edit targets the open note
- **THEN** its file is resolved by Iris from the note's identity and re-checked to be inside the vault after symlinks are followed, with no path accepted from the renderer or from a model
