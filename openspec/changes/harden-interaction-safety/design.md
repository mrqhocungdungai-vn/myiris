## Context

The DEV soft-gate confirm (`src/App.tsx:496-508`) runs inside the already-`async` role-switch handler: when switching to a role whose predecessor's handoff gate is not satisfied, it calls `const ok = window.confirm(...)`, and `if (!ok) return;` aborts. `window.confirm` is synchronous and blocks the renderer event loop entirely.

The dwell loop (`src/App.tsx:797-841`, BUG F form) reads live hand data from `liveHandRef`, finds `el = document.elementFromPoint(...)`, matches `actionable = el.closest('button, a, [data-task-id], [role="button"]')`, and after ~300 ms calls `actionable.click()`. It has no notion of an element that should be excluded from hands-free activation.

The two meet at the role chip: dwelling it fires the switch handler, which pops the blocking confirm — a hovering hand can freeze the app. `two-hand-gestures` "Universal point-and-hold click" currently mandates dwell on *any* interactive element, so excluding some is a spec change, not just code.

## Goals / Non-Goals

**Goals:**

- No blocking dialog in the renderer; the DEV gate confirm keeps identical confirm/cancel semantics but no longer freezes the orb/audio/gestures.
- A hovering hand cannot fire a destructive/irreversible control; those stay mouse- and voice-operable.
- Non-destructive dwell targets (cards, PO options, toggles, close buttons) behave exactly as before.

**Non-Goals:**

- Camera lifecycle (opt-in webcam, sticky camera error), audio-playback correctness, stale-closure comment — separate changes.
- Redesigning the gate logic itself (only its presentation changes).
- A general design-system modal; a minimal purpose-built confirm surface is enough.

## Decisions

### D1 — `askConfirm(message): Promise<boolean>` backed by a small modal state

**Chosen:** a `confirm` state `{ message: string; resolve: (ok: boolean) => void } | null` and a helper `askConfirm(message)` that returns `new Promise<boolean>((resolve) => setConfirm({ message, resolve }))`. The overlay renders when `confirm` is non-null with Confirm and Cancel buttons; each calls `confirm.resolve(true|false)` then clears the state. The role-switch handler does `const ok = await askConfirm(...); if (!ok) return;` — a one-line shape change from the blocking call. Escape / backdrop click resolves `false` (same as Cancel).

Because the handler is already `async` and already `await`s `window.iris.selectAgent`, awaiting the modal introduces no new control-flow risk. While the promise is pending, the event loop keeps running — rAF, audio scheduling, and MediaPipe continue.

*Considered:* a confirm library or the existing SetupPanel overlay machinery — rejected as heavier than one boolean promise needs.

### D2 — Dwell loop skips `[data-no-dwell]`; the tag marks destructive controls

**Chosen:** after computing `actionable`, if `actionable.closest('[data-no-dwell]')` is non-null, treat it as no actionable target — clear `dwellRef`, report no dwell (`syncDwell(false, false)`), and continue the loop. So dwell neither clicks nor shows the "Hold · opening" indicator over an excluded control. Mouse `.click()` and voice paths are untouched (they don't go through this loop).

The tag is applied to controls whose action loses data or is irreversible: "Remove token" (`SetupPanel.tsx:333`), "New session" (`App.tsx` `onNewSession`/`createSession`), and the project-folder switch (resets the session). The criterion — not an enumerated allowlist — is what the spec pins, so new destructive controls added later inherit the rule by being tagged.

*Considered:* an allowlist of dwell-safe selectors instead of a denylist — rejected: the default should stay "dwell works everywhere" (the spec's intent) with a small, explicit set of exclusions, not the inverse (which would silently break dwell on any new control).

### D3 — Should the gate-confirm buttons themselves be dwell-excluded?

**Chosen:** no. The gate confirm ("switch anyway despite a missing handoff") is reversible — switching roles loses no data and can be switched back — so its Confirm/Cancel buttons stay dwell-operable, consistent with dwelling PO answer options. `data-no-dwell` is reserved for irreversible/data-losing actions (D2). This keeps the hands-free flow usable end-to-end (a gesture user can pass the gate) without exposing them to accidental data loss.

## Risks / Trade-offs

**A destructive control is missed and stays dwell-reachable** → the spec pins the *criterion* (data-loss / irreversible) and a scenario, and the enumerated set (Remove token, New session, project-folder) covers today's controls; a manual pass over every visible button during verification catches stragglers. Adding the tag to a new destructive control is a one-attribute change.

**Async confirm changes ordering subtly** → the handler already awaits IPC; the only new suspension point is the user's decision, which is exactly where the blocking confirm suspended too. Cancel still returns before `selectAgent` is called.

**Dwell indicator flicker near an excluded control** → treating the excluded element as "no target" reuses the existing no-target path, so behavior matches hovering empty space; no new visual state.

**No automated coverage** → renderer/gesture/DOM code is out of the Vitest harness (Wave 0.0 D5). Verification is the manual checklist: the gate confirm no longer freezes the orb/audio; dwell over Remove-token / New-session does nothing while mouse still works; dwell over normal targets (cards, PO options) still fires.
