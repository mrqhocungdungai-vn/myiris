# Tasks: Bundled Pipeline Skills and Setup Guide

## 1. Bundle the skill/command snapshots

- [x] 1.1 Create `resources/skills/claude-skills/` with copies (symlink targets resolved) of the 4 mattpocock skills (`grilling`, `tdd`, `code-review`, `diagnosing-bugs`) from `~/.agents/skills/`
- [x] 1.2 Generate the 6 OpenSpec skills + 6 `/opsx` command files from the pinned CLI (`openspec init` into a temp dir) and copy into `resources/skills/claude-skills/` and `resources/skills/claude-commands/opsx/`
- [x] 1.3 Write `resources/skills/ATTRIBUTION.md`: upstream sources, versions/commits (mattpocock/skills commit from `~/.agents/.skill-lock.json`, openspec CLI version), MIT notices, and the snapshot refresh procedure. Also vendored the full MIT license text for each source (`claude-skills/LICENSE-mattpocock-skills`, `claude-skills/LICENSE-openspec`).

## 2. Installer (main process)

- [x] 2.1 Generalize `personasSourceDir()` into a shared bundled-resource resolver (`bundledResourceDir()`: repo `resources/` in dev, `process.resourcesPath` packaged) used by both personas and skills (`skillsSourceDir()`)
- [x] 2.2 Add `installPipelinePrereqs()` in `main.mjs`: runs `installIrisAgents()` (unchanged sync policy), then copies each bundled skill dir and `/opsx` command file to `~/.claude/skills` / `~/.claude/commands/opsx` only where the destination does not exist (`pathExists()` via `lstatSync` — symlinks count as existing); returns a structured report (agents result, installedSkills, skippedSkills, installedCommands, skippedCommands, errors)
- [x] 2.3 Exposed IPC `pipeline:install-prereqs` + preload `installPipelinePrereqs()`; runs only on explicit invocation (no startup call — verified no call site outside the IPC handler)

## 3. Checks corrected

- [x] 3.1 Fixed `REQUIRED_SKILLS` to `grilling`, `tdd`, `code-review`, `diagnosing-bugs`, `openspec-propose`, `openspec-apply-change`, `openspec-archive-change` (dropped phantom `verify`)
- [x] 3.2 Extended `checkClaudeHealth()` with `agentsOk`/`missingAgents` via new `checkAgentsStatus()` (`~/.claude/agents/iris-po.md`, `iris-dev.md`); updated the `ClaudeHealth` type in `src/vite-env.d.ts`
- [x] 3.3 Reworded `resources/personas/iris-dev.md`: verification is now an action DEV performs itself (run acceptance scenarios, typecheck, tests, build) with the `code-review` skill for the review pass — no `verify` skill reference; updated the matching `tdd`/`verify`/`code-review` sentence in `CLAUDE.md`

## 4. SetupPanel install surface

- [x] 4.1 Added the agents check row (present/missing with the two persona files) beside the skills/CLI rows in `SetupPanel.tsx`, reusing `PrereqRow`
- [x] 4.2 Added the "Install missing" button: visible when any of agents/skills/commands are missing, disabled while running, calls `installPipelinePrereqs()`, surfaces a summary report, then auto re-runs `checkClaude()`
- [x] 4.3 Per-row copyable manual commands kept as fallback; confirmed the PipelineBar "Install agents…" path (`App.tsx` → `window.iris.installAgents()`) is untouched

## 5. Guide and docs

- [x] 5.1 Wrote `docs/PIPELINE_GUIDE.md` (EN): pipeline overview + diagram, setup steps ending at "Install missing", voice walkthrough (what to say per stage, `/opsx` explained as agent-internal), Claude Code appendix, troubleshooting mapped to check rows
- [x] 5.2 Wrote `docs/PIPELINE_GUIDE.vi.md` (VI) with the identical section skeleton; cross-linked both files at the top
- [x] 5.3 Slimmed README's "Claude pipeline (PO → DEV)" section to the enablement summary + guide links (also fixed its stale `verify` mention in the process); updated `CLAUDE.md` with the installer mental model

## 6. Verify

- [x] 6.1 `npm run build` clean. Installer logic smoke-tested by replicating the exact skip-if-exists algorithm against a temp `HOME` with a pre-seeded symlink at `~/.claude/skills/tdd`: result was 9/10 skills installed, `tdd` skipped and its symlink left byte-for-byte untouched, zero errors — matches `installPipelinePrereqs()`'s logic exactly.
- [x] 6.2 Launch the app, open Settings, click "Install missing" live and confirm rows flip green after auto re-check — completed manually by the user (GUI automation wasn't available in this session's environment; user confirmed the live click-through worked as designed).
- [x] 6.3 Grep sweep: no `verify` **skill** references left in personas/CLAUDE.md/README/REQUIRED_SKILLS (remaining hits are the plain English verb); `openspec validate` passes
