import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_CHOICES,
  NO_PROJECT_STATE,
  PARK,
  STATEFUL_SESSION_KEY,
  STATEFUL_VERBS,
  VERB_NAMES,
  defaultModelFor,
  isVerb,
  projectState,
  resolveAllVerbs,
  resolveVerb,
} from "./verbs.mjs";
import { IMPLEMENTATION_SKILLS, ORDINARY_SKILLS } from "./run-skills.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginSkillsDir = path.join(repoRoot, "resources", "iris-plugin", "skills");
const shippedSkills = fs
  .readdirSync(pluginSkillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const WITH_CHANGE = { hasOpenChange: true, changes: ["add-thing"] };

describe("the verb registry", () => {
  it("declares exactly the seven verbs the surface offers", () => {
    expect(VERB_NAMES).toEqual([
      "shape_requirements",
      "shape_on_canvas",
      "execute",
      "finish",
      "investigate",
      "review",
      "capture_learning",
    ]);
  });

  it("resolves every verb against both project states", () => {
    for (const name of VERB_NAMES) {
      for (const state of [NO_PROJECT_STATE, WITH_CHANGE]) {
        const resolved = resolveVerb(name, state);
        expect(resolved.verb).toBe(name);
        expect(typeof resolved.description).toBe("string");
        expect(resolved.description.length).toBeGreaterThan(0);
        expect(typeof resolved.stateful).toBe("boolean");
        expect(Object.values(PARK)).toContain(resolved.park);
        expect(typeof resolved.sessionKey).toBe("string");
        expect(MODEL_CHOICES.map((choice) => choice.id)).toContain(resolved.model);
        expect(Array.isArray(resolved.skills)).toBe(true);
        expect(Array.isArray(resolved.mcpServers)).toBe(true);
        expect(resolved.params.type).toBe("object");
        expect(typeof resolved.clause).toBe("string");
        expect(resolved.clause.length).toBeGreaterThan(0);
        expect(["stateful", "stateless"]).toContain(resolved.basePersona);
      }
    }
  });

  // An unknown verb must be rejected rather than silently resolving to some
  // default — a typo that runs *something* is worse than one that fails.
  it("rejects an unknown verb by name", () => {
    expect(() => resolveVerb("submit_claude_task")).toThrow(/Unknown verb/);
    expect(() => resolveVerb(null)).toThrow(/Unknown verb/);
    expect(isVerb("execute")).toBe(true);
    expect(isVerb("dev")).toBe(false);
  });

  // D4: the fork is the whole reason a registry field may be a function.
  it("forks `execute` on whether the project has an open change with tasks", () => {
    const withChange = resolveVerb("execute", WITH_CHANGE);
    const without = resolveVerb("execute", NO_PROJECT_STATE);

    expect(withChange.skills).toEqual(IMPLEMENTATION_SKILLS);
    expect(withChange.clause).toMatch(/open OpenSpec change/);

    expect(without.skills).toEqual(ORDINARY_SKILLS);
    expect(without.skills).toEqual([]);
    expect(without.clause).toMatch(/do not propose one/);
    // The removed gate, stated positively: no open change is not a refusal.
    expect(without.clause).not.toMatch(/refuse|cannot proceed/i);
  });

  it("accepts a raw openChangesWithTasks() array as project state", () => {
    expect(resolveVerb("execute", ["add-thing"]).skills).toEqual(IMPLEMENTATION_SKILLS);
    expect(resolveVerb("execute", []).skills).toEqual(ORDINARY_SKILLS);
    expect(projectState(["a", "b"])).toEqual({ hasOpenChange: true, changes: ["a", "b"] });
    expect(projectState(null)).toEqual({ hasOpenChange: false, changes: [] });
  });

  // D3: the two shaping verbs are the same conversation in two media.
  it("gives both stateful verbs the one shared resident session", () => {
    expect(STATEFUL_VERBS).toEqual(["shape_requirements", "shape_on_canvas"]);
    for (const name of STATEFUL_VERBS) {
      const resolved = resolveVerb(name);
      expect(resolved.stateful).toBe(true);
      expect(resolved.sessionKey).toBe(STATEFUL_SESSION_KEY);
      expect(resolved.basePersona).toBe("stateful");
    }
    expect(resolveVerb("shape_requirements").sessionKey).toBe(resolveVerb("shape_on_canvas").sessionKey);
  });

  it("keeps every stateless verb on its own conversation", () => {
    const stateless = VERB_NAMES.filter((name) => !resolveVerb(name).stateful);
    const keys = stateless.map((name) => resolveVerb(name).sessionKey);
    expect(new Set(keys).size).toBe(stateless.length);
    // Continuity is not statefulness: a stateless verb still resumes its own
    // prior conversation, which is what a session key is for.
    expect(keys).toEqual(stateless);
  });

  // Enforced by configuration, not by instruction.
  it("denies the question tool to every stateless verb and only those", () => {
    for (const name of VERB_NAMES) {
      const resolved = resolveVerb(name);
      if (resolved.stateful) expect(resolved.disallowedTools).toEqual([]);
      else expect(resolved.disallowedTools).toContain("AskUserQuestion");
    }
  });

  it("denies the edit tools to `investigate`, because investigating does not modify", () => {
    expect(resolveVerb("investigate").disallowedTools).toEqual(
      expect.arrayContaining(["AskUserQuestion", "Write", "Edit"]),
    );
    expect(resolveVerb("execute").disallowedTools).not.toContain("Write");
  });

  it("parks the two consequential stateless verbs on every call and nothing else always", () => {
    expect(resolveVerb("execute").park).toBe(PARK.ALWAYS);
    expect(resolveVerb("finish").park).toBe(PARK.ALWAYS);
    expect(resolveVerb("shape_requirements").park).toBe(PARK.ON_OPEN);
    expect(resolveVerb("shape_on_canvas").park).toBe(PARK.ON_OPEN);
    for (const name of ["investigate", "review", "capture_learning"]) {
      expect(resolveVerb(name).park).toBe(PARK.NEVER);
    }
  });

  it("wires the canvas tool server only for the canvas verb", () => {
    expect(resolveVerb("shape_on_canvas").mcpServers).toEqual(["iris-canvas"]);
    for (const name of VERB_NAMES.filter((verb) => verb !== "shape_on_canvas")) {
      expect(resolveVerb(name).mcpServers).toEqual([]);
    }
  });

  // vault-write-path design D3: without this, wiki-query would search only
  // the curated wiki and answer "nothing found" about a note the user just
  // captured through capture_note — the clause naming the spool is what makes
  // the run actually read it.
  it("names the capture spool in capture_learning's clause, so a fresh capture is findable", () => {
    expect(resolveVerb("capture_learning").clause).toMatch(/inbox\/captures/);
    expect(resolveVerb("capture_learning").clause).toMatch(/inbox\/runs/);
  });

  it("grants the notes vault only to the capture verb", () => {
    expect(resolveVerb("capture_learning").vault).toBe(true);
    for (const name of VERB_NAMES.filter((verb) => verb !== "capture_learning")) {
      expect(resolveVerb(name).vault).toBe(false);
    }
  });

  // A name that matches nothing is worse than "all": it looks like scoping and
  // silently grants nothing.
  it("names only skills the bundled plugin actually ships", () => {
    for (const resolved of [...resolveAllVerbs(), ...resolveAllVerbs(WITH_CHANGE)]) {
      for (const entry of resolved.skills) {
        expect(entry.startsWith("iris:")).toBe(true);
        expect(shippedSkills).toContain(entry.slice("iris:".length));
      }
    }
  });

  // The scoping is the substance, the verb table is the vehicle: without it,
  // seven verbs would be seven names for one agent.
  it("keeps unrelated workflows out of each other's verbs", () => {
    const execute = resolveVerb("execute", WITH_CHANGE).skills;
    expect(execute).not.toContain("iris:grilling");
    expect(execute.some((skill) => skill.startsWith("iris:wiki-"))).toBe(false);

    const capture = resolveVerb("capture_learning").skills;
    expect(capture).not.toContain("iris:tdd");
    expect(capture.every((skill) => skill.startsWith("iris:wiki-"))).toBe(true);

    expect(resolveVerb("shape_requirements").skills).toContain("iris:grilling");
  });

  it("hands out copies, so a consumer cannot mutate the table", () => {
    resolveVerb("shape_requirements").skills.push("iris:whatever");
    expect(resolveVerb("shape_requirements").skills).not.toContain("iris:whatever");
  });

  it("resolves every verb's default model to a curated choice", () => {
    expect(defaultModelFor("shape_requirements")).toBe("claude-opus-5");
    expect(defaultModelFor("execute")).toBe("claude-sonnet-5");
    expect(defaultModelFor("capture_learning")).toBe("claude-haiku-4-5-20251001");
    expect(defaultModelFor("nonsense")).toBeNull();
  });

  // Role vocabulary is what this change removes from the Claude- and
  // Gemini-facing surface; a description that still says "PO" would put it back.
  it("carries no role vocabulary in any declared text", () => {
    for (const resolved of [...resolveAllVerbs(), ...resolveAllVerbs(WITH_CHANGE)]) {
      const text = `${resolved.description} ${resolved.clause} ${JSON.stringify(resolved.params)}`;
      expect(text).not.toMatch(/\bPO\b|\bDEV\b|Product Owner|submit_claude_task/);
    }
  });

  it("resolves all seven verbs in declaration order", () => {
    expect(resolveAllVerbs().map((resolved) => resolved.verb)).toEqual(VERB_NAMES);
  });
});
