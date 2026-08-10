// Electron-free coverage of the one module that owns writing to the vault
// (vault-write-path design D1/D2/D8): two spool-append shapes (sync for the
// run-finalize path, async for the capture tool), and an atomic note-page
// writer that never lets a model-supplied title choose a path.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendSpoolRecord,
  appendSpoolRecordSync,
  createNotePage,
  spoolFileFor,
  captureSpoolDir,
  runSpoolDir,
  sessionsSpoolDir,
  localIsoString,
  appendSpoolRecordTo,
  linkNotes,
  unlinkNotes,
  setNoteTags,
} from "./vault-write.mjs";
import { isUserNote } from "./vault-graph-parse.mjs";

async function withTempDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-vault-write-"));
  try {
    return await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("spoolFileFor", () => {
  it("names one file per day", () => {
    expect(spoolFileFor(new Date(Date.UTC(2026, 7, 4, 12, 0, 0)))).toBe("2026-08-04.md");
  });
});

describe("captureSpoolDir / runSpoolDir / sessionsSpoolDir", () => {
  it("place the three spools at fixed paths under the vault root", () => {
    expect(captureSpoolDir("/vault")).toBe(path.join("/vault", "inbox", "captures"));
    expect(runSpoolDir("/vault")).toBe(path.join("/vault", "inbox", "runs"));
    expect(sessionsSpoolDir("/vault")).toBe(path.join("/vault", "inbox", "sessions"));
  });

  // The spools need no galaxy exclusion of their own, because isUserNote already
  // matches on segments[0] — this pins that, so moving an area out from under
  // inbox/ fails here rather than silently turning every spooled record into a
  // galaxy node.
  it("keeps spooled records out of the galaxy through the existing inbox/ exclusion", () => {
    expect(isUserNote("inbox/sessions/2026-08-06.md")).toBe(false);
    expect(isUserNote("inbox/captures/2026-08-06.md")).toBe(false);
  });
});

describe("localIsoString", () => {
  // Local components, never Date.UTC: this must hold in every time zone, since
  // the point of it is that the value follows the machine's own clock.
  it("keeps the offset in the timestamp, so the value stays unambiguous", () => {
    const stamp = localIsoString(new Date(2026, 7, 6, 9, 30, 15));
    expect(stamp).toMatch(/^2026-08-06T09:30:15[+-]\d{2}:\d{2}$/);
  });

  it("does not report an early-morning local time under the previous day", () => {
    // The failure this guards: at UTC+7, 06:00 local is 23:00Z the day before,
    // so a UTC stamp buries this morning under yesterday's date.
    expect(localIsoString(new Date(2026, 7, 6, 6, 0, 0))).toContain("2026-08-06");
  });
});

describe("appendSpoolRecordTo", () => {
  it("appends to a named file and reports a failure instead of rejecting", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "inbox", "sessions");
      const first = await appendSpoolRecordTo({ dir: target, name: "2026-08-06.md", content: "one\n" });
      const second = await appendSpoolRecordTo({ dir: target, name: "2026-08-06.md", content: "two\n" });
      expect(second.ok).toBe(true);
      expect(first.file).toBe(second.file);
      expect(fs.readFileSync(second.file, "utf8")).toBe("one\ntwo\n");
    });

    const failing = await appendSpoolRecordTo({
      dir: "/vault",
      name: "2026-08-06.md",
      content: "x",
      io: /** @type {any} */ ({ promises: { mkdir: async () => { throw new Error("read-only fs"); } } }),
    });
    expect(failing).toEqual({ ok: false, error: "read-only fs" });
  });
});

