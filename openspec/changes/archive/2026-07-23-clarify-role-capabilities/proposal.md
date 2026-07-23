## Why

The three roles a user meets — base Iris, PO, and DEV — have no stated capability boundaries or workflow, so users cannot tell when they are just talking to Iris versus driving the build pipeline, and never discover that Talk-mode Iris (via Claude) is also a note-taking second brain. There is no single source of truth for "what each role does" and no user-facing guidance. This change defines that source of truth and makes Iris able to explain and steer itself.

## What Changes

- **NEW capability — role capabilities.** Establish the canonical model: Iris runs as **two co-equal modes** — *Talk mode* (conversational companion + interface/HUD control + wake/sleep, plus optional billing-gated Google Search, plus the shipped `personal-knowledge-notes` second brain) and *Build mode* (the PO → DEV pipeline) — surfaced to users as exactly **three roles: Iris / PO / DEV** (the internal ungated "plain Claude" worker path is never advertised as a role).
- **Iris explains and steers itself (pipeline-available only).** When asked "what can you do / how do I build software / what are the modes", Iris explains the two modes and three roles — with an accurate Google Search line stating it is optional and needs a paid key. When the user asks to start a **new project or feature** while in Talk mode, Iris tells them this is Build-mode work and forwards it to the PO role via the existing automatic control-intent hand-off (the mechanism is unchanged; this change only states it explicitly) — quick/ad-hoc tasks stay decisive and are not steered. After a valuable exchange (research, a worked-out decision), and only when the notes skills are installed, Iris may offer once to save it to the second brain — a gentle offer, never an automatic save.
- **Google Search toggle in the SetupPanel.** Add a user-facing toggle for `IRIS_ENABLE_GOOGLE_SEARCH` with a clear warning that it needs a paid Gemini key (a free-tier key is killed with a 1011 quota error) and that it applies on the next reconnect. Toggling offers the existing reconnect prompt rather than forcing a disconnect.
- **README user guidance.** A README section documenting the three roles, the two modes, the second-brain notes capability, and how to enable search.

Out of scope (unchanged by decision): no new UI mode-switch affordance (prompt + docs only); the Google Search default stays OFF; the notes *mechanism* is untouched (shipped in `llm-wiki`); chat-only mode gains no role/mode teaching — `pipeline-availability`'s chat-only prompt stays exactly as-is.

## Capabilities

### New Capabilities
- `role-capabilities`: the canonical Talk/Build two-mode model, the three user-facing roles and their capability boundaries, and Iris's own behavior — explaining modes/roles on demand, steering new-project/feature requests to PO, and offering to save notes — all gated on pipeline availability.

### Modified Capabilities
- `setup-panel`: the settings panel's toggle set gains a Google Search toggle (with the paid-key/1011 warning), and the config-IPC writable-key set gains `IRIS_ENABLE_GOOGLE_SEARCH` as a reconnect-required setting.

## Impact

- **Code:** `electron/main.mjs` — `buildSystemInstructionText()` gains the explain/steer/offer-notes content **only in its `pipelineAvailable` branch** (chat-only branch unchanged), and its two pre-existing unconditional "you also have built-in Google Search" lines (both branches) are gated on `IRIS_ENABLE_GOOGLE_SEARCH` so the capability list stays accurate; `getFullConfig()` exposes a `googleSearch` boolean; `ALLOWED_CONFIG_KEYS` gains `IRIS_ENABLE_GOOGLE_SEARCH`; the runtime gate in `buildLiveConfig()` switches from a strict `=== "true"` check to the shared `envFlag()` helper so the panel and the runtime agree on which values count as enabled. `src/components/SetupPanel.tsx` — a new toggle in the existing "Gemini API key" section with the warning text and the standard reconnect offer on save.
- **Specs:** new `role-capabilities` living spec; `setup-panel` delta modifies two requirements. `pipeline-availability`, `config-persistence`, and `personal-knowledge-notes` are **not** modified (the note-offer references `personal-knowledge-notes` but adds no requirement to it).
- **Docs:** README gains a "Roles & modes" user-guidance section; `.env.example` gains a new `IRIS_ENABLE_GOOGLE_SEARCH` entry (the flag has no existing doc entry today) that the panel's warning text cross-references.
- **Behavior:** no change when the Claude CLI is absent (chat-only companion is untouched); Google Search remains off until a user explicitly enables it.
