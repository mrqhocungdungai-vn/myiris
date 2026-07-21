## Purpose

A Claude-oriented setup and settings panel (adopted from upstream, Deep Space styled) that lets the user configure the Gemini API key, verify Claude CLI availability and PO subscription auth, preview the voice, and toggle wake word / interface sounds / demo test data — backed by a config IPC pair that persists changes to the effective `.env` file.

## Requirements

### Requirement: Claude-oriented setup and settings panel

The app SHALL provide a SetupPanel (adopted from upstream, Deep Space styled) that offers: Gemini API key entry with a live connection test, a Claude CLI availability check (same binary resolution as the worker: PATH probing and `IRIS_CLAUDE_BIN`), subscription-auth status derived from the existing PO billing-path logic (`CLAUDE_CODE_OAUTH_TOKEN` present vs missing) together with an entry field that lets the user set or remove that token, a voice preview, toggles for wake word, interface sounds, and demo test data, and a camera device selector for gesture control. No Hermes endpoint configuration SHALL exist.

The subscription token control SHALL render only where the Claude prerequisite rows render — that is, when the Claude binary is reachable — so a chat-only install surfaces no token UI. It SHALL be a masked (password-type) input that is always empty on render, never pre-filled with the stored token, and SHALL carry its own save action rather than depending on the panel's global Save, so it also works inside the onboarding wizard's Claude step. A remove action SHALL be offered only while a token is stored. After a successful save or removal the panel SHALL re-run its existing Claude check so the displayed billing line reflects the new state without reopening the panel. The panel SHALL NOT validate the token by calling Claude or by inspecting its format; an unusable token surfaces through the normal PO run error.

The camera device selector SHALL offer a `"System Default"` option plus one entry per enumerated `videoinput` device (via `navigator.mediaDevices.enumerateDevices()`), and SHALL remain disabled/hidden with an explanatory hint until the Camera permission is granted (device labels are empty until then). While the panel is mounted, the device list SHALL live-refresh on `navigator.mediaDevices.ondevicechange` so devices that appear or disappear at runtime (e.g. starting/stopping a virtual camera) are reflected without reopening the panel. If the currently saved selection is not present in the live-refreshed device list, the selector SHALL visually mark it as unavailable rather than silently switching to another device or to System Default. The selector SHALL always render regardless of how many video input devices are currently detected.

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

### Requirement: Config persistence via config IPC to .env

A `config:get`/`config:save` IPC pair SHALL back the panel: reads return effective config with secrets reduced to presence/masked form; saves upsert keys line-wise into the existing `.env` location (repo `.env` in dev, `~/.iris/.env` packaged), preserving unrelated lines and comments, and never logging secret values. Settings that cannot hot-apply SHALL surface a reconnect/restart prompt instead of silently requiring one.

The writable key set SHALL include the PO subscription token (`CLAUDE_CODE_OAUTH_TOKEN`). Its value SHALL never be returned to the renderer in any form — the config read SHALL expose only a boolean presence flag for it. A save carrying an empty value for the token SHALL be treated as "no change" so that a global save cannot erase a stored token; clearing it SHALL require the panel's explicit remove action.

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
