## Context

See `proposal.md — Why` for the motivation. What matters for the approach is the current shape of the four identifiers.

**The state root is spelled out seven times, and one of them must not move.** `path.join(os.homedir(), ".iris", …)` is written independently in `user-config.mjs` (twice), `worker-env.mjs`, `session-store.mjs`, `main.mjs`, `pipeline-install.mjs`, and `pipeline-probes.mjs`. There is no shared constant. This is the same shape as the defect `CLAUDE.md` already records under "a verb is defined in exactly one place" — hand-wired copies of one fact, which drifted silently once before.

Six of the seven resolve *current* app-owned state and follow the rename. The seventh, `pipeline-install.mjs`'s `legacyTranscriptDir()`, is a different kind of fact wearing the same shape: it reconstructs a **historical** path in order to find what an older build left in the user's own `~/.claude/projects/`. Deduplicating it would be a correctness bug, not a cleanup — see D2.

**The identity constants are spelled out twice, in two languages, plus three times in prose that reaches the OS.** `package.json` declares `build.appId` and `build.productName` for electron-builder; `electron/mac-install-target.mjs` declares `BUNDLE_ID` and `PRODUCT_NAME` for the installer's ownership guard. Nothing checks they agree. The guard is only meaningful if the identifier it compares against is the identifier the packaged bundle actually carries — if those two drift, the guard either refuses the app's own bundle forever or, worse, accepts somebody else's.

`electron/window.mjs` adds three more: the tray tooltip, `setAboutPanelOptions({ applicationName })`, and the application menu's own title. These are not decoration — they are what the user reads in the menu bar and the About panel, and leaving them as `Iris` would produce a `MyIris.app` whose menu says `Iris`, which is precisely the ambiguity this change exists to remove. `window.mjs` is one of the four Electron-permitted modules, so it imports `app-identity.mjs` directly with no indirection needed.

**The repo has a precedent for this exact problem.** `mac-install-target.mjs` duplicates `DEFAULT_SHUTDOWN_DEADLINE_MS` from `user-config.mjs` rather than importing it, with a comment stating the parity is held by a test instead of by a shared import — because the installer has no business loading the module graph that constant otherwise lives in. The same reasoning applies to `package.json`, which cannot be imported into the Electron-free modules under `electron/`.

**Constraint from `main-process-structure`:** every module under `electron/` other than `main.mjs`, `ipc.mjs`, `window.mjs`, and `renderer-security.mjs` is Electron-free and importable in a plain vitest file. Both new modules must satisfy that.

**No installed base.** This app has never shipped a release, so nothing under `~/.iris` belongs to a user of it. Verified against upstream: it writes `brain-index/`, `run-registry.json`, and `.env` there and is actively using that path. So the old root is *somebody else's directory or a dev artifact*, never data this change is responsible for — which is what lets the whole migration question drop out. See D3.

## Goals / Non-Goals

**Goals:**

- One authoritative declaration per identifier, with every consumer deriving from it or asserted equal to it by test.
- No new code on the startup path, and nothing that reads or writes a directory shared with another application.
- No behavior change other than the identifiers themselves. Same IPC surface, same verb registry, same run semantics.

**Non-Goals:**

- **Carrying over OS-derived state** (`~/Library/Application Support/Iris`, `~/Library/Preferences/app.iris.voice.plist`). macOS names both from the identity, so both follow the rename on their own. Worth knowing rather than acting on: the Application Support directory holds the renderer's `localStorage`, so the eight interface preferences kept there (`src/App.tsx` — sounds, hand control, camera device, microphone device, WebGL fidelity, ambient capture, HUD camera size, listen-only consent) start at their defaults under the new name, in dev as well as packaged. With no installed base there is nothing to preserve, and each default is the safe direction anyway.
- **Moving the second-brain notes vault.** `~/iris-second-brain` sits outside the state root and stays there: upstream writes `~/.hermes` (with an `IRIS_BRAIN_PATH` override) and never touches this path, so there is no collision, and the vault is user-authored markdown opened in Obsidian and other editors, where a moved path breaks the user's own links and vault registrations. This is why the state-root requirement in `app-identity` is scoped to app-owned *configuration and runtime state* rather than to everything under `$HOME`.
- **Renaming the persona or the wake word.** Both stay `Iris` — see `proposal.md — Non-goals`.
- Deleting an `/Applications/Iris.app` found on disk. It carries upstream's identifier, so the installer must refuse it whether it is upstream's or a pre-rename local build.
- Any change to `IRIS_*` / `GEMINI_*` env var names, the npm package name, or the `window.iris` bridge — see `proposal.md — Non-goals`.

