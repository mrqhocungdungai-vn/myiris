import { describe, it, expect } from "vitest";
import { DECISION_OUTPUT_FORMAT, readRunOutput } from "./run-output-format.mjs";

describe("DECISION_OUTPUT_FORMAT", () => {
  // The more a schema demands, the likelier a run that did all its real work
  // dies on error_max_structured_output_retries because it could not format a
  // summary (design.md D6).
  it("requires nothing but a summary", () => {
    expect(DECISION_OUTPUT_FORMAT.schema.required).toEqual(["summary"]);
    expect(DECISION_OUTPUT_FORMAT.schema.properties.decisions.type).toBe("array");
  });

  it("asks for speakable prose, since the summary is read aloud", () => {
    expect(DECISION_OUTPUT_FORMAT.schema.properties.summary.description).toContain("read aloud");
  });
});

describe("readRunOutput — structured", () => {
  const structured = {
    subtype: "success",
    result: '{"summary":"Did the thing.","decisions":[]}',
    structured_output: {
      summary: "Did the thing.",
      decisions: [
        {
          question: "Store cost on the run or in a side table?",
          recommendation: "On the run",
          options: [
            { label: "On the run", description: "Simpler" },
            { label: "Side table", description: "Normalized" },
          ],
        },
      ],
    },
  };

  // The failure this function exists to prevent: `result.result` becomes the
  // raw JSON string once outputFormat is set, and that field is what the voice
  // layer reads aloud.
  it("takes the speakable text from the summary, never the JSON string", () => {
    const read = readRunOutput(structured);
    expect(read.text).toBe("Did the thing.");
    expect(read.text).not.toContain("{");
    expect(read.structured).toBe(true);
  });

  it("returns the decisions as data", () => {
    const [decision] = readRunOutput(structured).decisions;
    expect(decision.question).toContain("side table");
    expect(decision.recommendation).toBe("On the run");
    expect(decision.options.map((o) => o.label)).toEqual(["On the run", "Side table"]);
  });

  it("drops a decision with no question, and an option with no label", () => {
    const read = readRunOutput({
      structured_output: {
        summary: "s",
        decisions: [
          { recommendation: "orphaned" },
          { question: "  ", options: [] },
          { question: "Real?", options: [{ description: "no label" }, { label: "Yes" }] },
        ],
      },
    });
    expect(read.decisions).toHaveLength(1);
    expect(read.decisions[0].options).toEqual([{ label: "Yes", description: "" }]);
  });

  it("copes with a summary-only result", () => {
    const read = readRunOutput({ structured_output: { summary: "Just this." } });
    expect(read).toEqual({ text: "Just this.", decisions: [], structured: true });
  });
});

describe("readRunOutput — the prose fallback", () => {
  // A session resumed from before the schema existed cannot produce structured
  // output, and plain Claude never declares a schema at all.
  it("passes prose straight through", () => {
    const text = "Implemented it.\n\n## Decisions needed\n1. Which colour?";
    const read = readRunOutput({ subtype: "success", result: text });
    expect(read).toEqual({ text, decisions: [], structured: false });
  });

  it("is safe on a result that carries nothing", () => {
    expect(readRunOutput(null)).toEqual({ text: "", decisions: [], structured: false });
    expect(readRunOutput({}).text).toBe("");
  });

  it("ignores a structured_output that is not an object", () => {
    expect(readRunOutput({ result: "prose", structured_output: "nope" }).structured).toBe(false);
  });
});
