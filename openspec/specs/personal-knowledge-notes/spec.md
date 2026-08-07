## Purpose

Lets the user capture and retrieve personal notes by voice through the plain-Claude worker path, using the bundled LLM-Wiki skills to build an interlinked, plain-markdown second-brain vault at a fixed user-level location — independent of the pipeline and of whatever project folder happens to be active.
## Requirements
### Requirement: Personal notes are captured and retrieved in a second-brain vault
Iris SHALL let the user capture and retrieve personal notes in a vault of plain-markdown pages (YAML frontmatter, `[[wikilinks]]`) that accumulate into an interlinked knowledge base. Capture and retrieval SHALL both operate on the same vault, so a note captured in one turn is findable in a later turn.

**Capture SHALL be a direct file write, not a worker run.** It SHALL NOT start a Claude run, SHALL NOT consume tokens, and SHALL NOT occupy the execution slot — the same terms the run-outcome record already holds. Appending markdown to a file needs no model; routing it through one made the cheapest operation in this capability the slowest, the only one that could fail for reasons unrelated to the filesystem, and the only one that a user without a Claude credential could not perform at all.

Because the write is direct, Iris SHALL confirm a capture only after the write has succeeded, and SHALL report a capture whose write failed as failed rather than saved. This rule previously existed to defend against a worker that reported success without writing; it now holds by construction, and the worker is no longer in the path.

Retrieval — reading the vault to answer a question — and curation — turning spooled captures into linked pages — SHALL remain worker work using the bundled LLM-Wiki skills. Reading and synthesizing across a vault is judgement, which is what those skills are for; a filesystem append is not.

#### Scenario: Capturing a note by voice writes it to the vault immediately

- **WHEN** the user asks Iris to note something down (e.g. "ghi chú lại: …")
- **THEN** the text is written into the vault directly and Iris confirms it, with no Claude run started, no tokens spent, and no execution slot occupied

#### Scenario: A capture whose write fails is reported as failed, not confirmed

- **WHEN** a capture cannot be written (e.g. the vault path is not writable)
- **THEN** Iris does not tell the user it was saved to their second brain; it reports the capture as failed

#### Scenario: Capture does not wait on the run queue

- **WHEN** a long run is already occupying the single execution slot and the user captures a note
- **THEN** the capture lands immediately rather than queueing behind that run

#### Scenario: Retrieving a note returns earlier-captured content

- **WHEN** the user asks Iris to recall or search their notes (e.g. "tìm trong second-brain …")
- **THEN** the worker reads the vault and returns the matching note content with its source page, not a fabricated answer

#### Scenario: The vault is plain markdown the user can open and edit

- **WHEN** the user opens the vault folder in Obsidian (or any editor)
- **THEN** the notes are readable/editable plain-markdown files with no proprietary database or required external service

### Requirement: The vault's machine-written spool is not user notes

Iris SHALL write vault content it generates on its own initiative — captures awaiting curation, the per-run outcome records, and (when ambient session capture is enabled) the retained conversation text — into a dedicated spool area of the vault, distinct from curated note pages. That spool area SHALL NOT be treated as a user note by anything that enumerates the vault's notes.

Iris appends to the spool without being asked, once per finished run, once per capture, and repeatedly through a conversation while ambient capture is on. Anything that counts, renders, or reasons over "the user's notes" must therefore exclude it, or Iris's own bookkeeping accumulates as apparent knowledge — one entry per day of use, forever, growing without bound and without the user ever having written it. Ambient capture makes this sharper rather than adding a new problem: it is the highest-volume writer of the three, and the exclusion is what keeps its volume free of consequence for the graph.

Each kind of spooled content SHALL be distinguishable from the others, so the curator can weave a deliberate capture and a passively-retained conversation on different terms rather than treating a room transcript as if the user had chosen to record it.

The spool SHALL remain plain markdown inside the vault (not a database and not a hidden location), so the user can read and prune it with any editor, and so the curator reaches it through the same granted directory it already has.

#### Scenario: Spooled records are not counted as user notes

- **WHEN** the vault contains spooled capture, run-outcome, and session files alongside curated pages
- **THEN** anything enumerating the vault's user notes returns only the curated pages, and no spool file is presented as a note

#### Scenario: Session volume does not reach the graph

- **WHEN** ambient capture has been running across many long conversations
- **THEN** no node appears for any of it, and the galaxy is unchanged by the volume

#### Scenario: The kinds of spooled content are distinguishable

- **WHEN** the curator reads the spool
- **THEN** it can tell a deliberate capture from a run-outcome record from a passively-retained conversation

