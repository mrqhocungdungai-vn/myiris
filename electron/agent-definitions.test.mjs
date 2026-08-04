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
    // Descriptions routinely contain "Implements: tasks" style text; splitting
    // on the last colon instead of the first would silently truncate them.
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
  const base = { personasDir: "/personas" };

  // The bundled file is named for the base persona, unprefixed — there is
  // nothing to disambiguate it from inside the app's own resources.
  it("reads the bundled persona for the base", () => {
    const readFileSync = (p) => {
      expect(p).toBe(path.join("/personas", "stateless.md"));
      return "---\ndescription: The autonomous one\nmodel: inherit\n---\nDo the work.";
    };
    expect(buildAgentDefinition("stateless", { ...base, readFileSync })).toEqual({
      description: "The autonomous one",
      prompt: "Do the work.",
    });
  });

  it("omits `inherit` so the per-verb model choice still applies", () => {
    // resolveVerbModel picks the model per run; pinning "inherit" as a literal
    // model id would break that.
    const readFileSync = () => "---\ndescription: d\nmodel: inherit\n---\nBody.";
    expect(buildAgentDefinition("stateful", { ...base, readFileSync }).model).toBeUndefined();
  });

  it("honours an explicitly pinned model", () => {
    const readFileSync = () => "---\ndescription: d\nmodel: claude-opus-5\n---\nBody.";
    expect(buildAgentDefinition("stateful", { ...base, readFileSync }).model).toBe("claude-opus-5");
  });

  // The project-local override keeps the `iris-` prefix because it sits in a
  // directory shared with the user's own agents.
  it("prefers a project-local override over the bundled persona", () => {
    const readFileSync = (p) => {
      expect(p).toBe("/proj/.claude/agents/iris-stateless.md");
      return "---\ndescription: Custom\n---\nCustom prompt.";
    };
    const def = buildAgentDefinition("stateless", {
      ...base,
      projectFile: "/proj/.claude/agents/iris-stateless.md",
      readFileSync,
    });
    expect(def.prompt).toBe("Custom prompt.");
  });

  it("throws a named error when the persona cannot be read", () => {
    const readFileSync = () => {
      throw new Error("ENOENT");
    };
    expect(() => buildAgentDefinition("stateless", { ...base, readFileSync })).toThrow(/stateless persona/);
  });

  it("throws when the persona has front matter but no body", () => {
    const readFileSync = () => "---\ndescription: d\n---\n";
    expect(() => buildAgentDefinition("stateless", { ...base, readFileSync })).toThrow(/no prompt body/);
  });

  it("throws when there is no bundle to read from", () => {
    expect(() => buildAgentDefinition("stateless", { personasDir: null })).toThrow(/app bundle/);
  });

  it("parses the REAL shipped personas into usable definitions", () => {
    // Guards the actual resources/personas/*.md against a front-matter edit that
    // silently produces an empty description or prompt.
    for (const persona of ["stateful", "stateless"]) {
      const def = buildAgentDefinition(persona, { personasDir: PERSONAS_DIR });
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.prompt.length).toBeGreaterThan(200);
      expect(def.prompt.startsWith("---")).toBe(false);
      expect(def.model).toBeUndefined();
    }
  });

  // Role vocabulary left the Claude-facing prompt with this change: the
  // stateless persona used to open "You are the Developer (DEV) in the Iris
  // delivery pipeline PO → DEV".
  it("ships personas free of role vocabulary", () => {
    for (const persona of ["stateful", "stateless"]) {
      const def = buildAgentDefinition(persona, { personasDir: PERSONAS_DIR });
      expect(`${def.description} ${def.prompt}`).not.toMatch(/\bPO\b|\bDEV\b|Product Owner|PO → DEV/);
    }
  });

  it("keeps the shipped personas byte-identical to their file bodies", () => {
    // The prompt is the persona; a parser bug that dropped a section would be
    // invisible in behavior tests but would change what the agent actually is.
    const raw = fs.readFileSync(path.join(PERSONAS_DIR, "stateless.md"), "utf8");
    const def = buildAgentDefinition("stateless", { personasDir: PERSONAS_DIR });
    expect(def.prompt).toBe(raw.split(/^---$/m)[2].trim());
  });
});
