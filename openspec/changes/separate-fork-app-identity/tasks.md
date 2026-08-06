## 1. Centralize the identifiers (behavior-preserving, values unchanged)

- [ ] 1.1 Create `electron/app-identity.mjs` exporting `PRODUCT_NAME`, `BUNDLE_ID`, and `STATE_ROOT_DIR` — still `"Iris"`, `"app.iris.voice"`, `".iris"` at this step. Electron-free, dependency-free, per `main-process-structure`. Carry a header comment explaining that these four identifiers are what distinguish this fork from `ASHR12/iris` and must never match upstream's.
- [ ] 1.2 In `electron/mac-install-target.mjs`, replace the local `PRODUCT_NAME` / `BUNDLE_ID` declarations (lines 15–16) with imports from `app-identity.mjs`, re-exporting them so existing importers of `mac-install-target.mjs` keep working unchanged.
- [ ] 1.3 In `electron/main.mjs:25`, change `app.setName("Iris")` to use the imported `PRODUCT_NAME`. Keep the existing comment about the Dock tile only reflecting it in a packaged build.
- [ ] 1.4 Add `electron/app-identity.test.mjs`: read `package.json` and assert `build.appId === BUNDLE_ID`, `build.productName === PRODUCT_NAME`, and top-level `productName === PRODUCT_NAME`. Comment it the way `mac-install-target.mjs` comments `DEFAULT_SHUTDOWN_DEADLINE_MS` — duplication that cannot be removed, parity held by a test rather than a shared import (design D1).
- [ ] 1.5 Create `electron/app-paths.mjs`: one accessor per child of the state root — `stateRoot`, `userConfigFile`, `claudeHome`, `sessionStoreFile`, `canvasStoreFile`, `defaultWorkspace` — each taking an injectable `homedir = os.homedir` argument, matching `worker-env.mjs`'s existing convention. The directory name comes from `STATE_ROOT_DIR`; the literal appears nowhere else.
- [ ] 1.6 Move `worker-env.mjs`'s `irisClaudeHome()` comment block — the reasoning for pinning `CLAUDE_CONFIG_DIR`, why `settingSources` is insufficient, and why it is deliberately not overridable by an env var — onto the `claudeHome` accessor in `app-paths.mjs`, and reduce `irisClaudeHome()` to a delegation (or replace its call sites).
- [ ] 1.7 Repoint the seven state-root call sites at `app-paths.mjs`: `user-config.mjs:39`, `user-config.mjs:202`, `worker-env.mjs:37`, `session-store.mjs:68`, `main.mjs:44`, `pipeline-install.mjs:134`, `pipeline-probes.mjs:155` (keeping `IRIS_CLAUDE_CWD` precedence intact in the last one).
- [ ] 1.8 Add `electron/app-paths.test.mjs` covering each accessor against an injected fake home.
- [ ] 1.9 Run all five gates (`build`, `test`, `lint`, `scan:secrets`, `spec:check`). Everything must pass with **no behavior change** — this group renames nothing user-visible. Grep to confirm the string `".iris"` now appears in exactly one runtime source location.

## 2. Flip the identity values

- [ ] 2.1 In `electron/app-identity.mjs`, set `PRODUCT_NAME = "MyIris"`, `BUNDLE_ID = "app.myiris.voice"`, `STATE_ROOT_DIR = ".myiris"`.
- [ ] 2.2 In `package.json`, set `productName`, `build.productName` to `"MyIris"` and `build.appId` to `"app.myiris.voice"`. The test from 1.4 is what proves these match. Leave `name` (`iris-claude-voice`) alone — see the proposal's non-goals.
- [ ] 2.3 Update the six tests that assert the literal old path: `user-config.test.mjs:259,264`; `sdk-options.test.mjs:192`; `run-sessions.test.mjs:4,49`; `worker-env.test.mjs:110`; `session-store.test.mjs:9`.
- [ ] 2.4 Update `pipeline-install.test.mjs:126`, whose expected Claude projects directory is derived from the workspace path via `replace(/[/.]/g, "-")` — the slug changes with the rename.
- [ ] 2.5 Update the spoken line in `electron/announcements.mjs:85`, which names `~/.iris/workspace` out loud to Claude.
- [ ] 2.6 Run all five gates. `spec:check` will now flag the two specs that pin the literal path — group 5 resolves that.

## 3. One-time migration of an existing state root

