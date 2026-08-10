## 1. Re-verify each item against the code before touching the spec

Each task is a re-read at a named location, not a fresh audit — if any one of them
no longer holds, stop and fix the delta rather than the code (design.md, Goals).

- [x] 1.1 `setup-panel`: confirm `src/components/SetupPanel.tsx` still renders only `BundledRow` (Bundled/Damaged) with no install action and no copyable command, and that the chat-only line points at reinstalling — `SetupPanel.tsx:343`, `825-854`
- [x] 1.2 `setup-panel`: confirm availability is the two-condition gate, so a flip is credential-driven — `electron/pipeline-probes.mjs:186`
- [x] 1.3 `config-persistence`: confirm `claudeBinary()` resolves only the bundled binary, validates it with `assertExecutable`, and that no override or `PATH` probe exists — `electron/pipeline-probes.mjs:86-98`, `electron/bundled-binaries.mjs`
- [x] 1.4 `renderer-structure`: confirm no `useHoldToScroll` exists anywhere (`grep -rn useHoldToScroll src/` is empty) and that hold-to-scroll is inline — `src/App.tsx:1578`, `src/components/ReaderCore.tsx`
- [x] 1.5 `holo-deck-backdrop`: confirm the gradient layers are `hud-nebula` and `hud-glow` only, with no `hud-vignette` — `src/styles/base.css:54,68`, `src/App.tsx:2004-2005`
- [x] 1.6 `workflow-quality-gates`: confirm `runLint()` runs `checkDeadClaudeCss` and fails the gate on its findings — `scripts/gates.mjs:225-230`, `scripts/dead-claude-css.mjs:103-104`

## 2. Sync the deltas into the living spec

- [x] 2.1 Sync `setup-panel` — the MODIFIED requirement replaces "Panel surfaces pipeline availability state" (`openspec/specs/setup-panel/spec.md:164-176`) in full, including both of its existing scenarios
- [x] 2.2 Sync `config-persistence` — the ADDED requirement lands and "A config-sourced executable path is validated before it is spawned" (`openspec/specs/config-persistence/spec.md:77-93`) is removed with its three scenarios
- [x] 2.3 Sync `renderer-structure` — the MODIFIED requirement replaces "Modular renderer layout mirrors upstream" (`openspec/specs/renderer-structure/spec.md:7-25`); only the hooks scenario's content changes
- [x] 2.4 Sync `holo-deck-backdrop` — the MODIFIED requirement replaces "WebGL particle/node network backdrop" (`openspec/specs/holo-deck-backdrop/spec.md:7-41`), with "Deep Space files stay untouched" replaced by "The backdrop owns its own files"
- [x] 2.5 Sync `workflow-quality-gates` — the MODIFIED requirement replaces "A lint gate exists and is invocable on its own" (`openspec/specs/workflow-quality-gates/spec.md:8-27`), adding two scenarios for the sweep

## 3. Verify the change landed as a spec-only change

- [x] 3.1 `git diff --stat` shows changes under `openspec/` only — no `src/`, `electron/`, `scripts/`, `docs/`, or `package.json`
- [x] 3.2 `npm run spec:check` passes, and `npx openspec validate --specs --strict` reports every capability passing
- [x] 3.3 `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets` are unchanged from before the change (no code moved, so any difference is a signal, not noise)
- [x] 3.4 Re-read the five synced requirements once more against the tasks in group 1 — the living spec is the artifact this change exists to make true

## 4. Close the loop on what this change deliberately does not do

- [x] 4.1 Confirm nothing in the diff touches `scripts/dead-claude-css.mjs` — its expired header comment is left for the next change that edits that file (design.md D5)
- [x] 4.2 Confirm no new gate was added (design.md D4); the two automatable checks it names belong to a later change
