## MODIFIED Requirements

### Requirement: The second brain is a verb Iris can call, not prose it must recite
Working with the second brain SHALL be reachable through named functions with their own parameter schemas, one per kind of work: **capture** through a function that writes directly and returns once the write has settled, **finding a note by name** through a function that reads directly and returns the matches, and **curation and retrieval** through a verb scoped to the note-keeping skills.

Capture's function SHALL NOT be a verb dispatched to the worker. Modelling an instant local write as a run made it inherit a run's latency, cost, credential requirement, and queueing, none of which a file append has. The same SHALL hold for the name lookup, for the same reason read the other way: comparing strings against a list of titles needs no model.

Neither SHALL be offered only as prose in the voice layer's system instruction directing it toward a general-purpose task tool. A capability that ships its own skills but contributes no callable function is not reachable on its own terms — it depends on the voice layer remembering to describe it correctly.

#### Scenario: Capture has its own function

- **WHEN** the voice layer's tool declarations are built and the vault is available
- **THEN** a declaration exists for capturing a note, with its own parameters, and calling it writes the note rather than starting a run

#### Scenario: Finding a note by name has its own function

- **WHEN** the voice layer's tool declarations are built and the vault is available
- **THEN** a declaration exists for finding notes by name, with its own parameters, and calling it returns matches rather than starting a run

#### Scenario: Curation has its own function

- **WHEN** the voice layer's tool declarations are built and the worker is available
- **THEN** a declaration exists for curation and retrieval of the second brain, with its own parameters

#### Scenario: The verb is scoped to note-keeping

- **WHEN** a second-brain run executes
- **THEN** it has the note-keeping skills available and does not have skills belonging to unrelated workflows

## ADDED Requirements

### Requirement: A note is findable by name, spoken, without spending a run

Iris SHALL find the user's notes by **name** when asked aloud, returning the
notes whose titles match what the user said, so that a note the user can name
can be reached by naming it.

This SHALL be a direct read on exactly the terms capture is a direct write: it
SHALL NOT start a Claude run, SHALL NOT consume tokens, SHALL NOT occupy the
execution slot, and SHALL work with no Claude credential configured. Comparing
what the user said against a list of titles needs no model, and routing it
through one would make the cheapest question this capability can answer the
slowest, the only one that could fail for reasons unrelated to the vault, and
the only one a user without a credential could not ask.

Matching SHALL ignore case and diacritics. A vault's titles are prose, and a
spoken title arrives transcribed with whatever accents the transcription chose —
so requiring them to agree exactly would make the feature fail most often in the
languages that have them.

The lookup SHALL read the vault as it is at the moment it is asked, not a copy
kept fresh by something else. A note written moments ago SHALL be findable in the
same conversation — which this capability already requires of capture and
retrieval ("a note captured in one turn is findable in a later turn") and which
the lookup SHALL NOT be the exception to. Nothing watches this vault except while
the galaxy is on screen, so a lookup reading a kept copy would answer for an
empty vault whenever the galaxy had not been opened.

Iris SHALL report what she found. When several notes match she SHALL be able to
name them so the user can choose; when none do she SHALL say so rather than
offering the nearest unrelated note as though it were the answer.

**This lookup answers "which note is called that", and SHALL NOT be presented as
answering "what do my notes say about that".** The second question is retrieval —
reading and synthesising across the vault — which remains worker work through the
curation verb. The two are asked in sentences that resemble each other, so the
distinction SHALL be carried by the function's own declared contract rather than
left to prose the voice layer may weigh differently from one turn to the next.
Answering a question about a note's *contents* from its title alone would be a
confident wrong answer, which is worse than the slower correct one.

#### Scenario: Finding a note by name costs nothing

- **WHEN** the user asks Iris to find a note by its name
- **THEN** the matching notes are returned immediately, with no Claude run started, no tokens spent, and no execution slot occupied

#### Scenario: The lookup works with no Claude credential

- **WHEN** no Claude credential is configured and the user asks for a note by name
- **THEN** the lookup still answers, exactly as capture still writes

#### Scenario: Accents need not be spoken back exactly

- **WHEN** the user names a note whose title carries diacritics and the transcription omits or alters them
- **THEN** the note is still found

#### Scenario: A note captured moments ago is findable at once

- **WHEN** the user captures a note by voice and then, in the same conversation, asks for it by name
- **THEN** it is found — the lookup reads the vault as it stands, rather than a copy last refreshed when the galaxy was open

#### Scenario: The lookup answers a vault it has never displayed

- **WHEN** the galaxy has not been opened in this session and the user asks for a note by name
- **THEN** the vault's notes are matched normally, rather than the lookup finding nothing because no view had populated anything

#### Scenario: Several matches are offered rather than guessed between

- **WHEN** more than one note matches what the user named
- **THEN** Iris names the candidates so the user can choose, rather than picking one silently

#### Scenario: No match is reported as no match

- **WHEN** nothing in the vault matches what the user named
- **THEN** Iris says so, and does not offer an unrelated note as the answer

#### Scenario: A question about contents is not answered from titles

- **WHEN** the user asks what their notes say about a subject, rather than which note is called something
- **THEN** the question is routed to retrieval through the curation verb, not answered from the title list

#### Scenario: The lookup does not wait on the run queue

- **WHEN** a long run is already occupying the single execution slot and the user asks for a note by name
- **THEN** the answer comes back immediately rather than queueing behind that run

### Requirement: One definition of what matching a note's name means

Whatever decides that a spoken name matches a note SHALL be the same thing that
decides a typed one does. A user who says a title and a user who types it SHALL
get the same notes back, in the same order.

Two implementations of the same comparison that must agree is a defect waiting
for the day someone changes one of them; and the lookup has to answer with the
galaxy closed, where there is no view to match against, so it cannot live only in
the view.

#### Scenario: Spoken and typed searches agree

- **WHEN** the same words are typed into the galaxy's find field and spoken to Iris
- **THEN** the same notes are offered, in the same order
