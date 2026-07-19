## Purpose

The set of surfaces that toggle Iris's HUD overlay mode and keep it reachable while the main window is unfocused or minimized to the tray — a renderer control, a global hotkey, and a tray (menu-bar) item — plus the tray's wake/sleep shortcuts.

## Requirements

### Requirement: Three activation surfaces
HUD mode SHALL be toggleable three ways with identical effect: (1) a renderer control invoking `hud:toggle`, (2) a global hotkey configurable via `IRIS_HUD_HOTKEY` (default `Alt+Space`), and (3) a tray (menu-bar) item. The main process owns the current mode and broadcasts changes via `hud:mode`.

#### Scenario: Hotkey toggle from another app
- **WHEN** the user presses the HUD hotkey while a different application has focus
- **THEN** Iris toggles between deck and HUD mode without requiring the Iris window to be focused first

#### Scenario: Hotkey registration failure degrades gracefully
- **WHEN** the configured hotkey cannot be registered (conflict)
- **THEN** a log event records the failure, the app continues normally, and HUD remains reachable via the UI control and tray

### Requirement: Tray presence with wake and sleep
The app SHALL show a tray icon (template images bundled for macOS menu bar) whose menu offers at minimum: toggle HUD, wake, and sleep. Wake SHALL trigger the same wake path as the keyboard/wake-word (`iris:wake`), and sleep SHALL reuse the existing `iris:sleep` path. The global hotkey SHALL be unregistered on quit.

#### Scenario: Wake from the tray
- **WHEN** the app is asleep and the user picks the tray's wake item
- **THEN** the app wakes identically to the keyboard wake (pulse, cue, greeting behavior unchanged)

#### Scenario: Packaged build carries tray assets
- **WHEN** the packaged app launches
- **THEN** the tray icon renders from bundled template images (included in the electron-builder files list)