## Decisions

### D1 — A single `electron/app-identity.mjs` owns all four identifiers; parity with `package.json` is held by a test

`PRODUCT_NAME`, `BUNDLE_ID`, and the state-root directory name become exports of one new Electron-free module. `mac-install-target.mjs` imports `PRODUCT_NAME`/`BUNDLE_ID` from it instead of declaring them; `main.mjs` passes `PRODUCT_NAME` to `app.setName()` instead of a literal; `window.mjs` builds its tray tooltip, About-panel `applicationName`, and application-menu title from it. `mac-install-target.mjs` also builds the Automation-permission refusal text from `PRODUCT_NAME`, since that message names the app the user has to grant permission *to* — a message naming the wrong app sends them to the wrong row in System Settings.

`package.json` cannot import from it — electron-builder reads static JSON. So a test reads `package.json` and asserts `build.appId === BUNDLE_ID`, `build.productName === PRODUCT_NAME`, and `productName === PRODUCT_NAME`. This follows the `DEFAULT_SHUTDOWN_DEADLINE_MS` precedent already in `mac-install-target.mjs`: duplication that cannot be removed, with the invariant enforced by a test rather than left to inspection.

*Alternative rejected — generate `package.json` fields from the module at build time.* It would add a build step, and a generated `package.json` is worse to review than a two-line test.

*Alternative rejected — leave the constants where they are and just change the strings.* This is the change that makes the installer's guard load-bearing; leaving the two declarations unlinked at exactly the moment the guard starts mattering is the wrong trade.

### D2 — A single `electron/app-paths.mjs` owns the state root and its named children

One module exports the root and one accessor per child: the config file, the Claude configuration directory, the session store, the canvas store, the default workspace. The **six** current-state call sites each import the one they need. The literal `".myiris"` appears exactly once in the codebase.

Each accessor takes an injectable `homedir` argument, matching the existing convention in `worker-env.mjs`'s `irisClaudeHome(homedir = os.homedir)`, so tests keep injecting a fake home rather than mutating the environment.

`worker-env.mjs`'s `irisClaudeHome()` becomes a thin re-export or is replaced outright by the `app-paths` accessor. Its long comment explaining *why* `CLAUDE_CONFIG_DIR` is pinned and deliberately not overridable moves with it — that reasoning is the most important thing in the module and must not be orphaned.

**The seventh site is excluded, and the exclusion is the interesting part.** `legacyTranscriptDir()` in `pipeline-install.mjs` reads:

```js
const workspace = path.join(os.homedir(), ".iris", "workspace");
const key = workspace.replace(/[/.]/g, "-");
return path.join(os.homedir(), ".claude", "projects", key);
```

It looks like a sixth consumer of the state root. It is not: nothing under `~/.iris` is read here. The path is assembled only to reproduce the *slug* that an older Iris — one whose runs still inherited the default `CLAUDE_CONFIG_DIR` — caused Claude Code to create inside the **user's own** `~/.claude/projects/`. That slug is a historical fact about files already on disk. It cannot change, because the files cannot rename themselves.

Repointing it at `app-paths.defaultWorkspace()` would compile, pass every existing test that does not pin the slug, and break the feature silently: `legacyClaudeArtifacts()` would look for a directory that has never existed, find nothing, and the SetupPanel's "remove legacy artifacts" row would simply stop appearing — no error, no log line, and the user's `~/.claude` keeps the leftovers this repository added a whole capability to clean up.

So the literal stays, and `pipeline-install.test.mjs:126` keeps asserting the old slug. Both get a comment stating that the value is historical and must not follow the state-root rename. This is the one place in the change where the two `.iris` literals that survive in `electron/` are correct; the grep gate in task 6.2 permits exactly them and the migration source, and nothing else.

*Alternative rejected — derive the historical slug from `STATE_ROOT_DIR`'s old value, kept as a `LEGACY_STATE_ROOT_DIR` constant in `app-identity.mjs`.* Tempting for symmetry, and it would satisfy a naive "no `.iris` anywhere" grep. Rejected because it puts a dead identifier in the module whose entire purpose is to declare the app's *live* identity, where the next reader has to work out which of the two the guard compares against. A local literal with a comment explaining that it is frozen history is less likely to be misread than a second constant sitting next to the real one.

### D3 — No migration, and no code that reads `~/.iris` at all

The obvious-looking move here is a guarded `renameSync` of `~/.iris` to `~/.myiris` at boot, ownership proven from marker files. It was designed in full and then dropped, because the premise it rests on is false: **there is no installed base.** No released build of this app ever wrote to `~/.iris`, so there is no user whose sessions, canvas, or transcripts need carrying across.