describe("appendSpoolRecord (async)", () => {
  it("creates the file and its parent directory on first append", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "inbox", "captures");
      const result = await appendSpoolRecord({ dir: target, content: "## first\nhello\n" });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(result.file, "utf8")).toContain("hello");
    });
  });

  it("adds to the same file rather than replacing it on a second append", async () => {
    await withTempDir(async (dir) => {
      await appendSpoolRecord({ dir, content: "## a\n" });
      await appendSpoolRecord({ dir, content: "## b\n" });
      const file = path.join(dir, spoolFileFor(new Date()));
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain("## a");
      expect(text).toContain("## b");
    });
  });

  it("resolves { ok: false, error } rather than throwing when the write is rejected", async () => {
    const io = /** @type {any} */ ({
      promises: {
        mkdir: () => Promise.reject(new Error("ENOSPC")),
      },
    });
    const result = await appendSpoolRecord({ dir: "/nowhere", content: "x", io });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOSPC");
  });
});

describe("appendSpoolRecordSync", () => {
  it("honours the same never-throws contract as the async variant", () => {
    const io = /** @type {any} */ ({
      mkdirSync: () => {
        throw new Error("ENOSPC");
      },
    });
    const result = appendSpoolRecordSync({ dir: "/nowhere", content: "x", io });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOSPC");
  });

  it("appends to one file per day, accumulating rather than replacing", () => {
    withTempDir((dir) => {
      appendSpoolRecordSync({ dir, content: "## a\n" });
      appendSpoolRecordSync({ dir, content: "## b\n" });
      const file = path.join(dir, spoolFileFor(new Date()));
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain("## a");
      expect(text).toContain("## b");
      expect(fs.readdirSync(dir)).toHaveLength(1);
    });
  });
});

describe("createNotePage", () => {
  it("writes frontmatter and body for an ordinary title", async () => {
    await withTempDir(async (dir) => {
      const result = await createNotePage({ vaultDir: dir, title: "My Idea", tags: ["work"], body: "The body text." });
      expect(result.ok).toBe(true);
      const text = fs.readFileSync(result.file, "utf8");
      expect(text).toContain("title:");
      expect(text).toContain("My Idea");
      expect(text).toContain("tags:");
      expect(text).toContain("work");
      expect(text).toContain("The body text.");
    });
  });

  // A model-supplied title heard from a microphone is not a filename — design D8.
  it("sanitizes a title containing '../' path traversal to a safe basename inside the vault", async () => {
    await withTempDir(async (dir) => {
      const result = await createNotePage({ vaultDir: dir, title: "../../etc/passwd", body: "x" });
      expect(result.ok).toBe(true);
      const resolvedVault = path.resolve(dir);
      expect(path.resolve(result.file).startsWith(resolvedVault + path.sep)).toBe(true);
      expect(fs.existsSync(path.join(dir, "..", "..", "etc", "passwd"))).toBe(false);
    });
  });

  it("sanitizes a title containing a path separator to a safe basename inside the vault", async () => {
    await withTempDir(async (dir) => {
      const result = await createNotePage({ vaultDir: dir, title: "notes/secret", body: "x" });
      expect(result.ok).toBe(true);
      const resolvedVault = path.resolve(dir);
      expect(path.resolve(result.file).startsWith(resolvedVault + path.sep)).toBe(true);
      expect(fs.existsSync(path.join(dir, "notes"))).toBe(false);
    });
  });

  it("sanitizes a title containing a null byte to a safe basename inside the vault", async () => {
    await withTempDir(async (dir) => {
      const result = await createNotePage({ vaultDir: dir, title: "hello\0world", body: "x" });
      expect(result.ok).toBe(true);
      const resolvedVault = path.resolve(dir);
      expect(path.resolve(result.file).startsWith(resolvedVault + path.sep)).toBe(true);
    });
  });
});

