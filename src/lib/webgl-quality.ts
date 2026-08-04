// webgl-quality-mode: the single definition of the WebGL quality preference
// and what it means for every WebGL surface in the app. Absent or
// unparseable storage resolves to the light path (design.md D6) — the
// cheapest path is the default path, with no migration step needed.

export const WEBGL_QUALITY_STORAGE_KEY = "iris.webglHighFidelity";

export function readWebglHighFidelity(stored: string | null): boolean {
  return stored === "on";
}

export type OrbGlSettings = {
  antialias: boolean;
  powerPreference: "high-performance" | "default";
};

export type WebglSurfaceSettings = {
  orb: {
    gl: OrbGlSettings;
    dpr: number;
    unlitMaterials: boolean;
    bloom: boolean;
  };
  backdrop: {
    mount: boolean;
  };
  galaxy: {
    bloom: boolean;
  };
};

// One derivation per preference value, read by every surface (design.md D1)
// — the orb, the deck backdrop, and the galaxy — so a fourth WebGL surface
// added later has one obvious place to ask instead of a new conditional.
export function deriveWebglSettings(highFidelity: boolean, devicePixelRatio: number): WebglSurfaceSettings {
  return {
    orb: {
      gl: highFidelity
        ? { antialias: true, powerPreference: "high-performance" }
        : { antialias: false, powerPreference: "default" },
      // Unclamped (today's behavior) on the high-fidelity path; clamped to
      // 1.5 on the light path — never above the display's own ratio
      // (design.md D4).
      dpr: highFidelity ? devicePixelRatio : Math.min(devicePixelRatio, 1.5),
      unlitMaterials: !highFidelity,
      bloom: highFidelity,
    },
    backdrop: { mount: highFidelity },
    galaxy: { bloom: highFidelity },
  };
}
