## 1. Remove the dead rule block

- [x] 1.1 Delete the `.agent-install` rules from `src/styles/claude.css`
  (base, `:hover`, `:disabled`). The button they styled went when Claude Code and
  OpenSpec moved inside the app bundle.
- [x] 1.2 ~~Delete the `.hermes` rule.~~ Dropped: `.hermes` is not in `claude.css` —
  it's `.status-dot.hermes.on/.warn` in `deck.css`, an upstream sheet this
  change's Non-Goals put out of scope (see design.md's Context/Risks). Found
  during apply; scope narrowed to `.agent-install`.
- [x] 1.3 ~~Delete the `.wake-prompt` rule.~~ Dropped for the same reason: it's in
  `deck.css`, not `claude.css`.
- [x] 1.4 Confirm the deletion removes the whole block including its comment, not
  just the selector line, so no orphaned declarations remain. (`.agent-install`
  had no preceding comment header of its own — nothing orphaned.)

## 2. Add the check

- [x] 2.1 Add a check that extracts class selectors from `src/styles/claude.css`
  and reports any with no occurrence in `src/**/*.{ts,tsx}` outside `src/styles/`.
  (`scripts/dead-claude-css.mjs`, `findDeadClaudeCssClasses`.)
- [x] 2.2 Make it fail with the candidate class names printed, not warn — a
  warning on a fault with no runtime symptom is the reason `.hermes` survived.
- [x] 2.3 Do **not** auto-delete. Report only; a human confirms. A class built as a
  template literal looks dead to a static scan, and removing a live style produces
  a broken UI no test catches.
- [x] 2.4 Provide an explicit allowance mechanism for genuinely dynamic classes,
  requiring a comment stating why each is kept. (`DYNAMIC_ALLOWLIST`, empty today —
  every dynamic className in the renderer was enumerated and none builds a
  claude.css class; see design D2.)
- [x] 2.5 Wire it into the existing lint step (`scripts/lint.mjs` → `runLint()` in
  `scripts/gates.mjs`), not as a new top-level gate — the spec-drift gate is a
  separate change and both would otherwise modify `workflow-quality-gates`.
- [x] 2.6 Scope it to `claude.css` only. The adopted upstream sheets must stay
  byte-comparable to upstream, per `deepspace-skin`.

## 3. Verify

- [x] 3.1 `npm run lint` — passes, exit 0, with the new check running.
- [x] 3.2 Re-add one deleted rule locally and confirm lint goes red naming it;
  remove it again.
- [x] 3.3 `npm test`, `npm run build`, `npm run scan:secrets`.
- [ ] 3.4 Manual: launch the app, open the SetupPanel, enter and leave HUD mode, and
  confirm nothing is visually unstyled — the deletions should be invisible, since
  by definition these rules matched no element. **Attempted, not completed**: the
  app launches cleanly under `npm run start:prod` (no errors in its log), but
  driving its UI here needs either macOS Accessibility permission for
  AppleScript/System Events (not granted to this session — `osascript` returned
  "not allowed assistive access") or a Playwright `_electron` driver (no
  `playwright-core` in this repo, and installing one is a bigger step than this
  single check warrants). Left for the user to do directly — 30 seconds with the
  app in front of them.

## 4. Close out

- [x] 4.1 Re-read `openspec/specs/deepspace-skin/spec.md` against the landed code;
  the delta must be true before archiving. It is: no requirement in the living
  spec names `.agent-install`, and the new ADDED requirement (no styling for
  controls that don't exist, machine-checked) matches what's now wired into
  `scripts/gates.mjs`.
- [x] 4.2 Record the count in the change: **49 classes examined, 1 removed**
  (not the originally-estimated "52 classes, 3 removed" — see design.md's
  Context for the scope correction found during apply: `.hermes`/`.wake-prompt`
  turned out to live in `deck.css`, not `claude.css`). Verified via
  `findDeadClaudeCssClasses` reporting zero dead classes post-deletion.
