// The main window, the Glass HUD shape-morph, and the menu-bar tray. Split
// out of electron/main.mjs (split-main-process-modules): one of the four
// modules permitted to import Electron directly. Every collaborator this
// module doesn't own (the renderer bridge, Live status, listen-only mode,
// the second-brain vault watcher, the app icon/repo root) is injected.
import electron from "electron";
import fs from "node:fs";
import path from "node:path";
// Re-exported below rather than redefined here: getFullConfig() reports the
// same accelerators to the renderer, and one definition is what keeps the
// displayed key and the registered key the same key.
import { hudHotkey, listenHotkey, wakeHotkey, sleepHotkey } from "./hotkeys.mjs";
// The APP's name, for the three places this module hands a name to macOS. Not for
// the tray's wake/sleep/quit labels below, which address the persona — she keeps
// her name when the application is renamed (see the app-identity capability).
import { PRODUCT_NAME } from "./app-identity.mjs";

const { app, BrowserWindow, Menu, Tray, screen } = electron;

/**
 * Which renderer console messages are worth a durable record, and at what level.
 *
 * Returns null for everything routine. Electron reports the level as a string
 * in current versions and as a number in older ones, and both shapes are
 * accepted rather than assumed — getting this wrong fails silently, by
 * recording nothing, which is the failure mode this whole capability exists to
 * remove.
 *
 * @param {unknown} level
 * @returns {"warn" | "error" | null}
 */
export function rendererConsoleLevel(level) {
  const text = String(level ?? "").toLowerCase();
  if (text === "error" || text === "3") return "error";
  if (text === "warning" || text === "warn" || text === "2") return "warn";
  return null;
}

/**
 * @param {{
 *   repoRoot: string,
 *   appIcon: any,
 *   iconPath: string,
 *   getAppDevUrl: () => string,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   stopVaultGraphWatch: () => void,
 *   probeSecondBrainAvailability: () => boolean,
 *   getLiveStatus: () => { running: boolean },
 *   isListenOnlyEngaged: () => boolean,
 *   toggleListenOnly: () => void,
 *   onRendererGone?: () => void,
 *   recordLog?: (record: { level: string, src: string, msg: string, [key: string]: any }) => void,
 * }} deps
 */
