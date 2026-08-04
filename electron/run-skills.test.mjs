import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTE_SKILLS } from "./run-skills.mjs";
import { VERB_NAMES, resolveVerb } from "./verbs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginSkillsDir = path.join(repoRoot, "resources", "iris-plugin", "skills");
const shipped = fs
  .readdirSync(pluginSkillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("the skill lists", () => {
  it("leave no verb with the full bundle", () => {
    for (const name of VERB_NAMES) {
      expect(resolveVerb(name).skills.length).toBeLessThan(shipped.length);
    }
  });

  // The six wiki skills each cross-reference every other one, so a subset would
  // leave a skill telling the model to invoke one it cannot see.
  it("keep the wiki suite whole", () => {
    const wikiShipped = shipped.filter((name) => name.startsWith("wiki-"));
    expect(NOTE_SKILLS.map((entry) => entry.slice("iris:".length)).sort()).toEqual(wikiShipped.sort());
  });
});

// The risk: a persona quietly depending on a skill the verb using it cannot
// reach. One persona serves several verbs with different lists — naming
// `iris:tdd` in the stateless body would tell `investigate` to invoke something
// it cannot see — so the personas describe behaviour instead of naming skills.
//
// Two assertions, because the first alone would pass vacuously: that the
// personas name none today, and that any name added later is available to every
// verb using that persona.
describe("the personas do not depend on skills their verbs may lack", () => {
  function namedBy(base) {
    const source = fs.readFileSync(path.join(repoRoot, "resources", "personas", `${base}.md`), "utf8");
    const names = new Set();
    for (const match of source.matchAll(/iris:([a-z0-9-]+)/g)) {
      if (shipped.includes(match[1])) names.add(`iris:${match[1]}`);
    }
    return [...names];
  }

  for (const base of /** @type {const} */ (["stateful", "stateless"])) {
    it(`${base}`, () => {
      const named = namedBy(base);
      expect(named).toEqual([]);

      const users = VERB_NAMES.filter((verb) => resolveVerb(verb).basePersona === base);
      expect(users.length).toBeGreaterThan(0);
      for (const verb of users) {
        // Checked against BOTH project states, since `execute`'s list forks.
        for (const state of [[], ["a-change"]]) {
          const available = resolveVerb(verb, state).skills;
          for (const skill of named) expect(available).toContain(skill);
        }
      }
    });
  }
});
