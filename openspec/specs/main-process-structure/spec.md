## Purpose

Defines how the Electron main process is organized: a set of narrow, single-responsibility modules under `electron/`, with Electron API access confined to a composition root, an IPC registrar, a window module, and a renderer-security module, so that all domain logic is importable and testable without booting Electron. Also defines how capability-specific main-process code (its Gemini tool declarations, prompt fragment, IPC handlers, state, probe, and teardown) is gathered into one module per capability under `electron/capabilities/`, composed by the core modules rather than hardcoded into them. Parallels the existing `renderer-structure` capability, which established the same discipline for `src/`.

## Requirements

### Requirement: The main process is a set of single-responsibility modules

The Electron main process SHALL be organized as a set of modules under `electron/`, each holding one responsibility. `electron/main.mjs` SHALL act solely as a composition root — importing modules, wiring their injected dependencies, and starting the app — and SHALL NOT contain domain logic.

No module created or rewritten by this reorganization SHALL exceed 450 lines. The repo's 250-line lower bound is guidance, not a requirement: a module that is genuinely one small thing — a security boundary, a widely-injected primitive, a registration list — is permitted to sit below it, and several deliberately do.

`*.test.mjs` files are exempt. `electron/canvas-mcp.mjs` (557 lines) is a recorded pre-existing exception: it is untouched by this change and its split is an explicit non-goal, tracked as a follow-up.

#### Scenario: main.mjs is a composition root

- **WHEN** the split is complete
- **THEN** `electron/main.mjs` contains only imports, dependency wiring, app lifecycle hookup, and the startup call, and no session-store logic, run dispatch, Gemini tool declarations, prompt text, health probing, or install/scaffold logic

#### Scenario: Every module this change touches is within the ceiling

- **WHEN** the line count of each non-test module created or rewritten by this reorganization is measured
- **THEN** none exceeds 450 lines, and any file below 250 lines has a stated reason

#### Scenario: Each module has one responsibility

- **WHEN** a reader opens any module under `electron/`
- **THEN** its purpose is stated in a header comment and every exported function serves that single purpose

### Requirement: Capability-specific code lives in one module per capability

Main-process code that belongs to a single capability — its Gemini tool declarations, its system-prompt fragment, its IPC handlers, its state, its availability probe and its teardown — SHALL live together in one module under `electron/capabilities/`, named for that capability, rather than being distributed across the layered core modules.

Core modules SHALL compose these contributions rather than hardcode them: the tool-declaration module concatenates capability declarations, the prompt module splices capability fragments, the IPC module registers capability handlers alongside core channels, and the teardown routine runs capability teardowns as a group.

This exists so that adding a capability means adding one module and one registration, not editing six. Where a capability has a corresponding spec under `openspec/specs/`, the module SHALL be discoverable from that capability's name.

#### Scenario: A capability's main-process code is in one place

- **WHEN** a reader looks for the main-process implementation of the canvas or the second-brain vault
- **THEN** its tool declarations, prompt fragment, IPC handlers, state, probe and teardown are all in that capability's module, and none of them is defined in a core layer module

#### Scenario: Core modules compose rather than enumerate

- **WHEN** the tool-declaration module or the prompt module is read
- **THEN** it contains the core contributions plus a composition step over registered capabilities, and no capability-specific declaration or prose is hardcoded in it

#### Scenario: Adding a capability touches one module

- **WHEN** a new capability with main-process behavior is added after this change
- **THEN** it can be implemented as one new module under `electron/capabilities/` plus a single registration in the composition root, without editing the tool, prompt, or IPC modules

#### Scenario: Capability modules are covered by the module graph

- **WHEN** the import-graph test discovers modules
- **THEN** it searches `electron/**/*.mjs` so modules in the capabilities subdirectory are covered, and its expected-count guard accounts for them

### Requirement: Shared state has exactly one writing module

State owned by one module SHALL NOT be mutated directly by another. Where a module currently drives another module's state by direct field assignment, the split SHALL convert those assignments into named transition operations exposed by the owning module.

#### Scenario: The Live session does not write listening-mode state

- **WHEN** the Live session's connect or message-handling path needs to affect listening-mode state
- **THEN** it calls a named transition on the listening-mode module rather than assigning to its fields, and the listening-mode module remains the only writer of its own state

