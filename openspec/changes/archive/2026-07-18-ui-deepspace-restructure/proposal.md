# ui-deepspace-restructure

## Why

The upstream reference repo (`temp2/iris`, worker = Hermes) has evolved a modular renderer (`src/components|hooks|lib|styles`) and a full "Deep Space" visual system, while our fork still carries the older flat `src/` layout (App.tsx ~1300 lines with inlined WorkCard/HistoryDrawer/ExpandedReader/Telemetry) and the older aurora/scanlines skin. Two follow-up feature ports (two-hand gestures + orb expressions, voice UI control + setup panel) are copied almost file-for-file from upstream's modular components — without this foundation every one of them becomes a hand-merge into a 1300-line file. This change aligns structure and skin with upstream **without changing any behavior**, so subsequent ports become near drop-ins.

## What Changes

- Split flat `src/` into upstream's layout: `src/components/` (TopBar, CenterStage/Telemetry, CommsPanel, WorkStream, WorkCard, HistoryDrawer, ReaderOverlay, CameraDock, BootSequence, ReactorCore, SessionSwitcher), `src/hooks/` (useHandControl, useAudioPipeline, useHoldToScroll), `src/lib/` (tasks helpers, audio), `src/styles/` (tokens/base/deck/fx/overlays/index.css), `src/types.ts`. `App.tsx` becomes a pure orchestrator.
- Adopt the full Deep Space skin from upstream (`tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`; nebula/glow/vignette layers) replacing our aurora/scanlines reskin (`App.css` + monolithic `deck.css`).
- Re-graft every Claude-specific UI feature onto the new structure and skin, pixel-role-for-role — nothing dropped: pipeline bar with PO/DEV agent chips + gate ✓ marks + DEV soft gate confirm, per-role model popover, PO question banner (voice relay answer buttons), Claude session line (`who ▸ id`) + ⛓ chain badges on cards, project-folder bar, agent install button, CLAUDE telemetry row and `claude_*` sidecar event handling.
- Replace the workstream `<select>` dropdown with upstream's `SessionSwitcher` component UI, rebound to our existing `sessions:get/select/new/choose-cwd` IPC and per-role `agent_sessions` model. All Hermes IPC (`hermes:sessions`, `hermes:create-session`, `hermes:history`) is **not** ported.
- No `electron/` behavior changes; `preload.cjs` surface unchanged. Hermes-specific upstream pieces (hermesGate, Hermes status lanes, `IRIS_HERMES_*`) are explicitly excluded; all worker-facing naming stays `claude_*`.

## Capabilities

### New Capabilities
- `renderer-structure`: The modular renderer layout (components/hooks/lib/styles/types) and the composition contract App.tsx must uphold — which UI pieces exist as standalone components and what props/events they own.
- `deepspace-skin`: The Deep Space visual system (token variables, layered background, per-file stylesheet responsibilities) and the requirement that all Claude-custom UI elements render correctly on it.
- `workstream-switcher`: The SessionSwitcher-based workstream UI: list/create/switch workstreams, show cwd and per-role session identity, bound to the existing `sessions:*` IPC.

### Modified Capabilities

<!-- none — this is a structure/skin refactor; no existing spec-level behavior (model selection, PO relay, run queue, announcements, auth) changes -->

## Impact

- **Renderer only**: `src/**` is fully reorganized (App.tsx, App.css, deck.css, ReactorCore.tsx, BootSequence.tsx, useHandControl.ts, useAudioPipeline.ts, useHoldToScroll.ts all move/split). Renderer imports and `index.css` entry change.
- **Electron main/preload**: no functional change; only the renderer side of existing IPC channels moves between files.
- **Existing specs untouched**: per-role-model-selection, voice-decision-relay, po-live-session, run-execution-queue, session-announcements, agent-subscription-auth keep their behavior; their UI surfaces are re-hosted, not redesigned.
- **Dependencies**: none added or removed. Pinned identifiers (Gemini Live model, 16/24 kHz audio, MediaPipe 0.10.35) untouched.
- **Follow-ups unblocked**: `two-hand-gestures-and-orb` and `voice-ui-and-setup` build directly on this layout.
