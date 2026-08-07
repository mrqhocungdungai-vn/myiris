## Purpose

A Claude-oriented setup and settings panel (adopted from upstream, Deep Space styled) that lets the user configure the Gemini API key, verify Claude availability and subscription auth, preview the voice, and toggle wake word / interface sounds / demo test data — backed by a config IPC pair that persists changes to the effective `.env` file.
## Requirements
### Requirement: Claude-oriented setup and settings panel

The app SHALL provide a SetupPanel (adopted from upstream, Deep Space styled) that offers: Gemini API key entry with a live connection test, a Claude runtime check (the same bundled binary the worker uses; the host `PATH` is never probed), subscription-auth status derived from the existing subscription billing-path logic (`CLAUDE_CODE_OAUTH_TOKEN` present vs missing) together with an entry field that lets the user set or remove that token, a voice preview, toggles for wake word, interface sounds, demo test data, and Google Search, a wake-word sensitivity control, a camera device selector for gesture control, and a microphone device selector for voice capture (see `microphone-device-selection` spec for its enumeration/persistence/hot-swap/fallback behavior). No Hermes endpoint configuration SHALL exist.

The wake-word sensitivity control SHALL sit with the existing wake-word toggle and SHALL present a small set of named sensitivity levels rather than a raw numeric field, so a user cannot enter a value that makes wake-word detection unusable in either direction. It SHALL control only the detection threshold; the consecutive-evaluation count specified in `wake-sleep-voice` SHALL remain configuration-only and SHALL NOT appear in the panel. When the effective configuration holds a threshold that matches no named level (a hand-edited `.env`), the control SHALL indicate that a custom value is in effect and SHALL NOT silently rewrite it to the nearest level; only an explicit user selection SHALL change it. The control SHALL be shown regardless of pipeline availability, since the wake word is part of chat-only operation, and SHALL be disabled or visibly inert while the wake-word toggle is off.

The subscription token control SHALL render only where the Claude prerequisite rows render — that is, when the Claude binary is reachable — so a chat-only install surfaces no token UI. It SHALL be a masked (password-type) input that is always empty on render, never pre-filled with the stored token, and SHALL carry its own save action rather than depending on the panel's global Save, so it also works inside the onboarding wizard's Claude step. A remove action SHALL be offered only while a token is stored. After a successful save or removal the panel SHALL re-run its existing Claude check so the displayed billing line reflects the new state without reopening the panel. The panel SHALL NOT validate the token by calling Claude or by inspecting its format; an unusable token surfaces through the normal run error.

The Google Search toggle SHALL control the `IRIS_ENABLE_GOOGLE_SEARCH` flag and SHALL sit in the existing "Gemini API key" section (it concerns the Gemini key, not the Claude pipeline), rendering regardless of pipeline availability. It SHALL carry a visible warning that Google Search requires a paid Gemini key — a free-tier key is disconnected with a 1011 quota error while search is enabled — and that the change applies on the next reconnect. Enabling or disabling it SHALL offer the panel's standard reconnect prompt rather than forcing a mid-session disconnect.

The camera device selector SHALL offer a `"System Default"` option plus one entry per enumerated `videoinput` device (via `navigator.mediaDevices.enumerateDevices()`), and SHALL remain disabled/hidden with an explanatory hint until the Camera permission is granted (device labels are empty until then). While the panel is mounted, the device list SHALL live-refresh on `navigator.mediaDevices.ondevicechange` so devices that appear or disappear at runtime (e.g. starting/stopping a virtual camera) are reflected without reopening the panel. If the currently saved selection is not present in the live-refreshed device list, the selector SHALL visually mark it as unavailable rather than silently switching to another device or to System Default. The selector SHALL always render regardless of how many video input devices are currently detected.

The microphone device selector SHALL render directly below the Microphone permission row in the Permissions section, following the same `"System Default"` + live-refreshed enumeration pattern as the camera selector, gated on the Microphone permission being granted. Unlike the camera selector, if the saved/selected microphone is unavailable it SHALL NOT merely mark the selection as unavailable — it SHALL fall back to System Default automatically, since a non-functioning microphone breaks voice conversation while a non-functioning gesture camera does not (see `microphone-device-selection` spec for the full fallback and hot-swap requirements).

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

### Requirement: Config persistence via config IPC to .env

