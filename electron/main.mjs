// The Electron main process's composition root: imports every module,
// wires dependency injection via wiring.mjs, and starts the app. Contains
// no domain logic itself — see design.md D1 (split-main-process-modules)
// and CLAUDE.md's File map for where each responsibility now lives.
import electron from "electron";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { closeAllPoSessions } from "./po-session.mjs";
import { shouldRefuseLaunch } from "./platform.mjs";
import { loadEnvFile, envFlag, shutdownDeadlineMs } from "./user-config.mjs";
import { installRendererSecurity } from "./renderer-security.mjs";
import { registerIpc } from "./ipc.mjs";
import { createWiring } from "./wiring.mjs";

const { app, BrowserWindow, nativeImage, dialog, globalShortcut, shell } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Name the app "Iris" (menu bar / about panel). The Dock tile fully reflects this
// only in a packaged build; in dev the generic Electron bundle name is used.
app.setName("Iris");

const iconPath = path.join(repoRoot, "build", "icon.png");
const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;

// Must run before wiring.mjs constructs anything that reads envFlag() at
// construction time (e.g. user-config.mjs's own module state) — see
// design.md task 1.5.
loadEnvFile({ repoRoot });

// Drawing panel scene seam (hud-drawing-canvas): the renderer pushes the
// serialized excalidraw scene here; this is the same cache the
// canvas-claude-mcp change reads from. See design.md D5.
const CANVAS_STORE_FILE = path.join(os.homedir(), ".iris", "canvas.json");

const wiring = createWiring({
  repoRoot,
  appIcon,
  iconPath,
  canvasStoreFile: CANVAS_STORE_FILE,
  envFlag,
  dialog,
  // add-manual-note-editing design.md D3: the note reader's "open in the
  // default app" route. Injected as a bare function so every module below
  // stays Electron-free.
  openPathExternally: (filePath) => shell.openPath(filePath),
  getIsPackaged: () => app.isPackaged,
});
const {
  emitEvent,
  setUiContextSnapshot,
  getMainWindow,
  getUiMode,
  createWindow,
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
  setRendererSecurity,
  startLive,
  stopLive,
  getLiveStatus,
  GreetGate,
  toggleListenOnly,
  isListenOnlyEngaged,
  sendCommand,
  sendAudioChunk,
  sessionsSnapshot,
  selectWorkstream,
  createWorkstream,
  chooseWorkstreamCwd,
  verbsSnapshot,
  setVerbModel,
  legacyClaudeArtifactsStatus,
  removeLegacyClaudeArtifacts,
  resolvePendingPoQuestion,
  getPromptReviewMode,
  setPromptReviewMode,
  resolvePromptReview,
  sendContextSupplement,
  getFullConfig,
  writeUserConfig,
  savePoToken,
  testGeminiKey,
  previewVoice,
  checkClaudeHealth,
  getPipelineAvailable,
  probePipelineAvailability,
  runQueue,
  secondBrainCapability,
  capabilities,
} = wiring;

