import { describe, it, expect } from "vitest";
import {
  PREPARED_MATERIAL_MAX_CHARS,
  gatherPreparedMaterial,
  readPreparedMaterial,
  selectPreparedMaterial,
} from "./prepared-material.mjs";

/**
 * A fake `fs` over a flat `{ "/prep/a.md": "text" }` map — every path is a file,
 * and the directories between them are inferred. Faking the filesystem rather
 * than writing one keeps this a test of the walk's rules (extensions, skips,
 * caps) rather than of the OS, and lets a "file" throw on read on demand.
 *
 * @param {Record<string, string | Error>} tree
 */
function fakeFs(tree) {
  const paths = Object.keys(tree);
  return {
    readdirSync(dir, options) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const names = new Map();
      for (const full of paths) {
        if (!full.startsWith(prefix)) continue;
        const rest = full.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) names.set(rest, false);
        else names.set(rest.slice(0, slash), true);
      }
      if (names.size === 0) throw new Error(`ENOENT: ${dir}`);
      // Reversed on the way out so nothing can quietly depend on insertion
      // order — the walk sorts, and this is what proves it.
      const entries = [...names].reverse();
      if (!options?.withFileTypes) return entries.map(([name]) => name);
      return entries.map(([name, isDir]) => ({ name, isDirectory: () => isDir, isFile: () => !isDir }));
    },
    readFileSync(file) {
      const content = tree[file];
      if (content === undefined) throw new Error(`ENOENT: ${file}`);
      if (content instanceof Error) throw content;
      return content;
    },
  };
}

describe("readPreparedMaterial", () => {
  it("reads only .md and .txt, with paths relative to the folder", () => {
    const fs = fakeFs({
      "/prep/answers.md": "the prepared answer",
      "/prep/notes.txt": "a plain note",
      "/prep/deck.pdf": "binary",
      "/prep/index.js": "code",
      "/prep/nested/more.md": "nested material",
    });

    const { files, truncated } = readPreparedMaterial({ folder: "/prep", fs });

    expect(files.map((file) => file.path)).toEqual(["answers.md", "notes.txt", "nested/more.md"]);
    expect(files[0].text).toBe("the prepared answer");
    expect(truncated).toBe(false);
  });

  it("skips the named and dotted directories, at any depth", () => {
    const fs = fakeFs({
      "/prep/keep.md": "keep",
      "/prep/node_modules/pkg/readme.md": "dependency",
      "/prep/dist/out.md": "built",
      "/prep/build/out.md": "built",
      "/prep/.git/COMMIT_EDITMSG.txt": "history",
      "/prep/.obsidian/config.md": "editor state",
      "/prep/deep/node_modules/pkg/readme.md": "nested dependency",
      "/prep/deep/real.md": "deep material",
    });

    const { files } = readPreparedMaterial({ folder: "/prep", fs });

    expect(files.map((file) => file.path)).toEqual(["keep.md", "deep/real.md"]);
  });

  it("stops at the file-count cap and says it truncated", () => {
    const fs = fakeFs({ "/prep/a.md": "a", "/prep/b.md": "b", "/prep/c.md": "c" });

    const { files, truncated } = readPreparedMaterial({ folder: "/prep", fs, fileLimit: 2 });

    expect(files.map((file) => file.path)).toEqual(["a.md", "b.md"]);
    expect(truncated).toBe(true);
  });

  it("stops at the total-size cap and says it truncated", () => {
    const fs = fakeFs({ "/prep/a.md": "x".repeat(60), "/prep/b.md": "y".repeat(60) });

    const { files, truncated } = readPreparedMaterial({ folder: "/prep", fs, maxChars: 100 });

    expect(files.map((file) => file.path)).toEqual(["a.md"]);
    expect(truncated).toBe(true);
  });

  it("keeps the opening of a single file that overflows the cap on its own", () => {
    const fs = fakeFs({ "/prep/long.md": "z".repeat(500) });

    const { files, truncated } = readPreparedMaterial({ folder: "/prep", fs, maxChars: 100 });

    expect(files).toHaveLength(1);
    expect(files[0].text).toHaveLength(100);
    expect(truncated).toBe(true);
  });

  it("does not claim truncation when the whole folder fit", () => {
    const fs = fakeFs({ "/prep/a.md": "a", "/prep/b.md": "b" });

    expect(readPreparedMaterial({ folder: "/prep", fs, fileLimit: 2, maxChars: 2 }).truncated).toBe(false);
  });

  it("skips an unreadable file without calling it a truncation", () => {
    const fs = fakeFs({ "/prep/broken.md": new Error("EACCES"), "/prep/fine.md": "fine" });

    const { files, truncated } = readPreparedMaterial({ folder: "/prep", fs });

    expect(files.map((file) => file.path)).toEqual(["fine.md"]);
    expect(truncated).toBe(false);
  });

  it("returns empty rather than throwing for a folder that is not there", () => {
    const fs = fakeFs({ "/prep/a.md": "a" });

    expect(readPreparedMaterial({ folder: "/gone", fs })).toEqual({ files: [], truncated: false });
    expect(readPreparedMaterial({ folder: null, fs })).toEqual({ files: [], truncated: false });
    expect(readPreparedMaterial()).toEqual({ files: [], truncated: false });
  });
});