#### Scenario: Each transition is covered

- **WHEN** a named transition replaces a direct field assignment
- **THEN** a test exercises that transition, since this conversion is not a behavior-preserving move by construction

### Requirement: Electron API access is confined to the composition root, IPC, window and security modules

Only `electron/main.mjs`, `electron/ipc.mjs`, `electron/window.mjs` and `electron/renderer-security.mjs` SHALL import from the `electron` package or otherwise touch Electron APIs (`app`, `BrowserWindow`, `ipcMain`, `session`, `dialog`, `Tray`, `Menu`, `globalShortcut`, `shell`, `nativeImage`, `systemPreferences`). Every other module under `electron/` SHALL be free of Electron dependencies and SHALL receive any Electron-derived capability it needs as an injected dependency.

Note that `process.resourcesPath` is not an Electron import and does not make a module Electron-dependent, whereas `app.isPackaged` and `app.getPath` do — a module needing the latter receives it injected.

`electron/preload.cjs` is out of scope for this rule — it is a preload script and necessarily imports Electron.

#### Scenario: Domain modules import no Electron

- **WHEN** the source of any module under `electron/` other than `main.mjs`, `ipc.mjs`, `window.mjs`, `renderer-security.mjs` and `preload.cjs` is inspected
- **THEN** it contains no import of the `electron` package and no reference to an Electron API

#### Scenario: An Electron capability reaches a domain module by injection

- **WHEN** a domain module needs to show a native dialog, emit to the renderer, or read an app path
- **THEN** it receives that capability as an injected function parameter, and a test can substitute a fake for it

#### Scenario: Domain modules import without Electron present

- **WHEN** the import-graph test runs in a plain Node environment
- **THEN** every domain module under `electron/` imports successfully and no Electron process is created

### Requirement: Renderer security is one named module, installed before any window exists

The navigation containment and device-permission scoping that implement the `renderer-content-security` capability SHALL live in a single module named for that concern, together with the predicate that decides whether a URL is the app's own document. They SHALL NOT be placed in the IPC registration module, whose responsibility is the renderer↔main channel surface.

`main.mjs` SHALL install them before it creates any `BrowserWindow`. This ordering is required, not incidental: an `app.on("web-contents-created")` handler registered after a window is created never fires for that window, leaving it without navigation containment and producing no error, no failing test, and no log entry.

#### Scenario: Security code is locatable in one module

- **WHEN** a reader looks for the app's navigation containment or device-permission scoping
- **THEN** both are in one module named for renderer security, along with the app's-own-document predicate, and neither appears in the IPC registration module

#### Scenario: Security is installed before the first window

- **WHEN** `main.mjs`'s startup sequence runs
- **THEN** the renderer-security installation call precedes the first `BrowserWindow` construction, and the ordering carries a comment stating that reversing it fails silently

#### Scenario: Containment still holds for the main window

- **WHEN** a link to an external origin is activated in the renderer, including untrusted note content rendered by the galaxy view
- **THEN** the window does not navigate, and the URL opens in the OS browser instead

#### Scenario: Device permissions stay scoped

- **WHEN** a permission request arrives from any document that is not the app's own
- **THEN** it is denied, and microphone, camera and other media permissions are granted only to the app's own document

### Requirement: Shutdown teardown remains centrally ordered

`main.mjs` SHALL retain one teardown routine that invokes each module's stop or flush operation in an explicit order. Modules SHALL NOT self-register teardown hooks whose execution order depends on registration order.

Each module SHALL still own its own stop or flush implementation; only the sequencing is central. The existing bounded-teardown behavior required by the `app-shutdown` capability — the whole sequence racing a single deadline before `app.exit` — SHALL be preserved.

#### Scenario: Teardown order is explicit

- **WHEN** the app quits
- **THEN** the Live session is closed, then every live DEV child is group-killed, then resident PO sessions are closed, then the canvas is flushed, then the canvas MCP listener and the vault watcher stop — in that order, from one routine

#### Scenario: Teardown stays bounded

- **WHEN** a teardown step hangs
- **THEN** the shutdown deadline still fires and the app exits, as it did before the split

#### Scenario: Quit during an active run kills the process group

- **WHEN** the app quits while a DEV run is active
- **THEN** the detached child's process group is signalled, leaving no orphaned tool subprocess

