## ADDED Requirements

### Requirement: Keyboard wake and sleep are global shortcuts

Iris SHALL offer a keyboard shortcut to wake and a keyboard shortcut to sleep. Both
SHALL be registered by the main process as OS-level global shortcuts, so they work
while **any** application has focus and never require the Iris window to be focused
first. This is the property that makes them useful: the user reaches for them while
working in another application, which is the same reason the HUD toggle is global.

Each SHALL fire the identical wake and sleep paths already used by the tray, the wake
word, and the voice sleep tool — not a parallel implementation.

Both SHALL be **modifier-qualified**. A bare letter key SHALL NOT be used, because a
global binding on an ordinary typing key would intercept that key everywhere in the
operating system, and a window-level binding on one has to be defended by an
ever-growing list of text surfaces to exclude.

Both SHALL be configurable through the app's existing env-driven configuration
(`IRIS_*` keys), on the same terms as the other global hotkeys, with defaults that
work with no configuration and are documented in the authoritative env list.

A global shortcut can be pressed in states a window-level handler could never reach,
and it SHALL work in them. In particular, on macOS closing the deck does not quit
Iris — it continues running in the tray — so the wake shortcut SHALL wake Iris **with
no window open**, creating one if needed, rather than being silently discarded because
there is no renderer to deliver to. A shortcut that is registered and does nothing is
worse than one that is not registered, because nothing reports it.

Registration failure SHALL degrade gracefully: the failure SHALL be recorded, the app
SHALL continue running normally, and waking SHALL remain reachable by the tray, the
wake word, and the in-app control. A conflicting shortcut SHALL NOT be able to make
Iris unwakeable.

This SHALL hold for a **malformed** shortcut as well as a conflicting one. These
values are hand-edited by users, and a rejected accelerator is not the only failure
shape — an unparseable one can throw rather than return a failure, which would abort
whatever startup sequence registers it. A typo in configuration SHALL NOT be able to
take down unrelated startup work or leave Iris unwakeable.

All shortcuts Iris registers SHALL be released when the app quits.

Any user-facing text that names these shortcuts SHALL name the ones actually
registered. A prompt that instructs the user to press a key that no longer wakes Iris
is a defect in this requirement, on the same reasoning as the wake-word failure rule:
an instruction that is false is worse than none, because the resulting silence is
indistinguishable from the feature being broken.

#### Scenario: Wake from another application

- **WHEN** Iris is asleep and the user presses the wake shortcut while a different
  application has keyboard focus
- **THEN** Iris wakes, identically to the tray wake and the wake word, without the
  Iris window having to be focused first

#### Scenario: Sleep from another application

- **WHEN** Iris is awake and the user presses the sleep shortcut while a different
  application has keyboard focus
- **THEN** Iris sleeps, identically to the tray sleep path

#### Scenario: Typing an ordinary letter does not wake or sleep Iris

- **WHEN** the user types text containing the shortcut letters, in Iris or in any
  other application, without the modifier
- **THEN** Iris neither wakes nor sleeps

#### Scenario: Wake with no window open

- **WHEN** the user has closed the deck — Iris is still running in the tray — and
  presses the wake shortcut
- **THEN** Iris wakes and a window is available to the user, rather than the shortcut
  doing nothing

#### Scenario: Registration conflict leaves Iris reachable

- **WHEN** a configured shortcut cannot be registered because another application
  holds it
- **THEN** the failure is recorded, the app continues normally, and Iris can still be
  woken by tray, wake word, and the in-app control

#### Scenario: A malformed shortcut does not break startup

- **WHEN** a configured shortcut string is not valid accelerator syntax
- **THEN** the failure is recorded, the rest of the startup sequence completes, and
  Iris can still be woken by tray, wake word, and the in-app control

#### Scenario: Shortcuts are released on quit

- **WHEN** the app quits
- **THEN** every shortcut it registered is unregistered, and the key combinations
  return to the system

#### Scenario: Displayed keys match registered keys

- **WHEN** the interface tells the user which key wakes or sleeps Iris — the asleep
  prompt, a caption, a tooltip, or setup guidance
- **THEN** the key it names is the one actually registered, including when the default
  has been overridden by configuration
