// The main window, the Glass HUD shape-morph, and the menu-bar tray. Split
// out of electron/main.mjs (split-main-process-modules): one of the four
// modules permitted to import Electron directly. Every collaborator this
// module doesn't own (the renderer bridge, Live status, listening mode, the
// second-brain vault watcher, the app icon/repo root) is injected.
import electron from "electron";
import fs from "node:fs";
import path from "node:path";

const { app, BrowserWindow, Menu, Tray, screen } = electron;

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
 *   getSpeakerMuted: () => boolean,
 *   isListenModeEngaged: () => boolean,
 *   toggleListenMode: () => void,
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
  getSpeakerMuted,
  isListenModeEngaged,
  toggleListenMode,
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
    if (envFlag("IRIS_WAKE_DEBUG", false)) mainWindow.webContents.openDevTools();
    // Navigation containment and the external-link handoff now live on
    // app.on("web-contents-created") in renderer-security.mjs, covering every
    // web contents the app ever creates instead of just this one window.
    // A crashed renderer or a reload/navigation doesn't fire the window's
    // "closed" event, so an active vault-graph fs.watch stream would
    // otherwise orphan while a fresh renderer starts a second one
    // (second-brain-galaxy-view design.md D3 M3).
    mainWindow.webContents.on("render-process-gone", () => stopVaultGraphWatch());
    mainWindow.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) stopVaultGraphWatch();
    });
    // Avoid a translucent first-paint flash on the transparent window.
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
      uiMode = "deck";
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
          click: () => emitToRenderer(liveStatus.running ? "iris:sleep" : "iris:wake", {}),
        },
        {
          label: getSpeakerMuted() ? "Unmute speaker" : "Mute speaker",
          enabled: liveStatus.running,
          click: () => emitToRenderer("iris:mute-toggle", {}),
        },
        {
          // Main owns this state directly (design.md Decision 11) — calls
          // toggleListenMode() itself rather than dispatching to the
          // renderer, so this still works with no window open.
          label: isListenModeEngaged() ? "End listening mode" : "Start listening mode",
          enabled: liveStatus.running,
          click: () => toggleListenMode(),
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
        { label: "Quit Iris", role: "quit" },
      ]),
    );
  }

  function createTray() {
    const trayIconPath = path.join(repoRoot, "build", "trayTemplate.png");
    if (!fs.existsSync(trayIconPath)) return;
    tray = new Tray(trayIconPath);
    tray.setToolTip("Iris");
    updateTrayMenu();
  }

  function hudHotkey() {
    return process.env.IRIS_HUD_HOTKEY || "Alt+Space";
  }

  function muteHotkey() {
    return process.env.IRIS_MUTE_HOTKEY || "Alt+M";
  }

  function listenHotkey() {
    return process.env.IRIS_LISTEN_HOTKEY || "Alt+L";
  }

  function installAppMenu() {
    if (process.platform !== "darwin") return;
    app.setAboutPanelOptions({
      applicationName: "Iris",
      applicationVersion: app.getVersion(),
      ...(appIcon ? { iconPath } : {}),
    });
    const menu = Menu.buildFromTemplate([
      {
        label: "Iris",
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
    muteHotkey,
    listenHotkey,
    installAppMenu,
  };
}
