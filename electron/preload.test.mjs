import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";

// `preload.cjs` is the entire renderer <-> main contract, and until now **no
// gate read it**: both import-graph tests are `.mjs`-only, `tsc` does not cover
// it, and a renamed channel here would have been caught by nothing at all.
//
// Loading it for real (with `electron` stubbed) rather than grepping the source
// means the assertions are about the surface actually exposed, not about text
// that happens to appear in the file.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Loads preload.cjs with a stub `electron`, returning what it exposed. */
function loadPreload() {
  const exposed = {};
  const invoked = [];
  const sent = [];
  const listened = [];

  const electronStub = {
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        invoked.push({ channel, args });
        return Promise.resolve(undefined);
      },
      send: (channel, ...args) => void sent.push({ channel, args }),
      on: (channel) => void listened.push(channel),
      removeListener: () => {},
    },
  };

  // Intercept `require("electron")` for this one load.
  const original = Module.prototype.require;
  const source = fs.readFileSync(path.join(repoRoot, "electron/preload.cjs"), "utf8");
  const module = { exports: {} };
  const require = (name) => (name === "electron" ? electronStub : original.call(module, name));
  // eslint-disable-next-line no-new-func
  new Function("require", "module", "exports", source)(require, module, module.exports);

  return { exposed, invoked, sent, listened };
}

describe("the preload bridge", () => {
  const { exposed } = loadPreload();

  it("exposes exactly one global, named iris", () => {
    expect(Object.keys(exposed)).toEqual(["iris"]);
  });

  it("exposes only functions — no raw ipcRenderer, no objects to reach through", () => {
    for (const [name, value] of Object.entries(exposed.iris)) {
      expect(typeof value, `iris.${name}`).toBe("function");
    }
  });

  // The renderer must never be handed Electron itself.
  it("leaks no Electron internals", () => {
    const serialized = Object.keys(exposed.iris).join(" ");
    for (const forbidden of ["ipcRenderer", "contextBridge", "require", "process"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("channel names", () => {
  it("routes each call to a namespaced channel", () => {
    const { exposed, invoked, sent } = loadPreload();
    // Call every zero-argument-safe method and collect the channels reached.
    for (const fn of Object.values(exposed.iris)) {
      try {
        fn();
      } catch {
        // Some methods dereference their argument; the ones that do not are
        // enough to establish the naming convention.
      }
    }
    const channels = [...invoked.map((c) => c.channel), ...sent.map((c) => c.channel)];
    expect(channels.length).toBeGreaterThan(20);
    for (const channel of channels) {
      expect(channel, channel).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
    }
  });

  it("reaches a distinct channel per method", () => {
    const { exposed, invoked, sent } = loadPreload();
    for (const fn of Object.values(exposed.iris)) {
      try {
        fn();
      } catch {
        /* see above */
      }
    }
    const channels = [...invoked.map((c) => c.channel), ...sent.map((c) => c.channel)];
    expect(new Set(channels).size).toBe(channels.length);
  });
});

// Named methods the renderer depends on. A rename here is a real break, and
// this is the only gate that would notice.
describe("the surface the renderer relies on", () => {
  const { exposed } = loadPreload();
  const api = exposed.iris;

  it("keeps the session lifecycle", () => {
    for (const name of ["startSidecar", "stopSidecar", "getSidecarStatus"]) {
      expect(api, name).toHaveProperty(name);
    }
  });

  it("keeps the verb surface, and offers no way to select a verb", () => {
    expect(api).toHaveProperty("listVerbs");
    expect(api).toHaveProperty("setVerbModel");
    // A verb is chosen by Iris, never by a control (CLAUDE.md).
    expect(Object.keys(api)).not.toContain("selectAgent");
    expect(Object.keys(api)).not.toContain("selectVerb");
  });

  it("keeps every subscription paired with an unsubscribe contract", () => {
    const subscriptions = Object.keys(api).filter((name) => /^on[A-Z]/.test(name));
    expect(subscriptions.length).toBeGreaterThan(5);
    const { exposed: fresh } = loadPreload();
    for (const name of subscriptions) {
      const off = fresh.iris[name](() => {});
      expect(typeof off, `${name} must return an unsubscribe`).toBe("function");
    }
  });
});
