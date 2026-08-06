// Renderer content security: navigation containment and device-permission
// scoping (the renderer-content-security capability). Split out of
// electron/main.mjs (split-main-process-modules) into its own named module
// per design.md D7 — a security boundary with its own capability spec should
// be locatable in one file, deliberately below the 250-line floor. One of
// the four modules permitted to import Electron directly.
import electron from "electron";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { app, session, shell } = electron;

/**
 * @param {{
 *   repoRoot: string,
 *   isListenOnlyEngaged?: () => boolean,
 *   isSystemAudioEnabled?: () => boolean,
 * }} deps
 */
export function installRendererSecurity({
  repoRoot,
  // System-audio capture is scoped to the mode that justifies it
  // (listen-mode-hears-system-audio, renderer-content-security spec: "The mode
  // state is read from its owner"). Read through main's own getter, never from
  // anything the renderer reports back — the process asking the question must
  // not also be the one answering it. Defaulted so a caller that predates
  // system audio (and every test of the navigation half) still constructs.
  isListenOnlyEngaged = () => false,
  isSystemAudioEnabled = () => false,
}) {
  // D9/D10 (harden-security-boundaries): the single source of truth for "is
  // this URL the app's own document" — used both to contain navigation and to
  // scope device permissions. Exact match, not a `file://` wildcard: a
  // wildcard would match any local file (e.g. one dropped onto the window),
  // which still carries `preload.cjs` and therefore `window.iris` into
  // whatever content it navigates to.
  const APP_DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  const APP_PACKAGED_URL = pathToFileURL(path.join(repoRoot, "dist", "index.html")).href;

  function isAppOwnDocument(url) {
    return url === APP_DEV_URL || url.startsWith(`${APP_DEV_URL}/`) || url === APP_PACKAGED_URL;
  }

  // D9 (harden-security-boundaries): app-wide navigation containment,
  // replacing the old per-window will-navigate/setWindowOpenHandler pair
  // (second-brain-galaxy-view D9/M1) so every web contents the app ever
  // creates is covered, not just the first window. The galaxy renders
  // genuinely untrusted note content (wiki-ingest pulls web articles/PDFs
  // into the vault) and react-markdown turns `[text](https://…)` into a real
  // `<a>` — without this, clicking one would top-level-navigate the window
  // carrying `preload.cjs` to the remote page. window.open is denied as an
  // in-app window and handed to the OS browser instead, which also restores
  // the three panel links (src/App.tsx, SetupPanel.tsx) that a bare `deny`
  // left silently non-functional.
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (isAppOwnDocument(url)) return;
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    });
  });

  // D10 (harden-security-boundaries): grant media/audio/video only to the
  // app's own document. Latent on its own (only the app's document loads
  // today), but combined with a navigation gap this would otherwise hand the
  // microphone/camera to whatever content got navigated to — this removes
  // that compounding factor regardless of whether D9 also holds.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const isOwnDocument = isAppOwnDocument(details?.requestingUrl || "");
    // "audioCapture"/"videoCapture" are not in the installed Electron type's
    // permission union for this handler (only "media" is) — see the change's
    // recorded findings. Cast rather than drop the checks: behavior-neutral.
    const perm = /** @type {string} */ (permission);
    callback(
      isOwnDocument &&
        (perm === "media" ||
          perm === "audioCapture" ||
          perm === "videoCapture" ||
          // The permission `getDisplayMedia` asks for. Granting it here is not
          // on its own enough to capture anything — the display-media handler
          // below decides what the stream actually carries, and refuses
          // outright unless listen-only mode is engaged.
          perm === "display-capture"),
    );
  });

  // System-audio capture for listen-only mode (listen-mode-hears-system-audio
  // D1). Audio only, and deliberately nothing else: no `desktopCapturer`
  // enumeration, no screen or window source, no system picker. Chromium's
  // "loopback" audio source is what a `{ video: false, audio: true }`
  // getDisplayMedia request resolves to, and it needs no permission of ours —
  // macOS prompts once for its own system-audio consent and the grant sticks.
  //
  // Denial is `callback({})`: a stream with neither an audio nor a video source
  // cancels the request, which is how the renderer's getDisplayMedia promise
  // rejects rather than hanging.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      // The FRAME's URL, not `request.securityOrigin`: an origin is `file://`
      // for every local document in a packaged build, so an origin check would
      // either grant every local file or refuse the app's own document —
      // exactly the dev-works/packaged-broken split the spec forbids. This is
      // the same isAppOwnDocument the navigation containment above uses.
      const frameUrl = request?.frame?.url || "";
      if (!isAppOwnDocument(frameUrl)) return callback({});
      // The escape hatch must leave no capture surface at all, and the mode is
      // the only justification this capture has: outside it there is nothing
      // to grant.
      if (!isSystemAudioEnabled() || !isListenOnlyEngaged()) return callback({});
      callback({ audio: "loopback" });
    },
    { useSystemPicker: false },
  );

  return {
    isAppOwnDocument,
    // Exposed because createWindow() (still in main.mjs, moving to window.mjs
    // in task 4.3) also needs APP_DEV_URL to decide what to load.
    appDevUrl: APP_DEV_URL,
    appPackagedUrl: APP_PACKAGED_URL,
  };
}
