## ADDED Requirements

### Requirement: The step rail is reachable end to end without a keyboard

When the user asks Iris aloud to find a note and the galaxy is active, the step
rail SHALL offer what she found, on exactly the terms it offers any other entry:
activating one flies the camera to that note and recentres the rail on it.

**Finding a note is the one part of galaxy navigation that the hand cannot begin
on its own.** The universal point-and-hold activates buttons and links; it cannot
put words into a text field, so a rail whose search is typed leaves the hand able
to step the results of a search it has no way to start. Asking is what supplies
the words. With it, reaching a named note is: say it, then point and hold —
neither half requiring a keyboard, and neither adding a gesture.

The spoken search SHALL NOT be a second way of doing something the typed field
does differently: it SHALL offer the same notes, in the same order, for the same
words (see `personal-knowledge-notes`).

A spoken search SHALL NOT change what is selected. It SHALL leave the focus
exactly as it was, SHALL NOT open a note by itself, and SHALL NOT change what the
voice layer or a run reads — the same rule stepping already holds to, for the
same reason: navigating is not selecting.

Asking to find a note while the galaxy is **not** active SHALL still be answered.
The rail is where matches are shown when there is a rail; it is not a
precondition for the question being worth asking, and requiring the user to open
the galaxy first would make the shortest route to a note the longest.

#### Scenario: Saying a note's name fills the rail with it

- **WHEN** the galaxy is active and the user asks Iris to find a note by name
- **THEN** the rail offers the matching notes, and pointing at one and holding steps the camera to it

#### Scenario: Finding a note needs no keyboard and no new gesture

- **WHEN** the user reaches a named note by asking for it and then dwelling on the entry
- **THEN** no keyboard was used and no hand pose beyond the existing point-and-hold was involved

#### Scenario: A spoken search selects nothing

- **WHEN** notes are focused and the user asks Iris to find an unrelated note
- **THEN** the focus is unchanged, no note opens, and nothing the voice layer or a run reads has changed

#### Scenario: The question is answered with the galaxy closed

- **WHEN** the galaxy is not active and the user asks Iris to find a note by name
- **THEN** Iris still answers with what she found, rather than requiring the galaxy to be opened first

#### Scenario: Opening a found note leaves the camera on it

- **WHEN** the user asks for a note by name, asks Iris to open it, and then closes the reader
- **THEN** the camera is anchored on that note, exactly as it is for a note opened by click or by dwell