#### Scenario: A curated page is a user note

- **WHEN** the curator turns spooled material into a page in the vault proper
- **THEN** that page is a user note and is enumerated as one

#### Scenario: An existing vault needs no migration

- **WHEN** a vault already contains spool files that were previously being counted as user notes
- **THEN** they simply stop being counted, with no migration step and no data moved or deleted

#### Scenario: The spool is readable and prunable by hand

- **WHEN** the user opens the vault in an editor
- **THEN** the spool is plain markdown they can read, edit, and delete, like any other file in the vault

### Requirement: The notes vault is fixed at the user-level path, independent of the project folder
The notes vault SHALL be a user-owned Obsidian vault at `~/iris-second-brain`. Iris SHALL ensure this directory exists before a notes task runs, and SHALL pin the LLM-Wiki root to it for every plain-Claude run regardless of the workstream's active project folder (`cwd`), so notes never scatter into whatever project happens to be open. Iris SHALL achieve this without editing the vendored skill snapshots.

#### Scenario: Notes land in the vault even when a different project is active

- **WHEN** a workstream's active project folder is some code repository and the user captures a note
- **THEN** the note is written under `~/iris-second-brain`, not under the active project folder

#### Scenario: The vault is created on demand

- **WHEN** the user captures their first note and `~/iris-second-brain` does not yet exist
- **THEN** Iris creates the vault directory and the note is saved successfully

#### Scenario: A first-ever capture does not stall on an unanswerable setup question

- **WHEN** the user captures their very first note and no `wiki-config.md` exists yet under `~/iris-second-brain`
- **THEN** Iris has already pre-seeded `wiki-config.md` and `wiki-schema.md` before the run starts, so the plain-Claude worker's wiki skills find a valid config immediately and proceed to write the note, rather than ending the turn asking the user to run an interactive setup step it has no way to answer in a one-shot run

### Requirement: The notes capability follows the pipeline gate and is not a pipeline prerequisite
The parts of this capability that need a worker SHALL follow the pipeline gate; the part that does not SHALL NOT.

**Capture SHALL be available whenever the vault is**, independent of whether a Claude credential is configured or the bundled runtime resolves — it is a local file write, and gating it on a worker it does not use made the second brain nonexistent for a chat-only user. **Retrieval and curation SHALL be available exactly when the pipeline is** — a working bundled runtime plus a configured credential — because they run on the worker. Their skills ship in the app's bundled plugin rather than being installed on the machine, so the only failure mode left there is a damaged bundle, not a missing install.

Its skills SHALL NOT be reported as pipeline prerequisites: a user who has the pipeline available but has not set up second-brain notes SHALL NOT see the LLM-Wiki skills counted among missing required prerequisites. Vault creation (`~/iris-second-brain` and its pre-seeded config) is independent of the skills being present — the vault MAY exist while the bundle is damaged — so Iris SHALL check the skills are actually resolvable, not just that the vault exists, before telling the user it can retrieve from or curate a note.

#### Scenario: Capture works with no Claude credential

- **WHEN** no Claude credential is configured and the user asks Iris to note something down
- **THEN** the note is captured to the vault and confirmed — the chat-only companion can still save to the second brain

#### Scenario: No credential means no retrieval or curation

- **WHEN** the pipeline is unavailable because no Claude credential is configured, and the user asks Iris what their notes say about something
- **THEN** Iris has no notes worker and says so, without claiming it searched the vault and without fabricating an answer

#### Scenario: Pipeline available but the notes skills cannot be resolved

- **WHEN** the user asks Iris to retrieve from or curate their notes, and `~/iris-second-brain` already exists (or was just created) but the LLM-Wiki skills cannot be resolved from the app bundle
- **THEN** the worker tells the user that part of the notes capability is unavailable and the app bundle needs reinstalling, rather than attempting an ad-hoc, ungoverned substitute for the real LLM-Wiki workflow

#### Scenario: A damaged bundle does not disable capture

- **WHEN** the LLM-Wiki skills cannot be resolved from the bundle and the user asks Iris to note something down
- **THEN** the capture still lands in the vault, because capture does not use those skills

#### Scenario: Talk-only user is not flagged for a missing prerequisite

- **WHEN** the SetupPanel reports pipeline prerequisite status and the LLM-Wiki skills are not installed
- **THEN** they are not listed as a missing required prerequisite (they are absent from `REQUIRED_SKILLS`), so a Talk-mode user is never told to install them to fix the pipeline

#### Scenario: The notes capability's install state is still visible in the SetupPanel

