## MODIFIED Requirements

### Requirement: The subscription token is configurable at runtime from the app

The app SHALL let an operator set and clear `CLAUDE_CODE_OAUTH_TOKEN` from its own settings surface, persisted to the same effective `.env` the app already reads (repo `.env` in dev, `~/.myiris/.env` packaged) and applied to the running process environment on save, so a packaged install never requires hand-editing a hidden file to enable subscription billing. The token SHALL be stored in plaintext in that file, consistent with the other credentials the app manages, because it must reach the Claude subprocess environment in cleartext.

#### Scenario: Token set from the app takes effect without restart

- **WHEN** an operator saves a subscription token from the app's settings surface
- **THEN** the token is written to the effective `.env` and applied to the running process environment, and the next stateful turn authenticates with it

#### Scenario: Token cleared from the app

- **WHEN** an operator removes the stored token from the app's settings surface
- **THEN** the token is cleared from both the effective `.env` and the running process environment, and subsequent stateful turns fail with the existing actionable missing-token error

#### Scenario: Token value stays in the main process

- **WHEN** the token is saved, read back, or logged anywhere in this flow
- **THEN** the value is never sent to the renderer and never written to logs — only its presence is reported
