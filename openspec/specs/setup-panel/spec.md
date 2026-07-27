## Purpose

A Claude-oriented setup and settings panel (adopted from upstream, Deep Space styled) that lets the user configure the Gemini API key, verify Claude CLI availability and PO subscription auth, preview the voice, and toggle wake word / interface sounds / demo test data — backed by a config IPC pair that persists changes to the effective `.env` file.

## Requirements

### Requirement: Claude-oriented setup and settings panel

The app SHALL provide a SetupPanel (adopted from upstream, Deep Space styled) that offers: Gemini API key entry with a live connection test, a Claude CLI availability check (same binary resolution as the worker: PATH probing and `IRIS_CLAUDE_BIN`), subscription-auth status derived from the existing PO billing-path logic (`CLAUDE_CODE_OAUTH_TOKEN` present vs missing) together with an entry field that lets the user set or remove that token, a voice preview, toggles for wake word, interface sounds, demo test data, and Google Search, a camera device selector for gesture control, and a microphone device selector for voice capture (see `microphone-device-selection` spec for its enumeration/persistence/hot-swap/fallback behavior). No Hermes endpoint configuration SHALL exist.

The subscription token control SHALL render only where the Claude prerequisite rows render — that is, when the Claude binary is reachable — so a chat-only install surfaces no token UI. It SHALL be a masked (password-type) input that is always empty on render, never pre-filled with the stored token, and SHALL carry its own save action rather than depending on the panel's global Save, so it also works inside the onboarding wizard's Claude step. A remove action SHALL be offered only while a token is stored. After a successful save or removal the panel SHALL re-run its existing Claude check so the displayed billing line reflects the new state without reopening the panel. The panel SHALL NOT validate the token by calling Claude or by inspecting its format; an unusable token surfaces through the normal PO run error.

The Google Search toggle SHALL control the `IRIS_ENABLE_GOOGLE_SEARCH` flag and SHALL sit in the existing "Gemini API key" section (it concerns the Gemini key, not the Claude pipeline), rendering regardless of pipeline availability. It SHALL carry a visible warning that Google Search requires a paid Gemini key — a free-tier key is disconnected with a 1011 quota error while search is enabled — and that the change applies on the next reconnect. Enabling or disabling it SHALL offer the panel's standard reconnect prompt rather than forcing a mid-session disconnect.

The camera device selector SHALL offer a `"System Default"` option plus one entry per enumerated `videoinput` device (via `navigator.mediaDevices.enumerateDevices()`), and SHALL remain disabled/hidden with an explanatory hint until the Camera permission is granted (device labels are empty until then). While the panel is mounted, the device list SHALL live-refresh on `navigator.mediaDevices.ondevicechange` so devices that appear or disappear at runtime (e.g. starting/stopping a virtual camera) are reflected without reopening the panel. If the currently saved selection is not present in the live-refreshed device list, the selector SHALL visually mark it as unavailable rather than silently switching to another device or to System Default. The selector SHALL always render regardless of how many video input devices are currently detected.

The microphone device selector SHALL render directly below the Microphone permission row in the Permissions section, following the same `"System Default"` + live-refreshed enumeration pattern as the camera selector, gated on the Microphone permission being granted. Unlike the camera selector, if the saved/selected microphone is unavailable it SHALL NOT merely mark the selection as unavailable — it SHALL fall back to System Default automatically, since a non-functioning microphone breaks voice conversation while a non-functioning gesture camera does not (see `microphone-device-selection` spec for the full fallback and hot-swap requirements).

#### Scenario: First run without a key

- **WHEN** the app starts and no Gemini API key is configured
- **THEN** the SetupPanel opens automatically and a successful key test enables starting the session

#### Scenario: Claude health surfaced

- **WHEN** the panel runs its checks
- **THEN** it reports whether the `claude` binary resolves and whether the PO subscription token is configured, with actionable text on failure (matching the errors the runtime already produces)

#### Scenario: Packaged user pastes a subscription token

- **WHEN** a user of a packaged build has the Claude CLI installed, has run `claude setup-token`, and pastes the result into the token field and saves
- **THEN** the token is persisted to the effective `.env` for the run mode, the Claude check re-runs, and the billing line reports that a subscription token is configured — with no hand-editing of `~/.iris/.env` and no app restart

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

A `config:get`/`config:save` IPC pair SHALL back the panel: reads return effective config with secrets reduced to presence/masked form; saves upsert keys line-wise into the existing `.env` location (repo `.env` in dev, `~/.iris/.env` packaged), preserving unrelated lines and comments, and never logging secret values. Settings that cannot hot-apply SHALL surface a reconnect/restart prompt instead of silently requiring one.

The writable key set SHALL include the PO subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) and the Google Search flag (`IRIS_ENABLE_GOOGLE_SEARCH`). The token's value SHALL never be returned to the renderer in any form — the config read SHALL expose only a boolean presence flag for it. A save carrying an empty value for the token SHALL be treated as "no change" so that a global save cannot erase a stored token; clearing it SHALL require the panel's explicit remove action. The Google Search flag is a non-secret boolean read back to the renderer as its current value; because it is consumed only when the Gemini Live session is created, it is a setting that cannot hot-apply and SHALL surface the standard reconnect prompt on change rather than forcing a mid-session disconnect.

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

### Requirement: One-click install of missing pipeline prerequisites

The SetupPanel SHALL offer an "Install missing" action beside the prerequisite check rows whenever any of the agents, bundled skills, or `/opsx` commands are missing. Activating it SHALL run the pipeline prerequisite installer (see `pipeline-setup-install`: personas sync-installed, third-party skills/commands copied only where missing), then automatically re-run the checks so the rows reflect the new state in place. The per-row copyable manual commands SHALL remain available as a fallback, and the PipelineBar's existing "Install agents" action SHALL keep working unchanged (both paths call the same agents install).

#### Scenario: One click turns the rows green

- **WHEN** the agents and skills rows show missing and the user clicks "Install missing"
- **THEN** the installer runs, the checks re-run automatically, and the previously missing rows report present without reopening the panel

#### Scenario: Install reports what it did

- **WHEN** the install action completes
- **THEN** the panel surfaces the result (installed vs already-present vs errors) rather than silently flipping state

#### Scenario: Manual path still works

- **WHEN** a user prefers their own tooling and runs the copyable commands instead
- **THEN** re-check reflects their install identically, and the "Install missing" button disappears once nothing is missing