- **WHEN** the user opens the SetupPanel's Claude section
- **THEN** a dedicated "Second-brain notes (LLM-Wiki skills)" row reports whether the skills resolve from the bundle, separately from — and without affecting — the pipeline's own rows; a damaged state points at reinstalling the app, since no user command can repair a bundle

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

### Requirement: Every run's outcome is recorded, without costing a run
When a run reaches a terminal state, its outcome SHALL be appended to the second-brain vault: the verb, the request, the result, the cost, the error if any, and the tools it used. **Failures SHALL be recorded on the same terms as successes** — a failed attempt is at least as worth keeping as a successful one.

This capture SHALL be a direct file write. It SHALL NOT start a Claude run, SHALL NOT consume tokens, and SHALL NOT occupy the single execution slot — bookkeeping must never delay the user's next request, and knowledge must never be lost because the queue was busy.

Capture SHALL NOT depend on the voice layer choosing to record something. Accumulated knowledge that requires a model to remember to save it is knowledge that will be lost.

#### Scenario: A successful run is recorded

- **WHEN** a run completes successfully
- **THEN** its verb, request, result, cost, and tools used are appended to the vault

#### Scenario: A failed run is recorded

- **WHEN** a run fails, is cancelled, or terminates on a ceiling
- **THEN** its outcome and error are appended on the same terms as a success

#### Scenario: Capture never blocks the queue

- **WHEN** a run finalizes and its outcome is captured
- **THEN** no additional run is started, no tokens are spent, and the execution slot is not held

#### Scenario: Capture is not conditional on the voice layer

- **WHEN** a run finalizes without the voice layer taking any action
- **THEN** the outcome is still captured

### Requirement: Synthesis is deliberate, and offered rather than imposed
Turning captured records into structured knowledge — distilling and weaving them into the vault — SHALL happen when the second-brain verb is called, not automatically after each run and not automatically because a conversation ended.

Iris SHALL be able to notice that enough has accumulated across **all** of the spool — deliberate captures, run-outcome records, and retained conversation alike — to be worth synthesizing, and offer it. It SHALL NOT run synthesis unprompted.

Raw capture is a log; synthesis is the learning. Separating them means the log is never lost to a busy queue, and the expensive step happens when there is enough material to justify it. Ambient capture raises the stakes of that separation rather than changing it: a conversation ending is exactly the moment an automatic synthesis would feel natural and would be wrong, because it would spend the user's money and rewrite their vault on the strength of them having stopped talking.

#### Scenario: Synthesis runs when asked

- **WHEN** the second-brain verb is called for synthesis
- **THEN** the accumulated records across every kind of spooled content are read and woven into the vault

#### Scenario: Synthesis is offered, not imposed

- **WHEN** enough records have accumulated to be worth synthesizing
- **THEN** Iris offers to do it and waits, rather than starting it

#### Scenario: The offer accounts for retained conversation

- **WHEN** ambient capture has accumulated conversation but few runs have finished
- **THEN** the backlog Iris measures reflects that material, so the offer is made on what is actually waiting

#### Scenario: No synthesis run follows an ordinary run

- **WHEN** an ordinary run finalizes
- **THEN** no synthesis run is started as a consequence

#### Scenario: No synthesis run follows a conversation ending

- **WHEN** a conversation ends with retained material waiting and the user says nothing about their notes
- **THEN** no synthesis run is started

### Requirement: Structural edits between existing notes are direct writes

Linking two existing notes to each other, removing such a link, and changing a note's tags SHALL be direct file writes on the same terms as capture: no Claude run, no tokens, no execution slot, and available without a Claude credential. A link SHALL be written in **both** directions, so connecting two notes produces a link the graph can traverse from either end rather than a one-way reference the other note has no record of.

These operations carry no judgement. Which two notes to connect is the user's decision, and inserting a `[[wikilink]]` into two files is a text transform — routing it through a worker would give an instant, deterministic edit a run's latency, cost, and credential requirement, exactly as capture suffered before it became a write.

Work that **does** carry judgement — merging two notes, splitting one, summarizing a set, deciding what a set is missing — SHALL remain worker work. Curation of that kind, over a focused set or over whatever has accumulated, SHALL be served by the existing notes verb; that verb already takes a parameter naming what to concentrate on, and SHALL NOT be duplicated by a second verb for the same kind of work.

