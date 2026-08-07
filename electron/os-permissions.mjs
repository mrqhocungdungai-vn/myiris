// What the operating system has granted this app, and where the user goes to
// change it (setup-panel: "The Permissions step reports the operating system's
// answer", "A refused permission routes to where it can be changed").
//
// Electron-free by design (setup-panel-reports-real-permissions D1). The two
// decisions worth asserting live here — the state mapping and the settings
// location — while ipc.mjs makes the thin `systemPreferences` / `shell` calls
// and marshals through this module. This is deliberately NOT in
// renderer-security.mjs: that module answers "may this document capture", a
// containment question with a security consequence if it is wrong. This one
// answers "what has the OS granted", a reporting question for the setup UI
// with no containment content at all.

/**
 * The four states the panel distinguishes, because the action that resolves
 * each one differs.
 *
 * `restricted` must not collapse into `not-determined`: the user cannot grant
 * it and an in-app prompt returns immediately without asking, which rebuilds
 * the dead end this change exists to remove under a different label.
 *
 * @typedef {"not-determined" | "granted" | "denied" | "restricted"} OsPermissionState
 */

/** The permissions the panel reports or routes for. */
export const OS_PERMISSIONS = /** @type {const} */ (["microphone", "camera", "system-audio"]);

/**
 * The permissions `systemPreferences.getMediaAccessStatus` can be asked about.
 * System audio is absent on purpose: the platform interface reports
 * microphone, camera and screen only, and the screen state is NOT the state
 * that governs system-audio capture (measured: the audio-only loopback capture
 * delivers audio while `getMediaAccessStatus("screen")` reads `denied`). A row
 * built on it would report the wrong permission confidently, so system audio is
 * tested rather than read — see `setup-panel`'s self-test requirement.
 */
export const READABLE_OS_PERMISSIONS = /** @type {const} */ (["microphone", "camera"]);

/** The permissions an in-app prompt can be raised for (`askForMediaAccess`). */
export const PROMPTABLE_OS_PERMISSIONS = READABLE_OS_PERMISSIONS;

/**
 * Maps a platform-reported media access status onto the four states above.
 *
 * Anything unrecognised — including the states other platforms report, which
 * this design deliberately does not interpret — becomes `not-determined`,
 * which offers the prompt rather than a dead end.
 *
 * @param {unknown} status
 * @returns {OsPermissionState}
 */
export function toPermissionState(status) {
  switch (status) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "restricted":
      return "restricted";
    default:
      return "not-determined";
  }
}

/** Whether the in-app prompt is the action that can still work in this state. */
export function canPromptInApp(state) {
  return state === "not-determined";
}

/** Whether the row should route the user to System Settings instead. */
export function needsSettingsRoute(state) {
  return state === "denied" || state === "restricted";
}

// The System Settings pane each permission lives in.
//
// `com.apple.settings.PrivacySecurity.extension` is the modern identifier. The
// legacy `com.apple.preference.security` survives only as an alias, and aliases
// are what get dropped — so the modern one is what we open and the legacy one is
// recorded here rather than used:
//   x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone
const SETTINGS_PANE = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension";

const SETTINGS_LOCATIONS = {
  microphone: {
    anchor: "Privacy_Microphone",
    writtenPath: "System Settings → Privacy & Security → Microphone",
  },
  camera: {
    anchor: "Privacy_Camera",
    writtenPath: "System Settings → Privacy & Security → Camera",
  },
  // System-audio recording is presented alongside screen recording rather than
  // in a pane of its own. It is included even though its state cannot be read,
  // because the self-test's failing verdicts route here too — a user who once
  // refused that prompt is otherwise stranded with a verdict that never changes.
  "system-audio": {
    anchor: "Privacy_ScreenCapture",
    writtenPath: "System Settings → Privacy & Security → Screen & System Audio Recording",
  },
};

/**
 * Where the user changes this permission: the link to open, and the path
 * written out in words.
 *
 * The written path is not a fallback for an error branch — there is no error
 * branch to have. `shell.openExternal` rejects only when nothing handles the
 * SCHEME, and the settings scheme is always handled; an unknown or renamed
 * ANCHOR still launches System Settings and resolves successfully. The failure
 * actually being guarded against (settings opens on the wrong page) is
 * invisible to the caller, so the written path is what remains when the link
 * rots, and it is shown whether or not the link works.
 *
 * @param {string} permission
 * @returns {{ permission: string, url: string, writtenPath: string } | null}
 */
export function settingsLocation(permission) {
  const location = SETTINGS_LOCATIONS[permission];
  if (!location) return null;
  return {
    permission,
    url: `${SETTINGS_PANE}?${location.anchor}`,
    writtenPath: location.writtenPath,
  };
}

/** Every settings location, keyed by permission — what the renderer renders from. */
export function settingsLocations() {
  return Object.fromEntries(
    OS_PERMISSIONS.map((permission) => [permission, settingsLocation(permission)]),
  );
}

/** Whether this permission's state can be read from the platform at all. */
export function isReadablePermission(permission) {
  return READABLE_OS_PERMISSIONS.includes(/** @type {any} */ (permission));
}

/** Whether an in-app prompt can be raised for this permission at all. */
export function isPromptablePermission(permission) {
  return PROMPTABLE_OS_PERMISSIONS.includes(/** @type {any} */ (permission));
}
