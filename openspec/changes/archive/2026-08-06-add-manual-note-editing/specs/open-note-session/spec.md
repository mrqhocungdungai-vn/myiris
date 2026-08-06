## ADDED Requirements

### Requirement: A hand edit to the open note invalidates the session's reading of it

When the user edits the open note by hand and saves it, Iris SHALL tell the voice layer that the note's content changed, so that a subsequent turn does not act on a reading that is no longer true of the file.

This exists because a note now has two writers. The session's whole value is that a reading and the edits referring to it come from one continuous context: "drop the second paragraph" is resolvable only against the division the session itself produced. A hand edit between the reading and the follow-up changes the text under that division — so the same words name different content, and the mistake becomes visible only after the vault has been changed. This is the identical failure the requirement "The note is read back verbatim, by the session that will edit it" exists to prevent; a second writer reintroduces it by a different route.

The signal SHALL be delivered on the same terms as the other note-lifecycle announcements: silently, as something to remember rather than to speak about, and it SHALL NOT itself consume a run.

Iris SHALL NOT attempt to reconcile the session's prior reading with the new text, and SHALL NOT silently continue as if the reading still held. Re-reading the note is the correct response to being told it changed.

#### Scenario: A hand edit is announced to the voice layer

- **WHEN** the user saves a hand edit to the note that is currently open
- **THEN** the voice layer is told the open note's content changed, silently, without speaking about it and without spending a run

#### Scenario: A paragraph-referring follow-up does not act on a stale reading

- **WHEN** the session has read a note back, the user then edits and saves that note by hand, and the user then asks for a change to a named part of it
- **THEN** the request is resolved against the note's current text rather than against the superseded reading

#### Scenario: An edit to a note that is not open changes nothing about the session

- **WHEN** a hand edit is saved while no note is open in the reader
- **THEN** no open-note announcement is made
