## Why

The lowered-hand release read the **primary** hand's point. The primary is
chosen with a preference for POINTING hands — and no camera drive has one. A
two-open-palm zoom and a fist-plus-palm reel-in both leave `choosePrimary` on
its last fallback: whichever hand was primary before, sticky from an earlier
interaction.

So the drive lived or died on a hand picked for unrelated reasons. Hold a fist
a little low — which is exactly what people do with the hand that is only
*holding* while the other one moves — and the whole reel-in releases mid-gesture
if that fist happens to hold the primary title, or survives untouched if it does
not. Same gesture, same hands, two outcomes, decided by history the user cannot
see and did not create.

An intermittent release is felt as roughness rather than as a release: the
camera stops, the reference is dropped, and re-engaging seeds afresh. It is a
strong candidate for the reported "not smooth", and it is wrong regardless.

## What Changes

**The release SHALL be decided by the hands that drive.** Any driving hand
being low releases the drive — a two-hand drive with one arm dropping is a user
putting an arm down, and the span between the hands is changing for that reason
rather than because they are steering.

Driver selection and the height test are one function, so the gesture loop
cannot compose them wrongly; the loop has no tests of its own.

## Impact

- Specs: `second-brain-gesture-nav` (MODIFIED)
- Renderer: `src/lib/galaxy-nav.ts`, `src/hooks/useGalaxyCameraDrive.ts`
