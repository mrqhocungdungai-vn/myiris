import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ID, PRODUCT_NAME, STATE_ROOT_DIR } from "./app-identity.mjs";
import { BUNDLE_ID as INSTALLER_BUNDLE_ID, PRODUCT_NAME as INSTALLER_PRODUCT_NAME } from "./mac-install-target.mjs";

const packageJson = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
);

// package.json is read by electron-builder as static JSON, so it cannot import
// app-identity.mjs and the duplication cannot be removed. This is the same
// situation mac-install-target.mjs documents for DEFAULT_SHUTDOWN_DEADLINE_MS:
// duplication that has to exist, with the invariant held by a test rather than
// left to inspection.
//
// It matters more here than it does there. The installer's ownership guard is the
// gate in front of an `rm -rf` under /Applications, and it is only protective
// while the identifier it compares against is the identifier the packaged bundle
// actually carries. If these two drift, the guard either refuses the app's own
// bundle forever, or — the reason the app-identity capability exists at all —
// accepts a bundle belonging to somebody else.
describe("app identity is declared once and package.json agrees", () => {
  it("matches the bundle identifier electron-builder writes into the bundle", () => {
    expect(packageJson.build.appId).toBe(BUNDLE_ID);
  });

  it("matches both product names electron-builder reads", () => {
    // Both, deliberately: build.productName names the .app, and the top-level
    // productName is what Electron falls back to. Letting them disagree produces a
    // bundle whose directory and executable names differ, which breaks the
    // installer's INSTALLED_EXECUTABLE probe.
    expect(packageJson.build.productName).toBe(PRODUCT_NAME);
    expect(packageJson.productName).toBe(PRODUCT_NAME);
  });

  it("is the same identity the installer's ownership guard compares against", () => {
    // mac-install-target.mjs re-exports rather than re-declares. Asserted anyway:
    // a well-meaning "remove the indirection" refactor would restore exactly the
    // split this test exists to prevent.
    expect(INSTALLER_BUNDLE_ID).toBe(BUNDLE_ID);
    expect(INSTALLER_PRODUCT_NAME).toBe(PRODUCT_NAME);
  });

  it("leaves the npm package name out of the identity", () => {
    // Deliberately NOT tracked with PRODUCT_NAME (see the app-identity proposal's
    // non-goals): it is never published and never reaches disk as an identifier.
    // Pinned so a future reader does not mistake the mismatch for an oversight and
    // "fix" it.
    expect(packageJson.name).toBe("iris-claude-voice");
  });
});

describe("the state root is a well-formed home-directory child", () => {
  it("is a dot-directory containing no separator", () => {
    // app-paths.mjs joins this straight onto $HOME. A root that is not hidden, or
    // that carries a separator, would put app state somewhere the user never
    // agreed to.
    expect(STATE_ROOT_DIR.startsWith(".")).toBe(true);
    expect(STATE_ROOT_DIR).not.toContain("/");
    expect(STATE_ROOT_DIR).not.toContain(path.sep);
  });
});
