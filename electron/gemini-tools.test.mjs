import { describe, it, expect } from "vitest";
import { createGeminiTools } from "./gemini-tools.mjs";
import { VERB_NAMES, resolveAllVerbs } from "./verbs.mjs";

const modelChoices = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet" },
];

/** @param {{ pipelineAvailable?: boolean, envFlag?: (name: string, fallback?: boolean) => boolean }} [opts] */
/** @param {{ pipelineAvailable?: boolean, envFlag?: (name: string, fallback?: boolean) => boolean, capabilities?: Array<{ toolDeclarations?: any[] }> }} [opts] */
function make({ pipelineAvailable = true, envFlag = () => false, capabilities = [] } = {}) {
  return createGeminiTools({
    getPipelineAvailable: () => pipelineAvailable,
    modelChoices,
    envFlag,
    capabilities,
  });
}

describe("gemini-tools", () => {
  it("includes pipeline-gated declarations only when the pipeline is available", () => {
    const available = make({ pipelineAvailable: true }).buildClaudeTools();
    const names = available[0].functionDeclarations.map((d) => d.name);
    expect(names).toContain("submit_claude_task");
    expect(names).toContain("get_ui_context");

    const unavailable = make({ pipelineAvailable: false }).buildClaudeTools();
    const namesUnavailable = unavailable[0].functionDeclarations.map((d) => d.name);
    expect(namesUnavailable).not.toContain("submit_claude_task");
    expect(namesUnavailable).toContain("get_ui_context");
  });

  it("declaration shape is stable — one functionDeclarations tool", () => {
    const tools = make().buildClaudeTools();
    expect(tools).toHaveLength(1);
    expect(Array.isArray(tools[0].functionDeclarations)).toBe(true);
  });

  it("set_verb_model describes the injected model choices and every verb", () => {
    const declarations = make().buildPipelineToolDeclarations();
    const setVerbModel = declarations.find((d) => d.name === "set_verb_model");
    expect(setVerbModel.parameters.properties.model.description).toContain("claude-opus-5");
    expect(setVerbModel.parameters.properties.model.description).toContain("claude-sonnet-5");
    for (const verb of VERB_NAMES) {
      expect(setVerbModel.parameters.properties.verb.description).toContain(verb);
    }
  });

  // The registry is the single definition; a declaration written out by hand
  // here is exactly the second copy the registry exists to prevent.
  it("derives a declaration for every verb from the registry, schema and all", () => {
    const declarations = make().buildPipelineToolDeclarations();
    for (const resolved of resolveAllVerbs()) {
      const declaration = declarations.find((entry) => entry.name === resolved.verb);
      expect(declaration).toBeDefined();
      expect(declaration.description).toBe(resolved.description);
      expect(declaration.parameters).toEqual(resolved.params);
    }
  });

  // The two stateful verbs take a thin schema because their model can pause and
  // ask; the stateless ones cannot, so their parameters are the instruction.
  it("gives the stateful verbs a thin schema and the stateless ones concrete parameters", () => {
    const declarations = make().buildPipelineToolDeclarations();
    for (const name of ["shape_requirements", "shape_on_canvas"]) {
      expect(Object.keys(declarations.find((d) => d.name === name).parameters.properties)).toEqual(["said", "reading"]);
    }
    const execute = declarations.find((d) => d.name === "execute");
    expect(execute.parameters.required).toEqual(["goal", "details"]);
    expect(execute.parameters.properties.details.description).toContain("cannot ask you anything");
  });

  // A tool with no boundary is not a tool. The general-purpose one survives only
  // as a deprecated alias, so a resumed Gemini session does not break.
  it("offers no undifferentiated task tool beyond the deprecated alias", () => {
    const declarations = make().buildPipelineToolDeclarations();
    const legacy = declarations.find((d) => d.name === "submit_claude_task");
    expect(legacy.description).toMatch(/^DEPRECATED/);
    expect(declarations.filter((d) => /hand .*work to claude/i.test(d.description))).toEqual([]);
  });

  // Role vocabulary leaves the surface the model reads.
  it("mentions no role in any declaration", () => {
    const declarations = [...make().buildPipelineToolDeclarations(), ...make().buildAlwaysToolDeclarations()];
    for (const declaration of declarations) {
      expect(`${declaration.name} ${declaration.description} ${JSON.stringify(declaration.parameters)}`).not.toMatch(
        /\bPO\b|\bDEV\b|Product Owner/,
      );
    }
  });

  it("buildLiveTools adds googleSearch only when the env flag is set", () => {
    const withSearch = make({ envFlag: (name) => name === "IRIS_ENABLE_GOOGLE_SEARCH" }).buildLiveTools();
    expect(withSearch[0]).toEqual({ googleSearch: {} });

    const withoutSearch = make({ envFlag: () => false }).buildLiveTools();
    expect(withoutSearch.some((t) => t.googleSearch)).toBe(false);
  });

  it("composes capability tool declarations without changing output when none are registered", () => {
    const withoutCapabilities = make().buildClaudeTools();
    const withEmptyList = make({ capabilities: [] }).buildClaudeTools();
    expect(withEmptyList).toEqual(withoutCapabilities);
  });

  it("concatenates a registered capability's tool declarations", () => {
    const fakeCapability = { toolDeclarations: [{ name: "draw_shape", parameters: { type: "object", properties: {} } }] };
    const tools = make({ capabilities: [fakeCapability] }).buildClaudeTools();
    const names = tools[0].functionDeclarations.map((d) => d.name);
    expect(names).toContain("draw_shape");
  });
});
