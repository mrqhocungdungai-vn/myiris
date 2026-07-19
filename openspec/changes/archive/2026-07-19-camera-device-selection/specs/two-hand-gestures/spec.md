## ADDED Requirements

### Requirement: Device-selectable camera acquisition

The gesture engine's camera acquisition SHALL accept a selected video input device identifier (a `deviceId`, or a `"System Default"` sentinel) and use it to constrain `getUserMedia`: the System Default sentinel SHALL preserve the unconstrained `facingMode: "user"` behavior, while an explicit `deviceId` SHALL be requested via an exact `deviceId` constraint with no `facingMode` constraint applied. A change to the selected device SHALL be treated as a reason to re-acquire the camera stream — tearing down the previous stream, recognizer, and tracking loop before acquiring the new one — including while gesture control is already enabled and running.

If the selected device cannot be opened (not present among current devices, or `getUserMedia` rejects), the engine SHALL surface that failure through its existing error-reporting path and SHALL NOT silently retry with a different device or with the system default; gesture control remains unavailable until the failure is resolved (e.g. the user starts the missing device or selects a different one).

#### Scenario: System Default preserves prior behavior

- **WHEN** the selected device is System Default (or no selection has ever been made)
- **THEN** the camera is acquired exactly as before this change, with no `deviceId` constraint

#### Scenario: Explicit device selected

- **WHEN** a specific `deviceId` is selected
- **THEN** `getUserMedia` is called with that `deviceId` as an exact constraint and no `facingMode` constraint

#### Scenario: Device changes while gesture control is running

- **WHEN** gesture control is active and the selected device changes
- **THEN** the previous stream, recognizer, and tracking loop are torn down and a new stream is acquired from the newly selected device, without requiring the user to toggle gesture control off and on

#### Scenario: Selected device unavailable

- **WHEN** the selected device cannot be opened (missing or rejected by `getUserMedia`)
- **THEN** the failure is reported through the existing hand-control error path and gesture control does not silently start using a different camera
