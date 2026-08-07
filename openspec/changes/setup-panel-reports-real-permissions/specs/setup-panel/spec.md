## MODIFIED Requirements

### Requirement: Claude-oriented setup and settings panel

The app SHALL provide a SetupPanel (adopted from upstream, Deep Space styled) that offers: Gemini API key entry with a live connection test, a Claude runtime check (the same bundled binary the worker uses; the host `PATH` is never probed), subscription-auth status derived from the existing subscription billing-path logic (`CLAUDE_CODE_OAUTH_TOKEN` present vs missing) together with an entry field that lets the user set or remove that token, a voice preview, toggles for wake word, interface sounds, demo test data, and Google Search, a wake-word sensitivity control, a camera device selector for gesture control, a microphone device selector for voice capture (see `microphone-device-selection` spec for its enumeration/persistence/hot-swap/fallback behavior), and a system-audio entry carrying the capture self-test. No Hermes endpoint configuration SHALL exist.

The wake-word sensitivity control SHALL sit with the existing wake-word toggle and SHALL present a small set of named sensitivity levels rather than a raw numeric field, so a user cannot enter a value that makes wake-word detection unusable in either direction. It SHALL control only the detection threshold; the consecutive-evaluation count specified in `wake-sleep-voice` SHALL remain configuration-only and SHALL NOT appear in the panel. When the effective configuration holds a threshold that matches no named level (a hand-edited `.env`), the control SHALL indicate that a custom value is in effect and SHALL NOT silently rewrite it to the nearest level; only an explicit user selection SHALL change it. The control SHALL be shown regardless of pipeline availability, since the wake word is part of chat-only operation, and SHALL be disabled or visibly inert while the wake-word toggle is off.

The subscription token control SHALL render only where the Claude prerequisite rows render — that is, when the Claude binary is reachable — so a chat-only install surfaces no token UI. It SHALL be a masked (password-type) input that is always empty on render, never pre-filled with the stored token, and SHALL carry its own save action rather than depending on the panel's global Save, so it also works inside the onboarding wizard's Claude step. A remove action SHALL be offered only while a token is stored. After a successful save or removal the panel SHALL re-run its existing Claude check so the displayed billing line reflects the new state without reopening the panel. The panel SHALL NOT validate the token by calling Claude or by inspecting its format; an unusable token surfaces through the normal run error.

The Google Search toggle SHALL control the `IRIS_ENABLE_GOOGLE_SEARCH` flag and SHALL sit in the existing "Gemini API key" section (it concerns the Gemini key, not the Claude pipeline), rendering regardless of pipeline availability. It SHALL carry a visible warning that Google Search requires a paid Gemini key — a free-tier key is disconnected with a 1011 quota error while search is enabled — and that the change applies on the next reconnect. Enabling or disabling it SHALL offer the panel's standard reconnect prompt rather than forcing a mid-session disconnect.

The camera device selector SHALL offer a `"System Default"` option plus one entry per enumerated `videoinput` device (via `navigator.mediaDevices.enumerateDevices()`), and SHALL remain disabled/hidden with an explanatory hint until the Camera permission is granted at the operating-system level, on the terms of "The Permissions step reports the operating system's answer" (device labels are empty until then). While the panel is mounted, the device list SHALL live-refresh on `navigator.mediaDevices.ondevicechange` so devices that appear or disappear at runtime (e.g. starting/stopping a virtual camera) are reflected without reopening the panel. If the currently saved selection is not present in the live-refreshed device list, the selector SHALL visually mark it as unavailable rather than silently switching to another device or to System Default. The selector SHALL always render regardless of how many video input devices are currently detected.

The microphone device selector SHALL render directly below the Microphone permission row in the Permissions section, following the same `"System Default"` + live-refreshed enumeration pattern as the camera selector, gated on the Microphone permission being granted at the operating-system level rather than on the renderer's own view of it. Unlike the camera selector, if the saved/selected microphone is unavailable it SHALL NOT merely mark the selection as unavailable — it SHALL fall back to System Default automatically, since a non-functioning microphone breaks voice conversation while a non-functioning gesture camera does not (see `microphone-device-selection` spec for the full fallback and hot-swap requirements).

#### Scenario: First run without a key

- **WHEN** the app starts and no Gemini API key is configured
- **THEN** the SetupPanel opens automatically and a successful key test enables starting the session

#### Scenario: Raising wake-word strictness

