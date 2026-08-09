## Why

Two defects reported from use, both in the galaxy's fist drives. Free zoom with
two open palms is fine and is not touched.

**A fist turns the view before the user has chosen anything to turn around.**
The spec says a fist turns the camera around the *locked* note, and the code
honours that only when something is locked — with nothing locked it falls back
to the point at the centre of the view. That fallback is right for the two-palm
zoom, which moves in and out along an axis already on screen, and wrong for a
turn, which is entirely about *which* axis it is. The user's words: the app
picks a default axis by itself, which is not what was asked for. Closing a hand
swings the whole graph around a pivot they never chose and cannot see.

**Reeling in on a locked note is not smooth**, while the two-palm zoom that
shares its law is. The span was measured to the fist's tracked FINGERTIP.
Curling into a fist — or merely tightening one already closed — travels that
fingertip a long way with none of it being the hand moving through space, and
the zoom law maps the span straight to an absolute radius, so knuckle movement
arrived as camera distance. The orbit already refuses to read a fist's
fingertip for exactly this reason, and says so in a comment; the reel-in was
reading it. Two open palms have no curl to leak, which is why only this pose
pair felt rough.

## What Changes

**Both fist drives require a locked note.** A fist alone, and a fist with a palm
beside it, SHALL drive nothing while nothing is locked. Neither gesture is
definable without the lock — one turns around the locked note, the other reels
in on it.

**The reel-in measures the fist at the wrist**, like the orbit, so a hand held
still holds the camera still however the fingers move.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- Renderer: `src/lib/galaxy-nav.ts`, `src/hooks/useGalaxyCameraDrive.ts`
- Docs: `docs/GESTURES.md`
