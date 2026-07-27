## MODIFIED Requirements

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
