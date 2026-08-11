import { describe, it, expect } from "vitest";
import { compareToBaseline, countCodeLines, LINE_CEILING } from "./check-file-size.mjs";

// The ratchet's whole value is that it fails in the right directions, so those
// directions are what this pins. compareToBaseline is pure — it takes the two
// maps and returns the verdict — so none of this touches the filesystem.

const sizes = (entries) => new Map(Object.entries(entries));

describe("compareToBaseline", () => {
  it("passes when every baselined file is unchanged", () => {
    const result = compareToBaseline(sizes({ "a.ts": 900 }), { "a.ts": 900 });
    expect(result).toEqual({ grew: [], shrank: [], newlyOver: [], removed: [] });
  });

  // The direction the ratchet exists to stop.
  it("fails a baselined file that grew", () => {
    const result = compareToBaseline(sizes({ "a.ts": 901 }), { "a.ts": 900 });
    expect(result.grew).toEqual([{ file: "a.ts", lines: 901, recorded: 900 }]);
  });

  // Shrinking must also be reported, so progress is banked into the baseline
  // and cannot silently reverse later.
  it("reports a baselined file that shrank, so the gain is recorded", () => {
    const result = compareToBaseline(sizes({ "a.ts": 800 }), { "a.ts": 900 });
    expect(result.shrank).toEqual([{ file: "a.ts", lines: 800, recorded: 900 }]);
  });

  it("reports a baselined file that no longer exists", () => {
    const result = compareToBaseline(sizes({}), { "gone.ts": 900 });
    expect(result.removed).toEqual(["gone.ts"]);
  });

  // A new file gets no grandfathering: the convention applies to it.
  it("fails a new file over the ceiling", () => {
    const result = compareToBaseline(sizes({ "new.ts": LINE_CEILING + 1 }), {});
    expect(result.newlyOver).toEqual([{ file: "new.ts", lines: LINE_CEILING + 1 }]);
  });

  it("ignores a new file at or under the ceiling", () => {
    const result = compareToBaseline(sizes({ "small.ts": LINE_CEILING }), {});
    expect(result.newlyOver).toEqual([]);
    expect(result.grew).toEqual([]);
  });

  // A baselined file may sit far above the ceiling; that is the point of a
  // ratchet rather than a mandate. It is held to its own number, not to 450.
  it("holds an oversized file to its own recorded size, not to the ceiling", () => {
    const result = compareToBaseline(sizes({ "big.ts": 2000 }), { "big.ts": 2000 });
    expect(result.grew).toEqual([]);
    expect(result.newlyOver).toEqual([]);
  });
});

// The measure itself. Counting raw lines would make this gate push back on the
// comments the codebase depends on — see countCodeLines' own header.
describe("countCodeLines", () => {
  it("counts only executable lines", () => {
    expect(countCodeLines("const a = 1;\nconst b = 2;")).toBe(2);
  });

  it("ignores blank lines", () => {
    expect(countCodeLines("const a = 1;\n\n\nconst b = 2;")).toBe(2);
  });

  it("ignores line comments", () => {
    expect(countCodeLines("// why\nconst a = 1;\n// how")).toBe(1);
  });

  it("ignores block comments, including their continuation lines", () => {
    const text = ["/**", " * A long explanation", " * over several lines", " */", "const a = 1;"].join("\n");
    expect(countCodeLines(text)).toBe(1);
  });

  it("resumes counting after a block comment closes", () => {
    expect(countCodeLines("/* a\nb */\nconst a = 1;")).toBe(1);
    expect(countCodeLines("/* one-liner */\nconst a = 1;")).toBe(1);
  });

  // The behaviour that motivated the change: a heavily documented module is
  // measured by what it does, not by how well it is explained.
  it("measures a 50%-comment module by its code", () => {
    const documented = ["// reason one", "const a = 1;", "// reason two", "const b = 2;"].join("\n");
    expect(countCodeLines(documented)).toBe(2);
  });
});
