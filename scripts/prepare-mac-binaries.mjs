// Ensures BOTH macOS Claude native binaries are installed before packaging.
//
// npm installs an optional dependency only when its `os`/`cpu` match the host,
// so `npm ci` on an Intel Mac gets darwin-x64 and nothing else — an arm64 build
// from that machine would ship without a Claude binary at all. `npm install
// --os/--cpu` does NOT get around this: npm 11 still rejects the foreign package
// with EBADPLATFORM (verified). Fetching the tarball with `npm pack` and
// unpacking it into node_modules ourselves is the path that actually works,
// since the platform check lives in the installer, not in the registry.
//
// The version is read from the installed SDK rather than hardcoded: the native
// binary and its JS wrapper are released in lockstep and a mismatched pair is a
// silent incompatibility (the SDK's manifest.json records which wrapper
// versions each binary was tested against).
//
// Run before `npm run package:mac` / `dist:mac`. scripts/prune-foreign-arch.mjs
// then removes the wrong one from each individual .app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
// Read the manifest off disk rather than require()-ing it: the SDK's `exports`
// map does not expose "./package.json", so a subpath resolve is a hard error.
const sdkVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8"),
).version;

const ARCHES = ["x64", "arm64"];

let installed = 0;
for (const arch of ARCHES) {
  const pkg = `@anthropic-ai/claude-agent-sdk-darwin-${arch}`;
  const binary = path.join(repoRoot, "node_modules", pkg, "claude");

  if (fs.existsSync(binary)) {
    console.log(`[prepare-mac-binaries] ${pkg}@${sdkVersion} already present`);
    continue;
  }

  console.log(`[prepare-mac-binaries] fetching ${pkg}@${sdkVersion} (~250 MB)…`);
  const stage = fs.mkdtempSync(path.join(repoRoot, "node_modules", ".iris-pack-"));
  try {
    // Deliberately not `npm install`: see the header. The tarball is fetched and
    // unpacked directly, which no platform check applies to.
    const packed = execFileSync("npm", ["pack", `${pkg}@${sdkVersion}`, "--silent", `--pack-destination=${stage}`], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .pop();

    // npm tarballs always root everything under `package/`, which --strip-components peels off.
    const target = path.join(repoRoot, "node_modules", pkg);
    fs.mkdirSync(target, { recursive: true });
    execFileSync("tar", ["-xzf", path.join(stage, packed), "-C", target, "--strip-components=1"], {
      stdio: "inherit",
    });

    // tar preserves the mode from the archive, but a lost executable bit here
    // would only surface much later as an opaque spawn failure — make it certain.
    fs.chmodSync(path.join(target, "claude"), 0o755);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  installed += 1;
}

for (const arch of ARCHES) {
  const binary = path.join(repoRoot, "node_modules", `@anthropic-ai/claude-agent-sdk-darwin-${arch}`, "claude");
  if (!fs.existsSync(binary)) {
    throw new Error(`[prepare-mac-binaries] ${binary} is still missing after install — cannot package for ${arch}.`);
  }
}

console.log(`[prepare-mac-binaries] OK — both darwin binaries present (${installed} newly installed).`);
