## Why

Base Iris (Talk mode) has no defined knowledge capability: users can't tell that the Claude worker underneath is a capable note-taker/second-brain, not just a coder. Give Iris a real, user-owned personal-notes capability — capture and retrieve notes in a plain-markdown Obsidian vault — by bundling a proven LLM-Wiki skill set so it works offline out of the box wherever Claude is installed.

## What Changes

- **NEW capability — personal knowledge notes.** When the Claude CLI is present, Iris (via the existing plain-Claude worker path) can write notes into, and retrieve notes from, a user-owned Obsidian vault at `~/iris-second-brain`, implementing Andrej Karpathy's LLM-Wiki pattern (plain markdown, `[[wikilinks]]`, YAML frontmatter).
- **Vendor [vanillaflava/llm-wiki-skills](https://github.com/vanillaflava/llm-wiki-skills)** (MIT, filesystem-only — no `uv`/Python/ollama/API key) as repo-bundled snapshots under `resources/skills/claude-skills/`: its 6 skills `wiki-config`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `wiki-integrate`, `wiki-crystallize`, each its own directory, pinned to a commit. Add an `ATTRIBUTION.md` row and the upstream `LICENSE` beside the snapshots.
- **Vault is pinned to `~/iris-second-brain`, cwd-independent.** Iris ensures the vault directory exists and tells each plain-Claude run (via its `--append-system-prompt`) that the LLM-Wiki root is `~/iris-second-brain`, so notes always land in the user's vault regardless of the workstream project folder. Vendored snapshot content is never edited — the vault is pinned through the append-system-prompt seam, not by modifying the skills.
- **Reuse the existing installer.** `installPipelinePrereqs()` already iterates `resources/skills/claude-skills/` and copies each missing directory into `~/.claude/skills` (copy-only-where-missing) — the 6 new skills install through the same "Install missing" action with **no installer-loop code change**.
- **NOT added to `REQUIRED_SKILLS`.** That list is the PO/DEV pipeline prerequisite set; adding the knowledge skills there would falsely flag "missing prerequisite" for users who only want Talk mode. `checkSkillsStatus()` is unchanged.
- **Gated on the Claude CLI.** The capability runs on plain Claude, so it is available exactly when the Claude binary resolves — the same presence gate as the pipeline. With no Claude installed, Iris has no notes worker (unchanged chat-only behavior).

Out of scope (deliberately deferred to the follow-up `clarify-role-capabilities` change): upgrading the quick-task path to a stateful SDK session (rejected — resume is kept); the Google Search toggle; and the role/two-mode user guidance that will *document* this capability once it is real.

## Capabilities

### New Capabilities
- `personal-knowledge-notes`: Iris captures and retrieves personal notes in a user-owned `~/iris-second-brain` Obsidian vault via the bundled LLM-Wiki skills, on the plain-Claude worker path, gated on the Claude CLI.

### Modified Capabilities
- `pipeline-setup-install`: the "bundled snapshots" requirement broadens from *only* the PO/DEV-persona skills to also include the Talk-mode knowledge skills, and the one-click installer's "everything installed" scenario count grows from 10 to 16 bundled skills (the installer mechanism itself is unchanged — it already copies every bundled directory).

## Impact

- **New assets:** `resources/skills/claude-skills/{wiki-config,wiki-ingest,wiki-query,wiki-lint,wiki-integrate,wiki-crystallize}/`, an upstream `resources/skills/claude-skills/LICENSE-vanillaflava-llm-wiki-skills` (same directory level as the existing `LICENSE-mattpocock-skills` / `LICENSE-openspec`), and an `ATTRIBUTION.md` row.
- **Code:** `electron/main.mjs` — `startDevRun` gains vault-pinning in its `--append-system-prompt`, conditioned on `!run.agent` so PO/DEV prompts stay unchanged, plus an "ensure `~/iris-second-brain` exists and pre-seed `wiki-config.md`/`wiki-schema.md`" step (see design.md D5 — pre-seeding avoids the vendored skills' interactive first-run setup, which a one-shot `claude -p` run has no way to answer), and a `checkNotesSkillsStatus()` gate on that directive so it never tells Claude to use skills that aren't actually installed (design.md D6). No change to `installPipelinePrereqs()`, `REQUIRED_SKILLS`, or `checkSkillsStatus()`. `checkClaudeHealth()` gains three new fields (`notesSkillsOk`/`missingNotesSkills`/`notesSkillsInstallHint`) surfaced by a new SetupPanel row (design.md D7).
- **UI:** `src/components/SetupPanel.tsx` — a new "Second-brain notes (LLM-Wiki skills)" `PrereqRow`, informational only (never blocks PO/DEV). `src/vite-env.d.ts`'s `ClaudeHealth` type gains the three new fields.
- **Runtime:** creates `~/iris-second-brain/` on the user's machine (a plain folder openable as an Obsidian vault); installs 6 more skills into `~/.claude/skills` on the explicit install action.
- **Docs:** the `pipeline-setup-install` guide's bundled-skill count is refreshed; full user-facing role/notes guidance is the follow-up change, not this one.
