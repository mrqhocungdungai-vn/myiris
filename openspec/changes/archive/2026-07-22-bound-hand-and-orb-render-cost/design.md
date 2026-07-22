## Context

`useHandControl`'s rAF `loop()` (`src/hooks/useHandControl.ts:188-268`) runs the MediaPipe recognizer each frame and calls `setState(...)` unconditionally — with a full object in the hand-present branch (245) and `{ ...EMPTY_STATE, active: true }` in the no-hand branch (264). The hook returns that state; `App.tsx:778` consumes it as `hand`, and because nothing in App's tree is memoized, each `setState` re-renders everything down through the R3F `<Canvas>`.

The imperative-read infrastructure this fix needs already exists:

- `liveHandRef.current = hand` is mirrored every render (`App.tsx:779-780`).
- The open-palm scroll loop (`816-846`) and the fist-rotate / pinch-scale loop (`854-889`) already read `liveHandRef.current` inside their own rAF and write straight to DOM scroll / `orbRotationRef` / `orbScaleRef` — no React state involved.

So two consumers still force per-frame React renders: the `hand` state itself (feeding the `handAction` memo and `HandReticles`), and `dwellRef`, which is read during render but only stays fresh because BUG F re-renders on every `hand.point` change.

For BUG G, `ReactorCore` already accepts `running`, `rotationRef`, `scaleRef` (`ReactorCore.tsx:94-95,102-103,235`); `CenterStage` passes all three (`CenterStage.tsx:130-132`); `HudShell` passes none (`HudShell.tsx:255`), so the HUD orb defaults to `frameloop="always"` and has no gesture inputs.

## Goals / Non-Goals

**Goals:**

- No React re-render per hand-tracking frame; an empty (no-hand) frame does zero work.
- Every `two-hand-gestures` behavior preserved: reticles, 300ms dwell-click, fist-rotate, pinch-scale, two-palm resize, open-palm scroll, and the `handAction` label — including "Hold · opening".
- HUD orb pauses when asleep (satisfy `orb-expressions`) and honors fist-rotate / pinch-scale (satisfy `two-hand-gestures`).

**Non-Goals:**

- `ReactorCore` per-frame allocations, `AudioWorklet` migration, `window.confirm` block (separate follow-ons).
- Changing gesture semantics or thresholds.
- Adding `memo` throughout App (out of scope; this change removes the per-frame *trigger*, which is the root cause — memoization is a later hardening).

## Decisions

### D1 — The hook publishes semantic state; per-frame data rides a ref

**Chosen:** split `HandState` into (a) a **ref** carrying the continuously-changing fields (`point`, `landmarks`, `pinchDistance`, and the per-hand smoothed points) and (b) **React state** carrying only the semantic fields (`present`, `gesture`, `pointing`, `openPalm`, `fist`, and the hand count / ids). `loop()` updates the ref every frame but calls `setState` only when a semantic field differs from the last published one. The no-hand branch early-returns without `setState` when the previous published state was already the empty/absent one.

The hook returns `{ stateRef, state, error, stream }` (or equivalent): `stateRef` for per-frame consumers, `state` for semantic consumers. App's existing `liveHandRef` collapses into (or is fed by) `stateRef`, so the scroll and orb-gesture loops keep reading a ref exactly as they do now.

*A shallow-equality gate inside the hook before `setState` considered:* that alone would still allocate and compare a full object every frame and still re-render on every `point` change (point is in the object). Splitting point out of state is what actually removes the 60fps re-render. Comparing only the handful of semantic scalars is cheap.

### D2 — `HandReticles` positions itself imperatively from the point ref

**Chosen:** `HandReticles` reads the smoothed per-hand points from the ref in its own rAF and writes them to element transforms, instead of receiving `hand` as a prop and re-rendering. The reticle *set* (how many, which is secondary) changes only on the semantic state, so React still owns mount/unmount; only position is imperative — the same division `ReactorCore` already uses for audio-level refs.

### D3 — `dwellRef` becomes dwell **state** that changes only on dwell transitions

**Chosen:** the dwell tracker stays a ref for its bookkeeping (`el`, `startedAt`, `fired`), but the *render-visible* facts — "is a dwell in progress" and "has it fired" — become a small state (a `dwellActive` boolean, or a version counter bumped on transition). It changes at most twice per target (enter → fire), not per frame. The `handAction` memo (`891`) then drops `hand.point?.x/y` from its deps (`910-911`) and depends on the semantic state plus `dwellActive`; `HandReticles`' `dwelling` prop reads the same state.

This is the crux of the F↔dwell coupling: point leaving the render path and `dwellRef` entering the render path as state must happen together, or the "Hold · opening" label breaks (goes stale or never appears). One commit.

### D4 — HUD orb: `running={awake}`, plus the gesture refs

**Chosen:** thread `running={awake}`, `orbRotationRef`, `orbScaleRef` from `App.tsx`'s `<HudShell>` call site (`1094`) through `HudShell` into its `<ReactorCore>` (`255`).

`running={awake}` — not `awake && windowFocused` — because the HUD is the always-visible overlay the user keeps up while working elsewhere; pausing it on blur (which is most of the time in HUD) would freeze the ambient indicator. This is the deliberate deck-vs-HUD divergence the `orb-expressions` delta pins. The deck keeps its stricter `sidecarRunning && windowFocused`.

The gesture refs are already populated by App's fist-rotate / pinch-scale loop regardless of mode, so threading them just lets the HUD orb *apply* what is already being computed.

## Risks / Trade-offs

**Reticle lag or jitter after moving to imperative positioning** → the ref already holds smoothed points (the hook's EMA at `useHandControl.ts:237-242`); writing transforms in a dedicated rAF should be as smooth as today or smoother (no React reconciliation between frame and paint). Manual check: reticle tracks the finger without visible lag.

**"Hold · opening" or dwell-click regressions** → the highest-risk area; D3 must land atomically with D1. Manual checklist covers: label appears within ~300ms of holding over a target, click fires once, leaving and re-entering re-arms. Also re-verify dwell-click still works in HUD (`.hud-hit` islands).

**A semantic field missed in the publish gate** → if a field that the UI reads is left out of the equality check, the UI could go stale. Mitigated by deriving the gate from exactly the fields the render path consumes (the `handAction` memo's inputs plus `HandReticles`' set), and a manual pass over each gesture.

**HUD orb still runs while awake+unfocused** → intended and now specified; it is the ambient overlay. The GPU cost while awake is the accepted cost of the feature; the fix removes the *asleep* waste, which is the defect.

**No automated coverage** → this is renderer/R3F/MediaPipe code, out of the Vitest harness (Wave 0.0 D5). If any pure helper falls out (e.g. a `semanticEquals(a, b)` for the publish gate), it can carry a `src/lib` unit test like BUG D's; the rest is the manual FPS + gesture checklist in tasks.
