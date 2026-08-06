## Context

See `proposal.md — Why` for the motivation. What matters for the approach is the current shape of the four identifiers.

**The state root is spelled out seven times.** `path.join(os.homedir(), ".iris", …)` is written independently in `user-config.mjs` (twice), `worker-env.mjs`, `session-store.mjs`, `main.mjs`, `pipeline-install.mjs`, and `pipeline-probes.mjs`. There is no shared constant. This is the same shape as the defect `CLAUDE.md` already records under "a verb is defined in exactly one place" — hand-wired copies of one fact, which drifted silently once before.

**The identity constants are spelled out twice, in two languages.** `package.json` declares `build.appId` and `build.productName` for electron-builder; `electron/mac-install-target.mjs` declares `BUNDLE_ID` and `PRODUCT_NAME` for the installer's ownership guard. Nothing checks they agree. The guard is only meaningful if the identifier it compares against is the identifier the packaged bundle actually carries — if those two drift, the guard either refuses the app's own bundle forever or, worse, accepts somebody else's.

**The repo has a precedent for this exact problem.** `mac-install-target.mjs` duplicates `DEFAULT_SHUTDOWN_DEADLINE_MS` from `user-config.mjs` rather than importing it, with a comment stating the parity is held by a test instead of by a shared import — because the installer has no business loading the module graph that constant otherwise lives in. The same reasoning applies to `package.json`, which cannot be imported into the Electron-free modules under `electron/`.

**Constraint from `main-process-structure`:** every module under `electron/` other than `main.mjs`, `ipc.mjs`, `window.mjs`, and `renderer-security.mjs` is Electron-free and importable in a plain vitest file. Both new modules must satisfy that.

**Marker files, measured against upstream.** Grepping `upstream/main` for its `~/.iris` children gives a clean partition:

| Child of `~/.iris` | This fork | Upstream |
| --- | --- | --- |
| `claude-sessions.json`, `canvas.json`, `claude-home/`, `workspace/` | writes | never |
| `brain-index/`, `run-registry.json` | never | writes |
| `.env` | writes | writes |

## Goals / Non-Goals

**Goals:**

- One authoritative declaration per identifier, with every consumer deriving from it or asserted equal to it by test.
- A migration that is safe by construction against the case that matters — an upstream install already occupying `~/.iris` — rather than safe by the user reading a warning.
- No behavior change other than the identifiers and the migration. Same IPC surface, same verb registry, same run semantics.

**Non-Goals:**

- Migrating OS-managed state (`~/Library/Application Support/Iris`, `~/Library/Preferences/app.iris.voice.plist`). Framework state only; it regenerates.
- Deleting the previously installed `/Applications/Iris.app`. After this change it is indistinguishable from an upstream install, so the installer must not touch it.
- Any change to `IRIS_*` / `GEMINI_*` env var names, the npm package name, or the `window.iris` bridge — see `proposal.md — Non-goals`.

## Decisions

### D1 — A single `electron/app-identity.mjs` owns all four identifiers; parity with `package.json` is held by a test

`PRODUCT_NAME`, `BUNDLE_ID`, and the state-root directory name become exports of one new Electron-free module. `mac-install-target.mjs` imports `PRODUCT_NAME`/`BUNDLE_ID` from it instead of declaring them; `main.mjs` passes `PRODUCT_NAME` to `app.setName()` instead of a literal.

`package.json` cannot import from it — electron-builder reads static JSON. So a test reads `package.json` and asserts `build.appId === BUNDLE_ID`, `build.productName === PRODUCT_NAME`, and `productName === PRODUCT_NAME`. This follows the `DEFAULT_SHUTDOWN_DEADLINE_MS` precedent already in `mac-install-target.mjs`: duplication that cannot be removed, with the invariant enforced by a test rather than left to inspection.

*Alternative rejected — generate `package.json` fields from the module at build time.* It would add a build step, and a generated `package.json` is worse to review than a two-line test.

*Alternative rejected — leave the constants where they are and just change the strings.* This is the change that makes the installer's guard load-bearing; leaving the two declarations unlinked at exactly the moment the guard starts mattering is the wrong trade.

### D2 — A single `electron/app-paths.mjs` owns the state root and its named children

One module exports the root and one accessor per child: the config file, the Claude configuration directory, the session store, the canvas store, the default workspace. The seven call sites each import the one they need. The literal `".myiris"` appears exactly once in the codebase.

Each accessor takes an injectable `homedir` argument, matching the existing convention in `worker-env.mjs`'s `irisClaudeHome(homedir = os.homedir)`, so tests keep injecting a fake home rather than mutating the environment.

`worker-env.mjs`'s `irisClaudeHome()` becomes a thin re-export or is replaced outright by the `app-paths` accessor. Its long comment explaining *why* `CLAUDE_CONFIG_DIR` is pinned and deliberately not overridable moves with it — that reasoning is the most important thing in the module and must not be orphaned.

### D3 — Migration is a `renameSync`, gated on marker files, run once, before anything reads the root

Placed in `main.mjs` immediately before `loadEnvFile({ repoRoot })`, which is the first consumer. Synchronous, because `loadEnvFile` is synchronous and everything downstream is constructed from its result.

The decision function lives in a new Electron-free module and is pure over injected inputs — given "does the target exist", "does the source exist", and the source's directory listing, it returns `migrate` / `skip` / `ambiguous`. `main.mjs` performs the I/O. This is the shape `mac-install-target.mjs` already uses for the installer's destructive step, and for the same reason: the decision is the part worth testing exhaustively, and it is the part that must never be wrong.

