import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => {
  const contentsListeners = {};
  const fakeContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event, handler) => {
      contentsListeners[event] = handler;
    }),
  };
  const appListeners = {};
  return {
    default: {
      app: {
        on: vi.fn((event, handler) => {
          appListeners[event] = handler;
        }),
      },
      session: {
        defaultSession: {
          setPermissionRequestHandler: vi.fn(),
          setDisplayMediaRequestHandler: vi.fn(),
        },
      },
      shell: {
        openExternal: vi.fn(() => Promise.resolve()),
      },
      // The display-media handler resolves the ASKING frame to a WebContents id
      // so a grant can be restricted to the frame that armed the test. The fake
      // carries the id on the frame itself.
      webContents: {
        fromFrame: vi.fn((frame) => (frame?.contentsId == null ? null : { id: frame.contentsId })),
      },
      __test: { appListeners, contentsListeners, fakeContents },
    },
  };
});

import electronReal from "electron";
import { installRendererSecurity } from "./renderer-security.mjs";

/** @type {any} */
const electron = electronReal;

describe("renderer-security: isAppOwnDocument", () => {
  const repoRoot = "/fake/repo";
  let security;

  beforeEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
    security = installRendererSecurity({ repoRoot });
  });

  it("accepts the dev server URL and the dev URL with a path", () => {
    expect(security.isAppOwnDocument("http://127.0.0.1:5173")).toBe(true);
    expect(security.isAppOwnDocument("http://127.0.0.1:5173/some/path")).toBe(true);
  });

  it("accepts the packaged file:// URL", () => {
    expect(security.isAppOwnDocument(security.appPackagedUrl)).toBe(true);
  });

  it("rejects an unrelated https URL", () => {
    expect(security.isAppOwnDocument("https://example.com")).toBe(false);
  });

  it("rejects a different file:// path — exact match, not a wildcard", () => {
    expect(security.isAppOwnDocument("file:///etc/passwd")).toBe(false);
    expect(security.isAppOwnDocument("file:///Users/someone/Downloads/evil.html")).toBe(false);
  });

  it("rejects a URL that merely starts with the dev host without the expected boundary", () => {
    expect(security.isAppOwnDocument("http://127.0.0.1:51730/evil")).toBe(false);
  });
});

describe("renderer-security: navigation containment", () => {
  beforeEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it("registers a web-contents-created handler that denies window.open and hands it to the OS browser", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const { appListeners, fakeContents } = electron.__test;
    appListeners["web-contents-created"](null, fakeContents);

    const openHandlerCall = fakeContents.setWindowOpenHandler.mock.calls.at(-1)[0];
    const result = openHandlerCall({ url: "https://example.com" });
    expect(result).toEqual({ action: "deny" });
    expect(electron.shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("prevents will-navigate to a non-own-document URL and opens it externally instead", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const { appListeners, fakeContents } = electron.__test;
    appListeners["web-contents-created"](null, fakeContents);

    const willNavigateHandler = fakeContents.on.mock.calls.find(([event]) => event === "will-navigate")[1];
    const event = { preventDefault: vi.fn() };
    willNavigateHandler(event, "https://example.com/gallery-link");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.shell.openExternal).toHaveBeenCalledWith("https://example.com/gallery-link");
  });

  it("allows will-navigate to the app's own document without opening externally", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const { appListeners, fakeContents } = electron.__test;
    appListeners["web-contents-created"](null, fakeContents);
    electron.shell.openExternal.mockClear();

    const willNavigateHandler = fakeContents.on.mock.calls.find(([event]) => event === "will-navigate")[1];
    const event = { preventDefault: vi.fn() };
    willNavigateHandler(event, "http://127.0.0.1:5173/");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });
});

