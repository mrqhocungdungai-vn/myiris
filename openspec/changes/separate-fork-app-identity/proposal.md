## Why

This repository is a fork of [`ASHR12/iris`](https://github.com/ASHR12/iris), and it has inherited the upstream project's identity wholesale: the same bundle identifier, the same product name, the same install path, and the same home-directory state root. Installing the upstream app on a machine that already runs this fork — or the reverse — is not a coexistence problem, it is a **silent overwrite**. All four collision points exist on the maintainer's machine right now.

The most dangerous one is the bundle identifier. `decideInstallAction()` in `electron/mac-install-target.mjs` refuses to remove a bundle whose `CFBundleIdentifier` is *not* `app.iris.voice` — that guard is what stops the installer from deleting somebody else's application. Because the fork and upstream declare the *same* identifier, the guard reads upstream's `Iris.app` as "our own bundle, safe to replace", and `npm run install:mac` proceeds to `rm -rf` it without a warning. The identifier collision also merges the two apps as far as macOS is concerned: LaunchServices treats them as one application, and they share one set of TCC grants for microphone, camera, and screen recording.

Renaming `~/.iris` to `~/.myiris` — the change that prompted this proposal — separates the *data*, which matters, but it does not stop any of that. The data root is the one collision point that cannot destroy anything on its own. The three that can are the identifier, the product name, and the install path.

## What Changes

- **BREAKING** — **New bundle identifier**: `app.iris.voice` → `app.myiris.voice`, in both `package.json` (`build.appId`) and `electron/mac-install-target.mjs` (`BUNDLE_ID`). macOS keys TCC grants by bundle identifier, so **the microphone, camera, and screen-recording permissions reset** and the user must grant them again on first launch. This is the intended cost: a distinct identifier is precisely what makes the two apps distinct to the operating system.
- **BREAKING** — **New product name**: `Iris` → `MyIris`, in `package.json` (`productName`, `build.productName`), `electron/mac-install-target.mjs` (`PRODUCT_NAME`), and `app.setName()` in `electron/main.mjs`. This moves the install target to `/Applications/MyIris.app` and the Electron user-data directory to `~/Library/Application Support/MyIris`.
- **BREAKING** — **New state root**: `~/.iris/` → `~/.myiris/`, covering all seven runtime write sites — the packaged `.env`, `claude-home` (the pinned `CLAUDE_CONFIG_DIR`), `claude-sessions.json`, `canvas.json`, and the default `workspace`.
- **One-time automatic migration** of an existing `~/.iris` to `~/.myiris` at boot, so no user loses their session store, canvas, workspace, or Claude transcripts. The migration is **conditional on the directory provably belonging to this fork** — it must carry this fork's marker files and none of upstream's — so a fork installed alongside an existing upstream install never steals upstream's data.
- **Transcript-slug repair** as part of that migration. Claude Code names each project's transcript directory after a slug of the working directory, so moving the default workspace invalidates the slug and would orphan every transcript for runs against it. The migration renames the affected slug directory in step.
- **The installer's existing safety guard becomes genuinely protective.** Once `BUNDLE_ID` differs, `decideInstallAction()` refuses to touch upstream's `/Applications/Iris.app` — the branch that was unreachable-by-collision starts doing its job.
- **A stale `/Applications/Iris.app` is left in place, deliberately.** After the rename, the fork's previously-installed bundle is indistinguishable from an upstream install, so the installer must not remove it. Removal is documented as a manual step.
- Documentation updated across `README.md`, `CLAUDE.md`, `SECURITY.md`, `.env.example`, `docs/PIPELINE_GUIDE.md`, `docs/PIPELINE_GUIDE.vi.md`, `docs/PIPELINE_INTERNALS.md`, `scripts/install-mac.mjs`, and the spoken announcement in `electron/announcements.mjs`.

### Non-goals

- **The `IRIS_*` and `GEMINI_*` environment-variable prefixes are unchanged.** They are read from each app's own `.env` file, so once the state roots are separate the prefixes cannot collide. Renaming them would be a large, purely cosmetic edit with a real risk of breaking a user's existing configuration.
- **The npm package name (`iris-claude-voice`) is unchanged.** It is never published and never reaches disk as an identifier.
- **`window.iris`, the preload IPC bridge, is unchanged.** It is an in-process JavaScript binding with no cross-application visibility.
- No code signing, notarization, or dmg target is added — `mac.target` stays `dir`.

## Capabilities

### New Capabilities

- `app-identity`: The identifiers by which this application is distinguishable from every other application on the machine — its bundle identifier, its product name, its install path, and the root of its on-disk state — together with the requirement that they never collide with the upstream project this repository is forked from, and the one-time migration that carries an existing install's data across the rename.

### Modified Capabilities

- `setup-panel`: two requirements name the packaged configuration file by its literal path `~/.iris/.env`; both must name the new root.
- `agent-subscription-auth`: the requirement covering where `CLAUDE_CODE_OAUTH_TOKEN` is persisted names `~/.iris/.env` literally; it must name the new root.

`pipeline-setup-install`, `config-persistence`, and `global-agent-runtime` all describe this storage abstractly ("the app's own state directory", "storage the app owns") and stay true without edit — that abstraction is why the blast radius on the living spec is only two files.

## Impact

**Identity constants** (4 sites): `package.json` (`productName`, `build.appId`, `build.productName`), `electron/mac-install-target.mjs:15-16`, `electron/main.mjs:25`.

**State-root write sites** (7 sites): `electron/user-config.mjs:39`, `electron/user-config.mjs:202`, `electron/worker-env.mjs:37`, `electron/session-store.mjs:68`, `electron/main.mjs:44`, `electron/pipeline-install.mjs:134`, `electron/pipeline-probes.mjs:155`.

**New module**: a migration unit under `electron/`, Electron-free and unit-testable like every non-privileged module there, invoked from `main.mjs` before any consumer of the state root is constructed.

**Tests asserting the literal path** (6 files): `electron/user-config.test.mjs`, `electron/pipeline-install.test.mjs`, `electron/sdk-options.test.mjs`, `electron/run-sessions.test.mjs`, `electron/worker-env.test.mjs`, `electron/session-store.test.mjs`. `pipeline-install.test.mjs` derives the Claude projects directory from the workspace path via `replace(/[/.]/g, "-")`, so its expected slug changes with the rename.

**User-visible consequences**: microphone, camera, and screen-recording permissions must be re-granted; a stale `/Applications/Iris.app` remains until manually deleted; `~/Library/Application Support/Iris` and `~/Library/Preferences/app.iris.voice.plist` are abandoned and regenerate under the new names (they hold only Chromium/Electron state, nothing user-authored, so they are not migrated).

**No new dependencies. No IPC channel added, removed, or renamed. No change to the verb registry, the Gemini tool surface, or any pinned external identifier.**
