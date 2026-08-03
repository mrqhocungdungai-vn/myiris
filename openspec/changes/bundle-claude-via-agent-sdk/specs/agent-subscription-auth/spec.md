## MODIFIED Requirements

### Requirement: SDK-role sessions authenticate via subscription token

Both roles SHALL authenticate through the same credential set, since both now run on the Agent SDK against a binary that ships with the app and therefore has no host `/login` credential store to fall back on.

The app SHALL accept either credential: `CLAUDE_CODE_OAUTH_TOKEN` (billing against the Claude subscription) or `ANTHROPIC_API_KEY` (metered). When both are present the subscription token SHALL win. When neither is present, no role run SHALL be attempted, and the pipeline SHALL be unavailable (see `pipeline-availability`).

#### Scenario: A role session uses the subscription token

- **WHEN** a role run starts and `CLAUDE_CODE_OAUTH_TOKEN` is set
- **THEN** the Agent SDK run authenticates with that token and bills against the subscription

#### Scenario: An API-key-only user can run both roles

- **WHEN** a role run starts with only `ANTHROPIC_API_KEY` set
- **THEN** the run proceeds and bills per token, rather than being refused for lack of a subscription token

#### Scenario: Missing credential is reported clearly

- **WHEN** a role run is attempted with no usable credential
- **THEN** the app surfaces an actionable error pointing at the Setup panel's credential fields, rather than failing silently

### Requirement: API key is excluded from the SDK-role session environment

When a subscription token is present, the app SHALL remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment of **every** role worker, so a stray API key cannot silently move usage onto metered billing. When no subscription token is present, `ANTHROPIC_API_KEY` SHALL be left in place as the only credential that user has.

Exclusion by environment subtraction is deliberately stronger than relying on the SDK's own auth precedence.

#### Scenario: Stray API key is stripped when a token exists

- **WHEN** both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` are present and any role run starts
- **THEN** the API key is absent from that run's environment and billing goes to the subscription

#### Scenario: API key survives when it is the only credential

- **WHEN** only `ANTHROPIC_API_KEY` is present and a role run starts
- **THEN** the key is present in that run's environment and the run authenticates with it

### Requirement: The subscription token's reach is limited to the role that authenticates with it

**Superseded in effect: the token now reaches every role, because every role authenticates with it.**

The app SHALL supply the subscription token to any role that authenticates with it, and SHALL NOT withhold it from a role on the assumption that another auth path exists. A bundled Claude binary inside a packaged app has no interactive `/login` credential store, so withholding the token from a role leaves that role unable to authenticate at all.

Which roles authenticate by which means SHALL still be established by verification rather than assumption before any credential is withheld.

#### Scenario: Every role receives the credential it authenticates with

- **WHEN** either the stateless or the stateful role starts a run with a subscription token configured
- **THEN** the token is present in that run's environment and the run succeeds against the subscription

#### Scenario: Withholding is not assumed from a host-CLI behavior

- **WHEN** deciding whether a role may have a credential withheld
- **THEN** the decision is based on how that role authenticates *as shipped*, not on how a separately-installed CLI behaved
