// Gemini Live function-declaration schemas — the realtime voice model's
// contract for what Iris can call by voice. Split out of electron/main.mjs
// (split-main-process-modules): stateless and Electron-free, so every value
// that varies at runtime is injected rather than read from a module-level
// binding.

/**
 * @param {{
 *   getPipelineAvailable: () => boolean,
 *   modelChoices: Array<{ id: string, label: string }>,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 * }} deps
 */
export function createGeminiTools({ getPipelineAvailable, modelChoices, envFlag }) {
  function buildPipelineToolDeclarations() {
    return [
      {
        name: "check_claude_status",
        description: "Check if the Claude Code CLI is installed and ready. Use this for questions about Claude status.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "submit_claude_task",
        description:
          "Hand actionable work to Claude. Invoke for deals, shopping, research, coding, file work, terminal tasks, summaries, automations, or anything requiring tools. Do not ask the user clarifying questions first. Claude works in ONE continuous session: it remembers previous tasks in the session, and runs tasks one at a time — if it is busy, the new task is queued and starts automatically (the response will say 'queued'). IMPORTANT: Claude cannot hear this voice conversation — the 'task' string is the only new information it gets, so write a complete brief with every concrete detail. If review mode is on (the default), this does NOT start Claude — the brief is parked for the user's Approve/Edit/Cancel and the response says 'parked_for_review'; see the PRE-DISPATCH REVIEW GATE instructions for what to say and do next.",
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description:
                "The task for Claude in clear English, shaped to the role per the BRIEF WRITING rules in your instructions. For the PO role: a SHORT control intent (start-and-grill / propose the change / are there tasks left? / archive) plus the concrete details the user gave — never a PRD. For a plain task or the DEV role: a COMPLETE brief with the goal, every concrete detail the user gave (names, numbers, URLs, dates, budgets, constraints), sensible defaults, and the expected output; DEV is told to implement the open OpenSpec change. Claude remembers earlier tasks in this session, so follow-ups may reference previous work, but never omit new details.",
            },
            urgency: { type: "string", description: "low, normal, or high." },
            agent: {
              type: "string",
              description:
                "Optional role to run the task as: 'po' (Product Owner — grills, then proposes an OpenSpec change) or 'dev' (Developer — implements the open change's remaining tasks and verifies). ONLY set this when the user explicitly names a role (e.g. 'have the PO grill this…', 'cho dev làm…'). Otherwise OMIT it — the session's active agent from the UI is used.",
            },
          },
          required: ["task"],
        },
      },
      {
        name: "get_workspace_info",
        description:
          "Return the current workspace state: the active Claude session, the project folder it works in, and the active pipeline role. ALWAYS call this (never guess) when the user asks which project/folder/directory Claude is working in, what session or role is active, or before describing where work will happen.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_claude_task_status",
        description: "Fetch the latest status for a Claude run.",
        parameters: {
          type: "object",
          properties: { run_id: { type: "string" } },
          required: ["run_id"],
        },
      },
      {
        name: "stop_claude_task",
        description: "Stop an active or queued Claude run.",
        parameters: {
          type: "object",
          properties: { run_id: { type: "string" } },
          required: ["run_id"],
        },
      },
      {
        name: "start_new_claude_session",
        description:
          "Start a fresh Claude session with a clean slate (previous task context is forgotten). Call this ONLY when the user explicitly asks for it — e.g. says 'new session', 'phien moi', 'start over', 'iris new session'. Never call it on your own initiative. The user can also switch sessions from the UI.",
        parameters: {
          type: "object",
          properties: {
            label: { type: "string", description: "Optional short name for the new session, if the user gave one." },
          },
        },
      },
      {
        name: "answer_po_question",
        description:
          "Answer the pending question(s) from the Product Owner after SYSTEM_EVENT_PO_QUESTION. The PO's live session is paused waiting for this — call it only once you have collected every answer by voice, never before.",
        parameters: {
          type: "object",
          properties: {
            answers: {
              type: "array",
              description: "One entry per question from the event, in any order.",
              items: {
                type: "object",
                properties: {
                  question: { type: "string", description: "The exact question text, copied verbatim from the event." },
                  choice: { type: "string", description: "The option label the user chose for this question." },
                },
                required: ["question", "choice"],
              },
            },
          },
          required: ["answers"],
        },
      },
      {
        name: "set_agent_model",
        description:
          "Change which Claude model a role (PO or DEV) runs on for the active session — e.g. switch DEV to a stronger model to debug a hard problem, then switch it back afterwards. Only call this when the user EXPLICITLY asks to change or switch a role's model; never on your own initiative.",
        parameters: {
          type: "object",
          properties: {
            role: { type: "string", description: "'po' or 'dev'." },
            model: {
              type: "string",
              description: `One of: ${modelChoices.map((choice) => `${choice.id} (${choice.label})`).join(", ")}.`,
            },
          },
          required: ["role", "model"],
        },
      },
      {
        name: "respond_to_task_review",
        description:
          "Approve or cancel a brief that submit_claude_task just parked (status 'parked_for_review'). Call this only after the user tells you their decision by voice; if they resolve it from the screen instead, you get SYSTEM_EVENT_TASK_REVIEW_RESOLVED and must NOT also call this. This is separate from answer_po_question: that answers a LIVE, blocking question mid-PO-run; this approves/cancels a PARKED brief that has not started at all. Never call get_claude_task_status for a parked brief — it has no run yet.",
        parameters: {
          type: "object",
          properties: {
            decision: { type: "string", description: "'approve' or 'cancel'." },
          },
          required: ["decision"],
        },
      },
    ];
  }

  // Declarations available regardless of pipeline availability — interface
  // control and sleep have nothing to do with Claude (design.md decision 2).
  function buildAlwaysToolDeclarations() {
    return [
      {
        name: "get_ui_context",
        description:
          "Get the current Iris UI context: visible Claude tasks, latest result task, focused task, expanded task, whether history is open, any pending task-chooser candidates, and whether the Glass HUD overlay is active (uiMode). Use before UI-only voice commands like 'open that', 'show latest result', 'close it', or 'show history'.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "control_ui",
        description:
          "Control the Iris UI directly for UI-only requests — open/close/show a Claude task result, task history, or overlays. Use this instead of submit_claude_task when the request is purely about the interface, not new work.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description:
                "One of: open_task, open_task_by_query, open_current_claude_result, open_latest_claude_result, open_claude_history, close_reader, close_history, close_all_overlays, show_task_steps, hide_task_steps. Use show_task_steps/hide_task_steps to expand or collapse the tool-step timeline for a Claude task; when the user names a specific card, pass its words in `query` (or its exact id in `target_id`). With no target, steps default to the card the user is currently viewing (open reader / focused), then the running task.",
            },
            target_id: {
              type: "string",
              description: "Optional exact Claude task id for open_task, show_task_steps, or hide_task_steps.",
            },
            query: {
              type: "string",
              description:
                "Loose words from the user identifying a card, usable with open_task_by_query, show_task_steps, and hide_task_steps — e.g. 'failed one', 'the deals card', 'second one'. The renderer fuzzy-matches this against visible task titles/status. For open_task_by_query, close matches show a chooser overlay instead of guessing.",
            },
          },
          required: ["action"],
        },
      },
      {
        name: "go_to_sleep",
        description:
          "Put Iris to sleep (end this voice session). Call ONLY when the user explicitly asks — e.g. 'go to sleep', 'sleep now', 'goodnight Iris', 'that's all for today'. Say a very short goodbye BEFORE calling this; the session ends a few seconds later. The wake word (if enabled) keeps working, so they can wake Iris again by voice.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  function buildClaudeTools() {
    return [
      {
        functionDeclarations: [
          ...(getPipelineAvailable() ? buildPipelineToolDeclarations() : []),
          ...buildAlwaysToolDeclarations(),
        ],
      },
    ];
  }

  // Tools shared by both live-config modes (buildLiveConfig empties them again
  // for "listen" — see live-config.mjs). Google Search grounding is a BILLED
  // feature: on a free-tier Gemini key the Live API closes the session
  // immediately with a 1011 "exceeded your current quota" error the moment
  // this tool is present. Enable only with billing on: IRIS_ENABLE_GOOGLE_SEARCH=true.
  // envFlag() (not a bare === "true" check) so this agrees with the SetupPanel
  // toggle's own read of the same flag via getFullConfig() — see
  // setup-panel's "Toggle state matches runtime behavior" requirement.
  function buildLiveTools() {
    return [...(envFlag("IRIS_ENABLE_GOOGLE_SEARCH", false) ? [{ googleSearch: {} }] : []), ...buildClaudeTools()];
  }

  return { buildPipelineToolDeclarations, buildAlwaysToolDeclarations, buildClaudeTools, buildLiveTools };
}
