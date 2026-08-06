## Why

There is no way to get Iris installed. `package:mac` and `dist:mac` produce artifacts
under `release/`, and `start` / `start:prod` run the app from `dist/` — but nothing
puts Iris in `/Applications` where a macOS user expects to find and launch it.

This matters now specifically because of how this repo is meant to be used: `main` is
the branch people clone to try Iris. Today the shortest honest instruction after
`npm ci` is "build it, then find the `.app` in `release/` and drag it somewhere",
which is a poor first five minutes and a step where a new user can silently end up
running a stale copy.

Upstream added exactly this (`ASHR12/iris@120876e`) as a 51-line script, and later had
to fix it (`7eba14b`) because the packaging staging directory left duplicate Iris
entries visible in Finder. Both the feature and its follow-up fix are worth taking
together rather than rediscovering the second one.

## A packaging bug this change has to fix first

`package:mac:host` does not do what its name and CLAUDE.md's command table say. It runs
`electron-builder --mac` with no arch flags, and `package.json`'s `mac.target` declares
`arch: ["x64","arm64"]` — when the CLI supplies no arch, the config's array wins and the
host arch is never consulted. Both `package:mac` and `package:mac:host` build **both**
architectures. The only real difference is that `:host` skips `prepare:mac-binaries`.

That makes it worse than merely mislabelled: on a clean checkout `npm ci` installs only
the host-matching Claude binary, so `:host` packs an arm64 bundle with no arm64 binary
and `scripts/prune-foreign-arch.mjs` correctly refuses. **`package:mac:host` currently
fails**, and only appears to work on a machine where an earlier `package:mac` left both
binaries behind.

Two neighbouring entries in CLAUDE.md's command table are wrong for the same reason:
`dist:mac` is character-for-character identical to `package:mac`, and with `mac.target`
set to `dir` neither produces a dmg or zip — so "full macOS distributable" is not what
it does.

An installer cannot be built on top of this, so fixing it is in scope.

## What Changes

- `package:mac:host` genuinely builds the host architecture only, and CLAUDE.md's
  command table is corrected to match what the three packaging scripts actually do.
- One command builds, packages, and installs Iris into `/Applications`, then launches
  it.
- The install picks the bundle matching the **running machine's** architecture.
  electron-builder emits `release/mac/Iris.app` (x64) and `release/mac-arm64/Iris.app`
  (arm64), and a first-match-wins scan silently installs an arm64 build on an Intel
  Mac, where it cannot run.
- Installing over a running Iris works: the running instance is quit first rather than
  the copy failing or producing a half-replaced bundle.
- The installed app launches from Finder. Note what this actually depends on: a
  locally built bundle carries no `com.apple.quarantine` attribute in the first place —
  that is written by the agent that *downloads* a file — so clearing it is a defensive
  no-op, not the thing that makes launch work. What makes it work is that Gatekeeper's
  assessment is quarantine-triggered. The app is genuinely unsigned (no `identity`,
  `hardenedRuntime`, or `notarize` in the build config; electron-builder skips signing
  entirely with no ad-hoc fallback), so this holds for a locally built copy and says
  nothing about a copy someone downloads.
- README's current advice to "right-click and choose Open" is corrected — that
  workaround was removed in macOS Sequoia, where the path is System Settings →
  Privacy & Security → Open Anyway.
- Packaging leftovers do not remain on disk as extra Iris entries in Finder or
  Spotlight.
- README documents it as the install path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — `skip_specs: true`.

This is build tooling: it changes how the app gets onto a machine, not what the app
does once running. No capability owns installation. `platform-support` is the app's
own launch-admission policy (refusing to start off macOS) and `pipeline-setup-install`
covers the Claude pipeline's bundled skills — neither describes distribution, and
stretching either to cover a build script would misplace it.

## Impact

- **Code**: a new `scripts/install-mac.mjs` and an `npm run install:mac` entry, next
  to the existing `package:mac` / `package:mac:host` / `dist:mac` scripts.
- **Docs**: README gains the install command.
- **Dependencies**: none — `ditto` and `xattr` are macOS built-ins.
- **Risk — this script deletes and replaces a directory in `/Applications`.** That is
  the most destructive thing in this repo's tooling. It must target only Iris's own
  bundle, verify what it is replacing before removing it, and refuse rather than guess
  if the target is not what it expects.
- **The installed app will have no credentials.** A packaged build reads `~/.iris/.env`;
  only a dev run reads the repo's `.env`. So a user who runs this in a repo with a
  working `.env` gets an installed Iris that immediately reports a missing
  `GEMINI_API_KEY` — which is exactly the bad first five minutes this change exists to
  fix. The script or the README has to say so.
- **Apple Silicon is unverified.** arm64 requires a valid Mach-O signature to execute,
  and this bundle has none. The x64 path is fine. Do not claim the arm64 path works
  until someone has launched it on an Apple Silicon machine.
- **Not in scope**: code signing, notarization, and auto-update. The app stays
  unsigned; this change makes an unsigned app installable on the machine that built it,
  it does not make it distributable to third parties.
