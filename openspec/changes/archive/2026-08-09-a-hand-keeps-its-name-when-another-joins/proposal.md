## Why

Every per-hand memory — the point EMA, the wrist EMA, and the 3-frame gesture
stabilizer — is keyed by a hand identity. That identity was derived from **how
many hands were in frame**: `"single"` for one, `"left"`/`"right"` for two.

So raising a second hand **renamed the first one**. Its memories were then read
under the new name, where a PREVIOUS two-hand session's values were still
sitting, because nothing pruned them. The hand's smoothed point jumped to
wherever it had been the last time two hands were up, and the gesture
stabilizer returned that session's pose until three frames corrected it.

A wrong point at that moment is not cosmetic: it is the frame the zoom seeds
its reference from, so the reel-in starts mis-scaled as well as jumping.

The transition is **intrinsic to reeling in**: you must aim with ONE open palm
to lock a note, then add the second hand. It is only **incidental** to the
two-palm zoom, which is usually raised from nothing — which is exactly the
asymmetry that was reported, one drive rough and the other fine.

## What Changes

**A hand's identity SHALL NOT depend on how many hands are in frame.** It comes
from the model's own handedness, with a count-independent positional fallback
for frames that carry no label.

**Per-hand memory SHALL be dropped when the hand leaves.** Stable names fix the
renaming but not a hand that leaves, moves, and returns under its own name —
its stored point would be seconds stale, and the EMA would drag the camera
there. A hand that reappears is treated like one that appears.

## Impact

- Specs: `two-hand-gestures` (ADDED)
- Renderer: `src/lib/hand.ts`, `src/hooks/useHandControl.ts`
- Affects every surface reading hand poses, not the galaxy alone
