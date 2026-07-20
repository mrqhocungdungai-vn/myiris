## Purpose

Detects whether the Claude PO → DEV pipeline can run on this machine (the `claude` binary resolving is the sole signal) and gates the Gemini tool declarations, system-prompt content, and pipeline UI on that single flag — so the community release runs as a pure chat companion out of the box and self-reveals the build pipeline once Claude Code is installed, with no separate config flag.

## Requirements

### Requirement: Claude binary presence is the pipeline master switch

The app SHALL determine pipeline availability by probing the resolved `claude` binary (existing resolution: `IRIS_CLAUDE_BIN` override, then PATH probing) with a `--version` check before the Gemini Live session is created, and SHALL re-probe on a SetupPanel re-check and on every Gemini session (re)connect. When the probe fails, the app SHALL run in chat-only mode; when it succeeds, the full PO → DEV pipeline surface SHALL be enabled. `CLAUDE_CODE_OAUTH_TOKEN` SHALL NOT affect this switch — it continues to gate only PO turns via the existing billing-status check.

#### Scenario: No Claude installed yields chat-only mode

- **WHEN** the app starts with `GEMINI_API_KEY` configured and no `claude` binary resolvable
- **THEN** the app starts in chat-only mode and voice conversation works normally

#### Scenario: Claude present enables the pipeline

- **WHEN** the app starts and the `claude --version` probe succeeds
- **THEN** the Claude tools are declared to Gemini, the pipeline UI is shown, and PO/DEV behave exactly as specified by the existing pipeline capabilities

#### Scenario: Binary present but no OAuth token

- **WHEN** the pipeline is enabled and the user starts a PO turn without `CLAUDE_CODE_OAUTH_TOKEN`
- **THEN** the PO run fails with the existing actionable token error while DEV runs remain available

#### Scenario: Claude installed mid-session

- **WHEN** the app is running chat-only and the user installs the Claude CLI, then triggers a SetupPanel re-check
- **THEN** the check reports the binary as present and offers the standard reconnect prompt, and after the Gemini session reconnects the pipeline surface is enabled

### Requirement: Chat-only mode declares no Claude tools and omits pipeline prompt content

In chat-only mode the Gemini Live session SHALL be created without any Claude-delegation function declarations (`check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`, `set_agent_model`), and its system instruction SHALL contain no delegation, role, or workspace pipeline content. Interface-only tools (UI control) remain declared. The prompt SHALL be produced by one builder that includes the pipeline sections conditionally — not by a second maintained prompt variant.

#### Scenario: Gemini never offers to delegate

- **WHEN** the user asks for a coding task in chat-only mode
- **THEN** Gemini has no delegation tool to call and responds conversationally (including built-in search where applicable), without claiming it will hand work to Claude or producing a tool-call error

#### Scenario: UI control still works

- **WHEN** the user asks for a purely interface action in chat-only mode (e.g. opening an overlay the chat UI still has)
- **THEN** the UI-control tool remains available and behaves as specified

### Requirement: Pipeline UI is hidden in chat-only mode

The renderer SHALL receive the pipeline-availability state from the main process (at boot and on re-check) and, when the pipeline is unavailable, SHALL NOT render the pipeline surfaces: the Work Stream panel, the role/model PipelineBar, the workstream switcher, the task chooser, the HUD tasks column, and the PO question banner mount. Chat surfaces (Comms, orb/HUD core, camera/gesture, setup) render unchanged.

#### Scenario: First-run user sees a chat app

- **WHEN** a user with no Claude CLI launches Iris for the first time and completes Gemini key setup
- **THEN** the deck shows conversation surfaces only, with no pipeline panels, role chips, or workstream controls visible

#### Scenario: Pipeline UI appears after enablement

- **WHEN** pipeline availability flips to available and the Gemini session reconnects
- **THEN** the pipeline surfaces render without requiring an app restart

### Requirement: SetupPanel reports pipeline prerequisites with install guidance

The SetupPanel SHALL report, as read-only checks beside the existing Claude CLI and subscription-token rows: the `openspec` CLI (resolved the same way the runtime resolves it) and the required global skills under `~/.claude/skills` (the OpenSpec workflow skills and the mattpocock skills the personas invoke), each as present/missing with a copyable install command. All rows SHALL share a re-check action. The app SHALL NOT install any of these itself and SHALL NOT write into `~/.claude/skills`.

#### Scenario: Missing prerequisites are actionable

- **WHEN** the user opens the SetupPanel on a machine without the `openspec` CLI or the global skills
- **THEN** each missing item is shown with a copyable command to install it, and no install is performed automatically

#### Scenario: Re-check reflects a completed install

- **WHEN** the user installs a missing prerequisite and triggers re-check
- **THEN** the corresponding row flips to present without restarting the app

#### Scenario: Skills check is presence-based

- **WHEN** the skills directories exist under `~/.claude/skills`
- **THEN** the panel reports them as detected (presence, not semantic validation), and deeper problems still surface through normal PO/DEV run errors
