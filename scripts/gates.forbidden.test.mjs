// The destructive-command guard's cases, both directions.
//
// This file exists because a predicate that decides whether an irreversible
// command runs must not be verified by reading it: the interesting cases are the
// flag spellings and command shapes the author did not picture. The
// must-NOT-refuse half matters at least as much as the must-refuse half — a guard
// that fires on `git checkout main` is a guard that gets deleted, and then
// nothing is protecting anything.
//
// See openspec/specs/claude-code-config/spec.md and the guard's comment in
// scripts/gates.mjs.
import { describe, expect, it } from "vitest";
import { checkForbiddenCommand, commandSegments } from "./gates.mjs";

/** The guard refused, whatever reason it gave. */
const refused = (command) => checkForbiddenCommand(command) !== null;

describe("checkForbiddenCommand: recursive delete", () => {
  it("refuses every spelling of the recursive flag", () => {
    for (const command of [
      "rm -r build",
      "rm -R build",
      "rm -rf build",
      "rm -fr build",
      "rm -r -f build",
      "rm -f -r build",
      "rm --recursive build",
      "rm -rfv build",
    ]) {
      expect(refused(command), command).toBe(true);
    }
  });

  it("names the operation it matched", () => {
    expect(checkForbiddenCommand("rm -rf build")).toMatch(/recursive delete/);
  });

  it("allows a non-recursive delete of a single file", () => {
    for (const command of ["rm build/output.js", "rm -f build/output.js", "rm -v out.txt"]) {
      expect(refused(command), command).toBe(false);
    }
  });

  it("matches a path-qualified rm, so /bin/rm is not an escape", () => {
    expect(refused("/bin/rm -rf build")).toBe(true);
  });

  it("does not fire on another command that merely takes -r", () => {
    for (const command of ["grep -r pattern src", "cp -r src dest", "ls -R"]) {
      expect(refused(command), command).toBe(false);
    }
  });
});

describe("checkForbiddenCommand: git operations that lose work", () => {
  it("refuses a force push in either flag form", () => {
    for (const command of [
      "git push --force origin main",
      "git push -f origin main",
      "git push --force-with-lease origin main",
      "git push origin main --force",
    ]) {
      expect(refused(command), command).toBe(true);
    }
  });

  it("allows an ordinary push", () => {
    for (const command of ["git push", "git push origin main", "git push -u origin feature"]) {
      expect(refused(command), command).toBe(false);
    }
  });

  it("refuses a hard reset but allows the other reset modes", () => {
    expect(refused("git reset --hard HEAD~1")).toBe(true);
    expect(refused("git reset --soft HEAD~1")).toBe(false);
    expect(refused("git reset HEAD~1")).toBe(false);
    expect(refused("git reset")).toBe(false);
  });

  it("refuses discarding the whole working tree", () => {
    expect(refused("git checkout .")).toBe(true);
    expect(refused("git restore .")).toBe(true);
    expect(refused("git checkout -- .")).toBe(true);
  });

  it("allows switching branches and restoring a named path", () => {
    for (const command of [
      "git checkout main",
      "git checkout -b feature",
      "git restore src/App.tsx",
      "git checkout HEAD -- src/App.tsx",
    ]) {
      expect(refused(command), command).toBe(false);
    }
  });

  it("leaves the commit path alone — that is the other check's business", () => {
    expect(refused("git commit -m 'x'")).toBe(false);
    expect(refused("git log --oneline")).toBe(false);
    expect(refused("git status")).toBe(false);
  });
});

describe("checkForbiddenCommand: the credential file", () => {
  it("refuses naming the real credential file, whatever the command is", () => {
    for (const command of ["cat .env", "head -5 .env", "bat ./.env", "grep KEY .env", "code .env"]) {
      expect(refused(command), command).toBe(true);
    }
  });

  it("refuses the gitignored test credential variants", () => {
    expect(refused("cat .env_test")).toBe(true);
    expect(refused("cat .env_test.local")).toBe(true);
  });

  it("allows names that merely start the same way", () => {
    for (const command of [
      "cat .env.example",
      "cat .envrc",
      "cat .environment",
      "cat src/environment.ts",
    ]) {
      expect(refused(command), command).toBe(false);
    }
  });

  it("does not depend on enumerating readers — an unfamiliar reader is still caught", () => {
    expect(refused("some-future-pager .env")).toBe(true);
  });
});

describe("checkForbiddenCommand: compound command lines", () => {
  it("matches a destructive segment that is not the first", () => {
    for (const command of [
      "cd build && rm -rf dist",
      "npm run build; git reset --hard",
      "npm test || git checkout .",
      "echo hi | cat .env",
    ]) {
      expect(refused(command), command).toBe(true);
    }
  });

  it("matches through a leading environment assignment", () => {
    expect(refused("FOO=bar rm -rf build")).toBe(true);
    expect(refused("GIT_AUTHOR_NAME=x git push --force")).toBe(true);
  });

  it("leaves a wholly benign chain alone", () => {
    expect(refused("cd src && npm run build && npm test")).toBe(false);
  });
});

describe("checkForbiddenCommand: input handling", () => {
  it("returns null rather than throwing on nothing", () => {
    for (const input of ["", "   ", undefined, null, 42, {}]) {
      expect(checkForbiddenCommand(input)).toBeNull();
    }
  });
});

describe("commandSegments", () => {
  it("splits on every separator and drops empty segments", () => {
    expect(commandSegments("a && b; c | d || e")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]]);
  });

  it("strips leading VAR=value assignments so the real command is first", () => {
    expect(commandSegments("A=1 B=2 git commit")).toEqual([["git", "commit"]]);
  });

  it("keeps an assignment that is not leading, since it is an argument by then", () => {
    expect(commandSegments("git commit A=1")).toEqual([["git", "commit", "A=1"]]);
  });
});
