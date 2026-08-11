import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNotePathResolver, isNoteId, MAX_NOTE_ID_LENGTH } from "./second-brain-note-path.mjs";

// A security boundary. The spec is explicit: the capability "SHALL NOT accept a
// filesystem path from the renderer or from a model" (personal-knowledge-notes)
// — only an id — and the file that id resolves to must be re-checked against the
// vault *after* symlinks are resolved.
//
// It was a closure inside the capability and had no test of its own. These use
// a real temp vault with a real symlink, because the whole point is what the
// filesystem does, not what a mock says it does.

let root;
let vaultDir;
let outsideDir;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "iris-notepath-"));
  vaultDir = path.join(root, "vault");
  outsideDir = path.join(root, "outside");
  fs.mkdirSync(vaultDir);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(vaultDir, "real.md"), "# real");
  fs.writeFileSync(path.join(outsideDir, "secret.md"), "# secret");
  // A symlink that lives inside the vault but points out of it.
  fs.symlinkSync(path.join(outsideDir, "secret.md"), path.join(vaultDir, "escape.md"));
  // A vault directory that is itself reached through a symlink — realpath must
  // be applied to BOTH sides or an ordinary note stops resolving.
  fs.symlinkSync(vaultDir, path.join(root, "vault-link"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** The graph maps an id to a path; the resolver decides whether to trust it. */
const resolverFor = (map, dir = vaultDir) =>
  createNotePathResolver({ vaultDir: dir, resolveNotePath: (id) => map[id] ?? null });

describe("identity checks", () => {
  // Built inside each test: the temp vault does not exist at describe time.
  const resolve = (id) => resolverFor({ good: path.join(vaultDir, "real.md") })(id);

  it("accepts a real in-vault note", () => {
    expect(resolve("good")).toBe(fs.realpathSync(path.join(vaultDir, "real.md")));
  });

  // An XSS-in-renderer, or a model, could pass anything at all.
  it("rejects anything that is not a non-empty string", () => {
    for (const bad of [null, undefined, 42, {}, [], true, ""]) {
      expect(resolve(bad), String(bad)).toBeNull();
    }
  });

  it("rejects an over-long id without touching the filesystem", () => {
    expect(resolve("x".repeat(MAX_NOTE_ID_LENGTH + 1))).toBeNull();
  });

  it("rejects a ghost node, an unknown id, or a since-removed file", () => {
    expect(resolve("unknown")).toBeNull();
    expect(resolverFor({ gone: path.join(vaultDir, "deleted.md") })("gone")).toBeNull();
  });
});

// The attack this exists to stop.
describe("containment", () => {
  it("refuses a symlink that points out of the vault", () => {
    const resolve = resolverFor({ escape: path.join(vaultDir, "escape.md") });
    expect(resolve("escape")).toBeNull();
  });

  it("refuses a path outside the vault even when the graph offers one", () => {
    const resolve = resolverFor({ outside: path.join(outsideDir, "secret.md") });
    expect(resolve("outside")).toBeNull();
  });

  // A sibling whose name merely starts with the vault's name is not inside it.
  it("does not accept a sibling directory sharing the vault's prefix", () => {
    const sibling = `${vaultDir}-other`;
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "note.md"), "# nope");
    const resolve = resolverFor({ near: path.join(sibling, "note.md") });
    expect(resolve("near")).toBeNull();
  });

  // realpath must be applied to BOTH sides, or a vault reached through a
  // symlink would reject every one of its own notes.
  it("still resolves notes when the vault itself is reached via a symlink", () => {
    const resolve = resolverFor({ good: path.join(vaultDir, "real.md") }, path.join(root, "vault-link"));
    expect(resolve("good")).toBe(fs.realpathSync(path.join(vaultDir, "real.md")));
  });
});

// Applied at every entry point that accepts an id from the renderer or a model.
// It is one function rather than three copies of the same three-clause check —
// which is how one of them ends up with a different bound.
describe("isNoteId", () => {
  it("accepts an ordinary id", () => {
    expect(isNoteId("a-note")).toBe(true);
    expect(isNoteId("x".repeat(MAX_NOTE_ID_LENGTH))).toBe(true);
  });

  it("rejects anything that is not a non-empty string", () => {
    for (const bad of [null, undefined, 0, 42, {}, [], true, ""]) {
      expect(isNoteId(bad), String(bad)).toBe(false);
    }
  });

  it("rejects one character past the bound", () => {
    expect(isNoteId("x".repeat(MAX_NOTE_ID_LENGTH + 1))).toBe(false);
  });
});
