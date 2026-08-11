import fs from "node:fs";
import path from "node:path";

// Resolving a note **identity** to a real, in-vault file path.
//
// A security boundary, and the spec is explicit about why: the capability
// "SHALL NOT accept a filesystem path from the renderer or from a model"
// (personal-knowledge-notes). Only an id is ever accepted, and the file it
// resolves to is re-checked against the vault **after** symlinks are resolved,
// so a symlink pointing outside cannot be followed.
//
// Shared by read-note and the whole structural-edit surface so the guard exists
// in exactly one place. It was previously a closure inside the capability and
// therefore untestable; the two collaborators it needs are injected instead.

/** Ids longer than this are rejected outright — a real note id is far shorter. */
export const MAX_NOTE_ID_LENGTH = 512;

/**
 * Whether a value is shaped like a note id at all.
 *
 * Applied at **every** entry point that accepts an id from the renderer or a
 * model — the path resolver here, plus `set-focus` and `note-opened` — because
 * an XSS-in-renderer or a model could pass anything. It is one function rather
 * than three copies of the same three-clause check, which is how one of them
 * ends up with a different bound.
 */
export function isNoteId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NOTE_ID_LENGTH;
}

/**
 * @param {{ vaultDir: string, resolveNotePath: (id: string) => string | null }} deps
 */
export function createNotePathResolver({ vaultDir, resolveNotePath }) {
  /**
   * The absolute path for `id`, or null if it does not resolve to a real file
   * inside the vault.
   *
   * Type- and bound-checks `id` first: an XSS-in-renderer, or a model, could
   * pass anything at all.
   */
  return function resolveVaultNotePath(id) {
    if (!isNoteId(id)) return null;
    const notePath = resolveNotePath(id);
    if (!notePath) return null; // ghost node, unknown id, or since-removed file
    let realNotePath;
    let realVaultDir;
    try {
      realNotePath = fs.realpathSync(notePath);
      realVaultDir = fs.realpathSync(vaultDir);
    } catch {
      return null;
    }
    // Compared AFTER realpath on both sides, so a symlink out of the vault is
    // caught rather than followed.
    const withinVault = realNotePath === realVaultDir || realNotePath.startsWith(realVaultDir + path.sep);
    return withinVault ? realNotePath : null;
  };
}