A `config:get`/`config:save` IPC pair SHALL back the panel: reads return effective config with secrets reduced to presence/masked form; saves upsert keys line-wise into the existing `.env` location (repo `.env` in dev, `~/.myiris/.env` packaged), preserving unrelated lines and comments, and never logging secret values. Settings that cannot hot-apply SHALL surface a reconnect/restart prompt instead of silently requiring one.

The writable key set SHALL include the subscription token (`CLAUDE_CODE_OAUTH_TOKEN`), the Google Search flag (`IRIS_ENABLE_GOOGLE_SEARCH`), and the wake-word sensitivity keys defined in `wake-sleep-voice`. The token's value SHALL never be returned to the renderer in any form — the config read SHALL expose only a boolean presence flag for it. A save carrying an empty value for the token SHALL be treated as "no change" so that a global save cannot erase a stored token; clearing it SHALL require the panel's explicit remove action. The Google Search flag is a non-secret boolean read back to the renderer as its current value; because it is consumed only when the Gemini Live session is created, it is a setting that cannot hot-apply and SHALL surface the standard reconnect prompt on change rather than forcing a mid-session disconnect. The wake-word sensitivity keys are non-secret values read back to the renderer as their effective values; they hot-apply on the next arm of the listener and SHALL NOT trigger a reconnect or restart prompt.

#### Scenario: Saving the Gemini key

- **WHEN** the user saves a Gemini API key from the panel
- **THEN** it is written to the correct `.env` for the run mode, other lines are preserved, and the UI offers to reconnect the live session

#### Scenario: Secrets never echoed

- **WHEN** the panel re-opens after a save
- **THEN** stored secrets display only as present/masked, and full values are not sent back to the renderer

#### Scenario: Token presence exposed without the value

- **WHEN** the renderer reads the effective config while a subscription token is stored
- **THEN** it receives only a boolean indicating a token is present, and the token string itself never crosses the IPC boundary

#### Scenario: Empty token in a save does not erase the stored one

- **WHEN** a config save is submitted with an empty or whitespace-only value for the subscription token
- **THEN** the previously stored token is left intact in both `.env` and the process environment

#### Scenario: Toggling Google Search persists and offers a reconnect

- **WHEN** the user toggles Google Search and saves
- **THEN** `IRIS_ENABLE_GOOGLE_SEARCH` is written to the correct `.env` for the run mode, unrelated lines are preserved, and the UI offers to reconnect the live session because the flag applies only on the next connect, not mid-session

#### Scenario: Saving wake-word sensitivity does not prompt a reconnect

- **WHEN** the user changes wake-word sensitivity and saves
- **THEN** the value is written to the correct `.env` for the run mode, unrelated lines are preserved, and no reconnect or restart prompt is shown because the setting applies on the next arm of the listener

### Requirement: The Gemini API key follows the same presence-only read contract as the subscription token

The existing config-read contract already requires that secrets be reduced to presence/masked form and that full values not be sent back to the renderer. That contract SHALL apply to the Gemini API key, not only to the subscription token: `config:get` SHALL expose a boolean presence flag for the key and SHALL NOT return the key's value.

Consequently the key input SHALL render empty rather than pre-filled, exactly as the token input already does, and an empty value in an ordinary save SHALL mean "no change" so a global Save cannot blank a stored key. Clearing the key SHALL require an explicit action.

Rendering the value in a password-type input does not satisfy this. Visual masking hides the value from someone looking at the screen; it does not stop the value from being in renderer memory, where any code executing in the renderer can read it. The subscription token is already handled this way, so this is the established pattern applied consistently rather than a new one.

The live connection test SHALL keep working for a key the user has just typed, since that value is in the renderer already; testing a stored key SHALL be possible without the renderer holding it.

#### Scenario: The stored key is not returned to the renderer
- **WHEN** the renderer reads the effective config while a Gemini API key is stored
- **THEN** it receives only a boolean indicating a key is present, and the key string never crosses the IPC boundary

#### Scenario: The key field renders empty
- **WHEN** the setup panel opens with a key already stored
- **THEN** the key input is empty and the panel indicates that a key is configured

#### Scenario: A global save does not blank a stored key
- **WHEN** a config save is submitted with an empty or whitespace-only value for the Gemini API key
- **THEN** the previously stored key is left intact in both the config file and the process environment

#### Scenario: Testing a freshly typed key still works
- **WHEN** the user types a key and runs the connection test before saving
- **THEN** the test uses the typed value and reports success or failure as before

#### Scenario: Testing a stored key does not require returning it
- **WHEN** the user runs the connection test with a key stored and the input left empty
- **THEN** the test runs against the stored key without that key being sent to the renderer