describe("selectPreparedMaterial", () => {
  const files = [
    { path: "unrelated.md", text: `${"padding ".repeat(20)}quarterly invoicing spreadsheet` },
    { path: "answers.md", text: `${"padding ".repeat(20)}how the listening window expires` },
  ];

  it("is the identity under the bound, and does not claim it narrowed", () => {
    expect(selectPreparedMaterial({ files, question: "anything", maxChars: 10_000 })).toEqual({ files, narrowed: false });
  });

  it("narrows to the plausible file over the unrelated one, and says so", () => {
    const result = selectPreparedMaterial({ files, question: "How does the listening window expire?", maxChars: 200 });

    expect(result.files.map((file) => file.path)).toEqual(["answers.md"]);
    expect(result.narrowed).toBe(true);
  });

  it("matches across case and accents, like the note-title lookup", () => {
    const accented = [
      { path: "khac.md", text: `${"đệm ".repeat(40)}bảng kê hoá đơn` },
      { path: "cua-so.md", text: `${"đệm ".repeat(40)}CỬA SỔ nghe kết thúc thế nào` },
    ];

    const result = selectPreparedMaterial({ files: accented, question: "cua so nghe", maxChars: 200 });

    expect(result.files.map((file) => file.path)).toEqual(["cua-so.md"]);
  });

  it("cuts the best candidate rather than returning nothing when no file fits whole", () => {
    const result = selectPreparedMaterial({
      files: [{ path: "one.md", text: "x".repeat(300) }],
      question: "anything",
      maxChars: 100,
    });

    expect(result.files[0].text).toHaveLength(100);
    expect(result.narrowed).toBe(true);
  });

  it("narrows in folder order when the question matches nothing", () => {
    const result = selectPreparedMaterial({ files, question: "zzzz", maxChars: 200 });

    expect(result.files.map((file) => file.path)).toEqual(["unrelated.md"]);
    expect(result.narrowed).toBe(true);
  });
});

describe("gatherPreparedMaterial", () => {
  it("reports the walk's truncation and the bound's narrowing separately", () => {
    const fs = fakeFs({ "/prep/a.md": "alpha material", "/prep/b.md": "beta material" });

    const result = gatherPreparedMaterial({ folder: "/prep", question: "beta", fs, fileLimit: 1 });

    expect(result.files.map((file) => file.path)).toEqual(["a.md"]);
    expect(result.truncated).toBe(true);
    expect(result.narrowed).toBe(false);
  });

  it("bounds at PREPARED_MATERIAL_MAX_CHARS by default", () => {
    const fs = fakeFs({
      "/prep/a.md": "a".repeat(PREPARED_MATERIAL_MAX_CHARS),
      "/prep/b.md": "beta on the listening window",
    });

    const result = gatherPreparedMaterial({ folder: "/prep", question: "listening window", fs });

    expect(result.files.map((file) => file.path)).toEqual(["b.md"]);
    expect(result.narrowed).toBe(true);
  });
});
