## Why

Aiming was a single open palm — the pose a hand falls into by simply being
raised. So the galaxy was always half-listening for a choice and had to infer,
from movement alone, whether one was meant.

Three heuristics grew out of that inference, each defensible on its own:

1. a challenger had to be 120px from the target on screen before it could take it;
2. the hand had to travel 48px before a different note counted as chosen;
3. a newly locked note was pulled to the centre so the view would settle.

Together they were unpredictable. (3) slid the world under a still hand, which
is what (2) was added to survive; (2) and (1) then compounded until a deliberate
reselection could fail for reasons no user could see. The user's verdict on the
result was that moving the hand often did not reselect at all, and that the
auto-centring was worse in practice than it sounded.

Each fix answered its predecessor rather than the original problem. The original
problem was that the system could not tell choosing from not-choosing.

## What Changes

**Aiming becomes its own gesture: `Thumb_Up`.** While it is up, the user IS
choosing; while it is down, they are not. The crosshair and the candidate ring
appear only with it, so the galaxy is silent until asked.

**All three heuristics are deleted, not tuned.** A pose held on purpose answers
the question they were estimating, so there is nothing left to infer and no
reason to be careful about movement.

The open palm keeps only its two-handed job — zoom — and a single one now means
nothing, which is correct: a raised hand should not be a statement.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- `src/hooks/useHandControl.ts` (a `thumbUp` flag on every tracked hand), `src/lib/hand.ts`, `src/lib/galaxy-nav.ts`, `src/lib/galaxy-anchor.ts`, `src/hooks/useGalaxyCameraDrive.ts`
- Removes `ZOOM_SWITCH_SEPARATION_PX`, `SIGHT_TRAVEL_TO_RETARGET_PX`, `sightMovedEnoughToRetarget`, and the centring glide
