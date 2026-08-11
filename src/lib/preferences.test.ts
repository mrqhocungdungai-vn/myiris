import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseFlag,
  parseChoice,
  flagToStored,
  readFlag,
  readChoice,
  writeFlag,
  writePreference,
  SOUNDS_STORAGE_KEY,
  HAND_STORAGE_KEY,
  AMBIENT_CAPTURE_STORAGE_KEY,
  HUD_CAMERA_SIZE_STORAGE_KEY,
  LISTEN_ONLY_CONSENT_STORAGE_KEY,
} from "./preferences";

// The parse half needs no storage at all — that is the point of the split.
describe("parseFlag", () => {
  it("reads the two meaningful values regardless of the default", () => {
    expect(parseFlag("on", false)).toBe(true);
    expect(parseFlag("on", true)).toBe(true);
    expect(parseFlag("off", false)).toBe(false);
    expect(parseFlag("off", true)).toBe(false);
  });

  // Absent and unrecognized must behave identically, or a half-written or
  // hand-edited value silently flips a preference.
  it("resolves anything else to the preference's own default", () => {
    for (const stored of [null, "", "garbage", "true", "ON", "1"]) {
      expect(parseFlag(stored, true)).toBe(true);
      expect(parseFlag(stored, false)).toBe(false);
    }
  });

  // These three assertions are the reason this module takes the default as an
  // argument: they are the rules the eight hand-written loaders encoded, and
  // they disagree with each other on purpose.
  it("preserves each documented default", () => {
    // Interface sounds: ON unless explicitly turned off.
    expect(parseFlag(null, true)).toBe(true);
    // Ambient capture: OFF unless explicitly turned on (the safer default).
    expect(parseFlag(null, false)).toBe(false);
    // HUD camera: reverts to standard, never "stuck enlarged with no way back".
    expect(parseFlag("nonsense", false)).toBe(false);
  });

  it("is exactly the two rules it replaced", () => {
    for (const stored of [null, "", "on", "off", "garbage"]) {
      expect(parseFlag(stored, true)).toBe(stored !== "off");
      expect(parseFlag(stored, false)).toBe(stored === "on");
    }
  });
});

describe("parseChoice", () => {
  it("resolves an absent or empty choice to the fallback device", () => {
    expect(parseChoice(null, "system-default")).toBe("system-default");
    expect(parseChoice("", "system-default")).toBe("system-default");
  });

  it("returns a stored device id unchanged", () => {
    expect(parseChoice("abc123", "system-default")).toBe("abc123");
  });
});

describe("flagToStored", () => {
  it("round-trips through parseFlag for both values", () => {
    expect(parseFlag(flagToStored(true), false)).toBe(true);
    expect(parseFlag(flagToStored(false), true)).toBe(false);
  });
});

// The impure half: what happens when storage itself is hostile.
describe("storage failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const throwingStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };

  it("reads every preference at its stated default when storage throws", () => {
    vi.stubGlobal("window", { localStorage: throwingStorage });
    // Sounds default ON; the other three default OFF.
    expect(readFlag(SOUNDS_STORAGE_KEY, true)).toBe(true);
    expect(readFlag(HAND_STORAGE_KEY, false)).toBe(false);
    expect(readFlag(AMBIENT_CAPTURE_STORAGE_KEY, false)).toBe(false);
    expect(readFlag(HUD_CAMERA_SIZE_STORAGE_KEY, false)).toBe(false);
  });

  // Unreadable storage must show the consent notice again rather than swallow
  // it: a repeated consent statement is a nuisance, a missing one is not.
  it("fails OPEN on the listen-only consent notice", () => {
    vi.stubGlobal("window", { localStorage: throwingStorage });
    expect(readFlag(LISTEN_ONLY_CONSENT_STORAGE_KEY, false)).toBe(false);
  });

  it("falls back to the default device when storage throws", () => {
    vi.stubGlobal("window", { localStorage: throwingStorage });
    expect(readChoice("iris.micDeviceId", "system-default")).toBe("system-default");
  });

  // A failed write must not propagate: the caller has already set React state,
  // so the toggle works for this session and only fails to survive a restart.
  it("swallows a failed write rather than breaking the toggle", () => {
    vi.stubGlobal("window", { localStorage: throwingStorage });
    expect(() => writeFlag(SOUNDS_STORAGE_KEY, true)).not.toThrow();
    expect(() => writePreference("iris.micDeviceId", "abc")).not.toThrow();
  });
});

describe("reading and writing against a working store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function memoryStorage(seed: Record<string, string> = {}) {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => void map.set(k, v),
      dump: () => Object.fromEntries(map),
    };
  }

  it("round-trips a flag through storage", () => {
    const store = memoryStorage();
    vi.stubGlobal("window", { localStorage: store });
    writeFlag(HAND_STORAGE_KEY, true);
    expect(store.dump()[HAND_STORAGE_KEY]).toBe("on");
    expect(readFlag(HAND_STORAGE_KEY, false)).toBe(true);
    writeFlag(HAND_STORAGE_KEY, false);
    expect(readFlag(HAND_STORAGE_KEY, false)).toBe(false);
  });

  it("honours a stored value over the default", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage({ [SOUNDS_STORAGE_KEY]: "off" }) });
    expect(readFlag(SOUNDS_STORAGE_KEY, true)).toBe(false);
  });
});
