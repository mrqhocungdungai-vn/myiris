## Purpose

Detects whether the Claude PO → DEV pipeline can run on this machine (the `claude` binary resolving is the sole signal) and gates the Gemini tool declarations, system-prompt content, and pipeline UI on that single flag — so the community release runs as a pure chat companion out of the box and self-reveals the build pipeline once Claude Code is installed, with no separate config flag.
## Requirements
### Requirement: Chat-only mode declares no Claude tools and omits pipeline prompt content

In chat-only mode the Gemini Live session SHALL be created without any Claude-delegation function declarations (`check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`, `set_agent_model`, `respond_to_task_review`), and its system instruction SHALL contain no delegation, role, or workspace pipeline content. Interface-only tools (UI control) remain declared. The prompt SHALL be produced by one builder that includes the pipeline sections conditionally — not by a second maintained prompt variant. The prompt-review decision tool (`respond_to_task_review`) is a pipeline tool: it is meaningful only alongside `submit_claude_task`, so it is declared under the same `pipelineAvailable` gate and is absent in chat-only mode.

Review-mode mutation is not a declared tool in any mode. It is absent in chat-only mode because the whole pipeline surface is absent, and absent in pipeline mode because the gate must not be disarmable by the model — see `prompt-review-gate`. The `pipelineAvailable` flag therefore governs which pipeline tools are declared, but is not what withholds review-mode mutation.

#### Scenario: Gemini never offers to delegate

- **WHEN** the user asks for a coding task in chat-only mode
- **THEN** Gemini has no delegation tool to call and responds conversationally (including built-in search where applicable), without claiming it will hand work to Claude or producing a tool-call error

#### Scenario: UI control still works

- **WHEN** the user asks for a purely interface action in chat-only mode (e.g. opening an overlay the chat UI still has)
- **THEN** the UI-control tool remains available and behaves as specified

#### Scenario: The prompt-review decision tool is absent in chat-only mode

- **WHEN** the Gemini Live session is created in chat-only mode
- **THEN** `respond_to_task_review` is not declared, since there is no `submit_claude_task` to gate and the review flow is inert

#### Scenario: Review-mode mutation is absent in both modes

- **WHEN** the Gemini Live session is created, whether the pipeline is available or not
- **THEN** no review-mode mutation tool is declared in either case

### Requirement: Pipeline UI is hidden in chat-only mode

The renderer SHALL receive the pipeline-availability state from the main process (at boot and on re-check) and, when the pipeline is unavailable, SHALL NOT render the pipeline surfaces: the Work Stream panel, the role/model PipelineBar, the workstream switcher, the task chooser, the HUD tasks column, and the PO question banner mount. Chat surfaces (Comms, orb/HUD core, camera/gesture, setup) render unchanged.

#### Scenario: First-run user sees a chat app

- **WHEN** a user with no Claude CLI launches Iris for the first time and completes Gemini key setup
- **THEN** the deck shows conversation surfaces only, with no pipeline panels, role chips, or workstream controls visible

#### Scenario: Pipeline UI appears after enablement

- **WHEN** pipeline availability flips to available and the Gemini session reconnects
- **THEN** the pipeline surfaces render without requiring an app restart

### Requirement: SetupPanel reports pipeline prerequisites with install guidance

The SetupPanel SHALL report, as checks beside the existing Claude CLI and subscription-token rows: the `openspec` CLI (resolved the same way the runtime resolves it), the required global skills under `~/.claude/skills` (`grilling`, `tdd`, `code-review`, `diagnosing-bugs`, `openspec-propose`, `openspec-apply-change`, `openspec-archive-change` — exactly the skills the personas invoke), and the installed Iris agent personas under `~/.claude/agents/` (`iris-po.md`, `iris-dev.md`), each as present/missing. All rows SHALL share a re-check action. Missing prerequisites SHALL be resolvable two ways: the one-click bundled install action (see the `pipeline-setup-install` capability) or the copyable manual install commands shown per row. The app SHALL NOT write into `~/.claude` at startup or without explicit user action.

#### Scenario: Missing prerequisites are actionable

- **WHEN** the user opens the SetupPanel on a machine without the `openspec` CLI, the global skills, or the agent personas
- **THEN** each missing item is shown with the one-click install action available and a copyable manual command as fallback, and nothing installs until the user acts

#### Scenario: Re-check reflects a completed install

- **WHEN** the user installs a missing prerequisite (via the button or manually) and triggers re-check
- **THEN** the corresponding row flips to present without restarting the app

#### Scenario: Skills check is presence-based

- **WHEN** the skills directories exist under `~/.claude/skills`
- **THEN** the panel reports them as detected (presence, not semantic validation), and deeper problems still surface through normal PO/DEV run errors

#### Scenario: No phantom requirements

- **WHEN** a machine has every bundled skill, command, and persona installed
- **THEN** every prerequisite row reports present — the required list contains only skills that actually exist and are actually invoked by the personas

### Requirement: A working bundled runtime and a Claude credential are the pipeline master switch

The app SHALL ship Claude Code inside the application bundle and SHALL NOT probe the host machine for an installed `claude` binary. Availability SHALL be determined by two conditions together: the bundled binary responds to a `--version` probe, AND at least one usable Claude credential is configured (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`). The probe SHALL run before the Gemini Live session is created, and SHALL re-run on a SetupPanel re-check, on every Gemini session (re)connect, and immediately after a credential is saved or removed.

When either condition fails, the app SHALL run in chat-only mode; when both hold, the full PO → DEV pipeline surface SHALL be enabled.

The health payload SHALL report binary reachability and pipeline availability as separate fields, so a packaging failure is distinguishable from a missing credential.

There SHALL be no setting that points the app at a host-installed binary. Such an override would restore the coupling this capability removes, and would run a possibly-different binary under `bypassPermissions`.

#### Scenario: No credential yields chat-only mode

- **WHEN** the app starts with `GEMINI_API_KEY` configured and no Claude credential set
- **THEN** the app starts in chat-only mode, voice conversation works normally, and the health payload reports the binary as reachable but the pipeline as unavailable

#### Scenario: Credential present enables the pipeline

- **WHEN** the app starts with a Claude credential configured and the bundled `--version` probe succeeds
- **THEN** the Claude tools are declared to Gemini, the pipeline UI is shown, and PO/DEV behave exactly as specified by the existing pipeline capabilities

#### Scenario: No host Claude install is required

- **WHEN** the app runs on a machine with no `claude` binary anywhere on `PATH`
- **THEN** the probe still succeeds against the bundled binary and the pipeline is available as long as a credential is set

#### Scenario: A host Claude login does not stand in for a credential

- **WHEN** the app runs on a machine whose separately-installed Claude Code is logged in, but no credential is configured in the app
- **THEN** the pipeline remains unavailable, because the app's runs do not read the host credential store and would not authenticate

#### Scenario: Credential added mid-session

- **WHEN** the app is running chat-only and the user saves a credential in the Setup panel
- **THEN** availability is re-probed without a restart, the flag flips to available, and the change is pushed to the renderer

#### Scenario: Bundled runtime is broken

- **WHEN** the bundled binary cannot be resolved or is not executable (a packaging failure)
- **THEN** the app runs chat-only and the health payload reports the binary as unreachable, distinctly from the missing-credential case

