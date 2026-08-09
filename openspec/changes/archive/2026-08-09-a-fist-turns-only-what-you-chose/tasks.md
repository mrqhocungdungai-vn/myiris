## 1. A fist drives nothing until something is locked

- [x] 1.1 `driveFor` takes the lock and gates both fist drives on it
- [x] 1.2 `useGalaxyCameraDrive` passes this frame's lock, read after the lock step
- [x] 1.3 Tests: fist alone and fist+palm drive nothing unlocked; two-palm zoom still ungated

## 2. The reel-in is measured at the wrist

- [x] 2.1 `zoomSpan` reads the fist's `wristPoint`; palms keep their fingertips
- [x] 2.2 Tests: span from the wrist, a tightening fist does not move it, two palms unchanged

## 3. Proof and gates

- [x] 3.1 Each wire cut and confirmed red: fist gate (2 red), reel-in gate (1 red), wrist measurement (1 red)
- [x] 3.2 build / test / lint / scan:secrets / spec:check green — 1740 tests
- [x] 3.3 `docs/GESTURES.md` updated
