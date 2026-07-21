## ADDED Requirements

### Requirement: The subscription token is configurable at runtime from the app

The app SHALL let an operator set and clear `CLAUDE_CODE_OAUTH_TOKEN` from its own settings surface, persisted to the same effective `.env` the app already reads (repo `.env` in dev, `~/.iris/.env` packaged) and applied to the running process environment on save, so a packaged install never requires hand-editing a hidden file to enable subscription billing. The token SHALL be stored in plaintext in that file, consistent with the other credentials the app manages, because it must reach the Claude subprocess environment in cleartext.

#### Scenario: Token set from the app takes effect without restart

- **WHEN** an operator saves a subscription token from the app's settings surface
- **THEN** the token is written to the effective `.env` and applied to the running process environment, and the next PO turn authenticates with it

#### Scenario: Token cleared from the app

- **WHEN** an operator removes the stored token from the app's settings surface
- **THEN** the token is cleared from both the effective `.env` and the running process environment, and subsequent PO turns fail with the existing actionable missing-token error

#### Scenario: Token value stays in the main process

- **WHEN** the token is saved, read back, or logged anywhere in this flow
- **THEN** the value is never sent to the renderer and never written to logs — only its presence is reported

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
- **THEN** DEV's environment and session handling are untouched, matching its existing `/login`-based auth path