What remains at that path on a developer's machine is either upstream's live state or a pre-rename dev run's leftovers. For the first, moving it is exactly the data-theft this capability exists to prevent. For the second, a developer can `mv` a directory. Neither justifies putting a directory move on the startup path.

So the app never reads, moves, copies, or deletes `~/.iris`. A first launch beside an existing one behaves identically to a first launch on a clean machine.

What this buys, which is the real argument: the migration would have been the only code in this change capable of destroying data — a filesystem move of a directory *shared with another live application*, decided by heuristics, running before the first window exists. Deleting it removes that entire risk class, a startup-path dependency, two modules, and a marker-file heuristic whose correctness rested on a survey of upstream's current `main` that nothing keeps up to date.

*Alternative rejected — migrate anyway, "just in case".* The case does not exist, and the guard protecting against the case that does (upstream's directory) would be carrying the entire safety burden for no benefit.

*Alternative rejected — read `~/.iris/.env` as a fallback so a dev keeps their key.* This is the single most dangerous shortcut available here: `.env` is the one file both projects write, so a fallback read is precisely how this app would silently adopt an upstream install's credentials. The `app-identity` spec forbids it outright.

### D4 — The transcript slug simply changes, and nothing repairs it

Claude Code names each project's transcript directory after its working directory path with `/` and `.` replaced by `-`. The default workspace moves, so its slug moves with it: transcripts from pre-rename dev runs stay under the old slug and are not found again.

With no migration there is nothing to repair and no user history at stake. Accepted as-is rather than papered over — and it keeps this change free of any coupling to an external tool's naming scheme, which was the weakest point of the original design.

One derivation still names the old path deliberately, and it is a different fact: `pipeline-install.mjs`'s `legacyTranscriptDir()` reconstructs the pre-rename workspace slug to find what an older build left in the user's **own** `~/.claude/projects/`. That is a statement about files already on disk, so it must not follow the rename — see D2.

### D5 — `MyIris` / `app.myiris.voice` as the values

Chosen to match the repository name (`myiris`) and to be unmistakably distinct from upstream at a glance — not a case variant or a suffix. `app.myiris.voice` preserves upstream's reverse-DNS shape, which keeps the diff legible. These are three string constants behind D1; changing them later is a one-line edit plus a reinstall.

## Risks / Trade-offs

**Changing the bundle identifier resets microphone, camera, and screen-recording permission.** → Unavoidable and intended; it is the same mechanism that makes the two apps distinct to macOS. The app's existing permission prompts handle it, and with no installed base this is simply a first run.

**A developer's own `~/.iris` and `/Applications/Iris.app` are left behind and could be mistaken for a broken install.** → Both are named in the proposal's consequences. Neither is touched by design: the state root because nothing may read it (D3), the bundle because the installer's guard cannot distinguish it from upstream's and correctly refuses.

**The installer's `pgrep` probe and `osascript … to quit` target the app by name, so a still-running pre-rename build is not recognized.** → Both derive from `PRODUCT_NAME`, so they follow D1 and will never ask an upstream Iris to quit. The residual cost is that an old local build must be quit by hand once.

**A dev who had a Gemini key in `~/.iris/.env` starts unconfigured.** → They re-enter it in the SetupPanel, which already treats a missing key as its normal first-run path, or copy the file across by hand. Deliberately not automated: see D3's second rejected alternative.

**Renaming the state root is not detectable by `spec:check`.** → Confirmed by measurement, not assumption: `scripts/check-spec-drift.mjs` scans for retired vocabulary, placeholders, and self-contradiction, never filesystem paths, and `spec:check` passes with `~/.iris` still written in the living spec. The two specs that pin the literal have delta files here; the rest were read and confirmed abstract. Nothing automated will catch a stale path in a spec — it has to be looked for.

## Implementation Plan

1. Land D1 and D2 first (constants and paths centralized, values unchanged). Every gate stays green — this step is behavior-preserving and independently reviewable.
2. Flip the values in `app-identity.mjs` and `package.json` in one commit. Update the tests that assert the old literal, and the docs.
3. Verify manually: `npm run install:mac`, confirm `/Applications/MyIris.app` appears and any `/Applications/Iris.app` is untouched, and that the app reaches a working voice session. Expect the permission prompts and the interface preferences at their defaults — both are the change working, not failing.

**Rollback:** revert the commits. Nothing on disk was moved or deleted at any point, so there is no data step to undo — only the TCC grants, which would need granting once more.
