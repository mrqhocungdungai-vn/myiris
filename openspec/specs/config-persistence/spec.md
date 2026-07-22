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
