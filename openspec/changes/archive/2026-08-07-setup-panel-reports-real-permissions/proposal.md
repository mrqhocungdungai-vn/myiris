## Why

The SetupPanel's Permissions step reports permissions Iris does not actually
depend on, and stays silent about the one the meeting feature is built on.

It reads `navigator.permissions.query`, which reflects Chromium's own permission
store — and `renderer-security.mjs` grants `media`/`audioCapture`/`videoCapture`
unconditionally to the app's own document. So the panel reads back its own
decision and calls it the user's. Measured on macOS 15.7.8 / Electron 42:
`getMediaAccessStatus("camera")` is `not-determined` while
`permissions.query("camera")` is `granted`. The panel shows a green "✓ Granted"
for a permission macOS has never been asked for, and the device pickers unlock
behind that same false signal.

The failure is worse than cosmetic. When macOS denies at the OS level the panel
offers a "Retry" button that re-calls `getUserMedia` — and TCC never re-prompts
once denied, so the only affordance the panel has is one that cannot work, with
no route to System Settings. A user whose microphone is blocked sees "Retry",
clicks it forever, and is never told where the actual switch is.

Meanwhile listen-only mode — Iris's meeting mode, whose entire substance is
hearing the machine — has no entry in the Permissions step at all. Nothing tells
the user that engaging it captures system audio, and nothing lets them find out
whether it works until they are already in a meeting. That is the state this
feature was found in during its own testing.

## What Changes

- The Permissions step reports **macOS's** answer for Microphone and Camera,
  read from `systemPreferences.getMediaAccessStatus()` in the main process,
  rather than the renderer's view of Chromium's store. A row reads "Granted"
  only when the OS has actually granted it.
- A row whose OS status is `denied` offers a route to the relevant System
  Settings pane instead of a "Retry" that cannot succeed. `not-determined`
  keeps the in-app prompt, which is the one state where asking still works.
- The device pickers gate on that same OS-truthful state, so a picker never
  populates from a permission the OS has not given.
- The Permissions step gains a **System audio** entry for listen-only mode,
  stating that engaging the mode captures what the machine plays.
- That entry is a **self-test, not a grant** — because the governing permission
  cannot be *read*, not because none exists. Measured: a
  `{video:false, audio:true}` `getDisplayMedia` under the
  `MacCatapLoopbackAudioForScreenShare` flag delivers real audio (peak 0.715,
  16/16 non-zero probes) while `getMediaAccessStatus("screen")` reads `denied`.
  The OS does have a system-audio recording permission, distinct from screen
  recording; the platform interface available here reports microphone, camera
  and screen only, so the state the app can see is not the state that governs
  the outcome. A row built on it would report the wrong permission confidently.
  The honest affordance is to briefly open the capture on demand and report
  whether Iris hears anything — and, because that permission exists even though
  it cannot be read, to offer the settings route on a failing verdict rather
  than leaving a user who once refused it with a verdict that never changes.
- The self-test reports a **fourth** outcome: an operating system too old to
  provide this capture at all. It needs macOS 14.2+, while the bundle declares a
  minimum of 12.0 and the code gates on nothing but `darwin`. Without this,
  every user below 14.2 gets a permanent unexplained "silent".
- **BREAKING (behavior, not API):** `renderer-content-security`'s "System audio
  is unreachable outside the mode" narrows. It becomes reachable in exactly one
  further case — a user-initiated self-test the main process itself is running —
  and stays denied for every other request outside the mode. The properties that
  made the rule worth having are kept and restated: audio only, never video;
  main-process-owned, so the renderer cannot assert its way in; bounded and
  self-terminating, so no capture outlives the test.

## Capabilities

### New Capabilities

None. This change corrects and extends behavior that two existing capabilities
already own.

### Modified Capabilities

- `setup-panel`: the Permissions step's source of truth becomes the OS rather
  than the renderer's permission store; a denied row routes to System Settings
  instead of offering an unusable retry; the device pickers gate on the
  OS-truthful state; a System audio entry with a functional self-test is added.
  Its existing "Claude-oriented setup and settings panel" requirement enumerates
  what the panel offers and describes both selector gates, so that requirement
  is modified too — otherwise the living spec keeps a complete-looking list with
  the System audio entry missing from it.
- `renderer-content-security`: the mode-gating requirement for system-audio
  capture narrows to admit a main-process-owned, user-initiated, audio-only,
  single-grant self-test, with every other out-of-mode request still denied —
  and with the `IRIS_SYSTEM_AUDIO` escape hatch kept as a precondition of
  *every* route, so disabling system audio still leaves no reachable capture
  surface at all.
- `microphone-device-selection`: its selector is gated on "the Microphone
  permission being granted", and this change redefines what granted means, so
  the picker will stay hidden in cases where it previously appeared. The
  requirement's text reads the same before and after while meaning something
  different, which is exactly the silent drift the living spec exists to catch —
  so it gets a delta naming the OS-level state as the gate.

## Impact

- **`src/components/SetupPanel.tsx`** — the permission state effect
  (`navigator.permissions.query`), `requestMic`/`requestCam`, `PermRow`, the
  `permissionsSection`, and the two device-picker gates. The file is already
  1175 lines against a 250–450 line convention, so the Permissions step is a
  candidate to split into its own component as part of this work.
- **`electron/renderer-security.mjs`** — reads `systemPreferences`, gains the
  self-test state that `setDisplayMediaRequestHandler` consults alongside
  `isListenOnlyEngaged()`. It already owns device-permission scoping, and
  `main-process-structure` confines `systemPreferences`/`shell` to it and the
  three other Electron-touching modules, so no new module may reach for them.
- **`electron/ipc.mjs`, `electron/preload.cjs`** — a query for OS permission
  status, an action to open the relevant System Settings pane, and the
  start/stop of the self-test window.
- **`src/lib/system-audio.ts`** — the self-test's verdict comes from the
  existing `isCaptureSilent` / `watchCaptureLiveness`, because a second silence
  check would be a second definition of "Iris is not hearing anything". That
  function gains one callback: it currently reports only `onSilent` and emits
  nothing on real signal, so "heard" is not observable without `onLive`. This
  edits the mode's own live path and lands as its own task.
- **`package.json` `build.mac`** — usage-description strings. The bundle
  currently inherits the framework's placeholders ("This app needs access to
  audio capture"), and this change deliberately *raises* those prompts rather
  than letting them happen as a side effect, so they should say what Iris is
  actually doing. The declared minimum OS version should also match what
  system-audio capture requires.
- **Not in scope:** the separate defect where Iris hears no system audio under
  `npm run dev`. Raw capture is measured working there, so that fault lies in
  Iris's own listen-only gating flow, not in macOS, Chromium, or the origin
  check. It is tracked separately and deliberately not folded in here.
