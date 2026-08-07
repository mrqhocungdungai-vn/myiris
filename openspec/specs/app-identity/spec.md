# app-identity Specification

## Purpose
The identifiers that make this application distinguishable from every other application on the machine — its bundle identifier, its product name, its install path, and the root of its on-disk state — and the guarantee that none of them collides with the upstream project this repository is forked from, so both can be installed on one Mac without either destroying the other's data or bundle.
## Requirements
### Requirement: The app's identity does not collide with the upstream project it is forked from

This repository is a fork of `ASHR12/iris`. Every identifier by which macOS, the filesystem, or the installer distinguishes one application from another SHALL differ from the corresponding upstream identifier, so that installing both applications on one machine leaves each with its own bundle, its own permissions, and its own data.

The four identifiers SHALL be:

- **Bundle identifier**: `app.myiris.voice` (upstream: `app.iris.voice`). It SHALL be declared identically in the packaging configuration and in the constant the installer's ownership guard compares against, so the two can never disagree about which bundle the app owns.
- **Product name**: `MyIris` (upstream: `Iris`). This is the name the packaging configuration emits, the name the app registers with the window server, the name the installer builds its paths from, and the name the operating system shows the user — the application menu's own title, the About panel, and the tray tooltip. A bundle named `MyIris.app` whose menu bar reads `Iris` would reintroduce, in the one place the user actually looks, the ambiguity this capability exists to remove.
- **Install path**: `/Applications/MyIris.app` (upstream: `/Applications/Iris.app`), derived from the product name rather than stated independently.
- **State root**: `~/.myiris` (upstream: `~/.iris`).

A single hard-coded product name or bundle identifier SHALL NOT appear in more than one place in a form that can drift; each SHALL have exactly one authoritative declaration that every other consumer derives from or is asserted equal to. The same SHALL hold for the state-root directory name, with the one exemption named in the next requirement — a derivation of a *historical* path is not a second declaration of the current one.

The persona the user speaks to, and the wake word that summons it, are NOT app identity and SHALL NOT change with it. They name a character, not an application, and nothing in the operating system distinguishes two installs by them.

#### Scenario: No identifier is shared with upstream

- **WHEN** the app's bundle identifier, product name, install path, and state root are compared against the upstream project's
- **THEN** all four differ, and none is a prefix or case variant of the other

#### Scenario: The packaged bundle and the installer agree on the identifier

- **WHEN** the app is packaged and the installer resolves the bundle it is allowed to replace
- **THEN** the identifier written into the built bundle and the identifier the installer's guard compares against are the same value

#### Scenario: Both apps installed side by side

- **WHEN** this app and the upstream app are both installed on the same machine
- **THEN** each occupies its own path under `/Applications`, each carries its own bundle identifier, and neither reads nor writes the other's state root

#### Scenario: The persona keeps its name when the app is renamed

- **WHEN** the app identity changes
- **THEN** the voice persona's name and the wake word that summons it are unchanged, and the copy the user reads and hears still names the character as before

### Requirement: All app-owned configuration and runtime state lives under one home-directory root

Every file the app writes as its **own configuration or runtime state** SHALL live under a single home-directory root, `~/.myiris`. That root SHALL cover, at minimum: the packaged-build configuration file, the Claude configuration directory the app pins for its runs, the session store, the drawing-canvas store, and the default working directory for runs when no project folder is selected. There SHALL be exactly one authoritative declaration of that directory name, from which every accessor derives.

The scope is app-owned state, not everything the app can write. **User-authored content is deliberately outside it.** The second-brain notes vault (`~/iris-second-brain`) SHALL remain at its own top-level path and SHALL NOT be moved under the state root, for two reasons: it is plain markdown the user opens in other tools, where a relocated path breaks their own links and vault registrations; and the upstream project writes a different path entirely, so it is not a collision point and moving it buys no separation. Content the app writes into a project folder the user selected is outside the scope for the same reason.

No app-owned state SHALL be written to `~/.iris`, and the app SHALL NOT read configuration from `~/.iris` — including as a fallback — because a fallback read is exactly how this app would pick up an upstream install's configuration.

