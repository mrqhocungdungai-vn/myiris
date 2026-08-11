import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hudHotkey, listenHotkey, wakeHotkey, sleepHotkey } from "./hotkeys.mjs";

// This module exists so one accelerator has one definition. It is read in two
// unrelated places — main.mjs *registers* the shortcut, user-config.mjs
// *reports* it to the renderer so the UI can name the key — and a default that
// drifted between them produces exactly what wake-sleep-voice's "displayed keys
// match registered keys" scenario forbids: a prompt telling the user to press a
// key that does nothing.
//
// It had no test of any kind, direct or indirect.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const ENV_KEYS = ["IRIS_HUD_HOTKEY", "IRIS_LISTEN_HOTKEY", "IRIS_WAKE_HOTKEY", "IRIS_SLEEP_HOTKEY"];

describe("defaults", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("has a default for every accelerator", () => {
    for (const fn of [hudHotkey, listenHotkey, wakeHotkey, sleepHotkey]) {
      expect(fn()).toBeTruthy();
    }
  });

  it("lets the environment override each one independently", () => {
    process.env.IRIS_WAKE_HOTKEY = "Alt+Shift+Q";
    expect(wakeHotkey()).toBe("Alt+Shift+Q");
    // The others are unaffected.
    expect(sleepHotkey()).toBe("Alt+Shift+S");
  });

  it("falls back to the default for an empty override", () => {
    process.env.IRIS_HUD_HOTKEY = "";
    expect(hudHotkey()).toBe("Alt+Space");
  });

  it("gives every accelerator a distinct default", () => {
    const defaults = [hudHotkey(), listenHotkey(), wakeHotkey(), sleepHotkey()];
    expect(new Set(defaults).size).toBe(defaults.length);
  });
});

// Modifier-qualified by requirement, not by taste.
describe("the wake and sleep chords are safe to register globally", () => {
  it("never binds a bare letter", () => {
    // A global registration on a bare letter would swallow that letter
    // everywhere in the OS.
    for (const chord of [wakeHotkey(), sleepHotkey(), hudHotkey(), listenHotkey()]) {
      expect(chord).toContain("+");
    }
  });

  it("keeps the W/S mnemonic without using the character-entry chords", () => {
    // Alt+W / Alt+S are the ordinary chords for ∑ and ß on macOS, so wake and
    // sleep carry Shift as well.
    expect(wakeHotkey()).toBe("Alt+Shift+W");
    expect(sleepHotkey()).toBe("Alt+Shift+S");
    expect(wakeHotkey()).not.toBe("Alt+W");
    expect(sleepHotkey()).not.toBe("Alt+S");
  });
});

// The defect this module was created to prevent.
describe("one definition, two readers", () => {
  it("is the only place a default accelerator string is written", () => {
    const source = read("electron/hotkeys.mjs");
    for (const literal of ["Alt+Space", "Alt+L", "Alt+Shift+W", "Alt+Shift+S"]) {
      expect(source).toContain(literal);
    }
    // Neither reader may hardcode its own copy.
    for (const consumer of ["electron/main.mjs", "electron/user-config.mjs"]) {
      const text = read(consumer);
      for (const literal of ["Alt+Shift+W", "Alt+Shift+S"]) {
        expect(text).not.toContain(literal);
      }
    }
  });

  it("is what both the registrar and the reporter call", () => {
    expect(read("electron/main.mjs")).toMatch(/wakeHotkey\(\)/);
    expect(read("electron/user-config.mjs")).toMatch(/wakeHotkey\(\)/);
  });
});
