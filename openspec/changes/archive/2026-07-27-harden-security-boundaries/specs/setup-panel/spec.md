## ADDED Requirements

### Requirement: The Gemini API key follows the same presence-only read contract as the subscription token

The existing config-read contract already requires that secrets be reduced to presence/masked form and that full values not be sent back to the renderer. That contract SHALL apply to the Gemini API key, not only to the subscription token: `config:get` SHALL expose a boolean presence flag for the key and SHALL NOT return the key's value.

Consequently the key input SHALL render empty rather than pre-filled, exactly as the token input already does, and an empty value in an ordinary save SHALL mean "no change" so a global Save cannot blank a stored key. Clearing the key SHALL require an explicit action.

Rendering the value in a password-type input does not satisfy this. Visual masking hides the value from someone looking at the screen; it does not stop the value from being in renderer memory, where any code executing in the renderer can read it. The subscription token is already handled this way, so this is the established pattern applied consistently rather than a new one.

The live connection test SHALL keep working for a key the user has just typed, since that value is in the renderer already; testing a stored key SHALL be possible without the renderer holding it.

#### Scenario: The stored key is not returned to the renderer
- **WHEN** the renderer reads the effective config while a Gemini API key is stored
- **THEN** it receives only a boolean indicating a key is present, and the key string never crosses the IPC boundary

#### Scenario: The key field renders empty
- **WHEN** the setup panel opens with a key already stored
- **THEN** the key input is empty and the panel indicates that a key is configured

#### Scenario: A global save does not blank a stored key
- **WHEN** a config save is submitted with an empty or whitespace-only value for the Gemini API key
- **THEN** the previously stored key is left intact in both the config file and the process environment

#### Scenario: Testing a freshly typed key still works
- **WHEN** the user types a key and runs the connection test before saving
- **THEN** the test uses the typed value and reports success or failure as before

#### Scenario: Testing a stored key does not require returning it
- **WHEN** the user runs the connection test with a key stored and the input left empty
- **THEN** the test runs against the stored key without that key being sent to the renderer

#### Scenario: Onboarding still accepts a first key
- **WHEN** a first-run user pastes a key into the onboarding wizard and saves
- **THEN** the key is persisted and the app becomes configured exactly as before this change
