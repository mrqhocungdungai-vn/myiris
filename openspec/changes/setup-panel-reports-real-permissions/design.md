## Context

See proposal.md — Why. Three constraints shape the approach:

- `main-process-structure` confines `systemPreferences` and `shell` to
  `main.mjs`, `ipc.mjs`, `window.mjs`, `renderer-security.mjs`. Every other
  module under `electron/` must stay Electron-free and importable in a plain
  vitest file, so any *decision* worth testing has to live outside those four.
- `renderer-security.mjs` already owns device-permission scoping and the
  display-media handler. It is deliberately below the file-size floor because a
  security boundary should be readable in one sitting.
- macOS exposes no change notification for TCC. A permission the user grants in
  System Settings becomes visible to the app only when the app next asks.

## Goals / Non-Goals

**Goals:**

- One source of permission truth, in main, that both the panel rows and the
  device-selector gates read.
- The security-relevant part of the self-test — its bound, and who may extend
  it — testable without booting Electron.
- The self-test reusing the mode's own silence determination, so the panel and
  the mode cannot disagree.

**Non-Goals:**

- Any change to how the app grants permission to its own document. The
  unconditional internal grant stays; this change stops *reporting* it as the
  user's answer.
- Cross-platform permission reporting. Iris is macOS-only; other platforms
  return states this design does not interpret.
- Making the self-test diagnose *why* a capture is silent. It reports the
  verdict; the cause is out of reach from inside the process.

## Decisions

### D1 — Permission *reporting* is a pure module; `renderer-security.mjs` keeps only *containment*

A new Electron-free `electron/os-permissions.mjs` holds the decisions: the state
mapping (including `restricted`, which the platform reports and which must not
collapse into not-yet-asked), and the construction of the settings location for
each permission — both the link target and the written path. `ipc.mjs` makes the
thin Electron calls (`getMediaAccessStatus`, `askForMediaAccess`,
`shell.openExternal`) and marshals through that module.

An earlier draft of this design put the reporting in `renderer-security.mjs` on
the grounds that both are "device-permission questions". They are not the same
question. `renderer-security.mjs` answers *may this document capture* — a
containment decision about the renderer, with a security consequence if it is
wrong. `getMediaAccessStatus` answers *what has the OS granted this app* — a
reporting question for the setup UI, with no containment content at all. The
settings link is a third thing again: a UI affordance. Loading all three onto
the module that the `main-process-structure` spec deliberately keeps small, and
that this design elsewhere argues should stay readable in one sitting, would
contradict the reason it is small.

It also puts the testable part in the right place. The mapping and the
location-construction are exactly what is worth asserting, and neither needs
Electron. `ipc.mjs` stays within its charter — registration and marshalling,
with behavior delegated to the domain modules it imports.

`renderer-security.mjs` gains only the self-test composition and the arming
consultation in the display-media handler. That genuinely is renderer content
security.

*Alternative — everything in `renderer-security.mjs`:* one fewer file, but it
mixes reporting into a containment boundary and makes the mapping untestable
without Electron.

### D2 — Freshness comes from window focus, not polling

The rows refresh when the panel opens, after an in-app prompt resolves, and
when the app's window regains focus. Granting a permission requires leaving for
System Settings and coming back, so focus is the moment the answer can have
changed — it is the event, even though macOS offers none.

*Alternative — poll while the panel is open:* catches the case where the state
changes with the app still focused, which on macOS essentially cannot happen,
and adds a recurring main-process wake that `main-thread-budget` exists to
discourage. Rejected for that asymmetry.

Accepted gap: a permission revoked while the app sits focused and untouched
shows stale until the next focus. It is reported, not hidden.

### D3 — `askForMediaAccess` for the prompt, not `getUserMedia`

The in-app prompt uses `systemPreferences.askForMediaAccess()`, which asks the
OS and resolves to the answer. `getUserMedia` conflates asking with opening a
stream the panel then has to remember to stop, and its resolution says nothing
about the OS's state — which is the defect this change exists to fix.

It is offered only in the not-determined state. Calling it on a refused
permission resolves false without prompting, which is exactly the dead end the
"Retry" button already is.

### D4 — The System Settings route is a deep link plus written text, with no error fallback