What is **not** the same kind of work is a conversation about one note with the user in the loop — reading it back, then removing, adding, and rewriting parts of it across turns. That differs in **lifetime**, not in subject: it requires a resident session, because a follow-up naming a part of the note is only resolvable by whatever identified those parts and still remembers doing so, and a one-shot run re-derives that division on every turn. A verb for it is therefore not a duplicate of the curation verb, and the two SHALL be distinguished by lifetime and by whether the user is in the loop rather than by what they operate on. See `open-note-session`.

#### Scenario: Linking two notes is instant and free

- **WHEN** the user asks Iris to connect two existing notes
- **THEN** a `[[wikilink]]` is written into each note pointing at the other, with no Claude run started and no tokens spent

#### Scenario: A link is traversable from both ends

- **WHEN** two notes have just been linked
- **THEN** the vault graph shows the connection, and each note's own text records the other

#### Scenario: Structural edits work with no Claude credential

- **WHEN** no Claude credential is configured and the user asks to link two notes or retag one
- **THEN** the edit is applied and confirmed

#### Scenario: An already-present link is not duplicated

- **WHEN** the user asks to connect two notes that already link to each other
- **THEN** the notes are not given a second copy of the same link, and the operation reports success rather than an error

#### Scenario: Judgement work still goes to the verb

- **WHEN** the user asks Iris to merge two notes, or what a set of notes is missing
- **THEN** that is handled by the notes verb as a run, not by a direct write

#### Scenario: No second curation verb is introduced

- **WHEN** the verb registry is inspected
- **THEN** curation over a focused set is served by the existing notes verb rather than by an additional verb declared for it

#### Scenario: A resident note-working session is not a duplicate curation verb

- **WHEN** the verb registry is inspected and it declares both a stateless curation verb and a stateful verb for working on one open note
- **THEN** that is not a duplication: the two differ in lifetime and in whether the user is in the loop, and the curation verb remains the only route for weaving accumulated material into pages

### Requirement: A structural edit targets a note by identity, never by a supplied path

An operation that edits the vault SHALL name its target by the note identity the vault graph already assigns, and Iris SHALL resolve that identity to a file itself. It SHALL NOT accept a filesystem path from the renderer or from a model, and it SHALL re-assert — after resolving symlinks — that the file is inside the vault before writing, on exactly the terms reading a note already requires.

The read side of the vault is already guarded this way because note content may originate from the web. A write is the stronger capability of the two, so it SHALL NOT be guarded more weakly than the read it mirrors.

The write surface SHALL be bounded **by caller**, and the two callers SHALL be bounded differently because they are not the same risk:

- **Model-facing writes SHALL remain an enumerated set** of named structural operations, and SHALL NOT include a general "apply this content to this note" primitive. A general primitive on this surface would make every future caller — including a model acting on web-derived content — able to write arbitrary bytes anywhere the vault reaches, which is not a bound that can be audited.
- **A user-authored content write SHALL be permitted**, for the single purpose of letting the vault's owner edit their own note by hand in Iris. It SHALL be reachable only from the note reader's editing surface; it SHALL carry the identical identity resolution, symlink resolution and in-vault containment guard as every other write; and it SHALL NOT be exposed as a tool, a verb, an MCP surface, or through any other route a model can call.

The distinction is the caller, not the shape of the operation. The bytes of a user-authored write are composed by the person who owns the vault, in a field they opened, replacing content they are looking at. The bound that matters — that a model cannot write arbitrary bytes into the vault — is unaffected by that write existing.

#### Scenario: A supplied path is refused

- **WHEN** an edit request names a filesystem path rather than a note identity
- **THEN** no file is written

#### Scenario: A note symlinked outside the vault is not writable

- **WHEN** an edit targets a note whose file, after following symlinks, resolves outside the vault directory
- **THEN** the write is refused and the file is not modified

#### Scenario: An unknown identity is reported, not guessed

- **WHEN** an edit targets a note identity the graph does not know, or a ghost node with no backing file
- **THEN** the operation reports that the target was not found and writes nothing

#### Scenario: The model-facing surface has only enumerated operations

- **WHEN** the write surface reachable by a model — its tools, verbs, and any other model-callable route — is inspected
- **THEN** it exposes a fixed set of named structural operations and no general arbitrary-content write

#### Scenario: A user-authored write is not reachable by a model

- **WHEN** the surfaces available to a model are inspected
- **THEN** the user-authored content write is absent from all of them — it is reachable only from the note reader's editing surface

#### Scenario: A user-authored write is guarded like every other write

- **WHEN** the user saves an edit to a note whose file, after following symlinks, resolves outside the vault, or whose identity the graph does not know
- **THEN** the write is refused on exactly the same terms as a structural edit, and no file is modified

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

