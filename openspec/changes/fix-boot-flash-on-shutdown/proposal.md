## Why

The boot intro plays whenever it should not. `src/App.tsx:828` derives it from two
independent signals —

```ts
const booting = sidecarRunning && geminiStatus !== "connected";
```

— so *any* transition of `geminiStatus` away from `"connected"` while the session is
still running re-arms the full boot animation. The renderer has no notion of "Iris
started"; it only asks "is something running that isn't connected yet", and that
question answers `true` in states that are not a start at all.

Two manifestations, both reachable today:

1. **Every reconnect replays the boot intro.** `scheduleReconnect()`
   (`electron/live-session.mjs:287`) emits `gemini_status: "connecting"` and
   deliberately does *not* emit `sidecar_status` — the session is still running, it is
   only re-dialing. So `booting` flips true and stays true for the whole backoff
   (up to 8 s per attempt, up to `MAX_RECONNECT_ATTEMPTS`). A dropped Wi-Fi frame
   makes Iris look like she is cold-booting.
2. **The intro flashes during shutdown.** `stopLive()`
   (`electron/live-session.mjs:317-321`) emits `gemini_status: "offline"` *before*
   `sidecar_status: { running: false }`. Between those two IPC messages the renderer
   holds `sidecarRunning === true` with a non-connected status, so `BootSequence`
   mounts as the app is tearing down. The renderer's own `stop()` (`src/App.tsx:1214`)
   sets `setGeminiStatus("offline")` ahead of the same event and widens the gap.

The falling edge at `src/App.tsx:833` then fires `iris:boot-done`, which
`electron/ipc.mjs:174` routes to `greetGateFire()`. In the common case this is a
no-op — `GreetGate.done` is already `true` from the real wake — but a stop issued
while the intro is still playing leaves the gate armed, and shutdown fires the
greeting.

Upstream hit and fixed the same defect (`ASHR12/iris@9c99356`); their diagnosis was
the same one this proposal reaches: trigger on the power-on **edge**, not on a derived
predicate.

## What Changes

- The boot intro is triggered by the **rising edge of the session running**, not by
  the derived `booting` predicate. A reconnect, a status blip, and a shutdown all
  leave `sidecarRunning` unchanged, so none of them re-arm it.
- An **instant resume does not replay the intro**: if the session comes up already
  `connected`, the intro is skipped rather than shown for one frame.
- The `iris:boot-done` handshake keeps firing exactly once per real start, on the
  completion of an intro that actually played — never on a shutdown or reconnect edge.
- No change to what the intro looks like, how long it holds, or to `GreetGate`'s
  contract on the main-process side.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wake-sleep-voice`: the **Boot-done handshake** requirement currently specifies
  only that the renderer reports boot completion and that the greeting waits for it.
  It says nothing about *when the intro is allowed to play*, which is why the
  regression was possible without contradicting the spec. Adds a requirement pinning
  the intro to a genuine start, and pinning the handshake to an intro that played.

## Impact

- **Code**: `src/App.tsx` — the `booting` derivation (line 828), the boot-done edge
  effect (lines 829-835), and their consumer at line 1856. Main-process code is
  untouched; the event ordering in `live-session.mjs` is correct as-is and this
  change stops depending on it.
- **Tests**: a renderer-level test that drives the status transitions (start,
  reconnect, stop) and asserts intro visibility plus `iris:boot-done` call count.
  `src/hooks/useAudioPipeline.test.ts` establishes the renderer-test pattern.
- **Dependencies**: none.
- **Risk**: low. The change narrows when an existing component mounts; nothing new
  is introduced and no IPC contract changes.
