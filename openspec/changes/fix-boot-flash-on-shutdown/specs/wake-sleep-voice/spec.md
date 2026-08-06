## ADDED Requirements

### Requirement: The boot intro plays only on a genuine start

The boot intro SHALL play only when the session transitions from not-running to
running — a start Iris actually performed. It SHALL NOT be derived from connection
status, because a session that is running but momentarily not connected is not a
start.

Specifically, the intro SHALL NOT play while an already-running session is
reconnecting, SHALL NOT play while the session is shutting down, and SHALL NOT play
when a start comes up already connected (a resume fast enough to have nothing to
cover). A connection status that changes without the session starting SHALL leave
intro visibility untouched.

#### Scenario: Reconnect does not replay the intro

- **WHEN** a running session loses its connection and re-dials, reporting a
  non-connected status for the duration of the backoff
- **THEN** the boot intro does not appear, and the deck stays on the live UI

#### Scenario: Shutdown does not flash the intro

- **WHEN** Iris is stopped and the connection is reported offline before the session
  is reported not-running
- **THEN** the boot intro does not appear at any point during teardown

#### Scenario: Instant resume skips the intro

- **WHEN** a session starts and is already connected at the moment it is reported
  running
- **THEN** the boot intro is skipped rather than shown and immediately dismissed

#### Scenario: A real start still plays it

- **WHEN** Iris starts from not-running and the session is not yet connected
- **THEN** the boot intro plays, and it is dismissed once the session reports
  connected — unchanged from the behavior a user sees on a cold start today

## MODIFIED Requirements

### Requirement: Boot-done handshake

The renderer SHALL notify the main process via `iris:boot-done` when the boot animation completes, and the main process SHALL defer the Gemini session greeting until then; wake-word arming SHALL also respect boot completion.

The handshake SHALL be reported only for an intro that actually played. A transition
that does not start Iris — a reconnect settling, a shutdown completing — SHALL NOT
report boot-done, so the greeting gate is never released by an event that was not a
boot.

#### Scenario: No talking over boot

- **WHEN** the app starts and the boot animation is still playing
- **THEN** Gemini's opening line is not spoken until the renderer reports boot-done

#### Scenario: Shutdown does not release the greeting gate

- **WHEN** Iris is stopped while the boot intro is still playing, leaving the
  greeting gate armed
- **THEN** teardown does not report boot-done, and no greeting is emitted on the way
  down

#### Scenario: Reconnect does not report boot-done

- **WHEN** a running session reconnects and returns to connected
- **THEN** no boot-done is reported for that transition
