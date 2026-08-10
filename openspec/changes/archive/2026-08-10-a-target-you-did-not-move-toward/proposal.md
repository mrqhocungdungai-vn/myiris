## Why

A defect my own previous change introduced.

Bringing a newly locked note to the centre of the view slides the whole world
under a sight that has not moved. A note the user never aimed at arrives beneath
it, is taken — and taking it re-centres, which slides the world again. The user
is a bystander to a loop their own hand is not driving, which is exactly how
they described it: selecting other notes without meaning to.

The user asked whether selection should move to a gesture other than an open
palm. It would hide this — but the flaw is not in the pose. Selection was
reacting to the CAMERA's movement rather than the user's, and any pose held
while the view glides would suffer the same thing. Moving it would also spend a
gesture, and make the commonest act in the galaxy a deliberate one.

## What Changes

**A target the user did not move toward is not a target they chose.** A
different note may take the target only once the hand has travelled a real
distance since the current one was picked.

Stated in terms of the hand because that is the only thing that is the user's.
It covers every source of world motion at once — the centring glide, a zoom, an
orbit — instead of naming them one at a time and missing the next one.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- `src/lib/galaxy-anchor.ts`, `src/hooks/useGalaxyCameraDrive.ts`
- The open palm keeps aiming; no gesture is spent
