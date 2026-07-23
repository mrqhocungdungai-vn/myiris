## 1. Iris self-explanation, steering, and note-offer (prompt)

- [x] 1.1 In `buildSystemInstructionText()` (`electron/main.mjs`), inside the `pipelineAvailable` branch only, add a concise directive establishing the two-mode model (Talk vs Build) and the three roles (Iris/PO/DEV), to be explained ON REQUEST when the user asks what Iris can do / how to build / what the modes are — with an explicit "no unsolicited modes/roles tour at session start or wake".
- [x] 1.2 Add a steering directive: a request to start a NEW project or feature in Talk mode is announced as Build-mode work and forwarded to the PO role via the EXISTING automatic control-intent hand-off (`submit_claude_task` for the PO role, per the current PRODUCT OWNER CONTROL behavior) — this states the existing mechanism explicitly, it does not add a new manual-selection step; quick/ad-hoc tasks (lookups, checks, small automations, notes) stay decisive and are NOT steered.
- [x] 1.3 Add a note-offer directive, gated on `checkNotesSkillsStatus().ok` in addition to pipeline availability: after a valuable exchange, Iris MAY offer once (one short line) to save it to the second brain; never auto-save; always honor an explicit save/retrieve request; no offer at all when the notes skills aren't installed. Reference the notes capability, do not restate its mechanics.
- [x] 1.4 Confirm the chat-only branch of `buildSystemInstructionText()` is left unchanged (no role/mode content added there).
- [x] 1.5 Gate the two pre-existing unconditional "You also have built-in Google Search" lines in `buildSystemInstructionText()` (both the `pipelineAvailable` branch, ~line 2655, and the chat-only branch, ~line 2676) on `process.env.IRIS_ENABLE_GOOGLE_SEARCH`, so the capability list stays accurate when the flag is off (the default).

## 2. Google Search toggle (config + UI)

- [x] 2.1 Add `IRIS_ENABLE_GOOGLE_SEARCH` to `ALLOWED_CONFIG_KEYS` in `electron/main.mjs`.
- [x] 2.2 Expose a `googleSearch` boolean in `getFullConfig()` (via `envFlag("IRIS_ENABLE_GOOGLE_SEARCH", false)`), mirroring the existing `wakeWord`/`loadTestData` toggles.
- [x] 2.3 In `src/components/SetupPanel.tsx`, add a Google Search toggle in the Gemini section (renders regardless of pipeline availability), wired through `config:save`, with warning text: needs a paid Gemini key; a free-tier key is disconnected with a 1011 quota error; applies on the next reconnect.
- [x] 2.4 On toggle save, surface the panel's existing reconnect prompt (do NOT force a mid-session disconnect); confirm toggling back off is possible while a session is dead.
- [x] 2.5 Switch the runtime gate in `buildLiveConfig()` (`...(process.env.IRIS_ENABLE_GOOGLE_SEARCH === "true" ? [{ googleSearch: {} }] : [])`) to use the shared `envFlag()` helper, so the SetupPanel toggle (read via `envFlag` in 2.2) and the actual tool declaration agree on which raw `.env` values count as enabled.

## 3. README user guidance

- [x] 3.1 Add a "Roles & modes" section to `README.md`: the three roles (Iris/PO/DEV) with boundaries, the Talk vs Build two-mode model, the second-brain notes capability (Talk mode, needs Claude), and how to enable Google Search (paid key, from Settings).
- [x] 3.2 Add a new `IRIS_ENABLE_GOOGLE_SEARCH` entry to `.env.example` (no entry exists there today) documenting that the SetupPanel toggle and the runtime both accept `1`/`true`/`yes`/`on` (case-insensitive, per `envFlag()`, once 2.5 lands); cross-reference it from the panel's warning text so env and UI agree.

## 4. Verify

- [x] 4.1 Run `npm run build` (tsc --noEmit + vite build) and `npm test` (Vitest); both pass.
- [x] 4.2 Manual (pipeline available): ask "what can you do / how do I build software" → Iris explains modes/roles, and the Google Search line matches whether the flag is actually on; start a "new feature" → Iris announces Build-mode work and auto-forwards to PO via the existing hand-off (not a "please select PO" message); a quick lookup → handled decisively, no steer; after a research exchange with notes skills installed → at most one save offer, no auto-save; with notes skills NOT installed → no offer is made.
- [x] 4.3 Manual (chat-only, no Claude): confirm Iris behaves exactly as before — no role/mode teaching, existing "needs Claude" line intact, and the Google Search line matches the flag's actual state.
- [x] 4.4 Manual (SetupPanel): toggle Google Search on → warning shown, reconnect offered, `.env` updated with the literal value the toggle writes, other lines preserved; toggle off → persists; confirm the toggle renders with and without the Claude pipeline; hand-edit `.env` with an alternate accepted value (e.g. `1`) and confirm the panel's displayed state and the Live session's actual behavior agree.