- **WHEN** a user whose Iris wakes on its own selects a stricter sensitivity level and saves
- **THEN** the threshold is persisted to the effective `.env` and the next armed listener uses it, without an app restart or hand-editing `.env`

#### Scenario: Hand-set threshold shown as custom

- **WHEN** the effective configuration holds a wake-word threshold that matches none of the named levels
- **THEN** the control reports a custom value is in effect and leaves it unchanged unless the user explicitly picks a level

#### Scenario: Sensitivity inert while wake word is off

- **WHEN** the wake-word toggle is off
- **THEN** the sensitivity control is disabled or visibly inert, since no detection is running

#### Scenario: Claude health surfaced

- **WHEN** the panel runs its checks
- **THEN** it reports whether the `claude` binary resolves and whether the subscription token is configured, with actionable text on failure (matching the errors the runtime already produces)

#### Scenario: Packaged user pastes a subscription token

- **WHEN** a user of a packaged build has the Claude CLI installed, has run `claude setup-token`, and pastes the result into the token field and saves
- **THEN** the token is persisted to the effective `.env` for the run mode, the Claude check re-runs, and the billing line reports that a subscription token is configured — with no hand-editing of `~/.myiris/.env` and no app restart

#### Scenario: Token control hidden in chat-only mode

- **WHEN** the SetupPanel is open on a machine where the `claude` binary does not resolve
- **THEN** no token field or remove action is shown, alongside the existing chat-only explanation

#### Scenario: Removing a stored token

- **WHEN** a token is stored and the user activates the remove action
- **THEN** the stored token is cleared from the effective `.env` and the running process environment, and the Claude check re-runs and reports the token as missing with its actionable text

#### Scenario: Google Search toggle warns about billing

- **WHEN** the user views the Google Search toggle in the existing "Gemini API key" section
- **THEN** it shows a warning that Google Search needs a paid Gemini key and that a free-tier key is disconnected with a 1011 quota error, and this toggle renders whether or not the Claude pipeline is available

#### Scenario: Toggle state matches runtime behavior for any accepted value

- **WHEN** `.env` is hand-edited with an alternate accepted truthy value (e.g. `1`, `yes`, or `on`) for `IRIS_ENABLE_GOOGLE_SEARCH` instead of the literal `true`
- **THEN** the panel's displayed toggle state and the Live session's actual Google Search availability agree, because both read the flag through the same value-parsing rule

#### Scenario: Camera selector gated on permission

- **WHEN** the Camera permission has not yet been granted
- **THEN** the camera device selector is disabled or hidden with a hint to grant Camera permission first, instead of showing devices with blank or meaningless names

#### Scenario: Device appears while Settings is open

- **WHEN** Settings is open, Camera permission is granted, and a new video input device becomes available (e.g. the user starts OBS Virtual Camera)
- **THEN** the device selector's option list updates to include it without the user closing and reopening the panel

#### Scenario: Selecting a device applies immediately

- **WHEN** the user picks a device from the selector and it saves
- **THEN** the choice persists across app restarts and, if gesture control is currently active, its camera stream restarts immediately using the newly selected device

#### Scenario: Saved device no longer present

- **WHEN** the previously selected device does not appear in the current live-refreshed device list
- **THEN** the selector visually marks that saved selection as unavailable rather than silently falling back to a different device

#### Scenario: Microphone selector sits alongside the camera selector

- **WHEN** the user opens Settings with Microphone permission granted
- **THEN** a microphone device selector is visible in the Permissions section, offering "System Default" plus enumerated audio input devices, independent of the camera selector's state

## ADDED Requirements

### Requirement: The Permissions step reports the operating system's answer

Every permission row in the Permissions step SHALL report the state the
operating system holds, obtained from the main process, and SHALL NOT derive it
from the renderer's own view of the browser engine's permission store. A row
SHALL read as granted only when the OS has granted it.

The renderer's view is not evidence. The app grants microphone, camera, and
capture permission to its own document unconditionally as a security measure —
so a renderer-side query answers with the app's own decision, not the user's.
Measured on this platform, the renderer reports `granted` for the camera while
the OS reports `not-determined`: a row built on it shows a permission the OS has
never been asked for as one the user has given.

The distinction is what makes the row worth showing. A row that reads "Granted"
while the OS is blocking sends the user to look for the fault everywhere except
where it is, and the state where Iris cannot hear the user is exactly the state
where they cannot ask Iris about it.

