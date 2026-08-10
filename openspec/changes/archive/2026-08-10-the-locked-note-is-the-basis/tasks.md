## 1. One pose, one job

- [x] 1.1 `driveFor` no longer returns a zoom for a fist and a palm; a fist turns the view whatever the other hand does
- [x] 1.2 `zoomSpan` measures only between two open palms
- [x] 1.3 `reelsToLock`, `zoomKind`, `engagementKey`, `EngagementKey` deleted — they guarded a collision that no longer exists
- [x] 1.4 Tests, red when either wire is cut

## 2. The lock is the basis

- [x] 2.1 A zoom engages on the locked note whenever there is one — the `useLock` branch is gone rather than inverted, so there is no condition left to get wrong
- [x] 2.2 Red lock ring in `galaxy-anchor-rings`, drawn whether or not a drive is live
- [x] 2.3 The mark is cleared in the same statement that clears the lock on backing out

## 3. Gates

- [x] 3.1 build / test / lint / scan:secrets / spec:check green — 1744 tests
- [x] 3.2 `docs/GESTURES.md` updated
