## Why

Iris's PO role today is a persona that hand-authors a private SDD under `.scratch/<slug>/` (analysis → PRD → issues → handoff) — a parallel spec universe that duplicates and drifts from `openspec/specs/`, the project's declared living spec. The personas never reference OpenSpec, the installed OpenSpec/mattpocock skills, grilling, or the hook harness, so the PO is effectively "a voice that writes prompts" with no real process behind it. We want the PO on Iris to be *only* the voice layer that drives Claude-side agents through the real spec-driven workflow, with all execution and capability living in Claude.

## What Changes

- **BREAKING**: Remove the hand-written `.scratch/<slug>/` SDD (analysis.md/PRD.md/issues/handoff). OpenSpec (`openspec/changes/` → `openspec/specs/`) becomes the single living spec. Personas no longer emit those files.
- Iris PO (voice) becomes a thin **controller**: it sends short control prompts to the stateful Agent SDK PO session (`grill`, `propose`, `are-there-tasks`, `archive`) and never hand-authors PRD/issue markdown itself.
- The Claude-side PO agent **starts with the `grilling` skill** to elicit and stress-test requirements; only once the user is satisfied does it run OpenSpec propose to create a change **before** any DEV work begins.
- DEV runs **only** when an open OpenSpec change has unchecked tasks in its `tasks.md`; it implements the remaining tasks (apply flow) using `tdd`/`verify`/`code-review`, then archives the change to sync the living spec.
- Asking the PO "are there tasks left?" makes it read `openspec/changes/*/tasks.md` and report done/not-done, or brainstorm a new change if none remain.
- Capabilities (PO/DEV agents, OpenSpec skills + commands, mattpocock skills) are installed **globally into `~/.claude`** so both roles work on any `cwd`, decoupled from per-project plugins. `cwd` holds only code + that project's `openspec/`.
- New project `cwd` (no `openspec/`): run `openspec init` before proposing.
- `po-session.mjs` enables skills explicitly (`skills: 'all'`) so global skills load regardless of `cwd`; `ensureProjectScaffold` swaps its `.scratch` seeding for `openspec init`.

## Capabilities

### New Capabilities
- `openspec-native-pipeline`: The end-to-end PO→DEV flow expressed on OpenSpec — grill → propose (change created before DEV) → apply remaining tasks → archive to living spec — replacing the `.scratch/` hand-written SDD, including the new-project `openspec init` gate.
- `global-agent-runtime`: PO/DEV agents and their capabilities (OpenSpec + mattpocock skills, commands) installed globally under `~/.claude` and enabled for the Agent SDK session so both roles run on any `cwd` independent of per-project plugin config.

### Modified Capabilities
- `po-live-session`: The stateful PO session becomes a voice-controlled orchestrator — it enables skills explicitly (`skills: 'all'`), receives short control prompts instead of full task briefs, and drives OpenSpec instead of writing `.scratch/` artifacts.

## Impact

- **Personas**: `resources/personas/iris-po.md`, `resources/personas/iris-dev.md` rewritten to the OpenSpec-native process.
- **Electron**: `electron/po-session.mjs` (`skills: 'all'` wiring, control-prompt turn model), `electron/main.mjs` (`ensureProjectScaffold` → `openspec init`; DEV dispatch gated on an open change with unchecked tasks).
- **Global runtime**: `~/.claude/skills/` gains the OpenSpec + mattpocock skills (one-time global install); `~/.claude/agents/iris-*.md` reinstalled from the new personas.
- **Removed**: `.scratch/` seeding and its templates; `resources/project-seed/` reconciled with `openspec init`.
- **Docs/specs**: `CLAUDE.md` pipeline section, and existing `voice-decision-relay` / `per-role-model-selection` specs stay true (grilling + AskUserQuestion coexist).
