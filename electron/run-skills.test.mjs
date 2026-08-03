import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_SKILLS, PLAIN_SKILLS, PO_SKILLS, skillsForRole } from "./run-skills.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginSkillsDir = path.join(repoRoot, "resources", "iris-plugin", "skills");
const shipped = fs.readdirSync(pluginSkillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("skillsForRole", () => {
  it("gives each role its own list", () => {
    expect(skillsForRole("po")).toEqual(PO_SKILLS);
    expect(skillsForRole("dev")).toEqual(DEV_SKILLS);
    expect(skillsForRole("plain")).toEqual(PLAIN_SKILLS);
  });

  it("hands out a copy, so a caller cannot mutate the policy", () => {
    skillsForRole("po").push("iris:whatever");
    expect(skillsForRole("po")).toEqual(PO_SKILLS);
  });

  // A name that matches nothing is worse than "all": it looks like scoping and
  // silently grants nothing. Every entry must name a skill the plugin ships.
  it("names only skills the bundled plugin actually ships", () => {
    for (const entry of [...PO_SKILLS, ...DEV_SKILLS, ...PLAIN_SKILLS]) {
      expect(entry.startsWith("iris:")).toBe(true);
      expect(shipped).toContain(entry.slice("iris:".length));
    }
  });
});

describe("the lists narrow what a run can reach", () => {
  it("keeps DEV out of PO's grilling and PO out of the notes vault", () => {
    expect(DEV_SKILLS).not.toContain("iris:grilling");
    expect(DEV_SKILLS).not.toContain("iris:openspec-propose");
    expect(PO_SKILLS).not.toContain("iris:tdd");
    for (const wiki of PLAIN_SKILLS) {
      expect(PO_SKILLS).not.toContain(wiki);
      expect(DEV_SKILLS).not.toContain(wiki);
    }
  });

  it("leaves no role with the full bundle", () => {
    for (const role of /** @type {const} */ (["po", "dev", "plain"])) {
      expect(skillsForRole(role).length).toBeLessThan(shipped.length);
    }
  });

  // The six wiki skills each cross-reference every other one, so a subset would
  // leave a skill telling the model to invoke one it cannot see.
  it("keeps the wiki suite whole", () => {
    const wikiShipped = shipped.filter((name) => name.startsWith("wiki-"));
    expect(PLAIN_SKILLS.map((entry) => entry.slice("iris:".length)).sort()).toEqual(wikiShipped.sort());
  });
});

// D7's stated risk is a persona quietly depending on an unlisted skill. These
// read the personas rather than trusting the lists, so adding an invocation to a
// persona without widening its list fails here.
describe("every skill a persona invokes is in that persona's list", () => {
  function invokedBy(role) {
    const source = fs.readFileSync(path.join(repoRoot, "resources", "personas", `iris-${role}.md`), "utf8");
    const names = new Set();
    for (const match of source.matchAll(/iris:([a-z0-9-]+)/g)) {
      if (shipped.includes(match[1])) names.add(`iris:${match[1]}`);
    }
    return [...names];
  }

  for (const [role, list] of /** @type {const} */ ([["po", PO_SKILLS], ["dev", DEV_SKILLS]])) {
    it(`${role}`, () => {
      const invoked = invokedBy(role);
      expect(invoked.length).toBeGreaterThan(0);
      for (const name of invoked) expect(list).toContain(name);
    });
  }
});
