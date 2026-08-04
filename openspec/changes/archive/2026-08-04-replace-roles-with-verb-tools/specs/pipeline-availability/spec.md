## MODIFIED Requirements

### Requirement: Chat-only mode declares no Claude tools and omits pipeline prompt content

In chat-only mode the Gemini Live session SHALL be created without **any** of the Claude-delegation function declarations — neither the named verbs nor the tools that inspect, control, or review their runs — and its system instruction SHALL contain no delegation or workspace pipeline content. Interface-only tools (UI control) remain declared. The prompt SHALL be produced by one builder that includes the pipeline sections conditionally — not by a second maintained prompt variant.

The declaration set SHALL NOT be enumerated by name in this requirement. The verbs are defined in one registry and the declarations derive from it, so a list repeated here would be a second definition that drifts — which is the failure the registry exists to prevent. What this requirement fixes is that **the whole set** is governed by one flag.

The prompt-review decision tool is a pipeline tool: it is meaningful only alongside the verbs it gates, so it is declared under the same `pipelineAvailable` gate and is absent in chat-only mode.

Review-mode mutation is not a declared tool in any mode. It is absent in chat-only mode because the whole pipeline surface is absent, and absent in pipeline mode because the gate must not be disarmable by the model — see `prompt-review-gate`. The `pipelineAvailable` flag therefore governs which pipeline tools are declared, but is not what withholds review-mode mutation.

#### Scenario: Gemini never offers to delegate

- **WHEN** the user asks for a coding task in chat-only mode
- **THEN** Gemini has no verb to call and responds conversationally (including built-in search where applicable), without claiming it will hand work to Claude or producing a tool-call error

#### Scenario: Every verb is gated by the one flag

- **WHEN** the Gemini Live session is created in chat-only mode
- **THEN** no verb is declared, and the set that is withheld is exactly the set the registry defines

#### Scenario: UI control still works

- **WHEN** the user asks for a purely interface action in chat-only mode (e.g. opening an overlay the chat UI still has)
- **THEN** the UI-control tool remains available and behaves as specified

#### Scenario: The prompt-review decision tool is absent in chat-only mode

- **WHEN** the Gemini Live session is created in chat-only mode
- **THEN** the review-decision tool is not declared, since there is nothing to gate and the review flow is inert
