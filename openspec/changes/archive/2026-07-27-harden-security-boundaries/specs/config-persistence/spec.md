## ADDED Requirements

### Requirement: A written config value round-trips as exactly one variable

The config writer and the config reader SHALL agree on what constitutes one value. A value that the reader cannot reconstruct as a single variable — because it contains a line break or other control character the line-oriented reader would split on — SHALL be refused at write time rather than written and silently re-read as several variables.

Refusal SHALL be explicit: the save SHALL fail with an actionable message naming the offending key, and no part of the update SHALL be written. A partial write is worse than a rejected one, because the file is the app's only editable configuration surface in a packaged build.

#### Scenario: A value containing a newline is refused
- **WHEN** a config save supplies a value containing a line break
- **THEN** the save fails with an error naming the key, and the config file is unchanged

#### Scenario: A refused save writes nothing at all
- **WHEN** a config save supplies several keys and one value contains a line break
- **THEN** none of the keys in that save are written

#### Scenario: Ordinary values with spaces still save
- **WHEN** a config save supplies a value containing spaces, quotes, or `#`
- **THEN** the value is written quoted and reads back identical to what was supplied

#### Scenario: A forged variable cannot be smuggled through a value
- **WHEN** a config save supplies a value crafted to look like a key/value pair on a second line
- **THEN** the save is refused and no additional variable exists in the config file after the attempt

### Requirement: A config-sourced executable path is validated before it is spawned

A path resolved from configuration or environment that will be executed as a subprocess SHALL be validated before the spawn: it SHALL exist, SHALL be a regular file, and SHALL be executable by the current user. A path failing validation SHALL cause the run to fail with a clear error naming the setting, and SHALL NOT fall through to a bare command name or to a different candidate.

Validation is required because the executable path is the highest-value sink reachable from configuration — a redirected binary runs with the user's full privileges on the next task.

#### Scenario: A missing configured binary fails loudly
- **WHEN** the configured binary override points at a path that does not exist
- **THEN** the run fails with an error naming the setting, and no subprocess is spawned

#### Scenario: A non-executable path is refused
- **WHEN** the configured binary override points at a file that is not executable
- **THEN** the run fails with an error naming the setting, and no subprocess is spawned

#### Scenario: An unset override still probes known locations
- **WHEN** no binary override is configured
- **THEN** the existing probe of known install locations is unchanged, and the chosen candidate is validated the same way
