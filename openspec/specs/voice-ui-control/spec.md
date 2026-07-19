## Purpose

Lets Gemini both perceive and drive the renderer UI: the renderer streams throttled UI-state context to main for Gemini to reason over, and Gemini can invoke a fixed vocabulary of UI-control actions (open/close readers and history, toggle task-step timelines) that forward to the renderer. Ambiguous voice references are resolved via a TaskChooser modal, and the whole mechanism defers to the existing PO question relay when one is pending.

## Requirements

### Requirement: Renderer streams UI context to Gemini

The renderer SHALL send throttled UI-state snapshots to the main process over a new `iris:ui-context` channel — including expanded/focused/latest task ids, pending disambiguation choices, history-open state, and a task-list summary — and the main process SHALL make that context available to the Gemini Live session.

#### Scenario: Context reflects an open reader

- **WHEN** the user has a task's reader open
- **THEN** the next UI-context snapshot identifies that task as expanded, enabling references like "close this" or "the one I'm reading"

### Requirement: Gemini drives the UI via Claude-named actions

The main process SHALL expose UI-control tools to Gemini whose invocation forwards `{action, target_id?, query?}` to the renderer over `iris:ui-action`, with the vocabulary: `open_task`, `open_task_by_query`, `open_current_claude_result`, `open_latest_claude_result`, `open_claude_history`, `close_reader`, `close_history`, `close_all_overlays`, `show_task_steps`, `hide_task_steps`. Tool handlers SHALL return immediately (never block on renderer work), and no `hermes`-named action SHALL exist.

#### Scenario: Open latest result by voice

- **WHEN** the user says "show me the latest result"
- **THEN** Gemini calls the corresponding tool and the renderer opens the reader on the most recent terminal task

#### Scenario: Toggle steps by voice

- **WHEN** the user asks to see the steps for a running task
- **THEN** the targeted card's step timeline expands via `show_task_steps`

### Requirement: TaskChooser disambiguation

When a voice reference matches multiple tasks (fuzzy `findTaskMatches`), the renderer SHALL show a TaskChooser modal listing the candidates, answerable by voice, mouse click, or gesture dwell-click; choosing a candidate performs the deferred action and dismisses the modal.

#### Scenario: Ambiguous task reference

- **WHEN** the user says "open the auth task" and two tasks match
- **THEN** TaskChooser lists both with distinguishing detail, and the pending choice appears in the next UI-context snapshot so Gemini can relay a spoken selection

### Requirement: PO question relay precedence

The existing PO question relay (voice-decision-relay spec) SHALL be unaffected: while a PO question is pending, TaskChooser SHALL NOT be shown (pending disambiguation is dropped or deferred), `answer_po_question` continues to work unchanged, and non-conflicting UI actions (e.g. `close_reader`) remain available.

#### Scenario: PO question outranks disambiguation

- **WHEN** a PO question is pending and the user issues an ambiguous open-task command
- **THEN** no TaskChooser appears over the PO question banner, and answering the PO question by voice or click still works exactly as specified in voice-decision-relay