**Move, not copy.** A copy leaves this fork's data sitting at `~/.iris`, where a later upstream install reads it — recreating the collision in the other direction. The move is atomic: both paths are under `$HOME`, so `renameSync` is a same-filesystem rename.

*Alternative rejected — prompt the user at first launch.* The decision needs to be made before the first window exists, since `loadEnvFile` runs at module scope. Deferring it would mean either booting unconfigured and migrating later, or restructuring startup — both larger than the problem.

*Alternative rejected — no migration, document a manual `mv`.* The directory holds 3.5 MB of Claude transcripts on the maintainer's machine alone. Silently starting every user with no session history to resume is a worse first impression than a guarded automatic move.

### D4 — Ownership is decided by marker files, and ambiguity means "do nothing and say so"

Migrate only when the source directory contains **at least one** fork marker (`claude-sessions.json`, `canvas.json`, `claude-home/`, `workspace/`) and **no** upstream marker (`brain-index/`, `run-registry.json`). Anything else — both present, neither present, unreadable — is ambiguous.

The asymmetry is deliberate: a wrong "migrate" consumes another application's data and destroys its directory; a wrong "skip" costs a fresh start, which is recoverable. So the branch that acts requires positive evidence, and every other branch declines. This mirrors `decideInstallAction`, which refuses on every case it cannot positively identify, including the ones that "should not happen".

`.env` is deliberately **not** a fork marker, because both projects write it. The cost is stated in Risks below.

On `ambiguous`, the app SHALL record that a directory was found and left alone, so a user in the `.env`-only case has something to act on rather than a silent fresh start.

### D5 — The transcript slug is repaired as part of the migration, best-effort

Claude Code names each project's transcript directory after the working directory path with `/` and `.` replaced by `-` (the derivation `pipeline-install.test.mjs` already encodes). Moving the default workspace from `~/.iris/workspace` to `~/.myiris/workspace` changes its slug from `-Users-<user>--iris-workspace` to `-Users-<user>--myiris-workspace`, so every transcript for a run against the default workspace would become unreachable — and the symptom is a resumed session that finds no history, not an error.

So after the root rename, rename `<root>/claude-home/projects/<old-slug>` to `<new-slug>`. Transcripts for user-selected project folders are keyed by paths this change does not touch and are left alone.

Best-effort by design: if the source slug directory is absent (the user never ran against the default workspace) or the target already exists, leave both and continue. Neither case should fail a launch, and neither is recoverable by failing.

*Note:* this repair is coupled to an external tool's naming scheme. That coupling already exists in the test suite; this change does not introduce it, but it does make it load-bearing. The best-effort framing is what keeps a change in Claude Code's naming from turning into a launch failure.

### D6 — `MyIris` / `app.myiris.voice` as the values

Chosen to match the repository name (`myiris`) and to be unmistakably distinct from upstream at a glance — not a case variant or a suffix. `app.myiris.voice` preserves upstream's reverse-DNS shape, which keeps the diff legible. These are three string constants behind D1; changing them later is a one-line edit plus a reinstall.

## Risks / Trade-offs

**A chat-only user who never ran the pipeline has only `.env` in `~/.iris`, so D4 classifies them ambiguous and their Gemini API key is not carried across.** → They re-enter the key through the SetupPanel, which already handles a missing key as its normal first-run path. D4's `ambiguous` logging names the directory so they know where to look, and the release notes call it out. Accepted rather than fixed: making `.env` a migration trigger is exactly what would let the fork consume an upstream install's credentials.

**Changing the bundle identifier resets microphone, camera, and screen-recording permission.** → Unavoidable and intended; it is the same mechanism that makes the two apps distinct to macOS. The app's existing permission prompts handle it. Documented in the README and in `app-identity`'s spec.

**The old `/Applications/Iris.app` is orphaned, and the installer must not delete it.** → Documented as a manual step. The alternative — deleting a bundle carrying upstream's identifier — is precisely the bug this change exists to remove, so the installer refusing is correct even when the bundle happens to be the user's own stale build.

**The installer's `pgrep` probe and `osascript … to quit` both target the app by name, and a stale `Iris.app` may still be running.** → Both are built from `PRODUCT_NAME`, so they follow D1 to `MyIris` automatically and will not ask an upstream Iris to quit. The risk is only that a running *old* build of this fork is no longer recognized by the probe — it will not be asked to quit, and the user must quit it themselves once, before deleting it.

**A partially completed migration would leave an inconsistent state.** → `renameSync` on one directory within one filesystem is atomic, so there is no partial state for the root move. The slug repair (D5) is a second rename that can fail independently, and its failure mode is bounded: lost history for the default workspace, never a corrupt directory.

**Renaming the state root is not detectable by `spec:check`,** since most specs describe the storage abstractly. → The two specs that do pin the literal path have delta files in this change; the rest were read and confirmed abstract.

## Migration Plan

1. Land D1 and D2 first (constants and paths centralized, values unchanged). Every gate stays green — this step is behavior-preserving and independently reviewable.
2. Flip the values in `app-identity.mjs` and `package.json` in one commit. Update the tests that assert the literal path, and the docs.
3. Add the migration (D3–D5) with its unit tests.
4. Verify manually on the maintainer's machine, which carries all four collision points: run `npm run install:mac`, confirm `/Applications/MyIris.app` appears, `/Applications/Iris.app` is untouched, `~/.iris` has become `~/.myiris` with `claude-home` intact, and a previously-run stateful session resumes with its history.
5. Delete the stale `/Applications/Iris.app` by hand.

**Rollback:** revert the commits and rename `~/.myiris` back to `~/.iris` (and the slug directory back). No data is destroyed at any point — the migration only ever moves, never deletes — so rollback is symmetric. TCC permissions would need granting once more.
