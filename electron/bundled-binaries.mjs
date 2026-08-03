// Locates the executables Iris ships INSIDE the app, so a user installs nothing.
//
// `@anthropic-ai/claude-agent-sdk` declares one native-binary package per
// platform in its optionalDependencies (`@anthropic-ai/claude-agent-sdk-
// darwin-arm64` and friends); npm installs only the one matching the host. That
// binary IS Claude Code — the same program the CLI installs — so nothing here
// needs a host install to probe for.
//
// The one Electron-specific wrinkle this module exists to hide: `require.resolve`
// inside a packaged app returns a path inside `app.asar`, and **a subprocess
// cannot be exec'd from inside an asar archive**. electron-builder's `asarUnpack`
// writes a real on-disk copy to a sibling `app.asar.unpacked/` tree, so the
// resolved path has to be rewritten to point there. No other module should ever
// learn that asar exists — callers just get an absolute path.
//
// Verified empirically (see the refactor's Phase 0 spike): the native binary is
// fully self-contained. Hardlinked into a bare directory with no sibling files
// at all, addressed via `pathToClaudeCodeExecutable`, it ran a complete query
// successfully — it reads neither `manifest.json` nor anything else relative to
// its own location. That is what makes the unpacked rewrite safe.
//
// Electron-free by design (main-process-structure): every dependency is injected
// so this is importable in a plain vitest file.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const defaultRequire = createRequire(import.meta.url);

// A packaged path looks like /…/Resources/app.asar/node_modules/…; the unpacked
// twin is /…/Resources/app.asar.unpacked/node_modules/…. In dev there is no
// asar segment at all and this is a no-op.
export function toUnpackedPath(candidate, { existsSync = fs.existsSync, sep = path.sep } = {}) {
  const packed = `${sep}app.asar${sep}`;
  if (!candidate.includes(packed)) return candidate;
  const unpacked = candidate.replace(packed, `${sep}app.asar.unpacked${sep}`);
  // Fall back to the original if asarUnpack was misconfigured: the caller's own
  // executable check then produces a far clearer error than a missing-file
  // ENOENT from a path the user has never heard of.
  return existsSync(unpacked) ? unpacked : candidate;
}

// Finds a dependency's install directory. `${name}/package.json` resolves
// directly for packages without an `exports` map (the Claude binary packages),
// but an `exports` map that doesn't list "./package.json" makes that a hard
// error — @fission-ai/openspec is exactly that case. So fall back to resolving
// the package's main entry and walking up to the directory that owns it.
function resolvePackageRoot(requireImpl, existsSync, name) {
  try {
    return path.dirname(requireImpl.resolve(`${name}/package.json`));
  } catch {
    /* exports map hides package.json — fall through */
  }
  let dir = path.dirname(requireImpl.resolve(name));
  // Bounded walk: deep enough for dist/cjs/index.js nesting, short enough that
  // a bad resolve fails fast instead of climbing to the filesystem root.
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the install directory for ${name}.`);
}

/**
 * Absolute path to the Claude Code native binary shipped with the Agent SDK.
 * @param {{ requireImpl?: { resolve: (specifier: string) => string }, existsSync?: typeof fs.existsSync, platform?: string, arch?: string }} [deps]
 * @returns {string}
 */
export function resolveBundledClaude({
  requireImpl = defaultRequire,
  existsSync = fs.existsSync,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const pkg = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  let root;
  try {
    root = resolvePackageRoot(requireImpl, existsSync, pkg);
  } catch {
    throw new Error(
      `The bundled Claude binary for ${platform}-${arch} is missing (${pkg}). ` +
        "Reinstall dependencies with `npm ci`.",
    );
  }
  const binary = path.join(root, platform === "win32" ? "claude.exe" : "claude");
  return toUnpackedPath(binary, { existsSync });
}

/**
 * Absolute path to the bundled OpenSpec CLI entry point. Unlike Claude's, this
 * is a plain JS file, not a native executable — callers must run it through
 * Electron's own Node (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`) rather
 * than exec'ing it directly.
 * @param {{ requireImpl?: { resolve: (specifier: string) => string }, existsSync?: typeof fs.existsSync }} [deps]
 * @returns {string}
 */
export function resolveBundledOpenspec({ requireImpl = defaultRequire, existsSync = fs.existsSync } = {}) {
  let root;
  try {
    root = resolvePackageRoot(requireImpl, existsSync, "@fission-ai/openspec");
  } catch {
    throw new Error(
      "The bundled OpenSpec CLI is missing (@fission-ai/openspec). Reinstall dependencies with `npm ci`.",
    );
  }
  const entry = path.join(root, "bin", "openspec.js");
  return toUnpackedPath(entry, { existsSync });
}
