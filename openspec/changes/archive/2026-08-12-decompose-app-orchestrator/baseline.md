# Baseline — `src/App.tsx` before `decompose-app-orchestrator`

Recorded so "zero behavior change" and the size reduction are both checkable
against numbers rather than impressions.

## Size

```
code lines     1391
comment lines   422
blank lines     139
raw lines      1952
```

Measured with `scripts/check-file-size.mjs`'s `countCodeLines` (comments and
blanks excluded) — the same function the lint gate ratchets against.

## Shape

```
state bindings   55   (48 useState, 7 persisted-preference hooks)
useEffect        30
useRef           15
useMemo          11
useCallback       0
window.iris.*    45 call sites
```

`React.memo` + `useCallback` across the whole of `src/`: **8**.

## The 55 state bindings, by domain

Every binding belongs to exactly one domain; none is shared between two. This
is the finding the proposal rests on, so it is recorded here in full.

| Domain | n | Bindings |
|---|---|---|
| tasks & review | 10 | `tasks`, `expandedTaskId`, `focusedTaskId`, `stepsOpenIds`, `taskChooser`, `showHistory`, `pendingReview`, `reviewMode`, `modelPopoverVerb`, `agentsTick` |
| preferences | 8 | `soundsEnabled`, `handControl`, `webglHighFidelity`, `cameraDeviceId`, `micDeviceId`, `ambientCaptureEnabled`, `ambientCaptureLive`, `ambientCaptureForcedOff` |
| session & status | 7 | `sidecarRunning`, `sidecarPid`, `geminiStatus`, `claudeStatus`, `audioState`, `windowFocused`, `booting` |
| sessions, verbs & config | 6 | `sessions`, `activeSessionId`, `verbs`, `fullConfig`, `setup`, `pipelineAvailable` |
| listen-only mode | 5 | `listenOnlyEngaged`, `listenWindowDeadline`, `listenOnlyNotice`, `heardLive`, `refusedTool` |
| UI mode & HUD | 5 | `uiMode`, `modeTransition`, `drawingActive`, `commsOpen`, `hudCameraEnlarged` |
| orb & effects | 5 | `orbThinking`, `wakeKey`, `rippleKey`, `dwellActive`, `dwellFired` |
| second brain | 3 | `secondBrainActive`, `secondBrainAvailable`, `openNote` |
| claude question | 2 | `pendingClaudeQuestion`, `claudeAnswers` |
| transcript & log | 2 | `transcript`, `logs` |
| wake | 2 | `wakeWordEnabled`, `wakeFailed` |

## The render surface

The deck branch of the return statement references **67 distinct values**.
That number is the acceptance criterion for the proposal's central claim: a
`DeckShell` component cannot be extracted until it falls.

For comparison, `HudShell` currently takes **65 props** and forwards **23**
verbatim to `CenterStage`.

## Gates at baseline

All five green:

```
build   = 0
test    = 0   (2095 tests, 121 files)
lint    = 0
spec    = 0
secrets = 0
```

## What "zero behavior change" will be checked against

- `electron/preload.cjs` is untouched, so `window.iris`'s surface is unchanged
  by construction.
- No capability spec under `openspec/specs/` may need a wording change. If one
  does, the extraction altered behavior.
- The manual smoke checklist in `renderer-structure`'s own spec (wake, submit a
  task, answer a question by click, change a verb's model, switch/create
  workstream, choose project folder, open reader and history, dwell-open a card,
  palm-scroll) must pass unchanged.
