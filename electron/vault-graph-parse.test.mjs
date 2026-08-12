// Pure, Electron-free coverage of the vault-graph parser in
// openspec/specs/second-brain-layer/spec.md, "The vault graph is owned and kept fresh by the main process":
// wikilink forms/case-insensitive resolution, code-span/embed skipping,
// ghost-node synthesis, subfolder-collision id disambiguation, malformed
// frontmatter degrading a single note rather than failing the build, and the
// isUserNote exclusion predicate.
import { describe, it, expect } from "vitest";
import { isUserNote, parseVaultFiles } from "./vault-graph-parse.mjs";

function file(relativePath, content) {
  return { relativePath, absolutePath: `/vault/${relativePath}`, content };
}

describe("isUserNote", () => {
  it("excludes the LLM-Wiki system files at the vault root", () => {
    expect(isUserNote("index.md")).toBe(false);
    expect(isUserNote("log.md")).toBe(false);
    expect(isUserNote("wiki-config.md")).toBe(false);
    expect(isUserNote("wiki-schema.md")).toBe(false);
  });

  it("does not exclude a user note that happens to share a system file's basename deeper in the tree", () => {
    expect(isUserNote("projects/index.md")).toBe(true);
  });

  it("excludes plumbing folders at the vault root", () => {
    expect(isUserNote("templates/daily.md")).toBe(false);
    expect(isUserNote("raw/article.md")).toBe(false);
    expect(isUserNote("archive/old-note.md")).toBe(false);
    expect(isUserNote("ingested/paper.md")).toBe(false);
  });

  // vault-write-path design D5: the machine-written spool (run-outcome records
  // and captures awaiting curation) must never be counted as user notes, or
  // Iris's own bookkeeping accumulates as apparent knowledge, one node per day.
  it("excludes the machine-written spool at the vault root", () => {
    expect(isUserNote("inbox/runs/2026-08-04.md")).toBe(false);
    expect(isUserNote("inbox/captures/2026-08-04.md")).toBe(false);
  });

  it("does not exclude a user note nested below a non-root folder named like the spool", () => {
    expect(isUserNote("Projects/inbox/Idea.md")).toBe(true);
  });

  it("excludes dotfiles and dot-directories", () => {
    expect(isUserNote(".DS_Store")).toBe(false);
    expect(isUserNote(".obsidian/workspace.json")).toBe(false);
  });

  it("excludes common editor temp/lock file shapes", () => {
    expect(isUserNote("Ideas.md~")).toBe(false);
    expect(isUserNote("Ideas.md.tmp")).toBe(false);
    expect(isUserNote("~$Ideas.md")).toBe(false);
  });

  it("allows an ordinary user note", () => {
    expect(isUserNote("Ideas.md")).toBe(true);
    expect(isUserNote("projects/Iris.md")).toBe(true);
  });
});

describe("parseVaultFiles", () => {
  it("builds one node per note and one link per resolved wikilink", () => {
    const { nodes, links } = parseVaultFiles([file("A.md", "Links to [[B]]."), file("B.md", "No links here.")]);

    expect(nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(links).toEqual([{ source: "A", target: "B" }]);
  });

  it("resolves [[Note|alias]] and [[Note#heading]] to the base note", () => {
    const { nodes, links } = parseVaultFiles([file("A.md", "See [[B|the other note]] and [[B#Section]]."), file("B.md", "")]);

    expect(nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    // Two mentions of the same target collapse to a single edge.
    expect(links).toEqual([{ source: "A", target: "B" }]);
  });

  it("resolves wikilinks case-insensitively", () => {
    const { nodes, links } = parseVaultFiles([file("A.md", "Links to [[hello world]]."), file("Hello World.md", "")]);

    expect(nodes.find((n) => n.ghost)).toBeUndefined();
    expect(links).toEqual([{ source: "A", target: "Hello World" }]);
  });

  it("skips wikilink-like text inside fenced code blocks", () => {
    const { nodes, links } = parseVaultFiles([file("A.md", "```\n[[NotALink]]\n```\nreal text")]);

    expect(nodes.map((n) => n.id)).toEqual(["A"]);
    expect(links).toEqual([]);
  });

  it("skips wikilink-like text inside inline code spans", () => {
    const { links } = parseVaultFiles([file("A.md", "Use `[[NotALink]]` syntax to link notes.")]);

    expect(links).toEqual([]);
  });

  it("skips ![[embed]] transclusions", () => {
    const { nodes, links } = parseVaultFiles([file("A.md", "![[Embedded Image]]")]);

    expect(links).toEqual([]);
    expect(nodes.map((n) => n.id)).toEqual(["A"]);
  });

  it("synthesizes a ghost node for an unresolved wikilink target", () => {
    const { nodes, links } = parseVaultFiles([file("A.md", "Links to [[NonExistent]].")]);

    const ghost = nodes.find((n) => n.id === "NonExistent");
    expect(ghost).toBeDefined();
    expect(ghost.ghost).toBe(true);
    expect(ghost.path).toBeNull();
    expect(links).toEqual([{ source: "A", target: "NonExistent" }]);
  });

  it("disambiguates node ids by full relative path on a basename collision", () => {
    const { nodes } = parseVaultFiles([file("projects/Ideas.md", ""), file("personal/Ideas.md", "")]);

    expect(nodes.map((n) => n.id).sort()).toEqual(["personal/Ideas", "projects/Ideas"]);
  });

  it("uses the bare basename as id when there is no collision", () => {
    const { nodes } = parseVaultFiles([file("projects/Ideas.md", "")]);

    expect(nodes.map((n) => n.id)).toEqual(["Ideas"]);
  });

  // The scanner filters by isUserNote before this ever sees a file, but a
  // regression there would otherwise turn a spool file into a junk node — this
  // asserts the same filtering the scanner applies end-to-end.
  it("yields only the real note when a spool file and a real note both pass through the isUserNote filter", () => {
    const allFiles = [file("inbox/runs/2026-08-04.md", "## a run"), file("Ideas.md", "")];
    const { nodes } = parseVaultFiles(allFiles.filter((f) => isUserNote(f.relativePath)));

    expect(nodes.map((n) => n.id)).toEqual(["Ideas"]);
  });

  it("parses frontmatter tags into node color groups", () => {
    const { nodes } = parseVaultFiles([file("A.md", "---\ntags: [work, urgent]\n---\nbody")]);

    expect(nodes[0].tags).toEqual(["work", "urgent"]);
  });

  it("normalizes a CSV-string tags shape", () => {
    const { nodes } = parseVaultFiles([file("A.md", "---\ntags: work, urgent\n---\nbody")]);

    expect(nodes[0].tags).toEqual(["work", "urgent"]);
  });

  it("degrades a note with malformed YAML frontmatter to a tagless node instead of failing the build", () => {
    const { nodes } = parseVaultFiles([file("A.md", "---\ntags: [oops\n---\nbody with [[B]]"), file("B.md", "")]);

    const a = nodes.find((n) => n.id === "A");
    expect(a.malformed).toBe(true);
    expect(a.tags).toEqual([]);
    expect(nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("keeps the note's absolute path as an internal field, not exposed as ghost", () => {
    const { nodes } = parseVaultFiles([file("A.md", "")]);

    expect(nodes[0].path).toBe("/vault/A.md");
    expect(nodes[0].ghost).toBe(false);
  });
});
