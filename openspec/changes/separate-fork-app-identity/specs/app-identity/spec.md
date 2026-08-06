## Purpose

The identifiers that make this application distinguishable from every other application on the machine — its bundle identifier, its product name, its install path, and the root of its on-disk state — and the guarantee that none of them collides with the upstream project this repository is forked from, so both can be installed on one Mac without either destroying the other's data or bundle.

## ADDED Requirements

### Requirement: The app's identity does not collide with the upstream project it is forked from

This repository is a fork of `ASHR12/iris`. Every identifier by which macOS, the filesystem, or the installer distinguishes one application from another SHALL differ from the corresponding upstream identifier, so that installing both applications on one machine leaves each with its own bundle, its own permissions, and its own data.

The four identifiers SHALL be:

- **Bundle identifier**: `app.myiris.voice` (upstream: `app.iris.voice`). It SHALL be declared identically in the packaging configuration and in the constant the installer's ownership guard compares against, so the two can never disagree about which bundle the app owns.
- **Product name**: `MyIris` (upstream: `Iris`). This is the name the packaging configuration emits, the name the app registers with the window server, and the name the installer builds its paths from.
- **Install path**: `/Applications/MyIris.app` (upstream: `/Applications/Iris.app`), derived from the product name rather than stated independently.
- **State root**: `~/.myiris` (upstream: `~/.iris`).

A single hard-coded product name or bundle identifier SHALL NOT appear in more than one place in a form that can drift; each SHALL have exactly one authoritative declaration that every other consumer derives from or is asserted equal to.

#### Scenario: No identifier is shared with upstream

- **WHEN** the app's bundle identifier, product name, install path, and state root are compared against the upstream project's
- **THEN** all four differ, and none is a prefix or case variant of the other

#### Scenario: The packaged bundle and the installer agree on the identifier

- **WHEN** the app is packaged and the installer resolves the bundle it is allowed to replace
- **THEN** the identifier written into the built bundle and the identifier the installer's guard compares against are the same value

#### Scenario: Both apps installed side by side

- **WHEN** this app and the upstream app are both installed on the same machine
- **THEN** each occupies its own path under `/Applications`, each carries its own bundle identifier, and neither reads nor writes the other's state root

### Requirement: All app-owned local state lives under one home-directory root

Every file the app writes to the user's home directory outside of OS-managed locations SHALL live under a single root, `~/.myiris`. That root SHALL cover, at minimum: the packaged-build configuration file, the Claude configuration directory the app pins for its runs, the session store, the drawing-canvas store, and the default working directory for runs when no project folder is selected.

No app-owned state SHALL be written to `~/.iris`, and the app SHALL NOT read configuration from `~/.iris` — including as a fallback — once the migration below has had its chance to run, because a fallback read is exactly how the fork would pick up an upstream install's configuration.

#### Scenario: A packaged run writes only under the new root

- **WHEN** a packaged build starts, loads its configuration, opens a session, and completes a run against the default workspace
- **THEN** every file it created or modified in the home directory outside OS-managed locations is under `~/.myiris`, and nothing under `~/.iris` was created or modified

#### Scenario: No fallback read of the old root

- **WHEN** the app resolves its configuration file and `~/.iris/.env` exists but `~/.myiris/.env` does not
- **THEN** the app does not read `~/.iris/.env`, and behaves as it would with no configuration file at all

### Requirement: An existing state root is migrated once, and only when it provably belongs to this app

On startup, before any component that reads or writes the state root is constructed, the app SHALL perform a one-time migration: when `~/.myiris` does not exist and `~/.iris` does, and the contents of `~/.iris` identify it as this app's own, the app SHALL relocate that directory to `~/.myiris`.

Ownership SHALL be established from marker files, not assumed from the path. The directory SHALL be treated as this app's own only when it contains at least one file this app writes and the upstream project does not, and contains no file the upstream project writes and this app does not. When the markers are ambiguous, or when both sets are present, the app SHALL leave `~/.iris` untouched and start with an empty state root — a fresh start is recoverable, and consuming another application's data is not.

The relocation SHALL be a move, not a copy. A copy would leave this app's data at the shared path, where an upstream install would later read it — which is the collision this capability exists to remove.

A migration that cannot be completed SHALL NOT prevent the app from starting. The app SHALL leave the source directory as it found it, start with an empty state root, and record what happened, rather than aborting launch or proceeding with a half-moved directory.

#### Scenario: A previous install's data is carried across