export function createWindowModule({
  repoRoot,
  appIcon,
  iconPath,
  getAppDevUrl,
  envFlag,
  emitToRenderer,
  stopVaultGraphWatch,
  probeSecondBrainAvailability,
  getLiveStatus,
  isListenOnlyEngaged,
  toggleListenOnly,
  // Fires when the renderer that a mode's machinery lives behind goes away —
  // both on a clean window close and on a renderer crash, since neither leaves
  // a capture graph behind (listen-mode-hears-system-audio 4.7).
  onRendererGone = () => {},
  // diagnostic-logging: the renderer's faults reaching the file. Defaulted to
  // a no-op so this module stays constructible without a sink.
  recordLog = () => {},
}) {
  let mainWindow = null;

  // ===== Glass HUD =====
  // One window, two shapes. Deck: a normal rounded app window. HUD: the same
  // window stretched over the whole screen, transparent, always on top, and
  // click-through except where the renderer marks interactive elements — Iris
  // floats over everything while you keep working underneath.
  let uiMode = "deck";
  let deckBounds = null;

  // ===== Tray (menu-bar presence) =====
  let tray = null;

  function getMainWindow() {
    return mainWindow;
  }

  function getUiMode() {
    return uiMode;
  }

  function createWindow() {
    // Frameless + transparent from birth so the same window can morph into the
    // Glass HUD overlay — Electron cannot toggle `frame`/`transparent` after
    // creation. The deck paints its own rounded background in CSS; TopBar's
    // custom win-controls replace the native traffic lights this gives up.
    mainWindow = new BrowserWindow({
      width: 1180,
      height: 860,
      minWidth: 980,
      minHeight: 800,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: true,
      fullscreenable: false,
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        preload: path.join(repoRoot, "electron", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        // OS-process-level renderer isolation, on top of contextIsolation.
        // Land alongside the `electron` version pin (package.json) so its
        // effect is verified against a fixed, known Electron version rather
        // than a floating `latest` (harden-security-boundaries D9).
        sandbox: true,
        // Audio capture/playback and the HUD must keep running when occluded.
        backgroundThrottling: false,
      },
    });
    const useProd = app.isPackaged || process.env.IRIS_START_PROD === "1";
    if (useProd) mainWindow.loadFile(path.join(repoRoot, "dist", "index.html"));
    else mainWindow.loadURL(getAppDevUrl());
    // harden-wake-word-detection D6: the application menu ships with no View
    // role and nothing else calls openDevTools(), so the renderer console —
    // where IRIS_WAKE_DEBUG's score diagnostics land — is otherwise unreachable
    // by menu or accelerator in both dev and packaged builds.
    const wakeDebug = envFlag("IRIS_WAKE_DEBUG", false);
    if (wakeDebug) mainWindow.webContents.openDevTools();
    // Electron 42 passes this listener a single details object — {message,
    // level, lineNumber, sourceId} — not the widely-documented 5-arg (event,
    // level, message, line, sourceId) form; that form yields `undefined` here
    // and surfaces as a script timeout with a misleading cause.
    mainWindow.webContents.on("console-message", (details) => {
      // NO FLAG GATES THE RECORDING (diagnostic-logging). A renderer exception
      // is the most common way this app breaks for a user, and until now it
      // left nothing behind at all unless a debug flag happened to be set —
      // which it never is on the machine where the failure happens.
      //
      // Only warnings and errors are recorded: the renderer's routine console
      // output is React's and Vite's, not Iris's, and a file it fills is a file
      // nobody reads.
      const level = rendererConsoleLevel(details?.level);
      if (level) {
        recordLog({
          level,
          src: "renderer",
          msg: String(details?.message ?? ""),
          at_source: details?.sourceId ? `${details.sourceId}:${details.lineNumber ?? "?"}` : undefined,
        });
      }
      // Printing stays behind the flag, unchanged: the terminal is the one
      // destination where volume costs something, and
      // scripts/check-wake-e2e.mjs asserts on this line
      // (fix-vendored-runtime-path-resolution design D8).
      if (wakeDebug) console.log(`[renderer] ${details.message}`);
    });
    // Navigation containment and the external-link handoff now live on
    // app.on("web-contents-created") in renderer-security.mjs, covering every
    // web contents the app ever creates instead of just this one window.
    // A crashed renderer or a reload/navigation doesn't fire the window's
    // "closed" event, so an active vault-graph fs.watch stream would
    // otherwise orphan while a fresh renderer starts a second one
    // (second-brain-galaxy-view design.md D3 M3).
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      // The interface process dying is the single most important thing this app
      // can record about itself, and it is exactly what an in-memory log cannot.
      recordLog({
        level: "error",
        src: "renderer",
        msg: `render process gone: ${details?.reason ?? "unknown"}`,
        reason: details?.reason,
        exitCode: details?.exitCode,
      });
      stopVaultGraphWatch();
      onRendererGone();
    });
    mainWindow.webContents.on("unresponsive", () => {
      recordLog({ level: "warn", src: "renderer", msg: "render process became unresponsive" });
      // Give the mouse back. In HUD mode the renderer decides whether this
      // window accepts the pointer, and while a fullscreen layer (the drawing
      // surface, the galaxy) is open it holds that decision at "yes" — on a
      // display-sized window above the menu bar. A renderer that has stopped
      // responding will never send the release, so the user is left unable to
      // click anything on their machine by a window that is no longer running
      // anything. Releasing here costs a hung renderer nothing: it cannot be
      // taking input either way, and the `hud:interactive` it sends when it
      // recovers takes precedence again immediately.
      if (uiMode === "hud") mainWindow?.setIgnoreMouseEvents(true, { forward: true });
    });
    mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
      recordLog({
        level: "error",
        src: "renderer",
        msg: `preload failed: ${error?.message ?? error}`,
        preloadPath,
      });
    });
    mainWindow.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) stopVaultGraphWatch();
    });
    // Main owns the window, so it is the authority on whether the window holds
    // OS focus — the deck's WebGL surfaces pause on that signal
    // (orb-expressions). The renderer's own focus/blur events are a derived
    // view that can miss a transition: the window is created hidden and shown
    // on "ready-to-show", commonly after the renderer's first render.
    mainWindow.on("focus", () => emitToRenderer("win:focus", { focused: true }));
    mainWindow.on("blur", () => emitToRenderer("win:focus", { focused: false }));
    // Avoid a translucent first-paint flash on the transparent window.
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
      uiMode = "deck";
      // A wake held for a renderer that never subscribed dies with the window
      // it was waiting on, rather than firing at whatever opens the next one.
      pendingWake = false;
      onRendererGone();
    });
  }

  function enterHud() {
    if (!mainWindow || uiMode === "hud") return;
    uiMode = "hud";
    deckBounds = mainWindow.getBounds();
    // Re-check vault existence on every HUD open (design.md D7 of
    // second-brain-galaxy-view) — cheap existsSync, only emits on a real
    // transition, so the "show second brain" toggle's visibility stays in
    // sync even if the vault appeared/disappeared since the last HUD session.
    probeSecondBrainAvailability();
    // Let the renderer fade the deck out before the window jumps to full screen.
    emitToRenderer("hud:mode", { mode: "hud" });
    setTimeout(() => {
      if (!mainWindow || uiMode !== "hud") return;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      mainWindow.setHasShadow(false);
      mainWindow.setMinimumSize(1, 1);
      mainWindow.setBounds(display.bounds);
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      mainWindow.show();
    }, 170);
  }

  function exitHud() {
    if (!mainWindow || uiMode === "deck") return;
    uiMode = "deck";
    mainWindow.setIgnoreMouseEvents(false);
    // Tell the renderer first (the deck mounts invisible and fades in), then
    // restore the window while it's still transparent — no stretched flash.
    emitToRenderer("hud:mode", { mode: "deck" });
    setTimeout(() => {
      if (!mainWindow || uiMode !== "deck") return;
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setVisibleOnAllWorkspaces(false);
      mainWindow.setHasShadow(true);
      mainWindow.setMinimumSize(980, 800);
      if (deckBounds) mainWindow.setBounds(deckBounds);
      mainWindow.show();
      mainWindow.focus();
    }, 170);
  }

  function toggleHud() {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (uiMode === "hud") exitHud();
    else enterHud();
  }

  function updateTrayMenu() {
    if (!tray) return;
    const liveStatus = getLiveStatus();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: liveStatus.running ? "Sleep Iris" : "Wake Iris",
          click: () => (liveStatus.running ? requestSleep() : requestWake()),
        },
        {
          // Main owns this state directly (design.md D3) — calls
          // toggleListenOnly() itself rather than dispatching to the
          // renderer, so this still works with no window open.
          // The mode's meaning changed (listen-mode-hears-system-audio): it is
          // no longer "Iris replies in text", it is "Iris goes silent and also
          // hears this machine". The label has to say so — engaging it starts
          // a capture and a retained record, which is not something to discover
          // afterwards.
          label: isListenOnlyEngaged()
            ? "Leave Listen-only Mode — Iris speaks again"
            : "Enter Listen-only Mode — Iris goes silent and hears your machine",
          enabled: liveStatus.running,
          click: () => toggleListenOnly(),
        },
        { label: uiMode === "hud" ? "Exit Glass HUD" : "Enter Glass HUD", click: () => toggleHud() },
        { type: "separator" },
        {
          label: "Show Deck",
          click: () => {
            if (!mainWindow) createWindow();
            else {
              exitHud();
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        { type: "separator" },
        // "Quit <app>" names the application, not the persona — and an explicit
        // label overrides what `role: "quit"` would render, which the app menu
        // below relies on. Derived so the tray cannot disagree with it.
        { label: `Quit ${PRODUCT_NAME}`, role: "quit" },
      ]),
    );
  }

  function createTray() {
    const trayIconPath = path.join(repoRoot, "build", "trayTemplate.png");
    if (!fs.existsSync(trayIconPath)) return;
    tray = new Tray(trayIconPath);
    tray.setToolTip(PRODUCT_NAME);
    updateTrayMenu();
  }

  // Wake has to survive the one state no window-level handler could ever reach:
  // the deck closed while Iris keeps running in the tray (wake-sleep-voice).
  // emitToRenderer drops the message when there is no window, and a window
  // created on the spot is not listening yet either — the renderer subscribes to
  // iris:wake from a mount effect, which can run after the page's load event. So
  // the request is *held* and flushed when the renderer says it has subscribed
  // (notifyWakeReady, over iris:wake-ready). Emitting on window creation and
  // hoping the listener is up would be the silent no-op the spec forbids.
  let pendingWake = false;

  function requestWake() {
    if (mainWindow) {
      emitToRenderer("iris:wake", {});
      return;
    }
    pendingWake = true;
    createWindow();
  }

  function notifyWakeReady() {
    if (!pendingWake) return;
    pendingWake = false;
    emitToRenderer("iris:wake", {});
  }

  // No window means no live session — mic capture is renderer-owned — so this
  // needs no window handling of its own; emitToRenderer already no-ops.
  function requestSleep() {
    emitToRenderer("iris:sleep", {});
  }

  function installAppMenu() {
    if (process.platform !== "darwin") return;
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
      ...(appIcon ? { iconPath } : {}),
    });
    const menu = Menu.buildFromTemplate([
      {
        // The application menu's own title — the leftmost item in the menu bar,
        // and the most visible name the app has. A bundle called MyIris.app whose
        // menu bar reads "Iris" would put back, exactly where the user looks, the
        // ambiguity the identity split exists to remove.
        label: PRODUCT_NAME,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]);
    Menu.setApplicationMenu(menu);
  }

  return {
    getMainWindow,
    getUiMode,
    createWindow,
    enterHud,
    exitHud,
    toggleHud,
    updateTrayMenu,
    createTray,
    hudHotkey,
    listenHotkey,
    wakeHotkey,
    sleepHotkey,
    requestWake,
    requestSleep,
    notifyWakeReady,
    installAppMenu,
  };
}
