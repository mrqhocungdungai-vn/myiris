import { describe, it, expect, vi, beforeEach } from "vitest";

function makeFakeWindow() {
  const listeners = {};
  return {
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    webContents: { on: vi.fn(), openDevTools: vi.fn() },
    once: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    show: vi.fn(),
    focus: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1180, height: 860 })),
    setHasShadow: vi.fn(),
    setMinimumSize: vi.fn(),
    setBounds: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    isDestroyed: () => false,
    __listeners: listeners,
  };
}

let lastFakeWindow;

vi.mock("electron", () => {
  return {
    default: {
      app: {
        isPackaged: false,
        setAboutPanelOptions: vi.fn(),
        getVersion: () => "1.0.0",
      },
      BrowserWindow: vi.fn(function BrowserWindowMock() {
        return lastFakeWindow;
      }),
      Menu: {
        buildFromTemplate: vi.fn((template) => ({ template })),
        setApplicationMenu: vi.fn(),
      },
      Tray: vi.fn(function TrayMock() {
        return { setToolTip: vi.fn(), setContextMenu: vi.fn() };
      }),
      screen: {
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
        getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }),
      },
    },
  };
});

import { createWindowModule } from "./window.mjs";

function make(overrides = {}) {
  return createWindowModule({
    repoRoot: "/fake/repo",
    appIcon: null,
    iconPath: "/fake/repo/build/icon.png",
    getAppDevUrl: () => "http://127.0.0.1:5173",
    envFlag: () => false,
    emitToRenderer: vi.fn(),
    stopVaultGraphWatch: vi.fn(),
    probeSecondBrainAvailability: vi.fn(() => true),
    getLiveStatus: () => ({ running: false }),
    isListenOnlyEngaged: () => false,
    toggleListenOnly: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  lastFakeWindow = makeFakeWindow();
  vi.useFakeTimers();
});

describe("window: HUD shape morph", () => {
  it("toggleHud creates the window if none exists yet", () => {
    const win = make();
    expect(win.getMainWindow()).toBeNull();
    win.toggleHud();
    expect(win.getMainWindow()).not.toBeNull();
  });

  it("enterHud switches uiMode to hud and ignores mouse events on the deferred timer", () => {
    const win = make();
    win.createWindow();
    win.enterHud();
    expect(win.getUiMode()).toBe("hud");
    vi.advanceTimersByTime(170);
    expect(lastFakeWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(lastFakeWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
  });

  it("exitHud restores deck bounds and stops ignoring mouse events", () => {
    const win = make();
    win.createWindow();
    win.enterHud();
    vi.advanceTimersByTime(170);
    win.exitHud();
    expect(win.getUiMode()).toBe("deck");
    expect(lastFakeWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    vi.advanceTimersByTime(170);
    expect(lastFakeWindow.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1180, height: 860 });
  });

  it("toggleHud flips between deck and hud on an existing window", () => {
    const win = make();
    win.createWindow();
    win.toggleHud();
    expect(win.getUiMode()).toBe("hud");
    win.toggleHud();
    expect(win.getUiMode()).toBe("deck");
  });

  it("enterHud is a no-op when already in hud mode", () => {
    const win = make();
    win.createWindow();
    win.enterHud();
    vi.advanceTimersByTime(170);
    lastFakeWindow.setAlwaysOnTop.mockClear();
    win.enterHud();
    expect(lastFakeWindow.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});

describe("window: createWindow", () => {
  it("loads the dev URL when not packaged", () => {
    const win = make();
    win.createWindow();
    expect(lastFakeWindow.loadURL).toHaveBeenCalledWith("http://127.0.0.1:5173");
  });

  it("stops the vault-graph watcher when the renderer process is gone", () => {
    const stopVaultGraphWatch = vi.fn();
    const win = make({ stopVaultGraphWatch });
    win.createWindow();
    const handler = lastFakeWindow.webContents.on.mock.calls.find(([event]) => event === "render-process-gone")[1];
    handler();
    expect(stopVaultGraphWatch).toHaveBeenCalled();
  });

  it("resets to deck mode when the window closes", () => {
    const win = make();
    win.createWindow();
    win.enterHud();
    vi.advanceTimersByTime(170);
    expect(win.getUiMode()).toBe("hud");
    lastFakeWindow.__listeners.closed();
    expect(win.getMainWindow()).toBeNull();
    expect(win.getUiMode()).toBe("deck");
  });
});

describe("window: hotkey readers", () => {
  it("fall back to defaults when no env override is set", () => {
    const originalEnv = { ...process.env };
    delete process.env.IRIS_HUD_HOTKEY;
    delete process.env.IRIS_LISTEN_HOTKEY;
    delete process.env.IRIS_WAKE_HOTKEY;
    delete process.env.IRIS_SLEEP_HOTKEY;
    try {
      const win = make();
      expect(win.hudHotkey()).toBe("Alt+Space");
      expect(win.listenHotkey()).toBe("Alt+L");
      expect(win.wakeHotkey()).toBe("Alt+Shift+W");
      expect(win.sleepHotkey()).toBe("Alt+Shift+S");
    } finally {
      process.env = originalEnv;
    }
  });

  it("every default is modifier-qualified and no two collide", () => {
    const originalEnv = { ...process.env };
    for (const key of ["IRIS_HUD_HOTKEY", "IRIS_LISTEN_HOTKEY", "IRIS_WAKE_HOTKEY", "IRIS_SLEEP_HOTKEY"]) {
      delete process.env[key];
    }
    try {
      const win = make();
      const defaults = [win.hudHotkey(), win.listenHotkey(), win.wakeHotkey(), win.sleepHotkey()];
      // A bare key would be swallowed system-wide by a global registration
      // (wake-sleep-voice), and two Iris hotkeys on one chord means one of them
      // never registers.
      for (const accelerator of defaults) expect(accelerator).toMatch(/^(Alt|Control|Cmd|Command|Shift)\+/);
      expect(new Set(defaults).size).toBe(defaults.length);
    } finally {
      process.env = originalEnv;
    }
  });

  it("respect an env override", () => {
    const originalEnv = { ...process.env };
    process.env.IRIS_HUD_HOTKEY = "Cmd+Shift+H";
    process.env.IRIS_WAKE_HOTKEY = "Cmd+Shift+K";
    process.env.IRIS_SLEEP_HOTKEY = "Cmd+Shift+J";
    try {
      const win = make();
      expect(win.hudHotkey()).toBe("Cmd+Shift+H");
      expect(win.wakeHotkey()).toBe("Cmd+Shift+K");
      expect(win.sleepHotkey()).toBe("Cmd+Shift+J");
    } finally {
      process.env = originalEnv;
    }
  });
});

describe("window: wake and sleep requests", () => {
  it("emits the wake straight through when a window already exists", () => {
    const emitToRenderer = vi.fn();
    const win = make({ emitToRenderer });
    win.createWindow();
    win.requestWake();
    expect(emitToRenderer).toHaveBeenCalledWith("iris:wake", {});
  });

  it("creates a window and holds the wake until the renderer subscribes", () => {
    const emitToRenderer = vi.fn();
    const win = make({ emitToRenderer });
    expect(win.getMainWindow()).toBeNull();
    win.requestWake();
    expect(win.getMainWindow()).not.toBeNull();
    // Nothing is listening yet — emitting now would be the silent no-op the
    // spec forbids, so the request waits.
    expect(emitToRenderer).not.toHaveBeenCalledWith("iris:wake", {});
    win.notifyWakeReady();
    expect(emitToRenderer).toHaveBeenCalledWith("iris:wake", {});
  });

  it("does not wake on a renderer announcement when no wake is pending", () => {
    const emitToRenderer = vi.fn();
    const win = make({ emitToRenderer });
    win.createWindow();
    win.notifyWakeReady();
    win.notifyWakeReady();
    expect(emitToRenderer).not.toHaveBeenCalledWith("iris:wake", {});
  });

  it("flushes a held wake only once, so a later resubscribe does not re-wake", () => {
    const emitToRenderer = vi.fn();
    const win = make({ emitToRenderer });
    win.requestWake();
    win.notifyWakeReady();
    win.notifyWakeReady();
    expect(emitToRenderer.mock.calls.filter(([channel]) => channel === "iris:wake")).toHaveLength(1);
  });

  it("drops a held wake when the window it was waiting on closes", () => {
    const emitToRenderer = vi.fn();
    const win = make({ emitToRenderer });
    win.requestWake();
    lastFakeWindow.__listeners.closed();
    win.notifyWakeReady();
    expect(emitToRenderer).not.toHaveBeenCalledWith("iris:wake", {});
  });

  it("requestSleep emits the same channel the voice sleep path uses", () => {
    const emitToRenderer = vi.fn();
    const win = make({ emitToRenderer });
    win.createWindow();
    win.requestSleep();
    expect(emitToRenderer).toHaveBeenCalledWith("iris:sleep", {});
  });
});