Four states SHALL be distinguished, because the action that resolves each one
differs: not yet asked, granted, refused, and **restricted** — refused by device
policy rather than by the user. Restricted SHALL NOT be folded into not-yet-asked:
the user cannot grant it and an in-app prompt returns immediately without asking,
so offering one there rebuilds the same dead end this change exists to remove,
under a different label. A restricted row SHALL say the permission is managed
rather than invite an action that cannot work.

Any state the platform reports that is none of these SHALL be treated as not yet
asked, which offers the prompt rather than a dead end.

Any device selector gated on a permission SHALL gate on this same state, so a
selector never populates from a permission the OS has not given.

#### Scenario: A permission the OS has not granted is not shown as granted

- **WHEN** the operating system reports the camera permission as not yet determined
- **THEN** the Camera row does not read as granted
- **AND** it offers the action that asks for it

#### Scenario: The row reflects the OS, not the app's own grant

- **WHEN** the app has granted its own document camera access internally while the OS has not granted it
- **THEN** the Camera row still reports the OS's answer

#### Scenario: A granted permission is shown as granted

- **WHEN** the operating system reports the microphone permission as granted
- **THEN** the Microphone row reads as granted and offers no redundant prompt

#### Scenario: A restricted permission is not offered a prompt

- **WHEN** the operating system reports a permission as restricted by device policy
- **THEN** the row says the permission is managed and does not offer an in-app prompt that would return without asking

#### Scenario: An unrecognised state falls back to prompting

- **WHEN** the platform reports a permission state the app does not recognise
- **THEN** the row offers the prompt rather than presenting a state it cannot act on

#### Scenario: Selectors gate on the same state

- **WHEN** a permission is not granted at the OS level
- **THEN** the device selector that depends on it stays hidden or disabled with its explanatory hint, rather than listing devices

#### Scenario: The state refreshes without reopening the panel

- **WHEN** the user grants a permission outside the app while the panel is open
- **THEN** the corresponding row updates to granted without the panel being closed and reopened

### Requirement: A refused permission routes to where it can be changed

When a permission has been refused at the operating-system level, the
Permissions step SHALL offer a route to the system settings that govern it, and
SHALL NOT offer an in-app retry as the way out.

Asking again is not a route. Once the OS has recorded a refusal it does not
prompt again, so an in-app retry cannot succeed however many times it is
pressed — it is an action whose only outcome is the failure it was offered to
resolve. The setting that would fix it lives somewhere the user has no reason to
know about.

The in-app prompt SHALL remain the offered action while the permission has
merely not been asked for yet, which is the one state where asking still works.

The route SHALL NOT be the only instruction the user gets. The settings location
SHALL also be stated in words next to it, because a deep link into system
settings is a convenience that decays: link targets for these panes have been
observed to stop working across operating-system releases, and a link that
silently opens the wrong page reports success while leaving the user exactly
where they were. The app cannot detect that case — opening the settings
application succeeds whether or not the requested page was reached — so the
written location is what remains when the link rots, and it SHALL be present
whether or not the link works.

The app SHALL NOT claim the permission was changed as a result of opening
settings. The row SHALL continue to report what the OS reports.

Where granting a permission does not take effect until the app is relaunched,
the app SHALL say so at the point the user returns from granting it, rather than
presenting a row that reads granted while the capability is still unavailable.
Reporting a permission as granted while Iris still cannot use it is the same
class of untruth this capability's other requirements exist to remove.

#### Scenario: A refused permission offers the settings route

- **WHEN** the operating system reports a permission as refused
- **THEN** the row offers to open the system settings that govern it
- **AND** it does not present an in-app retry as the resolution

#### Scenario: An unasked permission still prompts in-app

- **WHEN** a permission has not yet been asked for
- **THEN** the row offers the in-app prompt, since that is the state where asking works

#### Scenario: Opening settings does not fake a grant

- **WHEN** the user opens the system settings from the row and does not change anything
- **THEN** the row still reports the permission as refused

#### Scenario: The settings location is written out, not only linked

- **WHEN** a row offers the settings route
- **THEN** the location is also stated in words, so it remains usable if the link opens the wrong page

#### Scenario: A grant needing a relaunch says so

- **WHEN** a permission is granted outside the app and does not take effect until Iris is relaunched
- **THEN** the app says a relaunch is needed rather than presenting the capability as available

### Requirement: The Permissions step names system audio and can test it

