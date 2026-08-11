// The shipped instruction text is a capability surface, and it is the only one
// with neither a typechecker nor a runtime failure when it goes stale. A skill
// telling the model to invoke a skill that does not ship fails at exactly one
// moment: when a real run follows the pointer, in front of a user, with nothing
// in the log saying why. That is what this file reads for.
//
// It found one on the highest-traffic verb: the bundled openspec-apply-change
// skill pointed at `openspec-continue-change`, which is not a directory anywhere
// in the bundle — the exact defect class run-skills.mjs's suite-integrity rule
// exists to prevent ("a skill telling the model to invoke one it cannot see"),
// invisible for as long as it shipped because no test read a skill body.
//
// Kept apart from run-skills.test.mjs deliberately: that file is about the
// LISTS, this one is about the TEXT. Nothing here imports the registry.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "resources", "iris-plugin");
const skillsDir = path.join(pluginDir, "skills");
const commandsDir = path.join(pluginDir, "commands", "opsx");
const personasDir = path.join(repoRoot, "resources", "personas");

const shippedSkills = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const shippedCommands = fs
  .readdirSync(commandsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name.slice(0, -".md".length));

/** Every file whose text ships to the model: skill bodies and persona bodies. */
const shippedText = [
  ...shippedSkills.map((name) => ({
    label: `skills/${name}/SKILL.md`,
    source: fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8"),
  })),
  ...fs
    .readdirSync(personasDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({
      label: `personas/${entry.name}`,
      source: fs.readFileSync(path.join(personasDir, entry.name), "utf8"),
    })),
];

// A bare `openspec-<a>-<b>` is a SKILL name. Two hyphenated segments are
// required so the CLI invocations the same bodies are full of — `openspec
// status`, `openspec list` — are not mistaken for skill references; they are
// separated by a space, not a hyphen, and never match.
const SKILL_BY_NAME = /\bopenspec-[a-z]+(?:-[a-z]+)+\b/g;
// A plugin-qualified skill. `(?!opsx:)` keeps the command form below out of it —
// `iris:opsx:apply` would otherwise capture `opsx`, which is not a skill.
const SKILL_QUALIFIED = /\biris:(?!opsx:)([a-z0-9-]+)/g;
// The command form, always written with its leading slash where it is invoked.
const COMMAND = /\/iris:opsx:([a-z]+)/g;

describe("every skill and command the shipped text names actually ships", () => {
  for (const { label, source } of shippedText) {
    it(`${label}`, () => {
      const unresolved = [];

      for (const match of source.matchAll(SKILL_BY_NAME)) {
        if (!shippedSkills.includes(match[0])) unresolved.push(`skill "${match[0]}"`);
      }
      for (const match of source.matchAll(SKILL_QUALIFIED)) {
        if (!shippedSkills.includes(match[1])) unresolved.push(`skill "iris:${match[1]}"`);
      }
      for (const match of source.matchAll(COMMAND)) {
        if (!shippedCommands.includes(match[1])) unresolved.push(`command "/iris:opsx:${match[1]}"`);
      }

      expect([...new Set(unresolved)]).toEqual([]);
    });
  }

  // Without this the suite above would keep passing if the patterns stopped
  // matching anything at all — a green run that read nothing.
  it("reads text that genuinely contains cross-references", () => {
    const all = shippedText.map((entry) => entry.source).join("\n");
    expect([...all.matchAll(SKILL_BY_NAME)].length).toBeGreaterThan(0);
    expect([...all.matchAll(COMMAND)].length).toBeGreaterThan(0);
  });
});
