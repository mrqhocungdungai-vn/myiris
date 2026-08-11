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

  // The command channel, pinned. Commands are NOT a second surface: a
  // `/iris:opsx:*` command is a `Skill` tool call in the same namespace, and
  // the SDK turns `skills: [...]` into `allowedTools: ["Skill(<entry>)"]`
  // (measured — see the module comment). So "a workflow is reachable iff its
  // skill is listed" holds only while no list smuggles in a command entry,
  // which would grant a workflow to a verb whose declared skills withhold it.
  //
  // The check is on the declared surface, not on the SDK: what the runtime does
  // with the list was established by live measurement and cannot be re-measured
  // in a unit test without spending money and a credential.
  it("bound workflows through their skills, never through a command entry", () => {
    const commands = fs
      .readdirSync(path.join(repoRoot, "resources", "iris-plugin", "commands", "opsx"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `iris:opsx:${entry.name.slice(0, -".md".length)}`);
    expect(commands.length).toBeGreaterThan(0);

    for (const name of VERB_NAMES) {
      for (const state of [[], ["a-change"], { changes: ["a-change"], depth: "judge" }]) {
        for (const entry of resolveVerb(name, state).skills) {
          expect(entry.startsWith("iris:opsx:")).toBe(false);
          expect(commands).not.toContain(entry);
        }
      }
    }
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
  // `(?!opsx:)` is load-bearing. Without it `/iris:opsx:propose` matched with
  // `opsx` captured, which is not a shipped directory, so the `shipped.includes`
  // filter dropped it — every command reference in every persona was silently
  // skipped, and the filter that was meant to ignore prose was ignoring the
  // real references too. Commands are a separate surface with its own check
  // (plugin-skills.test.mjs); what is excluded here is excluded on purpose.
  function namedBy(base) {
    const source = fs.readFileSync(path.join(repoRoot, "resources", "personas", `${base}.md`), "utf8");
    const names = new Set();
    for (const match of source.matchAll(/iris:(?!opsx:)([a-z0-9-]+)/g)) {
      if (shipped.includes(match[1])) names.add(`iris:${match[1]}`);
    }
    return [...names];
  }

  // Derived from the registry, not enumerated: a verb given a fourth persona
  // with no test is exactly what this loop must not be able to miss.
  const personas = [...new Set(VERB_NAMES.map((verb) => resolveVerb(verb).basePersona))].sort();

  for (const base of personas) {
    it(`${base}`, () => {
      const named = namedBy(base);
      expect(named).toEqual([]);

      const users = VERB_NAMES.filter((verb) => resolveVerb(verb).basePersona === base);
      expect(users.length).toBeGreaterThan(0);
      for (const verb of users) {
        // Every state that selects a different list: `execute` forks on the open
        // change, and `investigate` forks on the depth — the judge fork was
        // never resolved here either.
        for (const state of [[], ["a-change"], { changes: ["a-change"], depth: "judge" }]) {
          const available = resolveVerb(verb, state).skills;
          for (const skill of named) expect(available).toContain(skill);
        }
      }
    });
  }
});

// The same defect as a persona naming a skill its verb cannot reach, one level
// up: a persona asserting a TOOL its verb may not have. `stateless.md` said "the
// question tool is not available to you" while `execute` with no open change
// resolves `disallowedTools: []` and may ask — the run's own clause said one
// thing and the body it was appended to said the opposite, and nothing read
// both.
//
// The registry decides per run and role-prompt.mjs's STATEFULNESS_CLAUSES state
// the decision, chosen off the run's EFFECTIVE `disallowedTools`. A persona body
// serves several verbs at once and cannot know, so it may not claim.
describe("a persona claims nothing the registry decides per run", () => {
  // Availability assertions only. Prose about *when* to ask is fine and has to
  // be — "do not ask for a specification first" is a judgement, not a claim
  // about what the run holds.
  const CLAIMS = [
    /the question tool is (?:not )?available/i,
    /\bnever asks?\b/i,
    /\bcannot ask\b/i,
    /\bAskUserQuestion\b/,
    /nobody is listening for a question/i,
  ];

  // Verbs on this persona that differ from each other on whether they may ask
  // are what make a body-level claim unsatisfiable — asserted rather than
  // assumed, so this test cannot go quiet if the registry stops forking.
  it("stateless serves verbs that disagree about asking, so it makes no claim", () => {
    const users = VERB_NAMES.filter((verb) => resolveVerb(verb).basePersona === "stateless");
    const mayAsk = users.flatMap((verb) =>
      [[], ["a-change"]].map((state) => !resolveVerb(verb, state).disallowedTools.includes("AskUserQuestion")),
    );
    expect(new Set(mayAsk)).toEqual(new Set([true, false]));

    const source = fs.readFileSync(path.join(repoRoot, "resources", "personas", "stateless.md"), "utf8");
    for (const claim of CLAIMS) expect(source).not.toMatch(claim);
  });

  // And it must not instruct work a verb on it has no skill for. `execute`
  // carries no archiving skill; `finish` owns close-out. The only route left was
  // the unscoped command channel.
  it("stateless does not instruct the archiving that only `finish` is equipped for", () => {
    const source = fs.readFileSync(path.join(repoRoot, "resources", "personas", "stateless.md"), "utf8");
    expect(source).not.toMatch(/\/iris:opsx:archive/);
    expect(resolveVerb("execute", ["a-change"]).skills).not.toContain("iris:openspec-archive-change");
    expect(resolveVerb("finish").skills).toContain("iris:openspec-archive-change");
  });
});