#### Scenario: Onboarding still accepts a first key
- **WHEN** a first-run user pastes a key into the onboarding wizard and saves
- **THEN** the key is persisted and the app becomes configured exactly as before this change

### Requirement: Panel surfaces pipeline availability state

The SetupPanel SHALL display the current pipeline availability state (chat-only vs pipeline enabled) derived from the Claude binary probe, alongside the prerequisite check rows specified in the `pipeline-availability` capability (openspec CLI, global skills — with copyable install commands and a shared re-check). When a re-check flips availability while a Gemini session is live, the panel SHALL surface the existing reconnect prompt rather than pretending the change hot-applied, since Live tool declarations are fixed per session.

#### Scenario: Chat-only state is explained, not hidden

- **WHEN** the user opens the SetupPanel while the app runs chat-only
- **THEN** the panel states that the Claude pipeline is off because no `claude` binary was found, and shows how to install it

#### Scenario: Availability flip prompts a reconnect

- **WHEN** a re-check detects the Claude binary for the first time while a voice session is connected
- **THEN** the panel reports the pipeline as ready and offers the standard reconnect action, after which the pipeline surface is live

### Requirement: Cleanup of what older versions installed into the user's Claude Code

There is nothing to install: Claude Code, the `openspec` CLI, the personas, and the skills and `/opsx` commands all ship inside the app. The SetupPanel SHALL therefore report bundled components as present or damaged, and SHALL NOT offer an install action, since no user command can repair a damaged bundle.

For machines that ran an earlier version, the panel SHALL report how many files that version wrote into the user's `~/.claude`, and SHALL offer to remove exactly those paths. Removal SHALL require an explicit user action and SHALL leave anything the app did not install untouched.

#### Scenario: Bundled components report present, with no install offered

- **WHEN** the panel checks the bundled Claude runtime, `openspec`, and the skills plugin
- **THEN** each row reports bundled or damaged, and no install action is presented

#### Scenario: Leftovers from an older version are offered for removal

- **WHEN** the panel opens on a machine where an earlier version wrote skills, commands, or personas into `~/.claude`
- **THEN** it reports how many such files exist and offers to remove them, without modifying anything until the user acts

#### Scenario: A fresh machine is offered no cleanup

- **WHEN** the panel opens on a machine that never ran an older version
- **THEN** no cleanup action is shown

#### Scenario: Removal is reported, not silent

- **WHEN** the cleanup action completes
- **THEN** the panel surfaces what was removed and any errors, rather than silently flipping state

### Requirement: Panel offers the WebGL quality control

The SetupPanel SHALL offer a control for the WebGL quality preference defined by `webgl-quality-mode`, presented as a two-state Off/On row alongside the panel's other display and interaction preferences (interface sounds, wake word, gesture camera), with Off meaning the light path. It SHALL be the only place in the UI where that preference is set, so a user never has to find a second control to stop a second WebGL surface from loading their GPU.

The control SHALL render regardless of pipeline availability, since every WebGL surface it governs exists in chat-only operation. Unlike the panel's `.env`-backed settings, this control SHALL persist locally and take effect immediately on change — it SHALL NOT depend on the panel's Save action, SHALL NOT write to the effective `.env`, and SHALL NOT offer a reconnect or relaunch prompt, because no session state is affected.

The control SHALL carry text making clear what the user is trading: turning it on restores the full visual effects at a materially higher GPU cost, and it is off by default so that a modest machine works without configuration.

#### Scenario: The control appears with the other preferences

- **WHEN** the user opens the SetupPanel
- **THEN** a two-state WebGL quality row is present alongside the interface-sounds and wake-word toggles, showing the current state, defaulting to Off

#### Scenario: The control renders in chat-only mode

- **WHEN** the SetupPanel is opened on an install with no Claude credential
- **THEN** the WebGL quality row still renders, since it governs surfaces that exist without the pipeline

#### Scenario: Changing it needs no Save and no relaunch

- **WHEN** the user toggles the row
- **THEN** the change persists and the WebGL surfaces re-render on the new path immediately, without pressing Save, without a reconnect prompt, and without a relaunch prompt

#### Scenario: The effective .env is untouched

- **WHEN** the user toggles the row and the effective `.env` is inspected
- **THEN** it is unchanged — this preference is not part of the `.env` configuration surface

#### Scenario: The trade-off is stated

- **WHEN** the user reads the row
- **THEN** it communicates that turning it on costs materially more GPU, and that it is off by default

