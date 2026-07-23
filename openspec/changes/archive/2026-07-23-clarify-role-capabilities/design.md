## Context

Iris already has all the machinery: base Iris (Talk) always has conversation + `control_ui` + wake/sleep; Google Search is declared only under `IRIS_ENABLE_GOOGLE_SEARCH === "true"` (billed; free-tier keys die with 1011); the PO/DEV pipeline and the `personal-knowledge-notes` second brain are gated on the `claude` binary. What is missing is a *stated model* and the ability for Iris to explain and steer itself. `buildSystemInstructionText()` is one builder with a `pipelineAvailable` branch and a chat-only branch (governed by `pipeline-availability`). The SetupPanel already surfaces boolean toggles (`wakeWord`, `loadTestData`) through `getFullConfig()` + `config:save` and offers a reconnect prompt for settings that can't hot-apply.

## Goals / Non-Goals

**Goals:**
- One source of truth (`role-capabilities` spec) for the three roles and two modes.
- Iris explains modes/roles on demand and steers new-project/feature work to PO, without becoming chatty.
- A discoverable, honest Google Search toggle (paid-key warning, reconnect-on-change).
- Prompt-and-docs only — reuse existing seams, add no new UI surface beyond one toggle.

**Non-Goals:**
- No UI mode-switch/badge; no onboarding tour; no change to the Google Search default (stays OFF).
- No change to the notes mechanism (`llm-wiki` shipped it) — only an Iris-side offer to use it.
- No chat-only role/mode teaching — `pipeline-availability`'s chat-only prompt is untouched.
- No stateful-SDK changes; no new Gemini tool.

## Decisions

### D1: `role-capabilities` is a NEW spec; `pipeline-availability` is not modified
The new explain/steer/offer behavior is added strictly inside the `pipelineAvailable` branch of `buildSystemInstructionText()`. The chat-only branch keeps saying only "this needs Claude, set up from Settings" — so `pipeline-availability`'s "chat-only omits role content" requirement stays true and needs no delta. `role-capabilities` owns the two-mode model, the role boundaries, and Iris's behavior; it *references* the shipped `personal-knowledge-notes` capability for the note-offer rather than modifying it. (Grilling Q2=A, Q8=A.)

### D2: Steering is scoped to "new project/feature", quick tasks stay decisive
The prompt already routes a NEW project/feature to the PO intake and treats other actionable work decisively. This change only makes that boundary explicit in words and adds the on-demand explanation and the note-offer. Ad-hoc tasks (lookups, checks, small automations, notes) are NOT steered to PO — preserving the decisive Talk-mode feel and avoiding turning a POC into a bureaucratic gate. (Grilling Q9=A.)

"Steering" means Iris announcing the Build-mode boundary and using the existing PRODUCT OWNER CONTROL hand-off (`submit_claude_task` for the PO role with a short control intent) — it introduces no new dispatch mechanism and does not ask the user to manually pick PO from the UI. The delta spec's requirement and scenario must read that way explicitly, not as a manual-selection step.

### D3: Note-offer is a bounded, opt-in, Iris-side behavior, gated on the notes skills being installed
Iris may offer once, in one short line, to save a valuable exchange; it never auto-saves and always honors an explicit save/retrieve request. The offer is additionally gated on `checkNotesSkillsStatus().ok` (the same check `main.mjs` already computes for the SetupPanel and for the plain-Claude worker's vault directive at `startClaudeRun`) — if the notes skills aren't installed yet, Iris does not offer, since the plain-Claude worker would refuse the save.

This lives in the prompt (role-capabilities), not in the notes skill. `wiki-crystallize`'s own `SKILL.md` description does invite proactive triggering ("even if they don't say 'wiki'") — that wording targets a long-running interactive session. Each plain-Claude run here is instead a single one-shot subprocess scoped to exactly one task string with no accumulating chat history, so the proactive trigger has no "session wrapping up" signal to act on for an unrelated task. The bounded offer is enforced by Iris's own directive (never auto-save, offer at most once), not by suppressing the skill's proactive wording. (Grilling change-2 Q1=B.)

### D4: Google Search toggle lives in the existing "Gemini API key" section, applies on next connect
The flag concerns the Gemini key, so the toggle renders in the existing "Gemini API key" section regardless of pipeline availability — unlike the Claude-only token control. It is wired exactly like the existing boolean toggles: `IRIS_ENABLE_GOOGLE_SEARCH` added to `ALLOWED_CONFIG_KEYS`, exposed as a `googleSearch` boolean in `getFullConfig()` via the shared `envFlag()` helper, saved via `config:save`. `buildLiveConfig()`'s runtime gate is switched from its current strict `=== "true"` check to the same `envFlag()` helper, so a hand-edited `.env` value (`1`/`true`/`yes`/`on`) is read identically by the panel and the runtime — no second, divergent parser for the same flag. Because `buildLiveConfig()` reads the flag only at connect time, the toggle is a can't-hot-apply setting: on change it surfaces the panel's existing reconnect offer (like the Gemini key) rather than forcing a disconnect — the user may decline and it applies on the next natural reconnect. The warning text states the paid-key requirement and the 1011 free-tier failure. (Grilling Q3=A, plus the original search-toggle decision.)

## Risks / Trade-offs

- **[Prompt bloat / Iris over-explaining or over-offering]** → Word the explain/steer/offer as tightly-scoped, on-request-or-once directives; forbid unsolicited tours and repeated offers. Keep voice responses short (existing rule).
- **[A user enables search on a free-tier key and the session dies with 1011]** → The toggle's warning states this plainly; the flag is recoverable (toggle it back off from the panel, which is independent of the Live session). Auto-detection/auto-recovery was explicitly deferred (grilling Q4=A).
- **[Steering feels naggy]** → Scope it to genuinely new project/feature starts only; never steer quick tasks.

## Migration Plan

Additive and reversible. Rollback = revert the `buildSystemInstructionText()` additions, remove `IRIS_ENABLE_GOOGLE_SEARCH` from `ALLOWED_CONFIG_KEYS`/`getFullConfig()`, and remove the SetupPanel toggle. No data migration; the `.env` flag already existed as an env-only setting.

## Open Questions

- None blocking. Exact README section wording and the toggle's microcopy are settled at implementation from the decisions above.
