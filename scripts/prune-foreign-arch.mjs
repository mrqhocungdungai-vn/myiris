// electron-builder afterPack hook: drop the Claude native binaries that do not
// match the architecture being packaged.
//
// The Agent SDK ships one ~250 MB native binary per platform/arch as separate
// optional dependencies. A build machine needs BOTH darwin binaries installed
// to be able to produce both Mac builds (see scripts/prepare-mac-binaries.mjs),
// but each individual .app must carry only its own — otherwise every download
// is ~250 MB heavier than it needs to be, for a binary that can never run on
// the target machine.
//
// This has to be afterPack, not beforePack: beforePack runs before app files are
// copied into appOutDir, so there would be nothing to prune yet. By afterPack the
// asarUnpack globs have already placed both packages in app.asar.unpacked, where
// they are real directories on disk and deleting one genuinely reclaims the space.
import fs from "node:fs";
import path from "node:path";

// electron-builder's Arch enum, which the hook receives as a number.
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const SDK_PREFIX = "claude-agent-sdk-";

export default async function pruneForeignArch(context) {
  const targetArch = ARCH_NAMES[context.arch] ?? String(context.arch);
  const platform = context.packager.platform.nodeName; // "darwin" | "win32" | "linux"

  // A universal build is a deliberate "carry everything" choice — pruning would
  // break the half of it that isn't the host arch.
  if (targetArch === "universal") {
    console.log("[prune-foreign-arch] universal build — keeping every native binary");
    return;
  }

  const unpackedModules = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "@anthropic-ai",
  );

  if (!fs.existsSync(unpackedModules)) {
    // Nothing to prune is not automatically fine: it usually means asarUnpack
    // did not match, which would leave the binary trapped inside the asar where
    // it cannot be spawned. Say so loudly rather than pass silently.
    console.warn(`[prune-foreign-arch] WARNING: no unpacked @anthropic-ai at ${unpackedModules}`);
    return;
  }

  const keep = `${SDK_PREFIX}${platform}-${targetArch}`;
  let removed = 0;
  let kept = null;

  for (const entry of fs.readdirSync(unpackedModules)) {
    if (!entry.startsWith(SDK_PREFIX)) continue;
    if (entry === keep) {
      kept = entry;
      continue;
    }
    fs.rmSync(path.join(unpackedModules, entry), { recursive: true, force: true });
    console.log(`[prune-foreign-arch] removed ${entry}`);
    removed += 1;
  }

  if (!kept) {
    // Shipping an .app whose Claude binary is missing produces a confusing
    // runtime failure for the user; fail the build instead.
    throw new Error(
      `[prune-foreign-arch] ${keep} is missing from the packaged app — ` +
        "run `node scripts/prepare-mac-binaries.mjs` before packaging.",
    );
  }
  console.log(`[prune-foreign-arch] ${targetArch}: kept ${kept}, removed ${removed}`);
}
