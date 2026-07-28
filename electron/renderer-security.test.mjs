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
        },
      },
      shell: {
        openExternal: vi.fn(() => Promise.resolve()),
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
});
