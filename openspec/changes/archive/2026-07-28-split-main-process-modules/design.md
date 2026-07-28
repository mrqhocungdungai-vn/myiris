## Context

`electron/main.mjs` is 4297 lines with no test coverage. The proposal covers why. This document is about how, and it starts from four measurements taken against the current file, because they determine what is cheap and what is dangerous.

**1. The file is already cohesive.** Mapping every line into domains yields 18 contiguous blocks, five of them already marked with `// =====` banners:

| # | domain | lines | ~size |
| --- | --- | --- | --- |
| 1 | env-file loading | 46–101 | 56 |
| 2 | listening-mode primitives (timers, listener plumbing, boundary driver) | 102–378 | 277 |
| 3 | renderer bridge, transcripts, canvas wiring | 379–499 | 121 |
| 4 | session store, workstreams, agent roster and models | 500–905 | 405 |
| 5 | voice announcements, workspace info | 906–1052 | 147 |
| 6 | binary resolution, health probes | 1053–1279 | 227 |
| 7 | env flags, user config, settings, token, key test, voice preview | 1280–1584 | 305 |
| 8 | run activity and stream events | 1585–1667 | 83 |
| 9 | install, scaffold, agent snapshot | 1668–1966 | 299 |
| 10 | notes vault, second brain | 2058–2196 | 139 |
| 11 | run start: DEV and PO | 1967–2057, 2197–2506 | 401 |
| 12 | task review, dispatch, Gemini tool implementations | 2507–2944 | 438 |
| 13 | Gemini tool declarations, system-instruction text | 2945–3281 | 337 |
| 14 | Live session connect, reconnect, message handling | 3282–3564 | 283 |
| 15 | listening-mode sequences | 3565–3713 | 149 |
| 16 | audio and command ingress | 3714–3770 | 57 |
| 17 | window, HUD, tray, menu, hotkeys | 3771–3980 | 210 |
| 18 | `app.whenReady()` startup sequence, IPC registration, shutdown | 3981–4297 | 317 |

Block 18 is not one thing, and an earlier draft of this design wrongly treated it as "IPC registration + shutdown" and routed all 312 lines to `ipc.mjs`. Read against the code it decomposes as:

| lines | content | destination |
| --- | --- | --- |
| 3982–3995 | platform refusal gate, dock icon, `installAppMenu()` | `main.mjs` startup |
| 3998–4005 | `probePipelineAvailability()`, `probeSecondBrainAvailability()` | `main.mjs` startup |
| 4018–4028 | `app.on("web-contents-created")` navigation containment | `renderer-security.mjs` |
| 4029–4033 | `session.defaultSession.setPermissionRequestHandler` (D10) | `renderer-security.mjs` |
| 4044–4231 | the 47 `ipcMain` registrations — **~188 lines, not 317** | `ipc.mjs` |
| 4232–4259 | `createWindow()`, `createTray()`, 3 × `globalShortcut.register`, `app.on("activate")` | `main.mjs` startup |
| 4267–4297 | `shutdownTeardown`, `will-quit`, `before-quit`, `window-all-closed` | `main.mjs` |

Routing the two security registrations into `ipc.mjs` would bury the entire implementation of the `renderer-content-security` capability inside a module whose declared responsibility is the renderer↔main channel surface — violating the principle this change exists to enforce, and hiding security code where nobody would look for it. See D7.

This is not spaghetti. It is 18 modules that were never given filenames, which makes the split mechanical rather than a rewrite.

**2. Electron coupling is already concentrated.** Counting references to `electron.*`, `app.`, `dialog.`, `BrowserWindow`, `shell.`, `globalShortcut`, `Tray`, `Menu`, `nativeImage`, `systemPreferences`, `ipcMain` per block:

| block | Electron refs |
| --- | --- |
| 18 `whenReady` / IPC | **71** |
| 17 window / HUD / tray | **17** |
| 1 bootstrap | 4 |
| 14 live session | 2 |
| 5 announce, 7 config, 16 audio | 1 each |
| 4, 6, 8, 9, 10, 11, 12, 13, 15 | **0** |

Nine domain blocks already touch no Electron API. The five stragglers are single call sites. Confining Electron to four files is therefore a small amount of work, not an architectural inversion.

**3. There are 25 module-level `let` bindings plus the `ListenMode` and `GreetGate` const objects.** These are what actually weld the file together, and how they are handled is the central decision.

