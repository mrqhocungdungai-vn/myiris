import { describe, it, expect } from "vitest";
import {
  DECISION_OUTPUT_FORMAT,
  STDERR_TAIL_LINES,
  STRUCTURED_OUTPUT_FAILURE,
  createStderrBuffer,
  readRunOutput,
  withStderr,
} from "./run-output-format.mjs";

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
  // output, and the verbs that answer a question rather than reporting on work
  // (`investigate`, `capture_learning`) declare no schema at all.
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

// How a run's FAILURE is worded belongs here for the same reason its success
// does: both run shapes finalize through this module, so neither can grow its
// own account of the same event.
describe("the stderr tail a failed run carries", () => {
  it("keeps whole lines out of arbitrary chunks", () => {
    const buffer = createStderrBuffer();
    buffer.collect("first li");
    buffer.collect("ne\nsecond line\n");
    expect(buffer.tail()).toBe("first line\nsecond line");
  });

  it("includes a trailing line the subprocess never terminated", () => {
    const buffer = createStderrBuffer();
    buffer.collect("no newline at the end");
    expect(buffer.tail()).toBe("no newline at the end");
  });

  it("drops blank lines rather than padding the tail with them", () => {
    const buffer = createStderrBuffer();
    buffer.collect("one\n\n   \ntwo\n");
    expect(buffer.tail()).toBe("one\ntwo");
  });

  // A chatty subprocess must not be able to turn a failure message into a wall
  // of text: the buffer is rolling, so it is the LAST lines that survive.
  it("keeps only the last `limit` lines", () => {
    const buffer = createStderrBuffer(3);
    for (let i = 1; i <= 10; i += 1) buffer.collect(`line ${i}\n`);
    expect(buffer.tail()).toBe("line 8\nline 9\nline 10");
  });

  it("defaults to twenty lines", () => {
    expect(STDERR_TAIL_LINES).toBe(20);
    const buffer = createStderrBuffer();
    for (let i = 1; i <= 25; i += 1) buffer.collect(`line ${i}\n`);
    expect(buffer.tail().split("\n")).toHaveLength(20);
  });
});

describe("withStderr", () => {
  it("appends the diagnostics behind the message, naming how many lines they are", () => {
    const message = withStderr("Failed to run claude: boom", () => "at foo\nat bar", 20);
    expect(message).toContain("Failed to run claude: boom");
    expect(message).toContain("--- claude stderr (last 20 lines) ---");
    expect(message).toContain("at foo\nat bar");
  });

  // The wording must name the number of lines actually kept, which is why the
  // limit is a parameter rather than a constant closed over at the call site.
  it("names the limit it was given", () => {
    expect(withStderr("failed", () => "a line", 3)).toContain("last 3 lines");
  });

  it("returns the message untouched when the subprocess said nothing", () => {
    expect(withStderr("Failed to run claude: boom", () => "")).toBe("Failed to run claude: boom");
  });
});

describe("STRUCTURED_OUTPUT_FAILURE", () => {
  // The work may be complete on disk; telling the user "the run failed" sends
  // them looking for a problem that is not there.
  it("says the work may be done rather than reading as a broken run", () => {
    expect(STRUCTURED_OUTPUT_FAILURE).toMatch(/the work itself may be done/i);
    expect(STRUCTURED_OUTPUT_FAILURE).toMatch(/finished its work/i);
  });
});
