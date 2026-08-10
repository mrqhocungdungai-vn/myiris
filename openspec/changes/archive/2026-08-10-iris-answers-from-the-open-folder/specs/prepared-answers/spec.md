## Purpose

Lets Iris answer a question from material the user prepared in advance and has open, reading it back in the user's own words, without spending a Claude run to do it.

## ADDED Requirements

### Requirement: Iris can look for a prepared answer without running an agent

The app SHALL provide a voice-callable function that takes a question and searches the folder the user currently has open for material that answers it.

That function SHALL require no Claude run, no execution slot, and no Claude credential, and SHALL remain available in chat-only mode. It reads local files and compares text; nothing about it needs a worker. The cheapest question the app can answer SHALL NOT be the one that requires the most machinery — which is the same rule the note-title lookup already follows.

The folder searched SHALL be the workspace folder the user has open, and no other. It SHALL NOT search outside that folder, and it SHALL NOT fall back to the notes vault on its own — the vault is one of the routes the user is offered when nothing is found, not a place this reaches into unasked.

#### Scenario: A prepared answer is found without a run

- **WHEN** Iris is asked to look for a prepared answer to a question
- **THEN** the search happens locally against the open workspace folder
- **AND** no Claude run is started, no execution slot is taken, and no tokens are spent

#### Scenario: The lookup works with no Claude credential

- **WHEN** no Claude credential is configured and Iris is asked to look for a prepared answer
- **THEN** the lookup still runs and still returns what it finds

#### Scenario: The search does not leave the open folder

- **WHEN** the answer to a question exists in the notes vault but not in the open folder
- **THEN** the lookup reports that it found nothing
- **AND** it does not read the vault

### Requirement: A found answer is returned and read out in the user's own words

What the lookup returns SHALL be the prepared text itself, unaltered — not a summary, not a paraphrase, and not a rewrite. The whole reason the user prepared it is that they chose those words, and a question answered in front of an audience is answered in the words the user meant to say.

The material returned SHALL identify which prepared file it came from, so the user can tell what Iris is about to read.

The amount of prepared material returned in one call SHALL be bounded. When the open folder holds more prepared material than the bound allows, the app SHALL narrow to what is most likely relevant and SHALL make clear that it narrowed, rather than silently truncating — a user who is told nothing was found, when in fact the material was cut, would prepare against a system that lies about its own coverage.

#### Scenario: The prepared text comes back verbatim

- **WHEN** the lookup finds material answering the question
- **THEN** the text is returned exactly as written in the prepared file
- **AND** the file it came from is identified

#### Scenario: Iris reads the prepared answer as written

- **WHEN** Iris reads out a prepared answer
- **THEN** she reads the prepared text rather than summarising or rephrasing it

#### Scenario: A large prepared folder is narrowed, not silently cut

- **WHEN** the open folder holds more prepared material than the bound allows
- **THEN** the most likely relevant material is returned and the narrowing is stated
- **AND** the result is not presented as though the whole folder had been considered

### Requirement: The end of listening leads straight to the prepared folder

When listen-only mode ends, Iris SHALL look for a prepared answer to what she just heard before any agent verb is considered. Answering from what the user already wrote is the fast path, and it SHALL be attempted first rather than reached after a detour through a run.

This step SHALL happen without the user having to ask for it. Turning the mode off is the request.

#### Scenario: Disengaging triggers the lookup

- **WHEN** listen-only mode ends after Iris heard a question
- **THEN** Iris looks for a prepared answer to it straight away
- **AND** she does so before offering or starting any verb

#### Scenario: The lookup is not offered as a choice first

- **WHEN** listen-only mode ends after Iris heard a question
- **THEN** she does not ask the user whether to look; she looks

### Requirement: A found answer is announced, not performed

When a prepared answer is found, Iris SHALL say so in one short line and SHALL wait for the user before reading it out. She SHALL NOT begin reading unprompted.

The user turns the mode off intending to answer some questions themselves; that is the whole shape of the interaction. Iris beginning to speak the moment the mode ends would talk over a live presentation, which is a worse failure than one extra beat of waiting. The user keeps the floor and hands it over deliberately.

When the user gives the cue, Iris SHALL read the prepared answer out.

#### Scenario: Finding something produces one short line

- **WHEN** a prepared answer is found as the mode ends
- **THEN** Iris says in one short line that she has one
- **AND** she does not read it out yet

#### Scenario: The user takes the question themselves

- **WHEN** Iris has announced that a prepared answer exists and the user answers the question themselves instead
- **THEN** Iris stays quiet and does not read it out

#### Scenario: The cue starts the reading

- **WHEN** the user tells Iris to go ahead
- **THEN** she reads the prepared answer out as written

### Requirement: Finding nothing is reported, and the costly routes are offered rather than taken

When the lookup finds nothing, Iris SHALL say so plainly and SHALL offer the routes that do cost something: searching the folder properly through an agent verb, or retrieving from the notes vault. She SHALL NOT choose one and start it.

A run started on Iris's own initiative during a live session spends the user's money and their audience's attention on a guess. Offering is cheap and reversible; starting is neither.

#### Scenario: Nothing found is said plainly

- **WHEN** the lookup finds no prepared answer
- **THEN** Iris says that there is nothing prepared for it, rather than improvising an answer or staying silent

#### Scenario: The fallbacks are offered, not started

- **WHEN** the lookup finds no prepared answer
- **THEN** Iris offers to search with an agent or to retrieve from the notes, and waits
- **AND** no run is started until the user chooses

#### Scenario: A chosen fallback runs normally

- **WHEN** the user picks one of the offered routes
- **THEN** that route runs on its existing terms, with its existing review and cost behaviour unchanged

### Requirement: The title lookup plays no part in this

The prepared-answer path SHALL NOT be served by the note-title lookup. That lookup matches titles and never reads what a note says, so using it here would answer a question about contents from a filename.

The two SHALL remain distinct in what the voice layer is told: one finds a note the user named, the other finds prepared material that answers a question.

#### Scenario: A question about contents does not go to the title lookup

- **WHEN** Iris needs the answer to a question that was asked
- **THEN** she uses the prepared-answer lookup rather than the note-title lookup

#### Scenario: Naming a note still goes to the title lookup

- **WHEN** the user asks Iris to find or open a note by its name
- **THEN** the note-title lookup still serves that, unchanged