`shell.openExternal` with the Privacy pane anchor for the specific permission,
**and** the pane path rendered as text beside it, always.

An earlier draft specified a fallback to the Privacy & Security root "if opening
the specific anchor fails". That branch can never run. `shell.openExternal`
rejects only when nothing handles the *scheme*, and the settings scheme is
always handled — an unknown or renamed *anchor* still launches System Settings
and resolves successfully. The failure being guarded against (settings opens on
the wrong page) is invisible to the caller, so the fallback would be dead code
guarding nothing.

The written path is the fallback that actually fires, and it is needed: anchors
for these panes are known to have stopped working across OS releases. The link
is a convenience over an instruction, never the instruction itself.

Use the modern pane identifier and keep the legacy one in a comment — the legacy
identifier survives only as an alias, and aliases are what get dropped.

The row's state is never inferred from having opened settings; it continues to
report what the OS reports, per the spec.

### D5 — The self-test window is a pure state machine, composed into `renderer-security.mjs`

A new Electron-free module (`electron/system-audio-self-test.mjs`) holds
start/stop/isRunning over an injected clock and timer.
`renderer-security.mjs` composes it and consults `isRunning()` in the
display-media handler alongside `isListenOnlyEngaged()`.

This is the whole reason to split it out: the security-relevant properties —
that the window ends on its own bound, that a repeat start does not extend it,
that a vanished renderer ends it — are then plain assertions in a vitest file,
rather than behavior only observable by driving a real Electron session. The
`bypassPermissions`-adjacent lesson in this repo is that a guard nobody can
test is a guard nobody knows the state of.

**The arming is one-shot, not a window.** `arm()` authorises exactly one grant;
the display-media handler *consumes* it. A second request before re-arming is
denied. An interval-shaped predicate would grant every request made inside it,
so a faulty or hijacked renderer could hold several concurrent loopback captures
while each individual grant still looked correct — the shape would be right and
the quantity wrong.

The arming also expires on an absolute deadline from the first `arm()`, so an
authorisation that is never used does not sit open. Re-arming while an arming is
live does not push that deadline out.

**The deadline: 6 seconds.** It is derived, not picked. The verdict comes from
`watchCaptureLiveness`, which needs `LIVENESS_PROBE_INTERVAL_MS` ×
`LIVENESS_PROBE_TICKS` = 750ms × 6 = 4.5s of probing before it will say
"silent". The deadline has to cover acquisition plus that window with margin; it
must not be so long that a stale authorisation lingers. If those constants
change, this changes with them — it is stated here so the coupling is visible
rather than rediscovered.

**What the bound does and does not do.** It bounds the interval in which a grant
can be *obtained*. It cannot end a stream already handed out: nothing in main
can revoke a live `MediaStream`, and the teardown paths that do work — reload,
close, render-process-gone — work because the browser engine tears the frame's
streams down, not because of anything here. The spec states this limit rather
than claiming an enforcement that does not exist.

The grant is also tied to the frame that armed it. Today the app has one window,
so the practical exposure is nil — but the value of a narrow boundary is that it
stays narrow when someone later adds a second window.

*Alternative — keep the flag inline in `renderer-security.mjs`:* fewer files,
but the bound becomes untestable without Electron, and the module is a security
boundary where that matters most.

### D6 — The self-test reuses `isCaptureSilent` and `watchCaptureLiveness`

The renderer runs the capture and the analysis, because that is where the
`AudioContext` is. It acquires an audio-only stream, taps an analyser, and
hands it to the existing `watchCaptureLiveness`, whose verdict rests on the
existing `isCaptureSilent`.

It does **not** reuse `acquireLoopbackBranch`, which is about summing the
capture into the live worklet and takes a destination the test has no business
providing. The shared thing is the *determination*, which is what the spec
requires; the plumbing around it is different work.

**`watchCaptureLiveness` gains an `onLive` callback.** As written it reports
only `onSilent`; on real signal it clears its own timer and returns nothing, so
there is no way to observe "heard". An earlier draft of this design mapped "the
watch cancels itself on real signal → heard", which is not an event the function
emits — that mapping was unimplementable, and the claim elsewhere that
`src/lib/system-audio.ts` is "reused as-is" was wrong.

