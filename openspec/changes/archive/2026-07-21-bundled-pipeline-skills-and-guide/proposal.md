# Bundled Pipeline Skills and Setup Guide

## Why

The chat-first release made talking to Iris zero-config, but enabling the PO → DEV pipeline still ends at a wall of manual steps: users must discover and correctly run third-party install commands (skills.sh for the mattpocock skills, plus the openspec CLI) and separately click "Install agents" — with no walkthrough of what to actually *say* to drive PO grilling → propose → DEV apply. Investigation also exposed two defects in the current prerequisite checks: `REQUIRED_SKILLS` demands a `verify` skill that does not exist anywhere (permanent false "missing"), and it checks for OpenSpec skills at user level even though `openspec init` now generates them per-project — so a fully working machine still shows red.

## What Changes

- **One-click prerequisite install.** Bundle snapshots of the required third-party skills in the repo (`resources/skills/`): the mattpocock set (`grilling`, `tdd`, `code-review`, `diagnosing-bugs`) and the OpenSpec set (6 skills + 6 `/opsx` commands), both MIT with attribution. A new "Install missing" action in the SetupPanel copies the missing pieces into `~/.claude/skills` and `~/.claude/commands/opsx` (**never overwriting** anything that exists, including symlinks) and also runs the existing `installIrisAgents()` so the `iris-po`/`iris-dev` personas land in `~/.claude/agents/` in the same click. This **reverses the previous "Iris never installs into `~/.claude/skills`" rule** — the spec is updated accordingly. The maintainer accepts responsibility for refreshing the bundled snapshots when upstream releases change (bundled versions may lag latest).
- **Fix the `verify` phantom skill** in all three places: drop it from `REQUIRED_SKILLS`, reword the `iris-dev` persona so verification is an action DEV performs itself (run tests/build/acceptance scenarios) rather than a named skill, and correct the matching sentence in `CLAUDE.md`.
- **Fix the check list to match reality**: `REQUIRED_SKILLS` becomes the 4 mattpocock skills + the 3 core OpenSpec skills (`openspec-propose`, `openspec-apply-change`, `openspec-archive-change`), checked at user level (which the installer now populates). SetupPanel additionally shows an **agents check row** (`iris-po.md`/`iris-dev.md` present in `~/.claude/agents/`).
- **Bilingual setup + workflow guide**: `docs/PIPELINE_GUIDE.md` (English) and `docs/PIPELINE_GUIDE.vi.md` (Vietnamese), cross-linked. Voice-first walkthrough — install steps (Claude CLI → `claude setup-token` → openspec CLI → in-app Install), then what to *say* at each stage (select PO → state the request → answer grilling questions → "you have enough, propose" → switch to DEV → "implement the remaining tasks"), explaining that `/opsx:propose`/`/opsx:apply` are what PO/DEV run underneath, not commands the user types. Short appendix: using `iris-po`/`iris-dev` and `/opsx` directly in Claude Code. README's pipeline section slims down and links to the guide.

## Capabilities

### New Capabilities

- `pipeline-setup-install`: the bundled skill/command snapshots, the one-click "Install missing" action (agents via sync-install, third-party skills/commands via install-only-missing), and the snapshot maintenance contract.

### Modified Capabilities

- `pipeline-availability`: the "SetupPanel reports pipeline prerequisites" requirement changes — the app now MAY install bundled prerequisites on explicit user action (the blanket "SHALL NOT install / SHALL NOT write into `~/.claude/skills`" clause is removed); the required-skills list is corrected (no `verify`; core OpenSpec trio added at user level).
- `setup-panel`: the panel gains the agents check row and the "Install missing" action beside the prerequisite rows.
- `global-agent-runtime`: the global-install requirement now includes the bundled skills/commands path as how a fresh machine gets its `~/.claude` capabilities (install-only-missing for third-party content, sync for Iris-owned personas).

## Impact

- **Code**: `electron/main.mjs` (`REQUIRED_SKILLS` fix, `checkClaudeHealth` agents row, new `installPipelinePrereqs()` + IPC), `electron/preload.cjs` (new channel), `src/components/SetupPanel.tsx` (agents row, Install missing button), `resources/skills/` (new bundled snapshots + LICENSE/attribution files), `resources/personas/iris-dev.md` (verify wording).
- **Docs**: new `docs/PIPELINE_GUIDE.md` + `docs/PIPELINE_GUIDE.vi.md`; `README.md` pipeline section slimmed and linked; `CLAUDE.md` verify sentence + installer mental model.
- **Specs**: `pipeline-availability` and `setup-panel` and `global-agent-runtime` deltas; new `pipeline-setup-install` capability.
- **Users**: pipeline enablement becomes install CLI(s) → click one button → talk. Existing machines with skills.sh/openspec-managed installs are untouched (install-only-missing). Maintainer takes on periodic snapshot refresh duty.
