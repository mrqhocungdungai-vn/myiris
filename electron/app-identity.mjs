// The identifiers by which this application is distinguishable from every other
// application on the machine.
//
// This repository is a fork of ASHR12/iris, and it inherited upstream's identity
// wholesale: the same bundle identifier, the same product name, and therefore the
// same install path and the same home-directory state root. That is not a
// coexistence problem, it is a silent overwrite — `decideInstallAction()` in
// mac-install-target.mjs refuses to remove a bundle whose CFBundleIdentifier is
// not ours, and while the two identifiers matched, that guard read upstream's
// Iris.app as "our own bundle, safe to replace".
//
// So every value here MUST differ from upstream's, and none may be a prefix or
// case variant of one:
//
//   this fork          upstream
//   ----------------   ----------------
//   MyIris             Iris
//   app.myiris.voice   app.iris.voice
//   ~/.myiris          ~/.iris
//
// The persona is NOT in that table. The voice companion the user talks to is still
// named Iris, and the wake word is a bundled ONNX model — the app was renamed, the
// character was not.
//
// Declared in one place because the alternative already bit this repository once:
// CLAUDE.md records the "a verb is defined in exactly one place" defect, where
// three hand-wired copies of one fact silently drifted. The installer's ownership
// guard is only meaningful if the identifier it compares against is the one the
// packaged bundle actually carries, and that is precisely the pair that cannot be
// linked by an import — electron-builder reads package.json as static JSON. So
// app-identity.test.mjs asserts the parity instead, the same way
// mac-install-target.mjs holds DEFAULT_SHUTDOWN_DEADLINE_MS in step with
// user-config.mjs.
//
// Electron-free and dependency-free, like every module under electron/ that is
// not one of the four permitted to import Electron (main-process-structure).

/**
 * The name macOS shows the user: the bundle under /Applications, the application
 * menu's own title, the About panel, and the tray tooltip. Also what the
 * installer builds its paths and its `osascript … to quit` target from.
 *
 * NOT the persona. The voice companion is still named Iris, and the wake word is
 * a bundled ONNX model — renaming the app deliberately leaves both alone.
 */
export const PRODUCT_NAME = "MyIris";

/**
 * The bundle identifier. macOS keys TCC grants (microphone, camera, screen
 * recording) and LaunchServices registration by this value, which is what makes
 * two apps genuinely separate rather than merely differently named.
 */
export const BUNDLE_ID = "app.myiris.voice";

/**
 * The single directory under $HOME holding this app's own configuration and
 * runtime state. Every child of it is named in app-paths.mjs, which is the only
 * module that should join this onto a home directory.
 *
 * Not every file the app writes lives here: the second-brain notes vault is
 * user-authored markdown opened in other editors, so it keeps its own top-level
 * path (see capabilities/second-brain.mjs), and it collides with nothing upstream
 * writes.
 */
export const STATE_ROOT_DIR = ".myiris";

// Upstream's ".iris" is deliberately not declared here, and there is no migration
// from it: this app has no released build that ever wrote there, so there is no
// user data to carry across. A `~/.iris` on a developer's machine is either
// upstream's or a pre-rename dev run's, and in both cases the right move is to
// leave it alone — this app simply starts with a clean state root.
//
// One derivation still names the old path on purpose, and it is not about this
// app's state: pipeline-install.mjs's legacyTranscriptDir() reproduces the path an
// older build ran against in order to find what it left in the user's OWN
// ~/.claude. That is a statement about files already on disk, so it must not
// follow this rename.