app.whenReady().then(() => {
  if (shouldRefuseLaunch(process.platform, process.env)) {
    dialog.showMessageBoxSync({
      type: "error",
      title: "Unsupported platform",
      message: "Iris only supports macOS.",
    });
    app.quit();
    return;
  }

  if (appIcon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIcon);
  }
  installAppMenu();

  // Fire-and-forget so app startup isn't blocked on the CLI probe; the
  // pipeline_availability sidecar event (see probePipelineAvailability)
  // updates the renderer whenever this resolves, and connectLive() re-probes
  // before the Gemini session that actually consumes the value is built.
  probePipelineAvailability().catch(() => {});
  // The vault used to be created lazily, on a user's first capture — so the
  // HUD's second-brain toggle stayed hidden (and the galaxy/focus/structural-
  // edit tools unreachable) until then, with no other affordance to create it.
  // Ensuring it here means the toggle is available from first launch, like
  // every other HUD control. Synchronous and idempotent (a no-op once the
  // directory and its config already exist), so it costs nothing on every
  // later boot.
  secondBrainCapability.ensureNotesVaultReady();
  // Cheap synchronous existsSync check — establishes the initial value so
  // the boot-time secondbrain:availability read (below) isn't just the
  // `false` default before the toggle has ever been checked. Run AFTER
  // ensureNotesVaultReady() so this reflects "available" on a first-ever
  // boot too, not one boot behind it.
  secondBrainCapability.probeSecondBrainAvailability();

  // Renderer content security (renderer-content-security capability, design.md
  // D9/D10 of harden-security-boundaries): navigation containment and
  // device-permission scoping. MUST run before createWindow() below —
  // reversing this ordering fails silently: a "web-contents-created" handler
  // registered after a window is created never fires for that window,
  // leaving the app's only window with no navigation containment and no
  // error, no failing test, no log line (split-main-process-modules D7).
  setRendererSecurity(installRendererSecurity({ repoRoot }));

  // The renderer↔main IPC channel surface (design.md D3): every
  // ipcMain.handle/on registration lives in ipc.mjs, and only there — this
  // call marshals no arguments itself, it just wires the domain modules
  // wiring.mjs constructed into that module's injected deps.
  registerIpc({
    getMainWindow,
    getUiMode,
    toggleHud,
    updateTrayMenu,
    startLive,
    stopLive,
    getLiveStatus,
    greetGateFire: () => GreetGate.fire(),
    notifyWakeReady,
    toggleListenOnly,
    isListenOnlyEngaged,
    sendCommand,
    sendAudioChunk,
    sessionsSnapshot,
    selectWorkstream,
    createWorkstream,
    chooseWorkstreamCwd,
    verbsSnapshot,
    setVerbModel,
    legacyClaudeArtifactsStatus,
  removeLegacyClaudeArtifacts,
    resolvePendingPoQuestion,
    getPromptReviewMode,
    setPromptReviewMode,
    resolvePromptReview,
    sendContextSupplement,
    getFullConfig,
    writeUserConfig,
    savePoToken,
    testGeminiKey,
    previewVoice,
    checkClaudeHealth,
    getPipelineAvailable,
    setUiContextSnapshot,
    capabilities,
  });

  createWindow();
  createTray();
  // These accelerators are hand-edited by users in .env, so a value can be not
  // just taken (register returns false) but unparseable — which *throws*. An
  // unhandled throw here would skip every registration that follows it and
  // whatever else the whenReady() callback still had to do, so one typo could
  // cost an unrelated feature. Both failure shapes land in the same place:
  // logged, and the app carries on with the hotkey missing (wake-sleep-voice,
  // hud-activation).
  function registerHotkey(label, accelerator, handler) {
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, handler);
    } catch (error) {
      ok = false;
      emitEvent({
        type: "log",
        level: "error",
        message: `Could not register ${label} hotkey ${accelerator}: ${error?.message || error}`,
      });
      return;
    }
    if (!ok) {
      emitEvent({ type: "log", level: "error", message: `Could not register ${label} hotkey ${accelerator}.` });
    }
  }

  registerHotkey("HUD", hudHotkey(), () => {
    toggleHud();
    updateTrayMenu();
  });
  // Calls main's toggle directly, not emitToRenderer (design.md D3) — a
  // modifier+key accelerator, not a media key, so no Accessibility or Input
  // Monitoring grant is involved. No unregistration code needed: will-quit
  // already calls globalShortcut.unregisterAll().
  registerHotkey("listen-only", listenHotkey(), () => {
    toggleListenOnly();
  });
  // Wake and sleep are global for the same reason the HUD toggle is: the user
  // reaches for them from whatever application they are working in. Both route
  // through the window module's request helpers, which are the same paths the
  // tray uses — and requestWake additionally creates a window when the deck has
  // been closed, since on macOS that does not quit Iris.
  // No updateTrayMenu() here, unlike the HUD toggle: the wake/sleep tray label
  // follows the live session, which flips asynchronously in the renderer, and
  // live-session.mjs already refreshes the tray on both transitions.
  registerHotkey("wake", wakeHotkey(), () => requestWake());
  registerHotkey("sleep", sleepHotkey(), () => requestSleep());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Awaited teardown for app quit (design.md D3 of bound-shutdown-teardown):
// closes the Gemini Live socket, aborts every live DEV query so the Agent SDK
// tears down its subprocess and no tool process is orphaned, then closes every
// resident PO session — in that deliberate order (design.md D8), centrally,
// rather than as self-registered per-module hooks whose order would become
// incidental. run-queue.mjs owns the runs map, so live runs are reached
// directly via list() rather than mutating run.status from outside the module.
// The capability teardowns (canvas flush + MCP stop, vault-graph stop) run
// last, as a group — they are mutually independent, so their order *within*
// the group is just registration order, unlike the core sequence above it.
async function shutdownTeardown() {
  await stopLive();
  for (const run of runQueue.list()) {
    run.cancel?.();
  }
  await closeAllPoSessions();
  for (const cap of capabilities) {
    await cap.teardown?.();
  }
}

app.on("will-quit", () => globalShortcut.unregisterAll());
let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return; // re-entrant quit signal — teardown already in flight
  shuttingDown = true;
  event.preventDefault();
  const deadline = new Promise((resolve) => {
    const timer = setTimeout(resolve, shutdownDeadlineMs());
    timer.unref?.();
  });
  Promise.race([shutdownTeardown(), deadline]).finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
