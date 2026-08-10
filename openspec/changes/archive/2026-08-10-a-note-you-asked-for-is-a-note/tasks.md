## 1. A capture is a note

- [x] 1.1 `writeVaultNote` in `vault-write.mjs` — frontmatter, atomic, never throws, never overwrites
- [x] 1.2 `titleFromText` derives a title from the first line when none was given
- [x] 1.3 `noteFileName` replaces only path-hostile characters, so diacritics survive
- [x] 1.4 `captureNote` writes into the vault, and reports the title it used
- [x] 1.5 `capture_note`'s declaration describes what it now does; `title` says it becomes the filename
- [x] 1.6 Tests, including a Vietnamese title and a collision; three wires cut, three red

## 2. Gates

- [x] 2.1 build / test / lint / scan:secrets / spec:check green — 1793 tests
