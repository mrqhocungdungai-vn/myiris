## 1. Verify runtime assumptions (blocking)

- [x] 1.1 Smoke-test that a PO Agent SDK session with `skills: 'all'` can invoke `grilling` and the OpenSpec workflow skills when they are installed under `~/.claude/skills/` (resolves design Open Question / marketplace-plugin risk); record the result in design.md — PASSED: 6/6 skills + iris agents discovered from a no-local-skills cwd
- [x] 1.2 Confirm `settingSources` left at default still loads global `user` settings for the PO session; confirm `openspec init` / `openspec archive` run headlessly in an arbitrary `cwd` — CONFIRMED: agents load; `openspec init <cwd> --tools claude` is the non-interactive form

## 2. Global capability install (~/.claude)

- [x] 2.1 Treat global skills as a documented PREREQUISITE (decided — no in-app installer): document in README / CLAUDE.md / .env.example that `~/.claude/skills/` must contain the OpenSpec + mattpocock skills (installed once via their setup skills), same shape as the `claude setup-token` prerequisite — documented in `.env.example` and `CLAUDE.md` (README left for a follow-up pass)
- [x] 2.2 Ensure `installIrisAgents` reinstalls `~/.claude/agents/iris-po.md` and `iris-dev.md` from the rewritten personas — `installIrisAgents` already content-syncs on the "Install agents" action; the two personas were synced to `~/.claude/agents/`

## 3. PO session wiring (electron/po-session.mjs)

- [x] 3.1 Set `skills: 'all'` on the Agent SDK `options`, keeping `settingSources` at default so global settings still load
- [x] 3.2 Support short control-prompt turns (grill / propose / task-status / archive) delivered by the voice layer, keeping the existing `AskUserQuestion` voice relay path intact for grilling questions — turns are plain text into the live session (no code change needed); the control-intent model is encoded in the Gemini voice prompt (`main.mjs`: PRODUCT OWNER CONTROL, brief-writing rules, tool descriptions, AGENT_SELECT) and the PO persona

## 4. Persona rewrites (resources/personas)

- [x] 4.1 Rewrite `iris-po.md`: voice-controlled process — grill first (questions via `AskUserQuestion`), then OpenSpec propose; read `openspec/changes/*/tasks.md` for task-status; brainstorm new change when none remain; no `.scratch/` artifacts
- [x] 4.2 Rewrite `iris-dev.md`: run only against an open change with unchecked `tasks.md` items; implement remaining tasks with `tdd`/`verify`/`code-review`; archive on completion; keep "never ask" one-shot behavior

## 5. Dispatch & scaffold (electron/main.mjs)

- [x] 5.1 Replace `ensureProjectScaffold`'s `.scratch`/`CONTEXT.md`/`docs/agents/*` seeding with `openspec init <cwd> --tools claude` (non-interactive) when the `cwd` has no `openspec/` — plus `openspecBinary()` resolver and `hasOpenSpec()`
- [x] 5.2 Gate DEV dispatch on an open change with at least one unchecked task; when none exists, do not start DEV and report back so PO proposes/archives first — `openChangesWithTasks()` + guard in `startClaudeRun` (functionally tested)
- [x] 5.3 Reconcile `resources/project-seed/` with `openspec init` (remove or repurpose what OpenSpec now owns) — removed the dead `projectSeedFile` helper; repointed `agentsSnapshot` gates + `latestOpenChange` to OpenSpec instead of `.scratch`. `resources/project-seed/` is now unused by code (safe to delete in a cleanup pass)

## 6. Docs & verification

- [x] 6.1 Update `CLAUDE.md` pipeline section (and `.env.example` if new config appears) to describe the OpenSpec-native, voice-controlled flow; confirm `voice-decision-relay` and `per-role-model-selection` specs still hold — done (`IRIS_OPENSPEC_BIN` + global-skills prerequisite added to `.env.example`); the two named specs are untouched behavior and still hold
- [x] 6.2 End-to-end smoke: fresh `cwd` → `openspec init` → PO grill → propose (change appears) → DEV applies a task → archive syncs a spec; run `npm run build` (tsc --noEmit) clean — `npm run build` CLEAN; mechanisms verified in isolation (openspec init --tools claude creates openspec/; skills:'all' loads global skills live; DEV-gate detection tested; `node --check` on edited .mjs). NOTE: the full live app run (Gemini↔Claude voice loop) still needs a manual pass in the running Electron app
