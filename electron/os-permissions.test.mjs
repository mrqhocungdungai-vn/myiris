import { describe, it, expect } from "vitest";
import {
  OS_PERMISSIONS,
  READABLE_OS_PERMISSIONS,
  canPromptInApp,
  isPromptablePermission,
  isReadablePermission,
  needsSettingsRoute,
  settingsLocation,
  settingsLocations,
  toPermissionState,
} from "./os-permissions.mjs";

describe("os-permissions: the four states", () => {
  it("maps each platform status the panel acts on", () => {
    expect(toPermissionState("granted")).toBe("granted");
    expect(toPermissionState("denied")).toBe("denied");
    expect(toPermissionState("not-determined")).toBe("not-determined");
  });

  // The whole point of the mapping: a permission refused by device policy is
  // not one the user has simply not been asked about yet. Folding it into
  // not-determined would offer a prompt that returns without asking.
  it("keeps restricted distinct from not-determined", () => {
    expect(toPermissionState("restricted")).toBe("restricted");
    expect(toPermissionState("restricted")).not.toBe(toPermissionState("not-determined"));
  });

  it("treats an unrecognised state as not-determined, which offers the prompt", () => {
    expect(toPermissionState("unknown")).toBe("not-determined");
    expect(toPermissionState("")).toBe("not-determined");
    expect(toPermissionState(undefined)).toBe("not-determined");
    expect(toPermissionState(null)).toBe("not-determined");
    expect(toPermissionState(42)).toBe("not-determined");
  });

  it("offers the in-app prompt only where asking still works", () => {
    expect(canPromptInApp("not-determined")).toBe(true);
    expect(canPromptInApp("denied")).toBe(false);
    expect(canPromptInApp("restricted")).toBe(false);
    expect(canPromptInApp("granted")).toBe(false);
  });

  it("routes to settings for both states the user cannot resolve in-app", () => {
    expect(needsSettingsRoute("denied")).toBe(true);
    expect(needsSettingsRoute("restricted")).toBe(true);
    expect(needsSettingsRoute("not-determined")).toBe(false);
    expect(needsSettingsRoute("granted")).toBe(false);
  });
});

describe("os-permissions: settings locations", () => {
  it("builds a link and a written path for every permission the panel shows", () => {
    for (const permission of OS_PERMISSIONS) {
      const location = settingsLocation(permission);
      expect(location).not.toBeNull();
      expect(location.url.startsWith("x-apple.systempreferences:")).toBe(true);
      expect(location.writtenPath.length).toBeGreaterThan(0);
    }
  });

  it("uses the modern Privacy & Security pane identifier, not the legacy alias", () => {
    const location = settingsLocation("microphone");
    expect(location.url).toContain("com.apple.settings.PrivacySecurity.extension");
    expect(location.url).not.toContain("com.apple.preference.security");
  });

  it("anchors each permission at its own pane", () => {
    expect(settingsLocation("microphone").url).toContain("Privacy_Microphone");
    expect(settingsLocation("camera").url).toContain("Privacy_Camera");
    expect(settingsLocation("system-audio").url).toContain("Privacy_ScreenCapture");
  });

  // The failing self-test verdicts route here, so the location has to exist
  // even though nothing can read the permission's state.
  it("includes system audio, whose state cannot be read", () => {
    expect(settingsLocation("system-audio")).not.toBeNull();
    expect(settingsLocation("system-audio").writtenPath).toContain("System Audio");
    expect(isReadablePermission("system-audio")).toBe(false);
    expect(isPromptablePermission("system-audio")).toBe(false);
  });

  it("reports no location for a permission it does not know", () => {
    expect(settingsLocation("bluetooth")).toBeNull();
    expect(settingsLocation("")).toBeNull();
  });

  it("exposes every location as one map for the renderer", () => {
    const locations = settingsLocations();
    expect(Object.keys(locations).sort()).toEqual([...OS_PERMISSIONS].sort());
    expect(locations.camera.writtenPath).toContain("Camera");
  });

  it("reads state only for the permissions the platform actually reports", () => {
    expect([...READABLE_OS_PERMISSIONS]).toEqual(["microphone", "camera"]);
    expect(isReadablePermission("microphone")).toBe(true);
    expect(isReadablePermission("camera")).toBe(true);
    expect(isReadablePermission("screen")).toBe(false);
  });
});
