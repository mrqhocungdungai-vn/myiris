## Purpose

Durability guarantees for Iris's on-disk state — the session store and the user configuration file (`.env`). Writes must never leave a target half-written, a corrupt store must never be silently discarded or overwritten, and the session store must carry a schema version so reads stay tolerant across upgrades.

## Requirements

### Requirement: On-disk state is written atomically

Every write of durable local state — the session store and the user configuration file (`.env`) — SHALL be performed atomically, such that a crash, power loss, or forced termination during the write leaves the previous complete contents intact rather than a truncated or partial file. A write SHALL NOT truncate the target in place. On a failed write, no temporary artifact SHALL be left behind in place of, or alongside, the target.

#### Scenario: A crash mid-write does not corrupt the existing file

- **WHEN** the app is writing durable state and the process is terminated before the write completes
- **THEN** the target file still contains its previous complete contents, not an empty or partial file

#### Scenario: A completed write leaves no temporary file

- **WHEN** a durable-state write completes normally
- **THEN** the target holds the new contents and no leftover temporary write file remains in the directory

### Requirement: A corrupt session store is preserved, not overwritten

When the session store exists but cannot be read or parsed, the app SHALL NOT silently discard it and SHALL NOT overwrite it with a fresh empty store. It SHALL move the unreadable file aside to a distinct quarantine name and record that it did so, so the original bytes remain recoverable. A genuinely absent store (first run) SHALL be treated as the normal empty-start case, distinct from corruption, without a quarantine or an error.

#### Scenario: Corrupt store is quarantined on load

- **WHEN** the session store file is present but unreadable or unparseable at load
- **THEN** the file is renamed to a distinct quarantine name (preserving its bytes) and the event is logged
- **AND** any subsequent automatic save writes a fresh store without destroying the quarantined original

#### Scenario: Missing store is a normal first run

- **WHEN** no session store file exists at load
- **THEN** the app starts with an empty store silently, without quarantining anything or logging an error

### Requirement: The session store is schema-versioned with tolerant reads

The session store SHALL carry a schema version identifying the format it was written in. Reading SHALL tolerate a store that predates the version field (treating it as the legacy format and loading it) and SHALL NOT require a migration for an unversioned file. A store whose version is newer than the running build understands SHALL be treated as unreadable — quarantined rather than parsed and overwritten — so a newer version's data is never downgraded away.

#### Scenario: New writes carry the version

- **WHEN** the app saves the session store
- **THEN** the written file includes the current schema version

#### Scenario: An unversioned store still loads

- **WHEN** the app loads a session store written before the schema-version field existed
- **THEN** the store loads normally without error and is rewritten with the version on the next save

#### Scenario: A future-version store is not downgraded

- **WHEN** the app loads a session store whose schema version is newer than the running build understands
- **THEN** the file is quarantined rather than parsed, so its data is not overwritten by an older format

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

### Requirement: The executable Iris spawns is validated before the spawn

Before Iris spawns the Claude runtime, the resolved executable path SHALL be
validated: it SHALL exist, SHALL be a regular file, and SHALL be executable by the
current user. A path failing validation SHALL fail with a clear error naming the
component being resolved and the condition that failed, and SHALL NOT fall through
to a bare command name, to a host-installed binary, or to any other candidate.

The path validated is the one the app ships, because that is the only path there
is: there SHALL be no setting that points Iris at a host-installed runtime (see
`pipeline-availability`), so configuration cannot redirect this spawn. Validation
is still required, and is not a formality — it is the one place a packaging fault,
such as a missing `asarUnpack` target or an executable bit lost in a copy, becomes
an error naming its cause instead of a bare `ENOENT` at spawn time against a path
the user has never heard of.

#### Scenario: A missing bundled executable fails loudly

- **WHEN** the bundled runtime cannot be resolved, or resolves to a path that does not exist
- **THEN** the failure names the bundled component and points at reinstalling, and no subprocess is spawned

#### Scenario: A non-executable bundled path is refused

- **WHEN** the resolved path exists but is not a regular file, or is not executable by the current user
- **THEN** the failure names that condition, and no subprocess is spawned

#### Scenario: Validation never falls back to the host

- **WHEN** validation fails for any reason
- **THEN** Iris does not search `PATH`, does not spawn a host-installed runtime, and does not substitute another candidate
