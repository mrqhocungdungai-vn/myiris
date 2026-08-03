## MODIFIED Requirements

### Requirement: Claude binary presence is the pipeline master switch

**Renamed in effect to: a working bundled runtime AND a Claude credential are the pipeline master switch.**

The app SHALL ship Claude Code inside the application bundle and SHALL NOT probe the host machine for an installed `claude` binary. Availability SHALL be determined by two conditions together: the bundled binary responds to a `--version` probe, AND at least one usable Claude credential is configured (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`). The probe SHALL run before the Gemini Live session is created, and SHALL re-run on a SetupPanel re-check, on every Gemini session (re)connect, and immediately after a credential is saved or removed.

When either condition fails, the app SHALL run in chat-only mode; when both hold, the full PO → DEV pipeline surface SHALL be enabled.

The health payload SHALL report binary reachability and pipeline availability as separate fields, so a packaging failure is distinguishable from a missing credential.

`IRIS_CLAUDE_BIN` SHALL remain available as a developer override of the bundled binary path, and SHALL be validated as an executable before use.

#### Scenario: No credential yields chat-only mode

- **WHEN** the app starts with `GEMINI_API_KEY` configured and no Claude credential set
- **THEN** the app starts in chat-only mode, voice conversation works normally, and the health payload reports the binary as reachable but the pipeline as unavailable

#### Scenario: Credential present enables the pipeline

- **WHEN** the app starts with a Claude credential configured and the bundled `--version` probe succeeds
- **THEN** the Claude tools are declared to Gemini, the pipeline UI is shown, and PO/DEV behave exactly as specified by the existing pipeline capabilities

#### Scenario: No host Claude install is required

- **WHEN** the app runs on a machine with no `claude` binary anywhere on `PATH`
- **THEN** the probe still succeeds against the bundled binary and the pipeline is available as long as a credential is set

#### Scenario: Credential added mid-session

- **WHEN** the app is running chat-only and the user saves a credential in the Setup panel
- **THEN** availability is re-probed without a restart, the flag flips to available, and the change is pushed to the renderer

#### Scenario: Bundled runtime is broken

- **WHEN** the bundled binary cannot be resolved or is not executable (a packaging failure)
- **THEN** the app runs chat-only and the health payload reports the binary as unreachable, distinctly from the missing-credential case

## REMOVED Requirements

### Requirement: `CLAUDE_CODE_OAUTH_TOKEN` does not affect the master switch

**Reason**: inverted by this change. The token (or an API key) is now part of the availability gate, because the binary — previously the only signal — is always present once it ships with the app. Credential presence still additionally gates individual PO turns.