describe("renderer-security: device permission scoping", () => {
  beforeEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it("grants media permission only to the app's own document", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const handler = electron.session.defaultSession.setPermissionRequestHandler.mock.calls.at(-1)[0];
    const callback = vi.fn();
    handler(null, "media", callback, { requestingUrl: "http://127.0.0.1:5173" });
    expect(callback).toHaveBeenCalledWith(true);
  });

  it("denies media permission for a request from any other document", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const handler = electron.session.defaultSession.setPermissionRequestHandler.mock.calls.at(-1)[0];
    const callback = vi.fn();
    handler(null, "media", callback, { requestingUrl: "https://example.com" });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it("denies a non-media permission even from the app's own document", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const handler = electron.session.defaultSession.setPermissionRequestHandler.mock.calls.at(-1)[0];
    const callback = vi.fn();
    handler(null, "notifications", callback, { requestingUrl: "http://127.0.0.1:5173" });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it("grants display-capture to the app's own document, and denies it to anything else", () => {
    installRendererSecurity({ repoRoot: "/fake/repo" });
    const handler = electron.session.defaultSession.setPermissionRequestHandler.mock.calls.at(-1)[0];

    const own = vi.fn();
    handler(null, "display-capture", own, { requestingUrl: "http://127.0.0.1:5173" });
    expect(own).toHaveBeenCalledWith(true);

    const foreign = vi.fn();
    handler(null, "display-capture", foreign, { requestingUrl: "https://example.com" });
    expect(foreign).toHaveBeenCalledWith(false);
  });
});

// listen-mode-hears-system-audio 1.5-1.8. System-audio capture is scoped three
// ways at once — to the app's own frame, to the mode that justifies it, and to
// audio — and every one of those is a separate way for the feature to become a
// screen-recording surface if it regresses.
describe("renderer-security: system-audio capture scoping", () => {
  beforeEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
  });

  function install({ engaged = true, systemAudio = true } = {}) {
    installRendererSecurity({
      repoRoot: "/fake/repo",
      isListenOnlyEngaged: () => engaged,
      isSystemAudioEnabled: () => systemAudio,
    });
    return electron.session.defaultSession.setDisplayMediaRequestHandler.mock.calls.at(-1);
  }

  it("answers the app's own frame with a loopback AUDIO source and no video", () => {
    const [handler, options] = install();
    const callback = vi.fn();
    handler({ frame: { url: "http://127.0.0.1:5173/" }, videoRequested: false, audioRequested: true }, callback);
    expect(callback).toHaveBeenCalledWith({ audio: "loopback" });
    // Never a video source, and never the system picker — a picker would be a
    // second, unscoped way to choose a screen.
    expect(callback.mock.calls.at(-1)[0].video).toBeUndefined();
    expect(options).toEqual({ useSystemPicker: false });
  });

  it("grants the same request from a packaged file:// document", () => {
    const security = installRendererSecurity({
      repoRoot: "/fake/repo",
      isListenOnlyEngaged: () => true,
      isSystemAudioEnabled: () => true,
    });
    const handler = electron.session.defaultSession.setDisplayMediaRequestHandler.mock.calls.at(-1)[0];
    const callback = vi.fn();
    handler({ frame: { url: security.appPackagedUrl } }, callback);
    expect(callback).toHaveBeenCalledWith({ audio: "loopback" });
  });

  it("denies a request from a frame that is not the app's own document", () => {
    const [handler] = install();
    const callback = vi.fn();
    handler({ frame: { url: "file:///Users/someone/Downloads/evil.html" } }, callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies the request while listen-only mode is not engaged", () => {
    const [handler] = install({ engaged: false });
    const callback = vi.fn();
    handler({ frame: { url: "http://127.0.0.1:5173/" } }, callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies the request under the IRIS_SYSTEM_AUDIO escape hatch", () => {
    const [handler] = install({ systemAudio: false });
    const callback = vi.fn();
    handler({ frame: { url: "http://127.0.0.1:5173/" } }, callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies a request with no frame at all rather than falling through", () => {
    const [handler] = install();
    const callback = vi.fn();
    handler({}, callback);
    expect(callback).toHaveBeenCalledWith({});
  });
});

// setup-panel-reports-real-permissions 2.12. The self-test is a SECOND door
// into the same capture, admitted on the terms that made the original rule
// worth having — so each of those terms is asserted separately here.
describe("renderer-security: the system-audio self-test arming", () => {
  beforeEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
  });

  const OWN_FRAME = { url: "http://127.0.0.1:5173/", contentsId: 1 };

  function install({ engaged = false, systemAudio = true } = {}) {
    const security = installRendererSecurity({
      repoRoot: "/fake/repo",
      isListenOnlyEngaged: () => engaged,
      isSystemAudioEnabled: () => systemAudio,
    });
    const handler = electron.session.defaultSession.setDisplayMediaRequestHandler.mock.calls.at(-1)[0];
    return { security, handler };
  }

  function fakeWindow(id = 1) {
    return { id, on: vi.fn(), once: vi.fn() };
  }

  function selfTestRequest(overrides = {}) {
    return { frame: OWN_FRAME, videoRequested: false, userGesture: true, ...overrides };
  }

  it("denies an out-of-mode request while nothing is armed", () => {
    const { handler } = install();
    const callback = vi.fn();
    handler(selfTestRequest(), callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("grants once for an armed test and denies the second request", () => {
    const { security, handler } = install();
    security.armSystemAudioSelfTest(fakeWindow(1));

    const first = vi.fn();
    handler(selfTestRequest(), first);
    expect(first).toHaveBeenCalledWith({ audio: "loopback" });

    const second = vi.fn();
    handler(selfTestRequest(), second);
    expect(second).toHaveBeenCalledWith({});
  });

  // The configuration gate is a precondition of EVERY route, not an
  // alternative to the mode: disabling system audio leaves no reachable
  // capture surface whatsoever.
  it("denies an armed test under the IRIS_SYSTEM_AUDIO escape hatch", () => {
    const { security, handler } = install({ systemAudio: false });
    security.armSystemAudioSelfTest(fakeWindow(1));
    const callback = vi.fn();
    handler(selfTestRequest(), callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("refuses a self-test request that asks for video rather than answering audio-only", () => {
    const { security, handler } = install();
    security.armSystemAudioSelfTest(fakeWindow(1));
    const callback = vi.fn();
    handler(selfTestRequest({ videoRequested: true }), callback);
    expect(callback).toHaveBeenCalledWith({});
    // And the arming survives, so a video request cannot burn the user's test.
    expect(security.isSystemAudioSelfTestArmed()).toBe(true);
  });

  it("requires a user gesture, so 'user-initiated' is established in main", () => {
    const { security, handler } = install();
    security.armSystemAudioSelfTest(fakeWindow(1));
    const callback = vi.fn();
    handler(selfTestRequest({ userGesture: false }), callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies a request from a frame other than the one that armed the test", () => {
    const { security, handler } = install();
    security.armSystemAudioSelfTest(fakeWindow(1));
    const callback = vi.fn();
    handler(selfTestRequest({ frame: { url: "http://127.0.0.1:5173/", contentsId: 2 } }), callback);
    expect(callback).toHaveBeenCalledWith({});
    expect(security.isSystemAudioSelfTestArmed()).toBe(true);
  });

  it("drops the arming when the window that armed it goes away", () => {
    const { security } = install();
    const win = fakeWindow(1);
    security.armSystemAudioSelfTest(win);
    expect(security.isSystemAudioSelfTestArmed()).toBe(true);

    const destroyed = win.once.mock.calls.find(([event]) => event === "destroyed")[1];
    destroyed();
    expect(security.isSystemAudioSelfTestArmed()).toBe(false);
  });

  it("drops the arming on a reload and on a lost render process", () => {
    for (const event of ["did-start-navigation", "render-process-gone"]) {
      const { security } = install();
      const win = fakeWindow(1);
      security.armSystemAudioSelfTest(win);
      const drop = win.on.mock.calls.find(([name]) => name === event)[1];
      drop();
      expect(security.isSystemAudioSelfTestArmed()).toBe(false);
    }
  });

  it("disarms on request, so a cancelled test leaves nothing armed", () => {
    const { security, handler } = install();
    security.armSystemAudioSelfTest(fakeWindow(1));
    security.disarmSystemAudioSelfTest();
    const callback = vi.fn();
    handler(selfTestRequest(), callback);
    expect(callback).toHaveBeenCalledWith({});
  });

  // The mode's own capture is not a self-test and must not spend the arming —
  // it is granted on its own condition, before the self-test path is reached.
  it("leaves the arming untouched while listen-only mode is engaged", () => {
    const { security, handler } = install({ engaged: true });
    security.armSystemAudioSelfTest(fakeWindow(1));
    const callback = vi.fn();
    handler({ frame: OWN_FRAME }, callback);
    expect(callback).toHaveBeenCalledWith({ audio: "loopback" });
    expect(security.isSystemAudioSelfTestArmed()).toBe(true);
  });
});
