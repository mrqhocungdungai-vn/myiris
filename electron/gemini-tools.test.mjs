import { describe, it, expect } from "vitest";
import { createGeminiTools } from "./gemini-tools.mjs";

const modelChoices = [
  { id: "claude-fable-5", label: "Fable" },
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

  it("set_agent_model describes the injected model choices", () => {
    const declarations = make().buildPipelineToolDeclarations();
    const setAgentModel = declarations.find((d) => d.name === "set_agent_model");
    expect(setAgentModel.parameters.properties.model.description).toContain("claude-fable-5");
    expect(setAgentModel.parameters.properties.model.description).toContain("claude-sonnet-5");
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
