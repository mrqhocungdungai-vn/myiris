// Pure, Electron-free coverage of the durability guarantees in
// openspec/changes/harden-config-persistence/specs/config-persistence/spec.md:
// atomic replace (no truncated file on crash, no leftover temp file), and
// quarantine (corrupt files preserved instead of overwritten).
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync, writeFileAtomicAsync, quarantineFile } from "./atomic-file.mjs";

let dirs = [];
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-file-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tmpLeftovers(dir, target) {
  return fs.readdirSync(dir).filter((name) => name !== path.basename(target) && name.includes(".tmp"));
}

describe("writeFileAtomicSync", () => {
  it("writes the given contents to the target", () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");

    writeFileAtomicSync(target, "hello world", "utf8");

    expect(fs.readFileSync(target, "utf8")).toBe("hello world");
  });

  it("leaves no temp file behind after a successful write", () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");

    writeFileAtomicSync(target, "hello world", "utf8");

    expect(tmpLeftovers(dir, target)).toEqual([]);
  });

  it("rethrows and leaves no temp file behind when the write fails", () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");

    // An object is not a valid fs.writeFileSync payload — throws a TypeError
    // before any rename, exercising the failure branch.
    expect(() => writeFileAtomicSync(target, { not: "a valid payload" })).toThrow();

    expect(fs.existsSync(target)).toBe(false);
    expect(tmpLeftovers(dir, target)).toEqual([]);
  });
});

describe("writeFileAtomicAsync", () => {
  it("writes the given contents to the target", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");

    await writeFileAtomicAsync(target, "hello world", "utf8");

    expect(fs.readFileSync(target, "utf8")).toBe("hello world");
  });

  it("leaves no temp file behind after a successful write", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");

    await writeFileAtomicAsync(target, "hello world", "utf8");

    expect(tmpLeftovers(dir, target)).toEqual([]);
  });

  it("rethrows and leaves no temp file behind when the write fails", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");

    await expect(writeFileAtomicAsync(target, { not: "a valid payload" })).rejects.toThrow();

    expect(fs.existsSync(target)).toBe(false);
    expect(tmpLeftovers(dir, target)).toEqual([]);
  });

  it("replaces existing contents at the target", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");
    fs.writeFileSync(target, "old contents");

    await writeFileAtomicAsync(target, "new contents", "utf8");

    expect(fs.readFileSync(target, "utf8")).toBe("new contents");
  });
});

describe("quarantineFile", () => {
  it("renames the target to a .corrupt-* path holding the original bytes, leaving the original path gone", () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "store.json");
    fs.writeFileSync(target, "not valid json{{{");

    const quarantined = quarantineFile(target);

    expect(quarantined).toMatch(/\.corrupt-\d+$/);
    expect(fs.readFileSync(quarantined, "utf8")).toBe("not valid json{{{");
    expect(fs.existsSync(target)).toBe(false);
  });
});