Adding `onLive` is the honest fix. The alternative — inferring "heard" from
"`onSilent` did not fire within N ms" — invents a second timing definition,
which is exactly what reusing the shared determination was meant to avoid, and
it races the 4.5s window. `useAudioPipeline` passes no `onLive` and is
unaffected, but this edits the mode's live path, so it lands as its own task
with the mode's own tests re-run.

Four outcomes then map cleanly: acquisition rejects → not obtainable; `onSilent`
→ obtained but silent; `onLive` → heard; and an OS below the version that
provides this capture at all → its own verdict, decided before the capture is
attempted.

### D8 — The OS version floor is checked, not assumed

System-audio capture needs macOS 14.2 or newer, while the app's bundle declares
a minimum of 12.0 and the code gates on nothing but `platform === "darwin"`. On
12 or 13 the capture is not broken, it is absent — and without a check the
self-test reports bit-exact silence forever with no explanation, sending the
user after a permission that cannot help.

The self-test resolves the version first and reports it as its own verdict. The
packaged bundle's declared minimum should be raised to match what Iris actually
needs, which is a packaging change rather than a runtime one.

### D7 — The Permissions step splits out of `SetupPanel.tsx`

`SetupPanel.tsx` is 1175 lines against a 250–450 convention, and this change
adds three permission concerns to it. The Permissions step moves to its own
component with the panel passing in the device-selector props it already
computes.

This is scoped to the Permissions step only. Splitting the rest of the panel is
worth doing and is not this change's job.

## Risks / Trade-offs

- **The deep-link anchor stops working on a future macOS** → this is observed,
  not hypothetical: anchors for several panes are known to have broken on the
  current major release. Mitigated by always rendering the written pane path
  (D4), never by an error branch that cannot fire.
- **The evidence base is one OS version.** Every measurement behind this design
  was taken on macOS 15.7.8, with an unsigned development binary that already
  held the system-audio grant. It establishes what the mechanism is; it does not
  establish behavior on the current major release, where this exact surface has
  been reorganised — the recording pane was renamed and consolidated, upgrading
  can require re-granting, and point releases have changed which processes
  appear in it at all. → The acceptance tasks run on both, and no requirement
  here asserts a per-version outcome. Treat a green run on one version as
  evidence about that version only.
- **Granting may not take effect until relaunch** → the platform documents this
  for these permissions, and it would recreate the panel's original lie in a new
  place: a row reading granted while Iris still cannot capture. Mitigated by
  saying so at the point the user returns (spec), and by verifying *capture*
  rather than the row in the acceptance tasks.
- **The bundle is unsigned, so its permission identity is unstable** → both the
  development binary and the installed app report `code object is not signed at
  all`. Grants attach to an identity the OS cannot verify, so a rebuild can drop
  them and the user is asked again; in development the prompt is attributed to
  the framework's own bundle rather than to Iris, making development and
  packaged grants separate subjects. Out of scope to fix here — it is a signing
  and distribution decision, not a panel one — but it bounds how much the phrase
  "the grant sticks" can be relied on anywhere in this design, and it is why the
  packaged-build acceptance task is not optional.
- **The self-test is a second door to system audio** → it is audio-only,
  main-process-owned, absolutely bounded, unextendable by the renderer, and
  closed when the requesting window goes away. The properties that justified
  the original mode gating are the ones kept; see the
  `renderer-content-security` delta.
- **A user tests against a silent machine and reads "nothing heard" as broken**
  → the verdict states that silence is expected when nothing is playing. This
  is a real limitation: the test cannot distinguish a blocked capture from a
  quiet one, because the failure it exists to catch is bit-exact silence.
- **Rows become stricter and some users will newly see "not granted"** → that
  is the fix, not a regression: those users were already in the state where
  Iris could not hear them, and were being told otherwise. The device pickers
  hiding in that state follows from the same correction.
- **`getMediaAccessStatus` returns states this design does not map on non-macOS**
  → Iris refuses to launch off macOS already; the mapping treats anything
  unrecognised as not-determined, which offers the prompt rather than a dead
  end.

## Migration Plan

None required — no persisted state changes shape or meaning. The permission
rows read a different source on first render after the update; nothing stored
needs rewriting, and rollback is a straight revert.
