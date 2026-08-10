## Why

The user locked a note and the two-palm zoom destroyed the lock mid-gesture.

Backing out past twice the graph's extent released the anchor — by design, so
"close your hands to see everything again" worked. But that made the most
ordinary navigation gesture silently destroy the user's choice. Lock a note,
spread the palms to pull back and see where it sits, cross an invisible line,
and the lock, its red ring, and the zoom's target all vanish at once. The zoom
carries on as an untargeted one. Nothing the user did was about releasing, so
nothing told them a release had happened.

The previous change made the zoom fly toward the locked note. This one makes
that hold: it is worth nothing if the zoom can delete the lock on the way out.

## What Changes

**A lock outranks the zoom.** The backed-out release applies only while nothing
is locked. Zooming out with a lock held keeps flying away from that note, and
the target is changed by aiming at another one — an act that is about choosing.

The rule lives inside `shouldReleaseAnchor` rather than at its call site, so it
is a property of the rule instead of a habit of one caller, and it is covered by
the existing pure-function tests. Adding the parameter also makes forgetting it
a type error.

**A new lock pulls its note to the centre of the view.** Locking used to change
nothing visible but the ring, leaving every drive to work around a point off in
the corner — hard to steer by, because the pivot of the motion is not where the
user is looking. The glide is eased, and runs only while no drive is engaged, so
it never fights a drive that owns the aim (D4b).

**Consequence, deliberate:** there is no longer a gesture that returns to
"nothing locked". Once a note is chosen, some note is always chosen, and the
choice moves by aiming. This follows the user's own framing, in which the
unlocked state is where you begin rather than somewhere you go back to.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- `src/lib/galaxy-anchor.ts` (signature + rule), `src/hooks/useGalaxyCameraDrive.ts`