One derivation SHALL be exempt, and SHALL keep naming the old root. Locating the artifacts an **older build of this app** left in the user's own Claude Code directory requires reproducing the path that build ran against, since the transcript directory on disk is named after it. That derivation is a statement about files already written, not about where state lives now, so it SHALL continue to name the pre-rename path. Updating it to the current root would make the cleanup silently find nothing rather than fail — and the leftovers it exists to report would stay in the user's directory unnoticed.

#### Scenario: A packaged run writes its own state only under the new root

- **WHEN** a packaged build starts, loads its configuration, opens a session, and completes a run against the default workspace
- **THEN** every configuration and runtime file it created or modified in the home directory, outside OS-managed locations and outside the notes vault, is under `~/.myiris`, and nothing under `~/.iris` was created or modified

#### Scenario: The notes vault stays where the user's other tools expect it

- **WHEN** the app ensures the notes vault exists and writes a capture into it
- **THEN** the vault is at `~/iris-second-brain`, unchanged by the state-root rename, and remains openable at that path by an external editor

#### Scenario: No fallback read of the old root

- **WHEN** the app resolves its configuration file and `~/.iris/.env` exists but `~/.myiris/.env` does not
- **THEN** the app does not read `~/.iris/.env`, and behaves as it would with no configuration file at all

#### Scenario: Leftovers from a pre-rename build are still found

- **WHEN** the app reports what an older build wrote into the user's own Claude Code directory, on a machine where that older build ran against the pre-rename workspace
- **THEN** the transcript directory named after the pre-rename workspace path is reported, rather than the cleanup finding nothing because it looked for a path no build ever ran against

### Requirement: There is no migration from the pre-rename state root

The app SHALL NOT read, move, copy, or delete `~/.iris`. It has never had a released build that wrote there, so there is no user data to carry across, and the directory's only plausible owners are the upstream project or a pre-rename development run — neither of which this app may claim.

A first launch on a machine that happens to carry `~/.iris` SHALL therefore behave exactly like a first launch on a clean machine: the app creates its own state root and starts unconfigured, and the existing directory is left byte-for-byte as it was found.

#### Scenario: An existing pre-rename directory is ignored, not adopted

- **WHEN** the app starts on a machine where `~/.iris` exists, whatever it contains
- **THEN** the app neither reads nor modifies it, creates and uses `~/.myiris` instead, and `~/.iris` is left exactly as it was

#### Scenario: A first launch starts unconfigured

- **WHEN** the app starts with no `~/.myiris` present
- **THEN** it starts with an empty state root and surfaces its normal first-run setup path, rather than searching elsewhere for configuration

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

### Requirement: State macOS derives from the identity is not app-managed

Two locations are named by macOS from the product name and the bundle identifier rather than by this app: the Electron user-data directory (`~/Library/Application Support/<product name>`, which is where the renderer's web storage lives) and the preferences property list (`~/Library/Preferences/<bundle id>.plist`). The app SHALL NOT create, move, or clean up either one. They follow the identity automatically, and they regenerate on first launch.

A consequence worth stating, because it is what a reader will otherwise trip over: the renderer's interface preferences — interface sounds, gesture control, the selected camera and microphone, WebGL fidelity, the ambient-capture opt-in, the HUD camera size, and whether the listen-only consent notice has been shown — live in that derived directory and not in the configuration file. Changing the product name therefore points the app at a fresh set of defaults, in a development run as well as a packaged one, since the name is registered before any window exists.

Privacy grants behave the same way: macOS keys microphone, camera, and screen-recording permission by bundle identifier, so the app SHALL treat a first launch under its identifier as an ordinary first run — surfacing its existing permission prompts rather than reporting an error.

#### Scenario: Permissions are requested on first launch

- **WHEN** the app launches for the first time under its bundle identifier
- **THEN** it requests microphone, camera, and screen-recording permission through its normal permission flow rather than reporting an error

#### Scenario: Derived directories are left to macOS

- **WHEN** the app runs and writes renderer preferences and window state
- **THEN** they land in the directories macOS derives from the product name and bundle identifier, and no code in the app creates, relocates, or removes those directories

