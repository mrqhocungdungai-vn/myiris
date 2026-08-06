## MODIFIED Requirements

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
