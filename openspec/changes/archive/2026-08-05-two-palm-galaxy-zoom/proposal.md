## Why

The galaxy's one-hand pinch zoom is unusable: pinching tightly is exactly what makes MediaPipe classify the hand as `Closed_Fist`, so the drive flips zoom → orbit → re-discrimination → zoom, and each flip to orbit takes its delta from the index fingertip — which has just travelled toward the thumb. The camera is flung around instead of dollying.

Tuning cannot fix it, because two of the constants are wrong in kind rather than in value. `PINCH_ENGAGE = 0.1` is compared against `pinchDistance`, an **absolute** normalized-image distance never divided by hand size; at working camera distance `dist(wrist, middleMCP)` is roughly 0.10–0.18, so the threshold is about one hand length and a genuine fist already satisfies it. And the zoom's whole authority is about ±50 radius units out of a 15–2500 range — roughly 2% — because `radiusStep` **adds** `pinchDelta * 600` instead of scaling. Zoom barely moves, so the natural response is to pinch harder, which walks straight into the misclassification. The interaction rewards the exact input that breaks it.

## What Changes

- **BREAKING (gesture surface):** pinch has no meaning in the galaxy at all. The pinch-to-zoom binding and the pinch-tap-to-focus binding are both removed.
- **Two open palms zoom the galaxy camera**, stated once as a general rule: two open palms scale whatever layer owns the gesture surface. A reader is already scaled that way; the galaxy joins it. So opening a note hands the gesture to the note and closing it hands the gesture back to the galaxy, with no new routing — `resolveGestureContext` already ranks reader > galaxy > deck.
- **The zoom law becomes multiplicative**, reusing the ratio law `ReaderCore` already proves out, inverted because a camera gets closer by shrinking its radius. Spreading the hands apart zooms in — the same direction in which spreading enlarges a reader, so the reflex survives opening and closing a note.
- **Every tracked hand's point is smoothed**, not just the primary one. This is conformance work, not a new behavior: `two-hand-gestures` already says `TrackedHand` exposes a smoothed point, and the second hand has been carrying raw coordinates. Nothing measured the distance between two hands sensitively enough to notice until now.
- **Hands-free node selection is deliberately deferred.** Removing pinch removes the only gesture that toggled focus. Selecting stays available by Cmd/Ctrl-click; clearing stays hands-free through the HUD control island, which stays dwell-activatable under a fullscreen layer. The deferral and its reason are recorded in the spec so a later reader sees a decision rather than an omission.
- **The gesture action indicator names the live binding again.** Its galaxy branch read `pinchDistance`, which `semanticEquals` deliberately excludes from republishing — so the label showed a stale value. Reading the open-palm count instead fixes it at the root, because that field *is* compared.
- A gesture debug readout, off by default, makes the live numbers observable while tuning.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `two-hand-gestures`: two open palms scale the layer that owns the gesture surface — stated once here rather than per-layer. The `TrackedHand` smoothed-point guarantee is restated so it holds for every tracked hand, not only the primary.
- `second-brain-gesture-nav`: the fist-orbits/pinch-zooms requirement is rewritten — the fist still orbits, the zoom now comes from the general two-palm rule. All pinch, tap, hold-window and hysteresis requirements are removed, and hands-free selection is recorded as deferred with its reason.
- `second-brain-focus`: the focus is produced by the mouse only for now, not by hand gestures.

## Impact

**Code**

- `src/lib/galaxy-nav.ts` — `driveFor` becomes stateless; `PoseDriveState`, the pinch thresholds, the release streak, the tap window and the `"tap"` drive are deleted; the linear `radiusStep` is replaced by a ratio-based radius function.
- `src/hooks/useHandControl.ts` — per-hand point smoothing, cleared on the no-hand transition.
- `src/components/VaultGalaxy.tsx` — the zoom reference is seeded from the two-hand distance; the tap branch is deleted. The `controls.enabled` disable/restore mechanism is untouched.
- `src/App.tsx` — the galaxy branch of `handAction`; a debug readout behind a default-off localStorage flag.
- `src/lib/galaxy-nav.test.ts` — the pinch/tap blocks are rewritten rather than left behind.

**Not changed, deliberately**

`pinchDistance` stays exactly as it is, because the deck orb's scale still depends on it. That binding has the same depth bug — moving a hand toward the camera inflates the orb — and it is out of scope here. Recorded as debt.

**Risk**

The two-palm gesture is already in use for reader resize, so the poses do not collide: a hand cannot be both `Open_Palm` and `Closed_Fist`, and the reader context outranks the galaxy. The one behavior genuinely lost is gesture-based node selection, which is the deferral above.
