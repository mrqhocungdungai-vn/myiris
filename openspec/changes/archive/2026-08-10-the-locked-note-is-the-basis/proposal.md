## Why

The user's own verdict on a design they had asked for: a fist plus an open palm
flying the camera toward the locked note was a bad trade, and reeling in should
be removed rather than tuned further.

The measurement says why. The reel-in read the distance BETWEEN the hands, so
moving the "holding" fist 100px changed the camera distance by 23% — exactly as
much as moving the palm did. The fist was not holding anything; it had equal
authority over the flight while the user thought of it as an anchor. And its
movement meant something different depending on the other hand: alone it turned
the view, with a palm beside it it flew the camera. The same movement of the
same hand, disambiguated by a hand the user was not thinking about.

Five implementation defects were fixed underneath this before the design itself
was questioned. They were all real, and none of them could have fixed this.

## What Changes

**Only two open palms zoom.** The fist-and-palm pair is removed.

**A fist always turns the view**, whatever the other hand is doing. One pose,
one job: the fist is the angle, two open palms are the distance.

**A zoom flies toward the locked note whenever there is one.** It used to
depend on the pose pair — two palms zoomed the middle of the view even with a
note locked — so "what am I zooming toward" was answered by which hands were up
rather than by what the user had chosen.

**A locked note wears a red ring.** The lock is the basis every gesture is
addressed to, so whether one exists decides whether most of the language does
anything at all. A user who cannot see it cannot tell why the same gesture
works or does nothing.

Without a lock, the only gestures that act are the two-palm zoom on the centre
of the view and the `Victory` reveal. Aiming and the dwell are unaffected: they
are how a lock is acquired and how a note is opened, and gating them on a lock
would make both unreachable.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- Renderer: `src/lib/galaxy-nav.ts`, `src/lib/galaxy-anchor-rings.ts`, `src/hooks/useGalaxyCameraDrive.ts`
- Docs: `docs/GESTURES.md`
- Removes `reelsToLock`, `zoomKind`, `engagementKey` and its branded type — all of which existed only to keep two zoom measurements from colliding
