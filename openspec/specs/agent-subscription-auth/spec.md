## Purpose

Credential handling for every verb's runs. Either `CLAUDE_CODE_OAUTH_TOKEN` (subscription billing) or `ANTHROPIC_API_KEY` (metered) authenticates a run; when both are present the subscription token wins and the metered keys are stripped from the run's environment, so a stray key cannot silently change the billing path. Every verb runs on the Agent SDK against the binary the app ships, so none has a host `/login` credential store to fall back on and all go through one policy.
## Requirements
### Requirement: Auth requirements are documented

The credential requirement SHALL be documented in the app's configuration surface so an operator can enable either billing path without reading the code.

#### Scenario: Configuration docs describe the token

- **WHEN** an operator consults `.env.example` / README to configure the app
- **THEN** they find how to mint a `CLAUDE_CODE_OAUTH_TOKEN` using the app's own bundled binary, the `ANTHROPIC_API_KEY` alternative, and the note that a subscription token takes precedence over a stray API key

### Requirement: The subscription token is configurable at runtime from the app

The app SHALL let an operator set and clear `CLAUDE_CODE_OAUTH_TOKEN` from its own settings surface, persisted to the same effective `.env` the app already reads (repo `.env` in dev, `~/.iris/.env` packaged) and applied to the running process environment on save, so a packaged install never requires hand-editing a hidden file to enable subscription billing. The token SHALL be stored in plaintext in that file, consistent with the other credentials the app manages, because it must reach the Claude subprocess environment in cleartext.

#### Scenario: Token set from the app takes effect without restart

- **WHEN** an operator saves a subscription token from the app's settings surface
- **THEN** the token is written to the effective `.env` and applied to the running process environment, and the next stateful turn authenticates with it

#### Scenario: Token cleared from the app

- **WHEN** an operator removes the stored token from the app's settings surface
- **THEN** the token is cleared from both the effective `.env` and the running process environment, and subsequent stateful turns fail with the existing actionable missing-token error

#### Scenario: Token value stays in the main process

- **WHEN** the token is saved, read back, or logged anywhere in this flow
- **THEN** the value is never sent to the renderer and never written to logs — only its presence is reported

### Requirement: A token change invalidates the resident stateful session

Because the live stateful session captures its environment at session creation, changing or removing the subscription token SHALL close any resident stateful session so the next stateful turn creates a fresh session that picks up the new credential. The stored session id SHALL be left intact so that next turn resumes the same conversation rather than losing context. If a stateful turn is currently in flight, the app SHALL refuse the token change with an explanatory message instead of tearing the session down mid-turn.

#### Scenario: New token applies to the next stateful turn

- **WHEN** the operator saves a different subscription token while a resident stateful session exists and no turn is running
- **THEN** that session is closed, and the next stateful turn opens a new session authenticated with the new token while resuming the stored session id

#### Scenario: Token change refused during a running stateful turn

- **WHEN** the operator attempts to save or remove the token while a stateful turn is executing
- **THEN** the change is refused with a message explaining that the stateful turn must finish first, and the stored token and live session are left unchanged

#### Scenario: A stateless run is unaffected by the change

- **WHEN** the token is changed while stateless work is queued or running
- **THEN** the in-flight stateless run, which captured its environment at start, is left untouched, and the next stateless run picks up the new credential

### Requirement: A worker subprocess receives only the credentials it needs

A verb's subprocess or SDK session SHALL NOT inherit credentials it has no use for. The environment handed to a worker SHALL be derived by removing unrelated secrets from the parent environment, not by passing the parent environment through unchanged.

This is a least-privilege requirement, distinct from the billing-scoped handling of `ANTHROPIC_API_KEY` and not a replacement for it. The rationale here is exfiltration, not billing: a worker runs with `bypassPermissions`, has shell and network access with no approval prompt, and routinely processes content it did not author — files, repositories, and web pages that can carry instructions. Any secret sitting in its environment is one `echo $VAR` away from leaving the machine, with nothing in the run to stop it.

`GEMINI_API_KEY` SHALL be excluded from every verb's worker environment. No verb has a use for the voice provider's credential.

Every verb SHALL derive its environment through a single shared policy, so runs cannot drift apart as they did when each maintained its own exclusion list.

#### Scenario: The voice credential does not reach a stateless verb's worker
- **WHEN** a stateless verb's run starts while a voice API key is configured
- **THEN** that key is absent from the run's environment

#### Scenario: The voice credential does not reach the stateful session
- **WHEN** the stateful session is created while a voice API key is configured
- **THEN** that key is absent from the session's environment

#### Scenario: Existing billing behavior is unchanged
- **WHEN** the stateful session is created with a subscription token configured
- **THEN** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are still excluded, and the session still authenticates against the subscription token

#### Scenario: Every verb keeps the credentials it does need
- **WHEN** a verb's worker starts
- **THEN** the credentials that run actually authenticates with remain present, and the run succeeds as before

### Requirement: Every verb authenticates from one credential set

Every verb SHALL authenticate through the same credential set, since all now run on the Agent SDK against a binary that ships with the app and therefore have no host `/login` credential store to fall back on.

The app SHALL accept either credential: `CLAUDE_CODE_OAUTH_TOKEN` (billing against the Claude subscription) or `ANTHROPIC_API_KEY` (metered). When both are present the subscription token SHALL win. When neither is present, no run SHALL be attempted, and the pipeline SHALL be unavailable (see `pipeline-availability`).

A credential SHALL come from the app's own configuration. A run SHALL NOT authenticate from the credential store of a separately-installed Claude Code, because that would make the app depend on the user's own install and would hide, on a machine that happens to have one, the failure a machine without one would hit.

#### Scenario: A run uses the subscription token

- **WHEN** a run starts and `CLAUDE_CODE_OAUTH_TOKEN` is set
- **THEN** the Agent SDK run authenticates with that token and bills against the subscription

#### Scenario: An API-key-only user can run every verb

- **WHEN** a run starts with only `ANTHROPIC_API_KEY` set
- **THEN** the run proceeds and bills per token, rather than being refused for lack of a subscription token

#### Scenario: A host Claude Code login is not borrowed

- **WHEN** a run starts with no credential configured in the app, on a machine whose separately-installed Claude Code is logged in
- **THEN** the run fails to authenticate rather than succeeding on that login

#### Scenario: Missing credential is reported clearly

- **WHEN** a run is attempted with no usable credential
- **THEN** the app surfaces an actionable error pointing at the Setup panel's credential fields, rather than failing silently

### Requirement: The metered API key yields to a subscription token, for every verb

When a subscription token is present, the app SHALL remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment of **every** verb's worker, so a stray API key cannot silently move usage onto metered billing. When no subscription token is present, `ANTHROPIC_API_KEY` SHALL be left in place as the only credential that user has.

Exclusion by environment subtraction is deliberately stronger than relying on the SDK's own auth precedence.

#### Scenario: Stray API key is stripped when a token exists

- **WHEN** both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` are present and any run starts
- **THEN** the API key is absent from that run's environment and billing goes to the subscription

#### Scenario: API key survives when it is the only credential

- **WHEN** only `ANTHROPIC_API_KEY` is present and a run starts
- **THEN** the key is present in that run's environment and the run authenticates with it
