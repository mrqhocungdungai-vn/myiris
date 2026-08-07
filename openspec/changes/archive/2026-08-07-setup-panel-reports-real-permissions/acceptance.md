# Manual acceptance results

Task 8.6. Recorded so the next person knows **which claims were verified
where** — a green run is evidence about the version it ran on and nothing
else. This change's design says so explicitly, and the surface it touches is
one Apple has been actively reorganising.

## What was run, and where

| Section | Verified on | Result |
| --- | --- | --- |
| 7.1–7.7 — permission rows, settings route, self-test, escape hatch, packaged build | **macOS 26** | Pass |
| 8.1–8.4 — deep links, system-audio anchor, loopback, relaunch behavior | **macOS 26** | Pass |
| 8.5 — machine upgraded from an earlier macOS | — | **Waived by decision** |

Exact point release was not captured at the time.

## What this does NOT establish

- **macOS 15 has no acceptance run.** Every measurement behind this change's
  design was taken on 15.7.8 — the state mapping, the `getMediaAccessStatus`
  vs `permissions.query` divergence, the loopback peak of 0.715 — but the
  acceptance tasks in section 7 were run on 26 instead. The design asked for
  both. Coverage landed on the riskier of the two, which is the better half to
  have, and it is still half.

- **No upgraded machine was tested (8.5).** The task was closed as unnecessary
  rather than run. The recording pane was renamed and consolidated on 26, and
  upgrading can require re-granting, so a user who upgraded into 26 may meet a
  permission state nothing here exercised. If that turns up as a bug report,
  this is the gap it came through — it is a waiver, not a pass.

- **The bundle is unsigned**, so its permission identity is unstable — grants
  attach to an identity the OS cannot verify, and a rebuild can drop them. That
  bounds how far "the grant sticks" can be relied on from any run above,
  including the packaged one in 7.7.

## Shipping floor

`build.mac.minimumSystemVersion` is **15.0** — not the 14.2 that system-audio
capture actually requires, and not the 12.0 the bundle used to declare. A
deliberate decision: nothing below 15 has ever been through acceptance, so
shipping there would be claiming coverage that does not exist.

The consequence worth knowing: `MIN_SYSTEM_AUDIO_MACOS` (14.2) is the version
below which the capture is *absent rather than broken*, and the self-test's
`os-too-old` verdict exists to say so. With the bundle floor at 15.0 that
verdict is unreachable in a packaged build. It stays reachable under
`npm run dev`, and it stays correct — the two floors answer different
questions, and lowering the shipping floor later must not require rediscovering
the capability one.
