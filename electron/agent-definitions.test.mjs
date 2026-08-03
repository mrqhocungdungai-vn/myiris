import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePersona, buildAgentDefinition } from "./agent-definitions.mjs";

const PERSONAS_DIR = path.join(import.meta.dirname, "..", "resources", "personas");

describe("parsePersona", () => {
  it("splits front matter from the prompt body", () => {
    const { frontMatter, body } = parsePersona("---\nname: x\ndescription: Does things\n---\nBody line.\n");
    expect(frontMatter).toEqual({ name: "x", description: "Does things" });
    expect(body).toBe("Body line.");
  });

  it("keeps colons inside a value", () => {
    // Descriptions routinely contain "PO → DEV:" style text; splitting on the
    // last colon instead of the first would silently truncate them.
    const { frontMatter } = parsePersona("---\ndescription: Implements: tasks, then verifies\n---\nBody.");
    expect(frontMatter.description).toBe("Implements: tasks, then verifies");
  });

  it("strips surrounding quotes", () => {
    const { frontMatter } = parsePersona('---\ndescription: "Quoted"\n---\nBody.');
    expect(frontMatter.description).toBe("Quoted");
  });

  it("treats a file with no front matter as all body", () => {
    const { frontMatter, body } = parsePersona("Just a prompt.");
    expect(frontMatter).toEqual({});
    expect(body).toBe("Just a prompt.");
  });
});

describe("buildAgentDefinition", () => {
  const base = { personasDir: "/personas", agentPrefix: "iris-" };

  it("reads the bundled persona for the role", () => {
    const readFileSync = (p) => {
      expect(p).toBe(path.join("/personas", "iris-dev.md"));
      return "---\ndescription: The DEV\nmodel: inherit\n---\nDo the work.";
    };
    expect(buildAgentDefinition("dev", { ...base, readFileSync })).toEqual({
      description: "The DEV",
      prompt: "Do the work.",
    });
  });

  it("omits `inherit` so the per-run model choice still applies", () => {
    // resolveAgentModel picks the model per run; pinning "inherit" as a literal
    // model id would break that.
    const readFileSync = () => "---\ndescription: d\nmodel: inherit\n---\nBody.";
    expect(buildAgentDefinition("po", { ...base, readFileSync }).model).toBeUndefined();
  });

  it("honours an explicitly pinned model", () => {
    const readFileSync = () => "---\ndescription: d\nmodel: claude-opus-5\n---\nBody.";
    expect(buildAgentDefinition("po", { ...base, readFileSync }).model).toBe("claude-opus-5");
  });

  it("prefers a project-local override over the bundled persona", () => {
    const readFileSync = (p) => {
      expect(p).toBe("/proj/.claude/agents/iris-dev.md");
      return "---\ndescription: Custom\n---\nCustom prompt.";
    };
    const def = buildAgentDefinition("dev", { ...base, projectFile: "/proj/.claude/agents/iris-dev.md", readFileSync });
    expect(def.prompt).toBe("Custom prompt.");
  });

  it("throws a named error when the persona cannot be read", () => {
    const readFileSync = () => {
      throw new Error("ENOENT");
    };
    expect(() => buildAgentDefinition("dev", { ...base, readFileSync })).toThrow(/DEV persona/);
  });

  it("throws when the persona has front matter but no body", () => {
    const readFileSync = () => "---\ndescription: d\n---\n";
    expect(() => buildAgentDefinition("dev", { ...base, readFileSync })).toThrow(/no prompt body/);
  });

  it("throws when there is no bundle to read from", () => {
    expect(() => buildAgentDefinition("dev", { personasDir: null, agentPrefix: "iris-" })).toThrow(/app bundle/);
  });

  it("parses the REAL shipped personas into usable definitions", () => {
    // Guards the actual resources/personas/*.md against a front-matter edit that
    // silently produces an empty description or prompt.
    for (const role of ["po", "dev"]) {
      const def = buildAgentDefinition(role, { personasDir: PERSONAS_DIR, agentPrefix: "iris-" });
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.prompt.length).toBeGreaterThan(200);
      expect(def.prompt.startsWith("---")).toBe(false);
      expect(def.model).toBeUndefined();
    }
  });

  it("keeps the shipped personas byte-identical to their file bodies", () => {
    // The prompt is the persona; a parser bug that dropped a section would be
    // invisible in behavior tests but would change what the agent actually is.
    const raw = fs.readFileSync(path.join(PERSONAS_DIR, "iris-dev.md"), "utf8");
    const def = buildAgentDefinition("dev", { personasDir: PERSONAS_DIR, agentPrefix: "iris-" });
    expect(def.prompt).toBe(raw.split(/^---$/m)[2].trim());
  });
});
