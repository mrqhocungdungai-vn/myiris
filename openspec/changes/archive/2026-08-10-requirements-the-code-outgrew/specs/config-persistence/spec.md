## ADDED Requirements

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

## REMOVED Requirements

### Requirement: A config-sourced executable path is validated before it is spawned

**Reason**: its subject no longer exists. The requirement was written when the
runtime was a host prerequisite reachable through a configuration override, and it
justified itself on exactly that basis ("the executable path is the highest-value
sink reachable from configuration"). Bundling removed the override and the probe
of known install locations deliberately, and `pipeline-availability` now forbids
reintroducing either — so its scenarios ("the configured binary override points at
a path that does not exist", "An unset override still probes known locations")
describe states that cannot occur. Replaced by the requirement above, which states
the same guarantee over the path that is actually spawned.

**Migration**: none. The validation itself is unchanged and already applies to the
bundled path; no configuration a user has set changes meaning, because no
configuration ever reached this sink after bundling.
