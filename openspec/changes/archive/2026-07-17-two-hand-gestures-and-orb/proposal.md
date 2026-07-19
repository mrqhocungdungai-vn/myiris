# two-hand-gestures-and-orb

## Why

Upstream iris (`temp2/iris`) upgraded the interaction layer well past our fork: two-hand gesture tracking with per-hand stabilization, universal point-and-hold clicking, two-palm reader resize, per-hand reticles and a camera-dock hand skeleton, plus an expressive orb (thinking swirl, wake pulse, speech ripple) with synthesized interface sounds and visual handoff comets + a live per-task step timeline. Our fork still tracks one hand, can only dwell-open task cards, and shows a static orb with no run-progress detail. These are the highest-value UX upgrades of the reference repo and are almost entirely renderer-side. Depends on `ui-deepspace-restructure` being implemented (modular layout + Deep Space skin).

## What Changes

- **Two-hand gesture engine**: upgrade `src/hooks/useHandControl.ts` to upstream's version — `numHands: 2`, per-hand gesture stabilization maps, `TrackedHand[]` state with mirrored landmarks, primary-hand selection with anti-flicker continuity. MediaPipe pin stays `0.10.35` (package and WASM_URL equal).
- **Universal point-and-hold**: dwell 300 ms with a pointing hand clicks any `button`/`a`/`[data-task-id]`/`[role=button]` (step toggles, close buttons, chips), not just task cards.
- **Two-palm reader resize**: two open palms scale/drag the ReaderOverlay (upstream pinch-zoom behavior).
- **Per-hand reticles + hand skeleton**: adopt `HandReticles.tsx` (one reticle per tracked hand) and `CameraDock`'s `HandSkeleton` 21-landmark SVG.
- **Orb micro-expressions + sounds**: adopt upstream `ReactorCore` props (`inputLevelRef`, `outputLevelRef`, `thinking`, `wakeKey`, `rippleKey`), the App-level thinking/wake/ripple triggers, and `src/lib/sounds.ts` synthesized Web Audio cues (wake, sleep, task sent, task done, task failed, approval) — no audio assets.
- **Visual handoff + step timeline (re-plumbed to Claude events)**: adopt `HandoffLayer.tsx` + `useHandoffFx.ts` (comets orb↔Work Stream on delegate/complete) and `WorkCard`'s `StepTimeline`, but build `TaskStep[]` from **our** sidecar stream (`claude_task_update` notes derived from DEV NDJSON tool events and PO SDK messages) — upstream's `hermes_task_event` ingestion is not ported. Works identically for PO turns and DEV runs.

## Capabilities

### New Capabilities
- `two-hand-gestures`: Two-hand tracking, per-hand stabilization, primary-hand selection, universal point-and-hold click, two-palm reader resize, per-hand reticles and camera-dock skeleton.
- `orb-expressions`: Orb micro-expression states (thinking, wake pulse, speech ripple, dual input/output levels) and synthesized interface sound cues with a mute toggle.
- `task-step-timeline`: Visual handoff comets and the per-task step timeline sourced from Claude run events, for both PO and DEV.

### Modified Capabilities

<!-- none — voice relay, model selection, run queue behavior unchanged; this layers presentation on existing events -->

## Impact

- **Renderer**: `src/hooks/useHandControl.ts` (replaced by upstream version), `src/hooks/useHandoffFx.ts`, `src/components/HandReticles.tsx`, `src/components/CameraDock.tsx` (skeleton), `src/components/ReactorCore.tsx` (upstream prop surface), `src/components/WorkCard.tsx` (StepTimeline), `src/components/ReaderOverlay.tsx` (two-palm resize), `src/components/HandoffLayer.tsx`, `src/lib/sounds.ts`, `src/types.ts` (`TaskStep`), App.tsx wiring, `src/styles/fx.css` already present from the restructure.
- **Main process**: no IPC changes required; step data derives from the existing sidecar event stream. If current `claude_task_update` payloads lack tool start/stop granularity, `electron/main.mjs`'s existing NDJSON/SDK parsers may add fields to the **existing** event payloads (no new channels).
- **Dependencies**: none new (MediaPipe already pinned; sounds are synthesized).
- **Prerequisite**: `ui-deepspace-restructure` implemented.
