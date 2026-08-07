## ADDED Requirements

### Requirement: The step rail is reachable end to end without a keyboard

When the user asks Iris aloud to find a note and the galaxy is active, the step
rail SHALL offer what she found, on exactly the terms it offers any other entry:
activating one flies the camera to that note and recentres the rail on it.

This requirement is about **where the rail's search words come from**, not about
what the rail is. What the rail offers, how an entry is activated, that matching
folds case and diacritics, and that a note is reachable by name at all are all
settled by "A note is reachable by stepping through its neighbours" in this same
capability, and SHALL NOT be re-decided here — a spoken search inherits every one
of them.

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

**Opening a found note while the galaxy is not active SHALL bring the galaxy up
with it.** The note reader is part of that layer and does not exist outside it,
so there is no reading of "open it" that shows the note alone; and answering a
request that has already named the note by asking the user to open something
else first is the same longest-route failure, one step further along. The
anchoring rule applies unchanged, because by the time the note is open the galaxy
is exactly as active as it would have been had the user opened it themselves.

This SHALL be a consequence of opening a named note and SHALL NOT become a
spoken control for the galaxy layer: Iris SHALL NOT gain a way to be asked to
open or close the galaxy on its own. A request that opens **nothing** — a refused
ghost match, or a search with no matches — SHALL leave the galaxy exactly as it
found it.

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

#### Scenario: Opening a found note with the galaxy shut brings the galaxy up

- **WHEN** the galaxy is not active, the user asks for a note by name and then asks Iris to open it
- **THEN** the galaxy becomes active and the note opens in the reader, and closing the reader leaves the camera anchored on that note as for any other open

#### Scenario: A refusal does not open the galaxy

- **WHEN** the galaxy is not active and the user asks to open a match that has no backing file, or asks for a note that matches nothing
- **THEN** Iris says why, and the galaxy is left inactive — nothing was opened, so nothing was brought up to show it in

#### Scenario: The galaxy is not a thing Iris can be asked to open

- **WHEN** the user asks Iris to open or close the galaxy itself, naming no note
- **THEN** she has no such control — activating the layer is a consequence of opening a named note, not an action of its own
