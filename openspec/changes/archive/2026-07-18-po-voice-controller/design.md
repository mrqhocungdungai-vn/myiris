## Context

Iris delegates real work to Claude through two agents, PO and DEV. Today both personas hand-author a bespoke SDD under `.scratch/<slug>/` that never touches `openspec/`, even though `CLAUDE.md` declares OpenSpec the living spec. The personas reference no skills, no OpenSpec, no grilling, and no hook harness. Meanwhile the environment already ships the right tooling — `openspec` CLI 1.6.0 is global on PATH; the OpenSpec workflow skills exist project-locally and the `mattpocock-skills` plugin is enabled in this repo — but none of it is wired into the roles, and none of it is guaranteed present on an arbitrary workstream `cwd`.

Verified against the installed Agent SDK (`@anthropic-ai/claude-agent-sdk@0.3.210`): `settingSources` omitted ⇒ *all* sources load (user/project/local), matching CLI defaults; `skills` omitted ⇒ CLI's own skill discovery applies (not "off"); a dedicated `skills: string[] | 'all'` option is the single switch to enable skills; marketplace/plugin resolution inside the SDK subprocess is not guaranteed (the `plugins` option notes only local plugins are supported). Capability availability therefore tracks `cwd` and the user's global `~/.claude`, not this repo.

## Goals / Non-Goals

**Goals:**
- Iris PO = voice controller only; all analysis/spec/code execution happens Claude-side.
- Both roles work on any `cwd` by sourcing agents + skills from global `~/.claude`.
- OpenSpec is the single living spec; grilling gates the start; a change must exist before DEV runs.
- DEV runs only against an open change with unchecked `tasks.md` items, then archives.

**Non-Goals:**
- Rewriting the DEV execution mechanism (stays one-shot headless `claude -p`) or the PO stateful mechanism (stays Agent SDK live session).
- Migrating existing `.scratch/` features into OpenSpec (no data migration; legacy dirs are left untouched).
- Changing the voice-decision-relay (`AskUserQuestion`) or per-role model selection contracts.

## Decisions

- **D1 — PO-voice sends control prompts, not task briefs.** The voice layer emits short intents (`grill`, `propose`, `status/are-there-tasks`, `archive`) into the resident PO session; the Claude-side PO owns the process. *Alternative:* voice composes the full PRD prompt — rejected: that is the current "voice writes prompts" anti-pattern the user is eliminating.
- **D2 — Capabilities installed globally in `~/.claude`, not per-project plugins.** Install the OpenSpec workflow skills + mattpocock skills into `~/.claude/skills/` (agents already in `~/.claude/agents/`). *Rationale:* global skills load via the `user` settings source regardless of `cwd`, sidestepping the SDK's unresolved marketplace-plugin behavior (see Risks). *Alternative:* rely on the repo's enabled plugin — rejected: breaks on any other `cwd`.
- **D3 — `po-session.mjs` sets `skills: 'all'` explicitly.** Omitting it "works by CLI default" but is ambiguous across versions/cwd; the explicit switch guarantees the global skills are enabled for the live session. Keeps `settingSources` omitted so `user` (global) settings still load.
- **D4 — OpenSpec replaces `.scratch/` as the only SDD surface.** PO produces `openspec/changes/<name>/` artifacts via the propose flow; DEV consumes `tasks.md`; archive syncs deltas into `openspec/specs/`. Eliminates the drift between two spec systems.
- **D5 — DEV dispatch is gated on an open change with unchecked tasks.** `submit_claude_task` for DEV first checks `openspec/changes/*/tasks.md` for remaining `- [ ]` items; if none, it does not start a DEV run and reports back so PO can propose or archive. Enforces spec-before-code.
- **D6 — Grilling is the explicit entry gate.** The PO agent does not create any artifact until told to grill; grilling's clarifying questions surface through the existing `AskUserQuestion` → voice relay, so the live-session Q&A path is reused, not rebuilt.
- **D7 — New-project scaffold is `openspec init`.** `ensureProjectScaffold` runs `openspec init` in a `cwd` that lacks `openspec/`, replacing the `.scratch/`+`CONTEXT.md`+`docs/agents/*` seeding.

## Risks / Trade-offs

- **Marketplace/plugin skills may not resolve in the SDK subprocess** → install the needed skills as plain global skills in `~/.claude/skills/` (D2) and verify at runtime with a smoke turn (`Skill grilling` / `Skill openspec-propose` availability) before relying on them.
- **Grilling is interactive but DEV/one-shot paths never ask** → grilling is PO-only; DEV keeps "never ask." PO's grilling questions must map onto `AskUserQuestion` so they reach voice; a grilling skill that shells out to raw stdin would hang the headless session.
- **Removing `.scratch/` is BREAKING for in-flight features** → no migration; legacy `.scratch/` dirs remain readable, but new work is OpenSpec-only. Personas stop reading/writing `.scratch/`.
- **`openspec init` writes files into the user's project `cwd`** → only run it when `openspec/` is absent; never overwrite an existing OpenSpec setup.
- **Global skill install mutates `~/.claude`** → make it idempotent (skip if already present) and driven by an explicit install step, not silently on every launch.

## Migration Plan

1. One-time: install OpenSpec + mattpocock skills into `~/.claude/skills/`; confirm `~/.claude/agents/iris-*.md` reinstalled from new personas.
2. Ship persona rewrites + `po-session.mjs` `skills: 'all'` + `ensureProjectScaffold` → `openspec init` + DEV task-gate.
3. Smoke test: fresh `cwd` → `openspec init`; a PO turn runs grill → propose (change appears); DEV turn applies a task; archive syncs a spec.
4. **Rollback:** existing `IRIS_PO_LIVE_SESSION=0` reverts PO to one-shot; if the OpenSpec-native flow misbehaves, the prior persona files can be restored from git and re-installed via `installIrisAgents`. No data migration to undo.

## Verification (task 1.1 / 1.2 — resolved)

Smoke-tested against `@anthropic-ai/claude-agent-sdk@0.3.210` with a live PO-style session:

- **Global skills load regardless of `cwd`** — a `query({ options: { skills: 'all', settingSources default } })` run in a throwaway temp `cwd` with **no** local skills reported all global `~/.claude/skills` in its init message: `grilling`, `openspec-propose/apply/archive`, `tdd`, `code-review` (6/6 target hits), plus the `opsx:*` plugin commands. So D2/D3 hold — no explicit `plugins`/local-path wiring is required; `skills: 'all'` + default `settingSources` is sufficient.
- **Global agents load too** — the same init message listed `iris-po` and `iris-dev` among available agents, confirming `settingSources` default loads the `user` source.
- **`openspec init` is interactive by default** — headless use MUST pass `--tools`: `openspec init <cwd> --tools claude` creates `openspec/` (changes/, specs/, config.yaml) + `.claude/` non-interactively. `openspec archive` is available. This settles D7's exact invocation.

## Open Questions

- Should `openspec init` run automatically on first PO turn in a new `cwd`, or only when PO explicitly proposes? (Leaning: on first propose, to avoid touching a `cwd` the user only wanted to inspect.)
- The needed skills are already present in `~/.claude/skills/` on the dev machine (installed via the mattpocock setup skill + OpenSpec). Open decision for task 2.1: ship an in-app idempotent installer, or treat the global skills as a documented prerequisite (like `claude setup-token`)? See implementation note below.
