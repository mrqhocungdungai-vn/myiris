## ADDED Requirements

### Requirement: Both role runs authenticate from one credential set

Both roles SHALL authenticate through the same credential set, since both now run on the Agent SDK against a binary that ships with the app and therefore has no host `/login` credential store to fall back on.

The app SHALL accept either credential: `CLAUDE_CODE_OAUTH_TOKEN` (billing against the Claude subscription) or `ANTHROPIC_API_KEY` (metered). When both are present the subscription token SHALL win. When neither is present, no role run SHALL be attempted, and the pipeline SHALL be unavailable (see `pipeline-availability`).

A credential SHALL come from the app's own configuration. A run SHALL NOT authenticate from the credential store of a separately-installed Claude Code, because that would make the app depend on the user's own install and would hide, on a machine that happens to have one, the failure a machine without one would hit.

#### Scenario: A role session uses the subscription token

- **WHEN** a role run starts and `CLAUDE_CODE_OAUTH_TOKEN` is set
- **THEN** the Agent SDK run authenticates with that token and bills against the subscription

#### Scenario: An API-key-only user can run both roles

- **WHEN** a role run starts with only `ANTHROPIC_API_KEY` set
- **THEN** the run proceeds and bills per token, rather than being refused for lack of a subscription token

#### Scenario: A host Claude Code login is not borrowed

- **WHEN** a role run starts with no credential configured in the app, on a machine whose separately-installed Claude Code is logged in
- **THEN** the run fails to authenticate rather than succeeding on that login

#### Scenario: Missing credential is reported clearly

- **WHEN** a role run is attempted with no usable credential
- **THEN** the app surfaces an actionable error pointing at the Setup panel's credential fields, rather than failing silently

### Requirement: The metered API key yields to a subscription token, for every role

When a subscription token is present, the app SHALL remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment of **every** role worker, so a stray API key cannot silently move usage onto metered billing. When no subscription token is present, `ANTHROPIC_API_KEY` SHALL be left in place as the only credential that user has.

Exclusion by environment subtraction is deliberately stronger than relying on the SDK's own auth precedence.

#### Scenario: Stray API key is stripped when a token exists

- **WHEN** both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` are present and any role run starts
- **THEN** the API key is absent from that run's environment and billing goes to the subscription

#### Scenario: API key survives when it is the only credential

- **WHEN** only `ANTHROPIC_API_KEY` is present and a role run starts
- **THEN** the key is present in that run's environment and the run authenticates with it

## MODIFIED Requirements

### Requirement: A worker subprocess receives only the credentials it needs

A role subprocess or SDK session SHALL NOT inherit credentials it has no use for. The environment handed to a worker SHALL be derived by removing unrelated secrets from the parent environment, not by passing the parent environment through unchanged.

This is a least-privilege requirement, distinct from the billing-scoped handling of `ANTHROPIC_API_KEY` and not a replacement for it. The rationale here is exfiltration, not billing: a worker runs with `bypassPermissions`, has shell and network access with no approval prompt, and routinely processes content it did not author — files, repositories, and web pages that can carry instructions. Any secret sitting in its environment is one `echo $VAR` away from leaving the machine, with nothing in the run to stop it.

`GEMINI_API_KEY` SHALL be excluded from every role worker's environment. No role has a use for the voice provider's credential.

Both roles SHALL derive their environment through a single shared policy, so the two cannot drift apart as they did when each maintained its own exclusion list.

#### Scenario: The voice credential does not reach a stateless role worker
- **WHEN** a stateless role run starts while a voice API key is configured
- **THEN** that key is absent from the run's environment

#### Scenario: The voice credential does not reach the stateful role session
- **WHEN** the stateful role session is created while a voice API key is configured
- **THEN** that key is absent from the session's environment

#### Scenario: Existing billing behavior is unchanged
- **WHEN** the stateful role session is created with a subscription token configured
- **THEN** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are still excluded, and the session still authenticates against the subscription token

#### Scenario: Roles keep the credentials they do need
- **WHEN** a role worker starts
- **THEN** the credentials that role actually authenticates with remain present, and the run succeeds as before

### Requirement: Auth requirements are documented

The credential requirement SHALL be documented in the app's configuration surface so an operator can enable either billing path without reading the code.

#### Scenario: Configuration docs describe the token

- **WHEN** an operator consults `.env.example` / README to configure the app
- **THEN** they find how to mint a `CLAUDE_CODE_OAUTH_TOKEN` using the app's own bundled binary, the `ANTHROPIC_API_KEY` alternative, and the note that a subscription token takes precedence over a stray API key

### Requirement: A token change invalidates the resident PO session

Because the live PO session captures its environment at session creation, changing or removing the subscription token SHALL close any resident PO session so the next PO turn creates a fresh session that picks up the new credential. The stored PO session id SHALL be left intact so that next turn resumes the same conversation rather than losing context. If a PO turn is currently in flight, the app SHALL refuse the token change with an explanatory message instead of tearing the session down mid-turn.

#### Scenario: New token applies to the next PO turn

- **WHEN** the operator saves a different subscription token while a resident PO session exists and no turn is running
- **THEN** that session is closed, and the next PO turn opens a new session authenticated with the new token while resuming the stored session id

#### Scenario: Token change refused during a running PO turn

- **WHEN** the operator attempts to save or remove the token while a PO turn is executing
- **THEN** the change is refused with a message explaining that the PO turn must finish first, and the stored token and live session are left unchanged

#### Scenario: DEV is unaffected by the change

- **WHEN** the token is changed while DEV work is queued or running
- **THEN** the in-flight DEV run, which captured its environment at start, is left untouched, and the next DEV run picks up the new credential

## REMOVED Requirements

### Requirement: SDK-role sessions authenticate via subscription token

**Reason**: scoped to the stateful PO session, on the stated grounds that the stateless role "retains its existing `/login`-based subscription auth and is out of scope". That is true of a host-installed CLI and false of a bundled one, which has no `/login` store — so the scoping would have left a packaged DEV unable to authenticate at all. Replaced by the single credential set above, which also admits `ANTHROPIC_API_KEY`.
**Migration**: a subscription-token user is unaffected. An API-key-only user gains a working pipeline instead of PO turns that all fail.

### Requirement: API key is excluded from the SDK-role session environment

**Reason**: the exclusion was unconditional and PO-scoped. Unconditional is wrong now that an API key is a first-class credential — stripping it from a user who has nothing else leaves them unable to authenticate. PO-scoped is wrong now that both roles authenticate the same way. Replaced by the conditional, all-roles rule above.
**Migration**: none for a subscription user. An API-key-only user's key is no longer stripped.

### Requirement: The subscription token's reach is limited to the role that authenticates with it

**Reason**: reversed. The token now reaches every role, because every role authenticates with it. The requirement's own caution — that which roles authenticate by which means must be established by verification rather than assumption — is exactly what this change acted on: the assumption that the stateless role authenticated by another means was inherited from a host CLI and was never true of the bundled one.
**Migration**: none. No role loses a credential; one gains the one it needs.
