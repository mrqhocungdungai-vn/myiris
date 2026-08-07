import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { STATE_ROOT_DIR } from "./app-identity.mjs";
import {
  canvasStoreFile,
  claudeHome,
  defaultWorkspace,
  sessionStoreFile,
  stateRoot,
  userConfigFile,
} from "./app-paths.mjs";

const FAKE_HOME = "/home/tester";
const fakeHomedir = () => FAKE_HOME;

// Every accessor takes homedir as an injectable function, so these tests never
// touch os.homedir() or the real filesystem.
describe("app-paths resolves every child of the state root", () => {
  it("puts the root directly under the injected home directory", () => {
    expect(stateRoot(fakeHomedir)).toBe(path.join(FAKE_HOME, STATE_ROOT_DIR));
  });

  it("names each child under that root", () => {
    const root = stateRoot(fakeHomedir);
    expect(userConfigFile(fakeHomedir)).toBe(path.join(root, ".env"));
    expect(claudeHome(fakeHomedir)).toBe(path.join(root, "claude-home"));
    expect(sessionStoreFile(fakeHomedir)).toBe(path.join(root, "claude-sessions.json"));
    expect(canvasStoreFile(fakeHomedir)).toBe(path.join(root, "canvas.json"));
    expect(defaultWorkspace(fakeHomedir)).toBe(path.join(root, "workspace"));
  });

  it("keeps every child inside the root", () => {
    // The property that actually matters: one directory a user can back up, move,
    // or delete to reset the app. A child that escaped the root would be missed by
    // every instruction that names the root.
    const root = stateRoot(fakeHomedir);
    for (const accessor of [userConfigFile, claudeHome, sessionStoreFile, canvasStoreFile, defaultWorkspace]) {
      expect(accessor(fakeHomedir).startsWith(`${root}${path.sep}`)).toBe(true);
    }
  });

  it("defaults to the real home directory when nothing is injected", () => {
    expect(stateRoot()).toBe(path.join(os.homedir(), STATE_ROOT_DIR));
  });

  it("resolves the home directory per call, not once at module load", () => {
    // session-store.mjs relies on this: its storeFile default is evaluated when the
    // store is constructed, which is how a test that mocks os.homedir() to a temp
    // directory gets a store under that temp directory. Caching the root at import
    // time would silently point every test at the developer's real home.
    let current = "/home/first";
    const shifting = () => current;
    expect(stateRoot(shifting)).toBe(path.join("/home/first", STATE_ROOT_DIR));
    current = "/home/second";
    expect(stateRoot(shifting)).toBe(path.join("/home/second", STATE_ROOT_DIR));
  });

  it("never resolves the Claude configuration directory into the user's own ~/.claude", () => {
    // The boundary the pinned CLAUDE_CONFIG_DIR exists to hold. Asserted here as
    // well as in worker-env.test.mjs, because this module is now where the value
    // comes from.
    expect(claudeHome(fakeHomedir)).not.toContain(`${path.sep}.claude${path.sep}`);
    expect(claudeHome(fakeHomedir).endsWith(`${path.sep}.claude`)).toBe(false);
  });
});
