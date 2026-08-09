## Why

Found while auditing the reel-in smoothness fix, and made WORSE by it.

The two zoom pose pairs are both the `zoom` drive — correctly, they do the same
job — and the camera re-seeds its reference only when the drive changes. But
they measure their span from different landmarks: two open palms fingertip to
fingertip, a fist and a palm wrist to fingertip. Switching between them leaves
the drive identity untouched while the measurement basis moves underneath the
reference, and the zoom law is a ratio of reference to current, so the whole
discontinuity arrives as camera travel in one frame.

That is a lurch at the exact moment the reported gesture happens: the user is
zooming with two open palms, closes one into a fist to reel in on the note they
locked, and the camera jumps. Measuring the fist at the wrist — the fix for the
curl noise — widened the gap between the two bases, so the lurch got bigger.

The gesture loop has no tests; it needs a live force-graph and a camera. So the
guard cannot be a test, and a comment is not a guard.

## What Changes

**A camera drive's reference SHALL be seeded per measurement, not per drive.**
A change of pose pair within the zoom re-seeds exactly as a change of drive
does.

The stored value becomes an **engagement key** naming both the drive and, for a
zoom, its pose pair — one value, so the two can never be compared separately.
The key is a branded type, so storing a bare drive in its place is a compile
error rather than a silent regression: cutting this wire was verified to
produce no failure from the build, the linter, or 1745 tests until the brand
existed.

## Impact

- Specs: `second-brain-gesture-nav` (ADDED)
- Renderer: `src/lib/galaxy-nav.ts`, `src/hooks/useGalaxyCameraDrive.ts`
