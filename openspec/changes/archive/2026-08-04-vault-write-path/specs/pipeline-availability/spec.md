## MODIFIED Requirements

### Requirement: Chat-only mode declares no Claude tools and omits pipeline prompt content

In chat-only mode the Gemini Live session SHALL be created without **any** of the Claude-delegation function declarations — neither the named verbs nor the tools that inspect, control, or review their runs — and its system instruction SHALL contain no delegation or workspace pipeline content. **Tools that need no Claude worker remain declared**: interface-only tools (UI control), and tools whose whole effect is local to Iris (such as writing to the user's own notes vault). The prompt SHALL be produced by one builder that includes the pipeline sections conditionally — not by a second maintained prompt variant.

The test SHALL be whether a tool needs the worker, not which capability it belongs to. A capability MAY contribute both a gated tool and an ungated one; gating a local file write on a credential it never uses withholds a working feature for no reason, and the second brain was withheld from every chat-only user on exactly that mistake.

The declaration set SHALL NOT be enumerated by name in this requirement. The verbs are defined in one registry and the declarations derive from it, so a list repeated here would be a second definition that drifts — which is the failure the registry exists to prevent. What this requirement fixes is that **the whole set** of worker-dependent tools is governed by one flag.

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

#### Scenario: A worker-free local tool still works

- **WHEN** the user asks Iris to save a note in chat-only mode
- **THEN** the capture tool is declared, the note is written to the vault, and Iris confirms it — no verb was needed and none was offered

#### Scenario: A capability contributes both a gated and an ungated tool

- **WHEN** the Gemini Live session is created in chat-only mode and a capability contributes both a worker-dependent verb and a worker-free tool
- **THEN** the verb is withheld and the worker-free tool is declared — the gate is applied per tool by whether it needs the worker, not per capability

#### Scenario: The prompt-review decision tool is absent in chat-only mode

- **WHEN** the Gemini Live session is created in chat-only mode
- **THEN** the review-decision tool is not declared, since there is nothing to gate and the review flow is inert
