import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_VERBS, MODEL_CHOICES, VERB_COLORS, VERB_LABELS, isVerb, sessionKeyForVerb, verbLabel } from "./verbs";
// The main-process registry is the single definition. Importing it here is the
// point: a renderer copy that could silently disagree with it is exactly the
// duplication the registry exists to prevent.
import {
  MODEL_CHOICES as MAIN_MODEL_CHOICES,
  VERB_NAMES,
  resolveVerb,
} from "../../electron/verbs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

describe("the renderer's verb vocabulary agrees with the registry", () => {
  it("names the same verbs, in the same order", () => {
    expect(ALL_VERBS).toEqual(VERB_NAMES);
  });

  it("uses each verb's own label", () => {
    for (const name of VERB_NAMES) {
      expect(VERB_LABELS[name as never]).toBe(resolveVerb(name).label);
    }
  });

  // The two shaping verbs share a conversation, so they share a hue.
  it("colours the shared conversation as one thing", () => {
    expect(VERB_COLORS.shape_requirements).toBe(VERB_COLORS.shape_on_canvas);
    for (const name of ALL_VERBS) {
      expect(VERB_COLORS[name]).toMatch(/^var\(--[a-z]+-rgb\)$/);
    }
  });

  it("offers the same model choices main does", () => {
    expect(MODEL_CHOICES).toEqual(MAIN_MODEL_CHOICES);
  });

  it("resolves a verb to the conversation it actually resumes", () => {
    for (const name of VERB_NAMES) {
      expect(sessionKeyForVerb(name as never)).toBe(resolveVerb(name).sessionKey);
    }
    expect(sessionKeyForVerb("shape_on_canvas")).toBe("stateful");
  });

  it("recognizes a verb and rejects a retired role name", () => {
    expect(isVerb("execute")).toBe(true);
    expect(isVerb("dev")).toBe(false);
    expect(verbLabel("po")).toBe("");
    expect(verbLabel("execute")).toBe("Build");
  });

  // Every colour token must exist, or a badge renders with no colour at all.
  it("names only design tokens the theme defines", () => {
    const tokens = read("src/styles/tokens.css");
    for (const value of new Set(Object.values(VERB_COLORS))) {
      expect(tokens).toContain(`${value.slice("var(".length, -1)}:`);
    }
  });
});

// There is no render harness in this project, so these read the components
// themselves — the same shape as the tests that read the shipped personas and
// the plugin's skill directory.
describe("the interface offers no way to choose a verb", () => {
  const pipelineBar = read("src/components/PipelineBar.tsx");

  it("renders no verb selector and exposes no selection handler", () => {
    expect(pipelineBar).not.toMatch(/onChooseAgent|onChooseVerb|onSelectVerb|selectAgent/);
    expect(pipelineBar).not.toContain("ALL_VERBS");
  });

  it("keeps the review-mode control, now with its three settings", () => {
    expect(pipelineBar).toContain("ReviewModeControl");
    for (const mode of ["verb", "always", "never"]) {
      expect(pipelineBar).toContain(`"${mode}"`);
    }
  });

  it("shows what ran last rather than what is selected", () => {
    expect(pipelineBar).toContain("lastVerb");
    expect(pipelineBar).toMatch(/what ran most recently, not a mode/);
  });

  it("leaves no role-selection channel on the preload bridge", () => {
    const preload = read("electron/preload.cjs");
    expect(preload).not.toContain("agents:select");
    expect(preload).not.toContain("selectAgent");
    expect(preload).toContain("verbs:list");
  });

  it("badges a run card with the verb that ran and its model", () => {
    const workCard = read("src/components/WorkCard.tsx");
    expect(workCard).toContain("VerbBadge");
    expect(workCard).toContain("verb={task.verb}");
    expect(workCard).toContain("model={task.model}");
  });
});