The Permissions step SHALL carry an entry for the system audio that listen-only
mode captures, stating that engaging the mode captures what the machine plays.
That entry SHALL offer a test rather than a grant.

A grant is the wrong affordance because the governing permission cannot be
READ, not because none exists. The operating system does have a permission for
system-audio recording, distinct from screen recording and presented alongside
it. What the app cannot do is ask for its state: the platform interface
available here reports microphone, camera, and screen only. Measured on this
platform, the audio-only capture delivers audio while the screen-recording state
reads as refused — so the state the app can see is not the state that governs
the outcome, and a row built on it would report the wrong permission
confidently.

So the row SHALL NOT report a permission state, and SHALL NOT offer to grant
one. It SHALL report what trying produces.

What the user needs to know is whether Iris will actually hear anything, and the
only thing that answers that is trying. The test SHALL open the capture,
determine whether audio is arriving, report the verdict, and close the capture.

It SHALL distinguish four outcomes, because the action that resolves each
differs: audio heard; capture obtained but silent; capture not obtainable; and
the operating system being too old to provide system-audio capture at all. The
second is the observed failure that otherwise looks identical to working until a
meeting has already been recorded to nothing. The fourth SHALL be reported as
its own outcome rather than as silence, because the app declares support for
operating-system versions older than the one this capture requires, and on those
the capture is not broken but absent — telling that user to check a permission
would send them after a setting that cannot help.

Because the governing permission is unreadable but not absent, a verdict of
silence or of not-obtainable SHALL offer the route to the system settings that
govern system-audio recording, on the same terms as a refused permission row. A
user who once refused that prompt is otherwise stranded with a verdict that
never changes and nothing to act on.

The test SHALL be bounded in time and SHALL leave no capture running once it
has reported, whatever its verdict and whether or not the user stays on the
panel. Its verdict SHALL come from the same silence determination the mode
itself uses, so that the panel and the mode cannot disagree about whether Iris
is hearing anything.

The test SHALL state that a verdict of silence usually means nothing is playing,
so a user testing against a silent machine is not told their setup is broken.

Running the test SHALL be disclosed as itself opening a capture of the machine's
audio, on the same terms the mode's own consent point uses, because pressing it
starts the same capture and may raise the operating system's own recording
prompt. The entry SHALL NOT author a second description of what is captured
where `listen-only-mode` already defines one.

Where the system-audio configuration is disabled, the entry SHALL say so and
SHALL NOT offer the test, since no capture is reachable by any route in that
configuration and a test could only report a failure the user chose.

#### Scenario: The step says what the mode captures

- **WHEN** the user opens the Permissions step
- **THEN** it carries an entry stating that listen-only mode captures the audio the machine plays

#### Scenario: The test discloses that it captures

- **WHEN** the user is offered the test
- **THEN** it is stated that running it opens a capture of the machine's audio and may raise the operating system's own prompt

#### Scenario: An operating system too old is its own verdict

- **WHEN** the test runs on an operating system older than the one system-audio capture requires
- **THEN** it reports that the operating system does not provide this capture, distinctly from silence and from a capture that could not be obtained
- **AND** it does not send the user to check a permission

#### Scenario: A failing verdict offers the settings route

- **WHEN** the test reports silence or a capture that could not be obtained
- **THEN** it offers the route to the system settings governing system-audio recording, with that location also stated in words

#### Scenario: The escape hatch removes the test

- **WHEN** the system-audio configuration is disabled
- **THEN** the entry says so and offers no test

#### Scenario: A working capture reports that Iris hears

- **WHEN** the user runs the test while the machine is playing audio
- **THEN** it reports that Iris can hear the machine

#### Scenario: A silent capture is reported as silence, not success

- **WHEN** the test obtains a capture that delivers only silence
- **THEN** it reports that nothing was heard, distinctly from a capture that could not be obtained
- **AND** it notes that this is expected when nothing is playing

#### Scenario: A capture that cannot be obtained is reported as such

- **WHEN** the test cannot obtain a capture at all
- **THEN** it reports that, distinctly from a capture that was obtained and heard nothing

#### Scenario: The test does not outlive its verdict

- **WHEN** the test finishes for any reason, including the user leaving the panel while it runs
- **THEN** no system-audio capture remains open

#### Scenario: The panel and the mode agree about silence

- **WHEN** the test judges whether audio is arriving
- **THEN** it uses the same determination listen-only mode uses, rather than a second definition of silence
