## MODIFIED Requirements

### Requirement: Panel surfaces pipeline availability state

The SetupPanel SHALL display the current pipeline availability state (chat-only vs
pipeline enabled), derived from the same two-condition gate `pipeline-availability`
defines: the bundled runtime answering its probe **and** a configured Claude
credential.

The bundled-component rows SHALL be presented on the vocabulary that capability
owns — one of exactly two states per row, one shared re-check — and SHALL NOT be
re-declared here. A second declaration of the same row set is precisely what let
this requirement keep asking for "copyable install commands" long after the code
stopped offering any, and after `pipeline-availability` forbade them.

The panel SHALL NOT offer an install action, an install command, or a copyable
string presented as a command for any bundled component, and SHALL NOT explain a
chat-only state as a missing host binary. Claude Code, the `openspec` CLI, the
personas, and the skills plugin all ship inside the app: the only row a user can
act on is the credential, and a component that does not resolve from the bundle
means a damaged install, which no command the user could run would repair.

When a re-check flips availability while a Gemini session is live, the panel SHALL
surface the existing reconnect prompt rather than pretending the change
hot-applied, since Live tool declarations are fixed per session.

#### Scenario: Chat-only state is explained by what is actually missing

- **WHEN** the user opens the SetupPanel while the app runs chat-only
- **THEN** the panel names which of the two conditions failed — no Claude credential is configured, or the bundled runtime did not launch — and for the runtime case points at reinstalling the app, offering no install command

#### Scenario: Availability flip prompts a reconnect

- **WHEN** a re-check finds a credential saved since the last probe while a voice session is connected
- **THEN** the panel reports the pipeline as ready and offers the standard reconnect action, after which the pipeline surface is live

#### Scenario: The panel does not restate the row vocabulary

- **WHEN** the bundled-component rows are rendered
- **THEN** they report exactly the two states `pipeline-availability` defines, and no row carries an install action, an install command, or a copyable command string
