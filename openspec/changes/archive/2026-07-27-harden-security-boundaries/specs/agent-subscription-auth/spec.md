## ADDED Requirements

### Requirement: A worker subprocess receives only the credentials it needs

A role subprocess or SDK session SHALL NOT inherit credentials it has no use for. The environment handed to a worker SHALL be derived by removing unrelated secrets from the parent environment, not by passing the parent environment through unchanged.

This is a least-privilege requirement, distinct from the existing billing-scoped exclusion of `ANTHROPIC_API_KEY` and not a replacement for it. The rationale here is exfiltration, not billing: a worker runs with `bypassPermissions`, has shell and network access with no approval prompt, and routinely processes content it did not author — files, repositories, and web pages that can carry instructions. Any secret sitting in its environment is one `echo $VAR` away from leaving the machine, with nothing in the run to stop it.

`GEMINI_API_KEY` SHALL be excluded from every role worker's environment. No role has a use for the voice provider's credential.

#### Scenario: The voice credential does not reach a stateless role worker
- **WHEN** a stateless role subprocess is spawned while a voice API key is configured
- **THEN** that key is absent from the subprocess environment

#### Scenario: The voice credential does not reach the stateful role session
- **WHEN** the stateful role session is created while a voice API key is configured
- **THEN** that key is absent from the session's environment

#### Scenario: Existing billing behavior is unchanged
- **WHEN** the stateful role session is created
- **THEN** the existing exclusion of `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` still applies, and the session still authenticates against the subscription token exactly as before

#### Scenario: Roles keep the credentials they do need
- **WHEN** a role worker starts
- **THEN** the credentials that role actually authenticates with remain present, and the run succeeds as before

### Requirement: The subscription token's reach is limited to the role that authenticates with it

The subscription token SHALL be present only in the environment of the role that uses it to authenticate. A role that authenticates by another means SHALL NOT receive it.

Which roles authenticate by which means SHALL be established by verification rather than assumption before the token is withheld from any role, because removing a credential a role is silently relying on would move that role's usage to a different billing path — a failure that is easy to miss and expensive to discover late.

#### Scenario: The authenticating role keeps its token
- **WHEN** the role that authenticates via the subscription token starts a turn
- **THEN** the token is present in its environment and billing is unchanged

#### Scenario: A role authenticating by another means does not receive the token
- **WHEN** a role that has been verified to authenticate by another means starts a run
- **THEN** the subscription token is absent from its environment and the run still succeeds against the expected billing path
