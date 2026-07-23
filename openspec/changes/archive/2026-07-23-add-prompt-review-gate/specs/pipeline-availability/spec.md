## MODIFIED Requirements

### Requirement: Chat-only mode declares no Claude tools and omits pipeline prompt content

In chat-only mode the Gemini Live session SHALL be created without any Claude-delegation function declarations (`check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`, `set_agent_model`, `respond_to_task_review`, `set_prompt_review_mode`), and its system instruction SHALL contain no delegation, role, or workspace pipeline content. Interface-only tools (UI control) remain declared. The prompt SHALL be produced by one builder that includes the pipeline sections conditionally — not by a second maintained prompt variant. The prompt-review tools (`respond_to_task_review`, `set_prompt_review_mode`) are pipeline tools: they are meaningful only alongside `submit_claude_task`, so they are declared under the same `pipelineAvailable` gate and are absent in chat-only mode.

#### Scenario: Gemini never offers to delegate

- **WHEN** the user asks for a coding task in chat-only mode
- **THEN** Gemini has no delegation tool to call and responds conversationally (including built-in search where applicable), without claiming it will hand work to Claude or producing a tool-call error

#### Scenario: UI control still works

- **WHEN** the user asks for a purely interface action in chat-only mode (e.g. opening an overlay the chat UI still has)
- **THEN** the UI-control tool remains available and behaves as specified

#### Scenario: Prompt-review tools are absent in chat-only mode

- **WHEN** the Gemini Live session is created in chat-only mode
- **THEN** neither `respond_to_task_review` nor `set_prompt_review_mode` is declared, since there is no `submit_claude_task` to gate and the review flow is inert