### Requirement: All renderer IPC registration lives in one module

Every `ipcMain.handle` and `ipcMain.on` registration SHALL live in `electron/ipc.mjs`. That module SHALL contain registration and argument marshalling only, delegating all behavior to the domain modules it imports.

Keeping the registrations in one file makes the renderer↔main channel surface readable in one place and diffable against `electron/preload.cjs`, which declares the matching `window.iris` surface.

#### Scenario: No handler is registered elsewhere

- **WHEN** the source of every file under `electron/` is searched for `ipcMain.handle` and `ipcMain.on`
- **THEN** all matches are in `electron/ipc.mjs`

#### Scenario: The channel surface matches the preload surface

- **WHEN** the channel names registered in `electron/ipc.mjs` are compared against those exposed by `electron/preload.cjs`
- **THEN** every channel the preload script invokes has a corresponding registration, and no registration is unreachable from the preload surface

#### Scenario: Handlers hold no logic

- **WHEN** a handler in `electron/ipc.mjs` is read
- **THEN** it validates or unpacks its arguments and calls into a domain module, without implementing the behavior inline

### Requirement: Modules expose dependencies by injection, not shared mutable state

An extracted module SHALL receive its collaborators and its access to mutable state as injected parameters — typically through a factory function returning the module's interface, matching the pattern established by `createRunQueue`, `createCanvasStore`, `createCanvasMcp` and `createVaultGraph`.

There SHALL NOT be a shared mutable application-state module that other modules import in order to read or write process-wide state. State SHALL be owned by the module whose responsibility it belongs to, and reached from elsewhere through an injected accessor.

#### Scenario: A module owns its own state

- **WHEN** the session store, the Live session handle, or the listening-mode engagement flag is located
- **THEN** each is owned by exactly one module, and no other module reads or writes it except through that module's interface

#### Scenario: No global state module exists

- **WHEN** the modules under `electron/` are inspected
- **THEN** none exists whose purpose is to hold mutable state for other modules to import

#### Scenario: A test drives a module with fakes

- **WHEN** a test constructs an extracted module supplying fake collaborators
- **THEN** the module drives the fakes, no production dependency is loaded, and no Electron or subprocess is created

### Requirement: Every extracted module is covered by tests

Each module extracted from `main.mjs` SHALL land with its own `.test.mjs` file asserting the behavior it owns, and SHALL be covered by the import-graph test established by the `test-harness` capability.

Tests SHALL assert existing behavior only. This capability SHALL NOT be used to introduce or change main-process behavior.

#### Scenario: A module lands with its test

- **WHEN** a module is extracted from `main.mjs`
- **THEN** a corresponding `.test.mjs` exists, exercises that module's responsibility through its public interface, and passes

#### Scenario: Coverage is not bypassed by omission

- **WHEN** the import-graph test runs after the split
- **THEN** every newly extracted module is among those it imports and asserts exports on, without the test needing per-module edits

### Requirement: The split preserves all observable behavior

The reorganization SHALL NOT change any observable behavior. No IPC channel SHALL be added, removed or renamed; `electron/preload.cjs`'s `window.iris` surface SHALL be unchanged; no dependency SHALL be added; and every pinned external identifier (the Gemini Live model and voice, the 16 kHz send / 24 kHz receive sample rates, `sendRealtimeInput`) SHALL move verbatim.

Every existing capability spec SHALL remain true against its current text without edit. A spec that requires rewording to stay true indicates the split changed behavior, and the code SHALL be corrected rather than the spec.

#### Scenario: IPC surface is unchanged

- **WHEN** the set of channel names registered after the split is compared to the set before
- **THEN** the two sets are identical

#### Scenario: Existing specs remain true

- **WHEN** the capability specs for voice relay, PO live session, run execution queue, listening mode, HUD, session announcements and config persistence are checked against the reorganized code
- **THEN** each remains satisfied with no change to its requirement text

#### Scenario: The app behaves identically

- **WHEN** the manual smoke path runs (launch, wake, hold a voice turn, submit a task through the review gate, answer a PO question by voice, cross the PO→DEV gate, switch workstream, choose a project folder, enter and exit HUD mode, enter and exit listening mode through a rotation, mute, quit)
- **THEN** every step behaves exactly as it did before the split
