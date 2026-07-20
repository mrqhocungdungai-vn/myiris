## ADDED Requirements

### Requirement: Panel surfaces pipeline availability state

The SetupPanel SHALL display the current pipeline availability state (chat-only vs pipeline enabled) derived from the Claude binary probe, alongside the prerequisite check rows specified in the `pipeline-availability` capability (openspec CLI, global skills — with copyable install commands and a shared re-check). When a re-check flips availability while a Gemini session is live, the panel SHALL surface the existing reconnect prompt rather than pretending the change hot-applied, since Live tool declarations are fixed per session.

#### Scenario: Chat-only state is explained, not hidden

- **WHEN** the user opens the SetupPanel while the app runs chat-only
- **THEN** the panel states that the Claude pipeline is off because no `claude` binary was found, and shows how to install it

#### Scenario: Availability flip prompts a reconnect

- **WHEN** a re-check detects the Claude binary for the first time while a voice session is connected
- **THEN** the panel reports the pipeline as ready and offers the standard reconnect action, after which the pipeline surface is live