- [ ] 3.1 Create `electron/state-root-migration.mjs` with a pure decision function over injected inputs (`targetExists`, `sourceExists`, `sourceEntries`) returning `"migrate" | "skip" | "ambiguous"`, plus the two marker sets: fork = `claude-sessions.json`, `canvas.json`, `claude-home`, `workspace`; upstream = `brain-index`, `run-registry.json`. Migrate only on ≥1 fork marker **and** 0 upstream markers (design D4). Comment why the asymmetry exists — a wrong "migrate" consumes another app's data, a wrong "skip" costs a recoverable fresh start.
- [ ] 3.2 Add the slug-repair helper in the same module: given the old and new state roots, derive the old and new transcript directory names via the same `replace(/[/.]/g, "-")` derivation, and return the rename pair. Pure; no I/O.
- [ ] 3.3 Add the I/O wrapper — `renameSync` of the root, then the best-effort slug rename — that swallows a slug-rename failure and reports a root-rename failure without throwing (design D3, D5).
- [ ] 3.4 Call it from `electron/main.mjs` **immediately before** `loadEnvFile({ repoRoot })`, which is the first consumer of the state root. Synchronous. Log the outcome, and on `"ambiguous"` log the path that was found and left alone so a `.env`-only user has something to act on.
- [ ] 3.5 Add `electron/state-root-migration.test.mjs` covering: fork markers only → migrate; upstream markers only → skip; both present → ambiguous; neither present (`.env` only) → ambiguous; target already exists → skip regardless of source; source absent → skip; slug pair derivation; slug rename skipped when the source is missing or the target already exists.
- [ ] 3.6 Run all five gates.

## 4. Installer and packaging

- [ ] 4.1 Confirm `scripts/install-mac.mjs` needs no edit beyond the constants it already imports — its `pgrep` probe, its `osascript … to quit`, its `INSTALLED_EXECUTABLE`, and its refusal messages all build from `PRODUCT_NAME`/`BUNDLE_ID`. Fix any remaining hard-coded `"Iris"` literal, including the closing note at line 269 that names `~/.iris/.env`.
- [ ] 4.2 Add a `mac-install-target.test.mjs` case asserting `decideInstallAction` **refuses** a bundle whose id is `app.iris.voice` at the install path — the upstream-collision case, now a real branch rather than an unreachable one.
- [ ] 4.3 Add a note to `scripts/install-mac.mjs`'s output telling the user that a previously installed `/Applications/Iris.app` is left in place deliberately and must be quit and deleted by hand.

## 5. Living spec and documentation

- [ ] 5.1 `README.md` — lines 91, 116, 139, 149, 245, 247, 250, 251, 364: new state root, and the `mkdir -p ~/.myiris && cp .env.example ~/.myiris/.env` snippet.
- [ ] 5.2 `README.md` — add a short "Relationship to upstream" note in the fork paragraph explaining that the app deliberately carries a distinct bundle id, name, and state root so both can be installed side by side.
- [ ] 5.3 `README.md` — add an upgrade note: permissions must be re-granted, the migration runs automatically, and the stale `/Applications/Iris.app` must be deleted by hand.
- [ ] 5.4 `CLAUDE.md` lines 89 and 100 (the `~/.iris/.env` prerequisite and the `CLAUDE_CONFIG_DIR` convention), plus a one-line router pointer to the `app-identity` capability.
- [ ] 5.5 `SECURITY.md` lines 142 and 225.
- [ ] 5.6 `.env.example` lines 24, 128, 141 — including the `IRIS_CLAUDE_CWD` example path.
- [ ] 5.7 `docs/PIPELINE_GUIDE.md:76`, `docs/PIPELINE_GUIDE.vi.md:76`, `docs/PIPELINE_INTERNALS.md:387`.
- [ ] 5.8 `docs/ARCHITECTURE.md` — add `electron/app-identity.mjs`, `electron/app-paths.mjs`, and `electron/state-root-migration.mjs` to the module map.
- [ ] 5.9 Run `npm run spec:check` and confirm it is clean against the two delta specs in this change.

## 6. Verification

- [ ] 6.1 All five gates green: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`.
- [ ] 6.2 Grep gate: no `".iris"` literal remains in `electron/`, `src/`, or `scripts/` outside `state-root-migration.mjs` (which names it as the migration source) and its test.
- [ ] 6.3 Manual, on a machine carrying the old state: back up `~/.iris`, then `npm run dev` and confirm the migration moved it to `~/.myiris` with `claude-home`, `workspace`, `claude-sessions.json`, and `canvas.json` intact, and that `~/.iris` is gone.
- [ ] 6.4 Manual: confirm a stateful session that ran against the default workspace **before** the migration resumes with its prior history — this is what the slug repair exists for.
- [ ] 6.5 Manual: restore a fake `~/.iris` containing only `brain-index/` and confirm the app leaves it untouched and starts with an empty state root.
- [ ] 6.6 Manual: `npm run install:mac`. Confirm `/Applications/MyIris.app` is created, the existing `/Applications/Iris.app` is **not** removed, and the app launches, re-requests microphone/camera permission, and reaches a working voice session.
- [ ] 6.7 Manual: confirm `~/Library/Application Support/MyIris` and `~/Library/Preferences/app.myiris.voice.plist` are created, and record that the old ones are abandoned.
- [ ] 6.8 Delete the stale `/Applications/Iris.app` and the abandoned `~/Library/Application Support/Iris` and `~/Library/Preferences/app.iris.voice.plist` by hand, then confirm `MyIris` still launches cleanly.