**4. `main.mjs` reports 20 errors at the `electron/` typecheck floor** (`checkJs: true, strict: false` plus the six zero-cost strict-family flags), all of which `add-electron-test-signal` clears before this change starts. So this change inherits no typing debt — see D5. (At `strict: true` the figure is 376, 46% of the directory's 822; that is the same concentration the line count shows, measured differently, but it is not a cost this change pays.)

**5. Features arrive as vertical slices, not horizontal layers.** Mapping each recent feature commit's touched functions onto the proposed modules:

| commit | modules it would touch |
| --- | --- |
| harden security boundaries | 10 |
| pre-dispatch prompt review gate | 8 |
| canvas-claude-mcp | 7 |
| second-brain galaxy | 6 |
| HUD drawing canvas | 4 |
| personal-knowledge-notes | 3 |

Five of six touched `app.whenReady()`. Every feature in this codebase adds the same slice: a tool declaration, a prompt fragment, an IPC channel, some state, a probe, and run wiring. A purely layered decomposition cuts across all six every time — see D10.

## Goals / Non-Goals

**Goals:**

- ~17 modules of 150–450 lines; `main.mjs` a ~150–250-line composition root.
- Every domain module Electron-free, hence importable and testable with no harness.
- Every extracted module lands with its own test.
- Zero observable behavior change; every existing capability spec still true, unedited.

**Non-Goals:**

- Improving, simplifying, or fixing anything. This is a move. A latent bug noticed in passing gets recorded, not fixed — mixing a fix into a 4000-line move makes both unreviewable.
- Any typing work. The `electron/` typecheck floor established by `add-electron-test-signal` covers every module this change creates, automatically — see D5. Raised-strictness flags stay deferred.
- Touching `src/`, `preload.cjs`, or the 13 existing `electron/` modules beyond adjusting import paths.
- Splitting `preload.cjs`, `canvas-mcp.mjs` (557) or any renderer file. Separate follow-ups.

## Decisions

### D1 — Module boundaries follow the 18 domains, adjusted by the capability tier (D10)

Target ~17 modules. Derived from the domain table by merging blocks below the 250 floor and splitting those above the 450 ceiling:

**Tier 1 — stateless, Electron-free, near-zero risk (~1400 lines)**

| module | from blocks | ~size |
| --- | --- | --- |
| `gemini-tools.mjs` | 13 (core declarations; composes capability contributions) | ~180 |
| `gemini-prompts.mjs` | 13 (core instruction text; splices capability fragments) | ~180 |
| `pipeline-install.mjs` | 9 | 300 |
| `pipeline-probes.mjs` | 6 | 226 |
| `user-config.mjs` | 1 + 7 | 305 |

Block 13 splits because 360 exceeds the ceiling and the seam is natural: tool *schemas* and tool *prose* are separate concerns that change for different reasons.

**Tier 2 — stateful, Electron-free (~1450 lines)**

| module | from blocks | ~size |
| --- | --- | --- |
| `session-store.mjs` | 4 (store, workstreams, agent models) | 410 |
| `run-exec.mjs` | 11 | 400 |
| `run-dispatch.mjs` | 8 + 12 | 380 |
| `announcements.mjs` | 5 | 150 |
| `renderer-bridge.mjs` | 3 | 120 |

Block 4 stays whole at 410 — under the 450 ceiling, and splitting workstream CRUD from agent-model selection would separate state from its only mutators. Block 8 (82, below the floor) merges into 12: run activity events and run dispatch are the same lifecycle.

**Tier 3 — the Electron edge (~1250 lines)**

| module | from blocks | ~size |
| --- | --- | --- |
| `listen-mode.mjs` | 2 + 15 | 420 |
| `live-session.mjs` | 14 + 16 | 315 |
| `window.mjs` | 17 (minus `isAppOwnDocument`) | ~200 |
| `ipc.mjs` | 18 (registrations only) | ~187 |
| `renderer-security.mjs` | 18 (the two security registrations) + 3767–3773 | ~60 |

**Capability tier — vertical slices under `electron/capabilities/` (D10)**

| module | from blocks | ~size |
| --- | --- | --- |
| `capabilities/canvas.mjs` | 3 + 13 + 18 + teardown | ~180 |
| `capabilities/second-brain.mjs` | 10 + 13 + 18 + teardown | ~230 |

These pull their content *out* of the layer modules above, which is why `gemini-tools`, `gemini-prompts`, `renderer-bridge` and `ipc` are smaller here than a purely layered split would make them, and why `notes-vault.mjs` no longer exists as a separate layer module — it was capability code all along.

Note for the import-graph test: candidates must be discovered as `electron/**/*.mjs`, not `electron/*.mjs`, or the capability subdirectory escapes coverage entirely.

Blocks 2 and 15 merge to one 420-line `listen-mode.mjs` rather than splitting primitives from sequences — the sequences are the only caller of the primitives, and the boundary-rotation invariant is easier to verify in one place. (`listen-boundary.mjs` already exists and stays as-is.)

`isAppOwnDocument` and its two constants `APP_DEV_URL`/`APP_PACKAGED_URL` sit at lines 3767–3773, which the block table places in block 17, but both of their consumers are the block-18 security handlers. They move to `renderer-security.mjs`, not `window.mjs`.

`main.mjs` retains: imports, the wiring block, the `app.whenReady()` startup sequence (platform gate, dock icon, menu, availability probes, security-handler registration, `createWindow()`, `createTray()`, hotkey registration, `activate`), `shutdownTeardown`, and the `will-quit`/`before-quit`/`window-all-closed` handlers. ~180–230 lines.

### D2 — Injection with per-module state ownership, never a shared state module

Those bindings are assigned to exactly one owning module each:

| owner | state |
| --- | --- |
| `live-session.mjs` | `liveSession`, `ai`, `liveStatus`, `resumptionHandle`, `userStopped`, `reconnectAttempts`, `reconnectTimer`, `speakerMuted`, `GreetGate` |
| `listen-mode.mjs` | `turnCompleteListeners`, `freshHandleListeners`, `liveCloseListeners`, listen-engaged flag, rotation timer |
| `renderer-bridge.mjs` | `userTranscriptBuffer`, `modelTranscriptBuffer`, `irisUiContext`, `pendingCanvasImageRequests`, `canvasEngaged` |
| `announcements.mjs` | `pendingClaudeAnnouncements` |
| `session-store.mjs` | `sessionStore` |
| `pipeline-probes.mjs` | `pipelineAvailable` |
| `user-config.mjs` | `promptReviewMode`, `previewSession` |
| `capabilities/second-brain.mjs` | `secondBrainAvailable` |
| `window.mjs` | `mainWindow`, `uiMode`, `deckBounds`, `tray` |
| `main.mjs` | `shuttingDown` |

Each owner exposes accessors; nothing else reaches the binding directly.

*Alternative considered*: one `state.mjs` that every module imports. Rejected. It is faster and requires almost no thought, and it would satisfy the 450-line convention — which is exactly what makes it dangerous. It preserves the god-object as a global, so the 17 modules remain mutually coupled and none can be tested without stubbing the state module. It would produce a `wc -l` that looks like success and change nothing real.

*Alternative considered*: an event bus. Rejected — no precedent in this repo, and it is a rewrite rather than a move, which is the wrong risk profile for untested code.

### D3 — All 47 handlers in one `ipc.mjs`

*Alternative considered, and it is the intuitive one*: each module exports `registerIpc(ipcMain)` so the handler sits beside the function it calls. Rejected, because it makes all 17 modules import Electron, discarding the entire finding that nine domain blocks are already Electron-free. Nine modules that need no harness would each need an Electron stub. Feature cohesion is not worth that.

*Alternative considered*: an `electron/ipc/` directory split by domain. Rejected — 17 files averaging ~13 lines, all far below the 250 floor, and the channel surface stops being readable in one place. Its value is that it is diffable against `preload.cjs`.

`ipc.mjs` at ~187 lines has one genuine responsibility: the renderer↔main channel surface. It marshals arguments and delegates; it holds no logic.

### D4 — Tier ordering, and why tier 1 goes first

Tier 1 is ~1400 lines that are stateless and Electron-free. Moving them cannot break state ownership, cannot break Electron wiring, and each lands with a test immediately. It is a third of the file at near-zero risk, and it proves the injected-factory pattern before anything stateful moves. Tier 2 introduces state ownership. Tier 3 touches the Electron edge and the IPC surface, and goes last because a mistake there is the most user-visible.

Within each tier, one module per commit, both gates green before the next. The file shrinks monotonically: 4297 → ~2900 after tier 1 → ~1450 after tier 2 → ~250 after tier 3 → ~200 after the capability tier.

### D5 — No typing work in this change; the floor covers every module automatically

An earlier draft of this design carried a large problem here: it assumed `main.mjs` held 376 type errors that would travel with its code into the new modules, forcing a choice between clearing them mid-refactor (destroying reviewability — a reviewer could no longer tell a moved line from a changed one) and deferring a `// @ts-check` pragma for 9 of 17 modules.

That problem no longer exists. It was an artifact of `add-electron-test-signal` originally proposing `strict: true`. That change now sets the `electron/` typecheck floor at `checkJs: true, strict: false` plus six zero-cost strict-family flags, where **`main.mjs` has 20 errors, not 376** — and clears them itself.

**Decision**: no typing work in this change, and no per-module opt-in step. `tsconfig.electron.json`'s include glob covers `electron/**/*.mjs`, so every module this change creates is type-checked from the moment the file exists. The build fails if a move introduces a type error, which is exactly the signal wanted, at zero planning cost.

Two consequences worth stating. A module that lands with a type error blocks the commit rather than accruing debt — treat that as the gate working, and fix the move rather than suppressing it. And because the floor includes `noUnusedLocals`, a function left behind in `main.mjs` after its callers moved away will fail the build, which is a useful accident: it catches incomplete moves.

The raised-strictness flags (`strictNullChecks` +91, `useUnknownInCatchVariables` +26, `noImplicitAny` +719, measured pre-split) remain deferred and out of scope. `strictNullChecks` would be genuinely valuable on `live-session.mjs` and `window.mjs`, where a gone window and a mid-reconnect session are the classic null bugs — recorded as a follow-up, not attempted here.

### D6 — The hoisting hazard: `runQueue` wiring must become late-bound

This is the one place the split is not mechanical, and it is easy to miss. `main.mjs:529` constructs the run queue at module scope:

```js
const runQueue = createRunQueue({ startRun: startClaudeRun, ... })
```

with an in-file comment noting that `startClaudeRun` and `announceClaudeCompletion` "are function declarations defined later in this file; referencing them here is safe because they're hoisted before this line ever runs."

**That guarantee is a property of being in one file, and it disappears the moment they are in different modules.** `startClaudeRun` moves to `run-exec.mjs`, `announceClaudeCompletion` to `announcements.mjs`, and the wiring becomes a genuine circular import: `run-dispatch` → `run-exec` → `announcements` → `live-session` → (tool calls) → `run-dispatch`. Under ESM the cycle resolves to `undefined` bindings at evaluation time rather than a clean error, so this would fail at runtime, intermittently, in the run pipeline.

**Decision**: the queue is constructed in `main.mjs`'s wiring block, after all modules are imported, and every collaborator is passed as a thunk or accessor (`() => runExec.startRun(...)`) rather than a direct function reference. Late binding through injection breaks the cycle structurally — which is a second, independent argument for D2 over a shared state module.

This must be handled in the *first* tier-2 commit that touches `run-exec` or `announcements`, and it is the single highest-risk step in the change.

### D7 — Renderer security gets its own module, and its registration order is a stated contract

The `renderer-content-security` capability's implementation is currently two registrations inside `app.whenReady()` plus the `isAppOwnDocument` predicate they share.

**Decision**: a dedicated `electron/renderer-security.mjs` (~60 lines) owning `APP_DEV_URL`, `APP_PACKAGED_URL`, `isAppOwnDocument`, the `web-contents-created` navigation containment, and `session.defaultSession.setPermissionRequestHandler`. It exports one `installRendererSecurity()` that `main.mjs` calls during startup.

It is below the 250-line floor, deliberately. The same argument as `renderer-bridge.mjs` applies with more force: a security boundary that has its own capability spec should be locatable in exactly one file, and folding it into `window.mjs` would give that module two responsibilities while making the capability harder to find. Naming the file after the capability is the point.

**The ordering is the dangerous part, and it must be stated rather than inherited.** Today `web-contents-created` registers at line 4018 and `setPermissionRequestHandler` at 4035, while `createWindow()` is called at 4232 — 200 lines later in the same `.then()`. Lexical position guarantees the order for free. After the split it becomes a call-order contract in `main.mjs`'s startup sequence, and **getting it wrong fails silently**: `web-contents-created` registered after `createWindow()` never fires for the app's only window, leaving it with no navigation containment and no evidence of the fact.

That is not a theoretical concern here. The code comment at line 4002 records why the app-wide handler replaced the old per-window pair: the galaxy view renders genuinely untrusted note content (wiki-ingest pulls web articles and PDFs into the vault), and react-markdown turns `[text](https://…)` into a real anchor — so without containment, clicking one top-level-navigates the window *carrying `preload.cjs`* to a remote origin. Neither gate catches it and no smoke step reaches it.

**Therefore**: `installRendererSecurity()` is called before `createWindow()` in `main.mjs`, that ordering carries a comment stating the failure mode, and the requirement is written into the spec so a later reorder is a spec violation rather than a silent regression.

### D8 — Teardown stays centrally ordered in `main.mjs`, not self-registered per module

`shutdownTeardown` orchestrates six modules in a deliberate sequence: `stopLive()`, then group-kill every DEV child via `runQueue.list()`, then `closeAllPoSessions()`, then `canvasStore.flush()`, then `canvasMcp.stop()`, then `notesVaultGraph.stop()`.

**Decision**: `main.mjs` keeps `shutdownTeardown` and calls each core module's teardown explicitly, in that order, then runs the capability teardowns as a group.

That refinement is safe because it matches the existing order: the last three steps — canvas flush, canvas MCP stop, vault-graph stop — are exactly the capability teardowns, they already run last, and they are mutually independent. So capability teardowns occupy a fixed position in the sequence while their order *within* the group is registration order, which nothing depends on. The core sequence, where order does matter, stays explicit.

*Alternative considered*: each module registers its own teardown hook with a lifecycle registry, so ownership follows state ownership as it does everywhere else in D2. Rejected — it makes execution order incidental to registration order, and the order here is load-bearing (Live is stopped before children are killed; the canvas is flushed before exit so a quit-while-drawing does not lose strokes, per `hud-drawing-canvas` D5). The `app-shutdown` capability's bounded-teardown requirement also depends on the whole sequence racing a single deadline, which is easier to guarantee from one place.

This is the one deliberate exception to D2's "state is owned by the module whose responsibility it is". Each module still owns its own stop/flush function; only the *ordering* is central.

### D9 — Global shortcuts are registered by `main.mjs`, not by `window.mjs`

Hotkey handling currently spans three future modules: `hudHotkey()`/`muteHotkey()`/`listenHotkey()` are defined in block 17 (`window.mjs`), the registrations live in block 18, the callbacks reach into `listen-mode.mjs` and `renderer-bridge.mjs`, and `globalShortcut.unregisterAll()` sits on `will-quit` in what becomes `main.mjs`.

**Decision**: the three `globalShortcut.register` calls live in `main.mjs`'s startup sequence, beside the `unregisterAll()` they pair with. `window.mjs` keeps the hotkey-string accessors, which are configuration readers, not registrations.

Registration is wiring — it binds a key to a callback that crosses three modules — and wiring is the composition root's job. Splitting register from unregister across two files was the incoherence worth fixing here.

### D10 — Hybrid decomposition: a layered core plus capability modules

M5 exposes a mismatch that a purely layered split would bake in. The unit of change here is a *capability*, but the proposed modules are *layers*, so every future feature would touch six of them.

The consequence is worse than friction. Today a feature adds ~180 lines to one file, and after twelve of them somebody noticed a 4287-line file. Under a purely layered split the same feature adds ~30 lines to each of six files: the accretion continues at exactly the same rate, but no file trips the 450-line convention for years. **The split would destroy the signal that detected the problem without stopping the problem** — and with enforcement being convention-only (D6), that signal is the only detector there is.

**Decision**: a hybrid. A layered *core* — the machinery every capability shares — plus *capability modules* under `electron/capabilities/`, each owning its slice end to end.

A capability module owns its own tool declarations, its prompt fragment, its IPC channel handlers, its state, its availability probe, and its teardown. It exports one factory returning those contributions:

```js
export function createCanvasCapability(deps) {
  return { toolDeclarations, promptFragment, ipcHandlers, probe, teardown }
}
```

The core composes them: `gemini-tools.mjs` concatenates core declarations with each capability's, `gemini-prompts.mjs` splices in each fragment, `ipc.mjs` registers core channels then iterates capability handlers, and `main.mjs`'s teardown runs the core sequence then the capability teardowns.

**Which code is genuinely capability-shaped** — verified by locating it in `main.mjs`, where each is already scattered across what would have been four separate layer modules:

| capability module | currently scattered across | ~size |
| --- | --- | --- |
| `capabilities/canvas.mjs` | `requestCanvasImage`, `maybeStartCanvasMcp`, `ensureCanvasMcpForRun`, `canvasEngaged`, `pendingCanvasImageRequests` (block 3), canvas tool declarations (13), `canvas:*` IPC (18), canvas flush in teardown | ~180 |
| `capabilities/second-brain.mjs` | `checkNotesSkillsStatus`, `ensureNotesVaultReady`, `renderNotesVaultConfig`, `vaultChangedSince`, `probeSecondBrainAvailability`, `secondBrainAvailable` (block 10), notes tool declarations (13), `secondbrain:*` IPC (18), vault-graph stop in teardown | ~230 |

`listen-mode.mjs` is also capability-shaped (it *is* the `listening-mode` capability) but stays in the core tier because of its entanglement with the Live session — see D11. Everything else — the Live session, the run pipeline, the session store, config, window — is genuinely core: shared machinery no single capability owns.

This maps the module layout onto `openspec/specs/`, which is already organized by capability. "Which module implements `canvas-claude-mcp`?" gains an answer, and a future capability lands in one new file plus a one-line registration rather than edits to six modules.

*Alternative considered*: pure capability decomposition, deriving every boundary from the spec list. Rejected — the Live session, run queue and session store are shared by every capability and would have to live somewhere anyway; forcing them into a capability shape would invent boundaries that do not exist.

*Alternative considered*: keep the pure layering and accept the mismatch. Rejected for the signal-destruction reason above.

**Cost, stated honestly**: two more modules, one more concept (the capability contract), and a composition step in three core modules that would otherwise be plain constants. Worth it because it is the only part of this plan that makes regrowth *self-limiting* rather than merely relocated.

### D11 — `live-session` and `listen-mode` stay separate, but their coupling must be converted, not moved

These two are the one place the split cannot be a verbatim move. Verified in code:

- `ListenMode` is already a `const` object (line 109) with 63 references — so the state is at least namespaced, and mechanical extraction is easier than for the 26 loose bindings.
- But `handleLiveMessage` *reads* `ListenMode.engaged`/`.transitioning`/`.boundaryInFlight`/`.segmentRecord` at six interleaved points, and `connectLive` *writes* `ListenMode.deliberateReconnect`, `.transitioning`, `.boundaryInFlight`, `.segmentRecord` and `.synthesizeOnNextConverseConnect` (lines 3370–3423).

So the Live session currently drives the listening-mode state machine by direct field assignment. That violates D2's rule that state has exactly one owning module, and moving the code verbatim would carry the violation across a module boundary, where it is harder to see rather than easier.

**Decision**: keep them as two modules, and convert live-session's raw field writes into named transitions on listen-mode's interface — e.g. `listenMode.consumeDeliberateReconnect()`, `listenMode.captureSegmentForSynthesis()`, `listenMode.settleBoundary()`. Reads stay reads through an accessor.

This is a *deepening*, in the same vocabulary the archived `architecture-deepening-refactors` change used for `PendingQuestion`: eight scattered field mutations become three or four named state transitions owned by the module whose invariant they belong to. It is the house pattern, applied to the one seam that needs it.

**It is also the only task in this change that is not behavior-preserving by construction**, so it needs its own commit, its own test coverage of each transition, and review attention that the mechanical moves do not.

*Alternative considered*: merge them into one 735-line module. Rejected — it exceeds the 450 ceiling by 60% and would be the largest file in `electron/`, recreating in miniature the problem this change exists to fix.

## Risks / Trade-offs

**[ESM circular imports resolving to `undefined` instead of erroring]** — D6's `runQueue` hazard is not the only cycle. A second one is confirmed in the code: `live-session` → `run-dispatch` (`handleToolCall` calls `executeClaudeTool`) → `announcements` (`announceClaudeCompletion`) → `live-session` (`notifyIris` reads `liveSession`). And `notifyIris` also reads `ListenMode`, so `announcements` depends on `listen-mode` as well. Three modules and a back-edge, none of it visible as a cycle today because it is all one file. → Mitigated structurally: every cross-module reference among the tier-2, tier-3 and capability modules is an injected accessor resolved in `main.mjs`'s wiring block, never a top-level import of one another. Enforce by review — a domain module importing another domain module for a *runtime value* (as opposed to a pure helper) is the smell to reject — and note that the demand-side graph check from `add-electron-test-signal` will make any such import visible in `main.mjs`.

**[The composition root becomes the new dumping ground]** — Wiring 17 modules with injected accessors could push `main.mjs` well past 250 and recreate the problem in a new shape. → Watch it per commit; if wiring alone exceeds ~250, extract a `wiring.mjs` that `main.mjs` calls. Explicitly permitted, not a failure.

**[Behavior change hidden in a 4000-line diff]** — → One module per commit, both gates green each time, and the moved code kept verbatim including comments. A reviewer should be able to confirm a commit is a pure move. This is also why D5 defers typing on tiers 2 and 3.

**[No test covers the wiring itself]** — The import-graph test proves every module exists and exports what callers expect; nothing proves `main.mjs` wires them correctly, and D6 is precisely a wiring bug. → Accepted, with two mitigations. The manual smoke path in the spec is broad and specifically includes the cold paths (reconnect, listen rotation, quit). And after this change `main.mjs` is ~200 lines and `ipc.mjs` a flat registration list, making the deferred vitest Electron-stub harness cheap — recorded as the natural follow-up, exactly as `add-electron-test-signal`'s D4 anticipated.

**[Cold paths remain unexercised]** — `scheduleReconnect`, `runListenRotation`, `shutdownTeardown` and the session-store quarantine branch are the likeliest places for a silent break and the hardest to trigger by hand. → Their owning modules (`live-session`, `listen-mode`, `session-store`) must have tests covering these specific paths, not just happy paths. Called out per module in tasks.

**[Startup ordering regressions fail silently]** — D7's hazard is the sharpest case, but the whole `whenReady` sequence has implicit ordering: the platform gate must run before anything else (it calls `app.quit()`), `installAppMenu()` before the window shows, security registration before `createWindow()`, and `createTray()` after the icon is resolved. Lexical order in one function currently makes all of this free; a composition root makes it explicit but also reorderable. → Keep the startup sequence as one clearly-commented function in `main.mjs` rather than scattering it across wiring, and state the security-before-window ordering in the spec so it is enforceable. Verification is manual: the smoke path must include clicking an external link in the galaxy view and confirming it opens in the OS browser rather than navigating the window.

**[Packaging needs no change, which is easy to assume wrongly in either direction]** — `package.json`'s `build.files` is `["dist/**", "electron/**", "!electron/**/*.test.mjs", "build/icon.png", …]`, so all ~15 new modules are packaged automatically and no build config edit is required. → Verified. The inverse trap is worth noting: any non-test helper file added under `electron/` also ships, so the graph test's vitest project config must not live there under a non-`.test.mjs` name.

**[Docs drift]** — `CLAUDE.md`, `docs/ARCHITECTURE.md` and `docs/PIPELINE_INTERNALS.md` all point at `main.mjs` for behavior that will have moved. → Docs updates are tasks in the final group, not an afterthought. `CLAUDE.md`'s "the heart of the system… lives almost entirely in `electron/main.mjs`" is false after this change and must be rewritten.

## Migration Plan

No data or config migration; no user-visible surface changes. Sequencing is the plan: `add-electron-test-signal` lands first, then tier 1 → tier 2 → tier 3, one module per commit with both gates green.

Rollback is per commit. Because each commit moves one module and changes no behavior, reverting any single commit restores the prior state without touching the others — a property worth preserving, so commits must not be squashed into one.

Verification: both gates green after every commit; the import-graph test covering all new modules; and the full manual smoke path from the spec before the change is archived.

## Open Questions

- Does `renderer-bridge.mjs` at ~120 lines justify its own file, or should it merge into `live-session.mjs`? It is below the 250 floor. Argument for keeping it separate: `emitToRenderer` is called by nearly every module, so folding it into `live-session` would make every module depend on the Live session. Leaning separate, and treating the floor as a guideline here — a widely-injected primitive is legitimately small.
- Whether `gemini-prompts.mjs` should be `.mjs` at all, or plain text/template files loaded at startup. Prose in a JS file is awkward to review and diff. Deferred — a behavior-neutral improvement that would add file-loading risk to a change that should stay a pure move.
- Whether the tier-3 `ipc.mjs` commit should be split further (e.g. registration moved in two halves) given it is the most user-visible step. Decide when reached, with the actual diff in hand.
