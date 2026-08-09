## 1. Re-seed on a change of measurement

- [x] 1.1 `zoomKind` names which pose pair a zoom is
- [x] 1.2 `engagementKey` carries drive + pose pair as one branded value
- [x] 1.3 The gesture loop compares and stores the key instead of the drive
- [x] 1.4 Tests over both pure functions, including that the pairs differ and that a held pair is stable

## 2. Make the omission unrepresentable

- [x] 2.1 Branded `EngagementKey`; verified the cut is now a compile error, and verified it was NOT caught before the brand
- [x] 2.2 Gates green — 1745 tests
