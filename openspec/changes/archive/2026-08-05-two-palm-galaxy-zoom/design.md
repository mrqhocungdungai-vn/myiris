## Context

See proposal.md — Why. What matters for the approach is where the current implementation sits:

- `src/lib/galaxy-nav.ts` is the pure policy module (hit-testing, dwell state machine, pose partition, camera math). `src/components/VaultGalaxy.tsx`'s rAF loop is a thin driver that feeds it a frame's inputs and applies its outputs. That split is good and this change keeps it — all new math lands in the pure module.
- `driveFor` currently threads a `PoseDriveState` through frames (`zooming`, `releaseStreak`, `pinchEngagedAt`, `becameZoom`). Every field exists to service the pinch's tap-versus-hold discrimination. Nothing else needs frame-to-frame state.
- `src/components/ReaderCore.tsx` already implements a two-hand ratio scale that works in the field. It seeds `{ distance, scale }` on engage, applies `currentDistance / max(80, refDistance)`, clamps the result, and drops the reference when fewer than two open palms are present. This change adopts that law rather than inventing one.
- `src/hooks/useHandControl.ts` publishes hand state through two channels: a `stateRef` written every frame for imperative readers, and React state published only when `semanticEquals` (`src/lib/hand.ts`) sees a semantic field change. `pinchDistance` is deliberately excluded from that comparison; `openPalm` is included, per hand.
- `resolveGestureContext` (`src/lib/gestureContext.ts`) already ranks `reader > galaxy > drawing > deck`.

## Goals / Non-Goals

**Goals:**

- A galaxy zoom whose input cannot be confused with any other galaxy binding, and whose authority spans the camera's whole usable range instead of ~2% of it.
- One statement of "two open palms scale the active layer", so the reader and the galaxy cannot drift apart.
- Make the constants observable, since every defect here came from a number nobody could see at runtime.

**Non-Goals:**

- Fixing the deck orb's pinch scale. It has the same depth bug (`App.tsx:1339` maps a raw `pinchDistance` through a fixed 0.03–0.3 range, so moving a hand toward the camera inflates the orb) but it is a different surface, tuned by feel, and the user did not report it. Recorded as debt.
- A replacement gesture for node selection. Deliberately deferred — reasoning lives in the `second-brain-gesture-nav` delta.
- Touching the reader's own scale range or feel. `ReaderCore` is the donor of the law here, not a subject of the change.
- Any change to `nearestNodeAt`, `dwellStep`, `focusNeighborhood`, `orbitStep`, or the `controls.enabled` disable/restore mechanism.

## Decisions

### D1. Zoom moves to two open palms rather than being repaired in place

A pinch cannot be told apart from a fist by the signal available. `pinchDistance` is `hypot(indexTip - thumbTip)` in normalized image coordinates — never divided by hand size — so its threshold is a length, not a shape. At working camera distance `dist(wrist, middleMCP)` is roughly 0.10–0.18, making `PINCH_ENGAGE = 0.1` about one hand length; a fist's own thumb-to-index-tip distance falls under it. That is why the fist branch had to be checked first and win.

*Alternative considered — a landmark-geometry pinch predicate:* derive `handScale = dist(wrist, middleMCP)`, then require both a small `dist(thumbTip, indexTip)/handScale` **and** a large `dist(indexTip, indexMCP)/handScale` (index actually extended, which a fist fails). This would work and was the design until the two-palm option surfaced. It was dropped because it fixes the discrimination while leaving the second problem — a pinch's finger travel is short, so zoom authority stays small and ratchety — and because it adds a hand-shape heuristic to a codebase that has so far relied on the recognizer's canned classes.

*Alternative considered — latching the zoom so a fist cannot preempt it once engaged:* cheaper, but the race is at *entry*. Pinching tightly from the start is read as a fist before any latch exists to hold.

Two open palms sidesteps all of it: `Open_Palm` is a canned class already debounced through `stabilizeGesture` (three consecutive frames), it is the opposite pose from `Closed_Fist` rather than a near-neighbor of it, and the measurement is a *relation between two hands* whose ratio is unbounded by finger travel.

### D2. The rule is stated once, in `two-hand-gestures`, not per layer

The binding means "scale what we are working on". Stating it in the general spec and letting `second-brain-gesture-nav` refer to it means the reader and galaxy cases cannot describe the same gesture differently — the same reason `resolveGestureContext` exists as one shared resolver rather than a condition re-derived per call site.

*Alternative considered:* declare a galaxy-local zoom binding in `second-brain-gesture-nav` and leave `two-hand-gestures` alone. Smaller delta, but it defines one gesture in two specs — the duplication pattern this codebase treats as a defect generator.

### D3. Ratio law, `k = 1.0`, no exponent

`radius = clamp(15, 2500, refRadius * refDist / curDist)`.