- **WHEN** the app starts with `~/.iris` present carrying this app's marker files, no upstream marker files, and `~/.myiris` absent
- **THEN** the directory is relocated to `~/.myiris` with its contents intact, `~/.iris` no longer exists, and the session store, canvas, workspace, and Claude configuration directory are all readable at their new paths

#### Scenario: An upstream install's data is never taken

- **WHEN** the app starts with `~/.iris` present carrying the upstream project's marker files and `~/.myiris` absent
- **THEN** `~/.iris` is left exactly as it was, and the app starts with an empty state root

#### Scenario: Ambiguous contents are left alone

- **WHEN** `~/.iris` contains marker files from both projects, or contains neither project's markers
- **THEN** the app leaves the directory untouched and starts with an empty state root

#### Scenario: Migration runs at most once

- **WHEN** the app starts and `~/.myiris` already exists
- **THEN** no migration is attempted regardless of whether `~/.iris` exists, and any existing `~/.iris` is left untouched

#### Scenario: A failed migration does not block launch

- **WHEN** the relocation cannot be completed
- **THEN** the app starts normally with an empty state root, the source directory is left as it was found, and the failure is recorded

### Requirement: Migration preserves run history for the default workspace

The Claude configuration directory stores each project's transcripts in a directory named after a slug derived from that project's working directory path. Moving the state root changes the default workspace's path, and therefore its slug, which would orphan every transcript belonging to runs against the default workspace — a resumed session would silently find no prior conversation.

The migration SHALL therefore also rename the transcript directory whose slug was derived from the old default workspace path to the slug derived from the new one, so a session resumed after the migration continues the same conversation. Transcript directories for user-selected project folders SHALL be left untouched, since those paths are unaffected by the rename.

When the target slug directory already exists, or the source slug directory does not, the migration SHALL leave both as they are — this repair is best-effort and SHALL NOT fail the migration or the launch.

#### Scenario: A session resumed after migration keeps its history

- **WHEN** a run completed against the default workspace before the migration, and a session is resumed against the default workspace after it
- **THEN** the run resumes the same conversation, having found the transcript the earlier run wrote

#### Scenario: Project-folder transcripts are untouched

- **WHEN** the migration runs and transcripts exist for user-selected project folders
- **THEN** those transcript directories keep their names and contents unchanged

### Requirement: The installer refuses any bundle it does not own

The installer replaces a directory under `/Applications`, which is the one genuinely destructive step in this repository's tooling. It SHALL remove an existing bundle at its install path only when that bundle's `CFBundleIdentifier` equals this app's own identifier. Every other case SHALL refuse without removing anything: a missing or unreadable identifier, a non-directory at the path, an identifier belonging to another application, or a path other than the app's own install path.

With the identifier now distinct from upstream's, this guard SHALL refuse an upstream `Iris.app` found at `/Applications` rather than replacing it.

#### Scenario: An upstream bundle is refused

- **WHEN** the installer runs and `/Applications/Iris.app` exists carrying the upstream bundle identifier
- **THEN** the installer does not remove or modify it, and installs this app at its own path instead

#### Scenario: An unidentifiable bundle is refused

- **WHEN** a directory sits at this app's install path but its bundle identifier cannot be read
- **THEN** the installer refuses with an explanation and removes nothing

#### Scenario: The app's own bundle is replaced

- **WHEN** a bundle sits at this app's install path carrying this app's own bundle identifier
- **THEN** the installer replaces it as before

### Requirement: OS-managed per-app state is abandoned, not migrated

Directories macOS derives from the product name or the bundle identifier — the Electron user-data directory and the preferences property list — SHALL NOT be migrated. They hold only framework state that regenerates on first launch under the new names, and nothing the user authored.

Changing the bundle identifier resets the app's privacy grants, because macOS keys microphone, camera, and screen-recording permission by bundle identifier. The app SHALL treat this as expected first-run behavior rather than an error condition, surfacing its existing permission prompts. The documentation SHALL state that these permissions must be granted again after this change.

Because the previously installed bundle carries the old identifier, it is indistinguishable from an upstream install once this change lands, so the installer SHALL NOT remove it. The documentation SHALL name it as a manual cleanup step.

#### Scenario: Permissions are re-requested on first launch

- **WHEN** the app launches for the first time under the new bundle identifier
- **THEN** it requests microphone, camera, and screen-recording permission through its normal permission flow rather than reporting an error

#### Scenario: The stale bundle is left for the user

- **WHEN** the installer runs on a machine carrying a bundle installed before this change
- **THEN** that bundle is not removed, and the documentation tells the user how to delete it