// Structural vault edits (shared-focus design D7): enumerated named
// operations over markdown text — never a general content-write primitive.
describe("linkNotes", () => {
  it("inserts [[B]] into A and [[A]] into B", async () => {
    await withTempDir(async (dir) => {
      const pathA = path.join(dir, "A.md");
      const pathB = path.join(dir, "B.md");
      fs.writeFileSync(pathA, "# Alpha\nSome content.\n");
      fs.writeFileSync(pathB, "# Beta\nOther content.\n");
      const result = await linkNotes({ pathA, idA: "A", pathB, idB: "B" });
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(pathA, "utf8")).toContain("[[B]]");
      expect(fs.readFileSync(pathB, "utf8")).toContain("[[A]]");
    });
  });

  it("is idempotent when the link already exists — no duplicate, still reports success", async () => {
    await withTempDir(async (dir) => {
      const pathA = path.join(dir, "A.md");
      const pathB = path.join(dir, "B.md");
      fs.writeFileSync(pathA, "# Alpha\nAlready linked: [[B]]\n");
      fs.writeFileSync(pathB, "# Beta\nAlready linked: [[A]]\n");
      const result = await linkNotes({ pathA, idA: "A", pathB, idB: "B" });
      expect(result.ok).toBe(true);
      const textA = fs.readFileSync(pathA, "utf8");
      const textB = fs.readFileSync(pathB, "utf8");
      expect(textA.match(/\[\[B\]\]/g)).toHaveLength(1);
      expect(textB.match(/\[\[A\]\]/g)).toHaveLength(1);
    });
  });

  it("reports failure without touching the other file when one note cannot be read", async () => {
    await withTempDir(async (dir) => {
      const pathA = path.join(dir, "A.md");
      const pathB = path.join(dir, "missing.md");
      fs.writeFileSync(pathA, "# Alpha\n");
      const result = await linkNotes({ pathA, idA: "A", pathB, idB: "missing" });
      expect(result.ok).toBe(false);
      expect(fs.readFileSync(pathA, "utf8")).not.toContain("[[missing]]");
    });
  });
});

describe("unlinkNotes", () => {
  it("removes the link in both directions", async () => {
    await withTempDir(async (dir) => {
      const pathA = path.join(dir, "A.md");
      const pathB = path.join(dir, "B.md");
      fs.writeFileSync(pathA, "# Alpha\nSee [[B]] for more.\n");
      fs.writeFileSync(pathB, "# Beta\nSee [[A]] for more.\n");
      const result = await unlinkNotes({ pathA, idA: "A", pathB, idB: "B" });
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(pathA, "utf8")).not.toContain("[[B]]");
      expect(fs.readFileSync(pathB, "utf8")).not.toContain("[[A]]");
    });
  });

  it("reports success when the link was already absent", async () => {
    await withTempDir(async (dir) => {
      const pathA = path.join(dir, "A.md");
      const pathB = path.join(dir, "B.md");
      fs.writeFileSync(pathA, "# Alpha\n");
      fs.writeFileSync(pathB, "# Beta\n");
      const result = await unlinkNotes({ pathA, idA: "A", pathB, idB: "B" });
      expect(result.ok).toBe(true);
    });
  });
});

describe("setNoteTags", () => {
  it("rewrites frontmatter tags without disturbing the body", async () => {
    await withTempDir(async (dir) => {
      const notePath = path.join(dir, "A.md");
      fs.writeFileSync(notePath, "---\ntitle: Alpha\ntags:\n  - old\n---\nThe body text stays put.\n");
      const result = await setNoteTags({ path: notePath, tags: ["new", "tags"] });
      expect(result.ok).toBe(true);
      const text = fs.readFileSync(notePath, "utf8");
      expect(text).toContain("The body text stays put.");
      expect(text).toContain("new");
      expect(text).toContain("tags");
      expect(text).not.toMatch(/- old/);
    });
  });

  it("reports a note with malformed frontmatter rather than corrupting it", async () => {
    await withTempDir(async (dir) => {
      const notePath = path.join(dir, "A.md");
      const original = "---\ntitle: [unclosed\n---\nBody.\n";
      fs.writeFileSync(notePath, original);
      const result = await setNoteTags({ path: notePath, tags: ["x"] });
      expect(result.ok).toBe(false);
      expect(fs.readFileSync(notePath, "utf8")).toBe(original);
    });
  });
});
