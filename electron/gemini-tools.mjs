// Gemini Live function-declaration schemas — the realtime voice model's
// contract for what Iris can call by voice. Split out of electron/main.mjs
// (split-main-process-modules): stateless and Electron-free, so every value
// that varies at runtime is injected rather than read from a module-level
// binding.
//
// Capability contract (design.md D10): a capability under
// electron/capabilities/ (e.g. canvas, second-brain) contributes to the
// core modules by exporting a factory that returns an object with these
// optional fields — every field is optional, and a capability with nothing
// to say for a given field simply omits it:
//   {
//     toolDeclarations?: Array<object>,        // Gemini function declarations
//     promptFragment?: () => string,           // one prose paragraph, or ""
//     ipcHandlers?: Array<{ channel, kind: "handle"|"on", fn }>,
//     probe?: () => { ok: boolean, ... },       // availability probe
//     teardown?: () => void | Promise<void>,    // shutdown hook
//   }
// gemini-tools.mjs concatenates each capability's toolDeclarations into the
// function-declarations array; gemini-prompts.mjs splices each capability's
// promptFragment() into the system instruction. Core modules never hardcode
// a capability-specific declaration or prose string.
//
// The Claude-facing surface is no longer one undifferentiated task tool. It is
// seven named verbs, each with its own parameter schema, derived from the verb
// registry — because prose is advice a model may ignore and a schema is a
// contract the calling interface enforces. See electron/verbs.mjs.
import { SHARED_SESSION_VERBS, VERB_NAMES, resolveAllVerbs } from "./verbs.mjs";

/**
 * @param {{
 *   getPipelineAvailable: () => boolean,
 *   modelChoices: Array<{ id: string, label: string }>,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 *   capabilities?: Array<{ toolDeclarations?: any[], [key: string]: any }>,
 * }} deps
 */
export function createGeminiTools({ getPipelineAvailable, modelChoices, envFlag, capabilities = [] }) {
  // The seven verbs, derived from electron/verbs.mjs rather than written out
  // here. A verb is defined in one place; the declaration, the review gate, and
  // the run configuration all follow from that one record. Two call sites
  // independently constructing the same thing, with nothing forcing them to
  // agree, is what silently dropped an instruction from the run configuration
  // for months — this is the shape that cannot recur.
  //
  // Declarations are built against the EMPTY project state: what a verb is
  // called for does not change with the project, only how it then runs does.
  function buildVerbDeclarations() {
    return resolveAllVerbs().map((verb) => ({
      name: verb.verb,
      description: verb.description,
      parameters: verb.params,
    }));
  }

  function buildPipelineToolDeclarations() {
    return [
      ...buildVerbDeclarations(),
      {
        name: "check_claude_status",
        description: "Check if the Claude worker is ready. Use this for questions about Claude status.",
        parameters: { type: "object", properties: {} },
      },
      {
        // Kept for one release so a Gemini session resumed mid-conversation
        // does not call a tool that no longer exists. Described as deprecated
        // so a model reading the list prefers a real verb.
        name: "submit_claude_task",
        description:
          "DEPRECATED — do not call this. Use one of the named verbs instead (execute for work that should get done). Retained only so an older conversation does not break; it dispatches as execute.",
        parameters: {
          type: "object",
          properties: {
            task: { type: "string", description: "The request, in clear English." },
            urgency: { type: "string", description: "low, normal, or high." },
          },
          required: ["task"],
        },
      },
      {
        name: "get_workspace_info",
        description:
          "Return the current workspace state: the active Claude session and the project folder it works in. ALWAYS call this (never guess) when the user asks which project/folder/directory Claude is working in, what session is active, or before describing where work will happen.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_project_state",
        description:
          "Return what the project looks like right now: whether an OpenSpec change is open, which ones, whether a shaping conversation is already under way, and which verb ran last. Call this when you are unsure whether to shape or to execute, or when the user asks what state the work is in. Never guess this.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_claude_task_status",
        description:
          "Fetch the latest status for a Claude run. The reply also carries what the run cost under `usage` " +
          "(`cost_usd`, `num_turns`, plus per-model detail) — use it to answer 'how much did that cost?' or " +
          "'how long did that take?'. Report those figures verbatim; never estimate a cost yourself. `usage` is " +
          "null until the run finishes. A run whose status is 'limited' did not fail: it reached its turn or " +
          "spend ceiling, and its output says which one and how to raise it. A run whose status is 'unanswered' " +
          "did not fail either, and was not cancelled: it asked a question its work depended on, no answer " +
          "arrived, so it stopped and wrote nothing further — nothing was chosen for the user and no default " +
          "was applied, so never report it as done or as decided.",
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
        name: "answer_claude_question",
        description:
          "Answer the pending question(s) Claude asked after SYSTEM_EVENT_CLAUDE_QUESTION. Whichever run asked is " +
          "paused waiting for this — a shaping conversation, a note-working session, or a build run that was " +
          "given no specification; call it only once you have collected every answer by voice, never before. A " +
          "destructive edit to a note and a build run's question are both asked here, on the same terms as any " +
          "other live question — never defer or downplay either as less important.",
        parameters: {
          type: "object",
          properties: {
            answers: {
              type: "array",
              description: "One entry per question from the event, in any order.",
              items: {
                type: "object",
                properties: {
                  question_number: {
                    type: "integer",
                    description:
                      "Which question this answers, by its NUMBER as listed in the event (1, 2, 3...). This is what identifies the question — do not rely on retyping its text.",
                  },
                  question: {
                    type: "string",
                    description:
                      "Optional. The question text as you read it, for diagnostics only. It is not used to match the answer.",
                  },
                  choice: {
                    type: "string",
                    description:
                      "The option label the user chose. For a question the event marked multi_select, give EVERY label " +
                      "they chose, separated by commas — do not pick just one, that answers a different question " +
                      "than the one that was asked.",
                  },
                },
                required: ["question_number", "choice"],
              },
            },
          },
          required: ["answers"],
        },
      },
      {
        name: "set_verb_model",
        description:
          `Change which Claude model a verb runs on for the active session — e.g. put execute on a stronger model to debug a hard problem, then put it back afterwards. Only call this when the user EXPLICITLY asks to change or switch a model; never on your own initiative. Note that ${SHARED_SESSION_VERBS.join(" and ")} share one live conversation, so changing either one changes both.`,
        parameters: {
          type: "object",
          properties: {
            verb: { type: "string", description: `One of: ${VERB_NAMES.join(", ")}.` },
            model: {
              type: "string",
              description: `One of: ${modelChoices.map((choice) => `${choice.id} (${choice.label})`).join(", ")}.`,
            },
          },
          required: ["verb", "model"],
        },
      },
      {
        name: "respond_to_task_review",
        description:
          "Approve or cancel a request that was just parked (status 'parked_for_review'). Call this only after the user tells you their decision by voice; if they resolve it from the screen instead, you get SYSTEM_EVENT_TASK_REVIEW_RESOLVED and must NOT also call this. This is separate from answer_claude_question: that answers a LIVE, blocking question mid-run; this approves/cancels a PARKED request that has not started at all. Never call get_claude_task_status for a parked request — it has no run yet.",
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
          "Control the Iris UI directly for UI-only requests — open/close/show a Claude task result, task history, or overlays. Use this instead of any verb when the request is purely about the interface, not new work.",
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
          ...capabilities.flatMap((cap) => cap.toolDeclarations || []),
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

  return { buildVerbDeclarations, buildPipelineToolDeclarations, buildAlwaysToolDeclarations, buildClaudeTools, buildLiveTools };
}
