## Purpose

Iris's launch-admission policy: the app only runs on macOS, refusing to start on other platforms (with a documented developer escape hatch), before any window, tray, or global shortcut is created.

## Requirements

### Requirement: Iris runs only on macOS

Iris SHALL run only on macOS. When the app becomes ready on any platform other than macOS (`process.platform !== "darwin"`), it SHALL show a native message informing the user that Iris only supports macOS and then quit **before** creating any window, tray, or global shortcut — no partial UI is ever brought up on an unsupported platform. As a developer escape hatch, when the environment variable `IRIS_ALLOW_ANY_PLATFORM` is set to `1`, the app SHALL skip this check and continue launching on any platform. The check SHALL be the first action taken once the app is ready, so that no launch side-effects run ahead of it.

#### Scenario: Launch on an unsupported platform

- **WHEN** the app becomes ready and `process.platform` is not `"darwin"` and `IRIS_ALLOW_ANY_PLATFORM` is not `"1"`
- **THEN** a native message stating that Iris only supports macOS is shown, and the app quits without creating a window, tray, or registering any global shortcut

#### Scenario: Launch on macOS

- **WHEN** the app becomes ready and `process.platform` is `"darwin"`
- **THEN** the app proceeds with its normal startup (window, tray, shortcuts, IPC handlers) unaffected by the guard

#### Scenario: Developer escape hatch on a non-macOS platform

- **WHEN** the app becomes ready, `process.platform` is not `"darwin"`, and `IRIS_ALLOW_ANY_PLATFORM` is set to `"1"`
- **THEN** the guard is skipped and the app proceeds with its normal startup
