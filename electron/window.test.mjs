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
    getSpeakerMuted: () => false,
    isListenModeEngaged: () => false,
    toggleListenMode: vi.fn(),
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
    delete process.env.IRIS_MUTE_HOTKEY;
    delete process.env.IRIS_LISTEN_HOTKEY;
    try {
      const win = make();
      expect(win.hudHotkey()).toBe("Alt+Space");
      expect(win.muteHotkey()).toBe("Alt+M");
      expect(win.listenHotkey()).toBe("Alt+L");
    } finally {
      process.env = originalEnv;
    }
  });

  it("respect an env override", () => {
    const originalEnv = { ...process.env };
    process.env.IRIS_HUD_HOTKEY = "Cmd+Shift+H";
    try {
      const win = make();
      expect(win.hudHotkey()).toBe("Cmd+Shift+H");
    } finally {
      process.env = originalEnv;
    }
  });
});
