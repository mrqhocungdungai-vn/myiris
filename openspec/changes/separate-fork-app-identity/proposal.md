## Why

This repository is a fork of [`ASHR12/iris`](https://github.com/ASHR12/iris), and it has inherited the upstream project's identity wholesale: the same bundle identifier, the same product name, the same install path, and the same home-directory state root. Installing the upstream app on a machine that already runs this fork — or the reverse — is not a coexistence problem, it is a **silent overwrite**. All four collision points exist on the maintainer's machine right now.

The most dangerous one is the bundle identifier. `decideInstallAction()` in `electron/mac-install-target.mjs` refuses to remove a bundle whose `CFBundleIdentifier` is *not* `app.iris.voice` — that guard is what stops the installer from deleting somebody else's application. Because the fork and upstream declare the *same* identifier, the guard reads upstream's `Iris.app` as "our own bundle, safe to replace", and `npm run install:mac` proceeds to `rm -rf` it without a warning. The identifier collision also merges the two apps as far as macOS is concerned: LaunchServices treats them as one application, and they share one set of TCC grants for microphone, camera, and screen recording.

Renaming `~/.iris` to `~/.myiris` — the change that prompted this proposal — separates the *data*, which matters, but it does not stop any of that. The data root is the one collision point that cannot destroy anything on its own. The three that can are the identifier, the product name, and the install path.

**There is no data to migrate.** This app has never had a released build, so no user has state under `~/.iris`. A `~/.iris` on a developer's machine belongs to upstream or to a pre-rename dev run, and in either case the correct behavior is to leave it alone rather than to claim it. That removes what would otherwise be the riskiest part of this change — code that moves a directory it shares with another application — and the whole change reduces to a refactor plus a value flip.

## What Changes

- **BREAKING** — **New bundle identifier**: `app.iris.voice` → `app.myiris.voice`, in both `package.json` (`build.appId`) and `electron/mac-install-target.mjs` (`BUNDLE_ID`). macOS keys TCC grants by bundle identifier, so **the microphone, camera, and screen-recording permissions reset** and the user must grant them again on first launch. This is the intended cost: a distinct identifier is precisely what makes the two apps distinct to the operating system.
- **BREAKING** — **New product name**: `Iris` → `MyIris`, in `package.json` (`productName`, `build.productName`), `electron/mac-install-target.mjs` (`PRODUCT_NAME`), `app.setName()` in `electron/main.mjs`, and the three places `electron/window.mjs` names the app to macOS — the tray tooltip, the About panel's `applicationName`, and the application menu's own title. This moves the install target to `/Applications/MyIris.app` and the Electron user-data directory to `~/Library/Application Support/MyIris`.
- **BREAKING** — **New state root**: `~/.iris/` → `~/.myiris/`, covering the six runtime sites that resolve app-owned state — the packaged `.env`, `claude-home` (the pinned `CLAUDE_CONFIG_DIR`), `claude-sessions.json`, `canvas.json`, and the default `workspace`.
- **One site spells `.iris` deliberately and does NOT follow the rename.** `legacyTranscriptDir()` in `electron/pipeline-install.mjs` derives a *historical* slug in order to find transcripts an **older Iris** left in the user's real `~/.claude/projects/`, back when runs inherited the default `CLAUDE_CONFIG_DIR`. Those transcripts were written against `~/.iris/workspace`, and that path is frozen in history. Repointing it at the new root would make the legacy-artifact detection find nothing, forever, with no error — the SetupPanel would simply stop offering that cleanup. The literal stays, with a comment saying why, and its test stays asserting the old slug.
- **No migration, and no code that touches `~/.iris`.** There is no released build whose state would need carrying across, so the app never reads, moves, or deletes that directory — a first launch beside an existing `~/.iris` behaves exactly like a first launch on a clean machine. This is a deliberate scope decision, not an omission: a migration would mean writing a guarded move of a directory shared with another application, which is the single most dangerous thing this change could contain and buys nothing when there is no data to save.
- **The installer's existing safety guard becomes genuinely protective.** Once `BUNDLE_ID` differs, `decideInstallAction()` refuses to touch upstream's `/Applications/Iris.app` — the branch that was unreachable-by-collision starts doing its job.
- **An `/Applications/Iris.app` found on disk is never touched.** It carries upstream's identifier, so the guard refuses it — whether it is a real upstream install or a pre-rename local build. Removing one is the developer's own call, by hand.
- Documentation updated across `README.md`, `CLAUDE.md`, `SECURITY.md`, `.env.example`, `docs/PIPELINE_GUIDE.md`, `docs/PIPELINE_GUIDE.vi.md`, `docs/PIPELINE_INTERNALS.md`, `scripts/install-mac.mjs`, and the spoken announcement in `electron/announcements.mjs`.

### Non-goals

- **The persona and the wake word stay `Iris`.** This change separates the *app identity* — what macOS, the filesystem, and the installer use to tell two applications apart. The character the user talks to is still named Iris, and every piece of spoken and on-screen copy that names her stays as it is (`src/components/CommsPanel.tsx`, `HudShell.tsx`, `SessionSwitcher.tsx`, `SetupPanel.tsx`, the tray's "Sleep Iris"/"Wake Iris" actions, and all of `electron/gemini-prompts.mjs`). The wake word is likewise untouched: it is a bundled ONNX model, `wakeword/hey_iris.onnx`, loaded by `src/hooks/useWakeWord.ts` — retraining a wake word is not a rename. Stated explicitly because "rename the app" reads like "rename everything", and it is not.
- **The second-brain notes vault at `~/iris-second-brain` does not move.** It sits outside the state root by design (`electron/capabilities/second-brain.mjs`), and upstream does not use that path at all — upstream's vault is `~/.hermes` with an `IRIS_BRAIN_PATH` override — so there is no collision to remove. It also holds user-authored markdown that users open in Obsidian and other editors; moving it would break their own links, bookmarks, and vault registrations for no safety gain. No code change to it.
- **The `IRIS_*` and `GEMINI_*` environment-variable prefixes are unchanged.** They are read from each app's own `.env` file, so once the state roots are separate the prefixes cannot collide. Renaming them would be a large, purely cosmetic edit with a real risk of breaking a user's existing configuration.
- **The npm package name (`iris-claude-voice`) is unchanged.** It is never published and never reaches disk as an identifier.
- **`window.iris`, the preload IPC bridge, is unchanged.** It is an in-process JavaScript binding with no cross-application visibility.
- No code signing, notarization, or dmg target is added — `mac.target` stays `dir`.

## Capabilities

### New Capabilities

- `app-identity`: The identifiers by which this application is distinguishable from every other application on the machine — its bundle identifier, its product name, its install path, and the root of its on-disk state — together with the requirement that they never collide with the upstream project this repository is forked from, and the rule that the pre-rename root is left untouched rather than adopted.

### Modified Capabilities

- `setup-panel`: two requirements name the packaged configuration file by its literal path `~/.iris/.env`; both must name the new root.
- `agent-subscription-auth`: the requirement covering where `CLAUDE_CODE_OAUTH_TOKEN` is persisted names `~/.iris/.env` literally; it must name the new root.

`pipeline-setup-install`, `config-persistence`, and `global-agent-runtime` all describe this storage abstractly ("the app's own state directory", "storage the app owns") and stay true without edit — that abstraction is why the blast radius on the living spec is only two files.

One of those abstractions is worth naming, because it hides the hazard above. `pipeline-setup-install`'s "Transcripts that cannot be attributed to Iris are left alone" scenario says cleanup removes "the directory for the app's own scratch workspace". Read after this change, that sounds like the *new* workspace path — but the transcripts in question were written against the old one and can only be found there. The scenario stays true (it is about attribution, not about a literal path), and `app-identity` pins the historical derivation explicitly so a future reader does not "fix" it into a silent no-op.

## Impact

**Identity constants**: `package.json` (`productName`, `build.appId`, `build.productName`), `electron/mac-install-target.mjs:15-16`, `electron/main.mjs:25`, and `electron/window.mjs` (the tray tooltip at `:251`, the About panel's `applicationName` at `:289`, the application-menu title at `:295`). `window.mjs` is one of the four modules permitted to import Electron, so it may import `app-identity.mjs` directly.

**State-root sites repointed** (6 sites): `electron/user-config.mjs:39`, `electron/user-config.mjs:202`, `electron/worker-env.mjs:37`, `electron/session-store.mjs:68`, `electron/main.mjs:44`, `electron/pipeline-probes.mjs:155`.

**State-root site deliberately left alone** (1 site): `electron/pipeline-install.mjs:134` — the historical slug described under *What Changes*. It keeps the `".iris"` literal and gains a comment saying the literal is historical and must not follow the rename.

**New modules** (2): `electron/app-identity.mjs` (the three identity constants, the single declaration) and `electron/app-paths.mjs` (one accessor per child of the state root, `homedir` injectable). Both Electron-free and unit-testable, per `main-process-structure`.

**Tests asserting an old literal** (6 files): `electron/user-config.test.mjs`, `electron/sdk-options.test.mjs`, `electron/run-sessions.test.mjs`, `electron/worker-env.test.mjs`, `electron/session-store.test.mjs` (all five for the state root), and `electron/mac-install-target.test.mjs`, which hard-codes `Iris.app` in its source-bundle cases and asserts `INSTALLED_EXECUTABLE === "/Applications/Iris.app/Contents/MacOS/Iris"` outright. `electron/pipeline-install.test.mjs:126` is **not** in this list: it asserts the historical slug, which does not change.

**Developer-visible consequences** (there are no users yet, which is the point):

- Microphone, camera, and screen-recording permission are requested on first launch, because macOS keys TCC by bundle identifier and this is a new one.
- A `~/.iris` left by a pre-rename dev run stays on disk, untouched. Move or delete it by hand if you want it gone; the app will not.
- An `/Applications/Iris.app` left by a pre-rename local build likewise stays. The installer's guard cannot tell it apart from a real upstream install, and refusing is the correct behavior.
- The renderer's interface preferences start at their defaults, because macOS derives the web-storage directory from the product name. This applies to `npm run dev` too: `app.setName()` runs at module scope in `main.mjs`, so a dev run resolves the same `userData` path as the installed app.

**No new dependencies. No IPC channel added, removed, or renamed. No change to the verb registry, the Gemini tool surface, or any pinned external identifier.**