Multiplicative, so the same hand motion produces the same *proportional* camera move at every distance — the current additive law makes 50 units invisible at radius 2000 and violent at radius 20. Inverted relative to `ReaderCore` because a camera approaches by shrinking its radius, which is what keeps "spread = bigger" true on both layers.

At `k = 1.0` the exponent disappears and the expression is a single multiply-divide, so no `Math.pow` and no extra tuning constant. Spreading the hands to twice their engage distance halves the radius; further travel is reached by releasing and re-engaging, which re-seeds — the same ratchet a trackpad pinch has.

`refDist` carries `ReaderCore`'s 80px floor so that engaging with the hands nearly touching cannot produce a runaway ratio. `curDist` needs the same floor for the same reason in the other direction; the output clamp would catch it regardless, but flooring the input keeps the function total rather than relying on a downstream clamp to absorb a division by ~0.

### D4. Smoothing is fixed at the source, for every hand

The zoom reads `|handA.point - handB.point|`. Only the primary hand's point is smoothed today, so that expression mixes a filtered signal with a raw one. Raw landmark noise (~0.003 normalized) is amplified ~1.56× by `INPUT_RANGE`'s remap before reaching window pixels, which at a 200px reference is a few percent of ratio every frame — invisible on a reader clamped to [0.72, 1.28], very visible on a camera radius spanning 15–2500.

Fixing it in `useHandControl` rather than filtering `curDist` inside the galaxy loop is chosen because `two-hand-gestures` already claims `TrackedHand` exposes a *smoothed* point. This is conformance, not new behavior, and it improves the reader's own resize and the secondary reticle for free.

The per-hand smoothing map must be cleared where `stableGestureById` is cleared (the transition into "no hand"). Without that, a hand that leaves and returns eases in from its last-seen position — turning a tracking dropout into a camera jump, which is precisely the class of defect being removed.

### D5. `driveFor` becomes stateless

With pinch gone, no drive needs to remember anything across frames: two open palms, a fist, and a point are each decided from the current frame alone. `PoseDriveState` and its constants are deleted rather than left inert — dead state on a hot path is how the original `appendSystemPrompt` defect survived.

The partition is ordered two-palms → point → fist. Order is not load-bearing (a hand cannot be `Open_Palm` and `Closed_Fist` at once, and the two-palm test counts *both* hands while the others read the primary), but reading two-palms first states the precedence the spec describes.

### D6. The indicator reads the open-palm count, not a pinch measurement

`handAction`'s galaxy branch labelled zoom from `hand.pinchDistance`, taken from React state — which `semanticEquals` never republishes for a `pinchDistance`-only change. The label therefore showed whatever that value was when some *other* field last changed. Counting open palms fixes this at the root rather than working around it, because `openPalm` is compared per hand by `sameHand`. No new re-render pressure: the count only changes when a hand's stabilized gesture does.

### D7. A default-off debug readout

Every defect in this change traces to a runtime number that was never displayed: a threshold in the wrong units, a sensitivity covering 2% of its range, an unsmoothed second hand. The readout shows hand count, per-hand gesture, `curDist`, `refDist`, ratio, resulting radius, the live drive, and fps.

Gated by a `localStorage` flag, matching how the other renderer-side preferences are held, and default off so it costs nothing in normal use. It reads `handRef` in the existing gesture rAF loop rather than scheduling its own, and writes through a ref-driven DOM update rather than React state, so an enabled readout does not turn a 60fps loop into 60 re-renders.

*Alternative considered:* make it permanent inside `CameraDock`, which already draws hand skeletons. Rejected for this change — a permanent surface needs its own spec, and this one is a tuning instrument.

## Risks / Trade-offs

- **Both hands must be in frame to zoom** → Real cost: single-hand zoom is gone. Accepted because the single-hand zoom being replaced did not work, and because both hands are already required for the reader resize the user must learn anyway.
- **`k = 1.0` may feel wrong in the hand** → It is one constant in one pure function, and D7's readout exists specifically so it can be judged against live numbers instead of guessed at across rebuilds.
- **Losing gesture node-selection** → Selection remains by Cmd/Ctrl-click and clearing remains dwell-reachable through the HUD control island. Recorded in the spec as a decision with its reasoning, so a later reader does not restore it by accident or mistake it for an oversight.
- **Per-hand smoothing changes reader resize feel slightly** → It makes it steadier, and the spec already promised it. Watched during the manual pass rather than pre-compensated.
- **Hand ids swap when hands cross in front of each other** (`id` is assigned by x-order) → Harmless: the zoom reads the distance between the two points, which is symmetric.
- **The recognizer briefly dropping one `Open_Palm` mid-zoom releases the reference** → By design, the zoom pauses and re-seeds rather than jumping. `stabilizeGesture`'s three-frame requirement makes the stable class sticky, so this should be rare.
