// The structured shape a role run reports back in, and the reader that turns a
// result message into the two things Iris actually needs: speakable text, and
// the decisions to relay.
//
// Before this, decisions round-tripped through prose: the persona wrote a
// `## Decisions needed` markdown block, and Gemini was told to look for it and
// read it aloud. `outputFormat: { type: 'json_schema', schema }` puts a parsed,
// schema-validated value on `result.structured_output` and re-prompts the model
// when it does not validate, which is strictly better than hoping a heading
// survives.
//
// Measured through a real role run with the persona and plugin loaded
// (design.md D1e): `structured_output` came back parsed, with a populated
// `decisions[]`, no retries. And one thing D6 did not anticipate —
// **`result.result` becomes the raw JSON string**, not prose. That field is what
// finalizes a run and what the voice layer reads aloud, so adopting the schema
// without changing the projection would have Gemini reading a JSON blob to the
// user. `readRunOutput` below is what stops that.
//
// Every field except `summary` is optional, deliberately: the more a schema
// demands, the likelier a run that did all its real work dies on
// `error_max_structured_output_retries` because it could not format a summary.
//
// This module also owns how a run's FAILURE is worded, for the same reason it
// owns how a success is: both shapes finalize through it, and a failure account
// that differed between them would be two stories about the same event.
//
// Electron-free, no I/O.

// A run that terminated because it could not produce valid structured output
// after the SDK's own retries. Named as its own cause: the work it did may be
// complete on disk, and telling the user "the run failed" would send them
// looking for a problem that is not there.
export const STRUCTURED_OUTPUT_FAILURE =
  "The run finished its work but could not format a valid summary after several attempts, so its report was " +
  "lost. Check the project for what it actually changed before re-running — the work itself may be done.";

// How many trailing stderr lines a failed run carries. Enough to show a stack or
// a spawn error, small enough that a chatty subprocess cannot turn a failure
// message into a wall of text.
export const STDERR_TAIL_LINES = 20;

// The SDK hands stderr over in arbitrary chunks, not lines, so this keeps a
// rolling line buffer rather than concatenating everything a run ever wrote.
// Attached to a run only when it FAILS — on the success path these lines are
// debug noise the user has no reason to read.
export function createStderrBuffer(limit = STDERR_TAIL_LINES) {
  const lines = [];
  let partial = "";
  return {
    collect(chunk) {
      partial += String(chunk ?? "");
      const parts = partial.split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) lines.push(line);
      }
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    },
    tail() {
      const all = partial.trim() ? [...lines, partial] : lines;
      return all.slice(-limit).join("\n").trim();
    },
  };
}

// A failure message with the subprocess's own diagnostics behind it. Before
// this, a transport failure reached the user as `Failed to run claude: <message>`
// and nothing else. `limit` is a parameter rather than a closed-over constant so
// the wording always names the same number of lines the buffer actually kept.
export function withStderr(message, tail, limit = STDERR_TAIL_LINES) {
  const diagnostics = tail();
  return diagnostics ? `${message}\n\n--- claude stderr (last ${limit} lines) ---\n${diagnostics}` : message;
}

export const DECISION_OUTPUT_FORMAT = Object.freeze({
  type: /** @type {"json_schema"} */ ("json_schema"),
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "Short, speakable summary of what you did — this is read aloud to the user by voice, so write it " +
          "as prose, not as markdown, and keep it to a few sentences.",
      },
      decisions: {
        type: "array",
        description:
          "Decisions you applied a default for and that the user should confirm. Omit or leave empty when " +
          "there are none — do not invent decisions to fill this in.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The decision, phrased as a question." },
            recommendation: { type: "string", description: "The option you applied as the default." },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  description: { type: "string" },
                },
                required: ["label"],
              },
            },
          },
          required: ["question"],
        },
      },
    },
    required: ["summary"],
  },
});

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Only the shape the relay can actually use. A decision with no question is not
// a decision, and is dropped rather than relayed as a blank prompt.
function normalizeDecisions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => ({
      question: cleanString(entry?.question),
      recommendation: cleanString(entry?.recommendation),
      options: (Array.isArray(entry?.options) ? entry.options : [])
        .map((option) => ({ label: cleanString(option?.label), description: cleanString(option?.description) }))
        .filter((option) => option.label),
    }))
    .filter((entry) => entry.question);
}

/**
 * What to finalize a run with, and what to relay.
 *
 * @param {any} result - the SDK's terminal result message
 * @returns {{ text: string, decisions: Array<{ question: string, recommendation: string, options: Array<{ label: string, description: string }> }>, structured: boolean }}
 */
export function readRunOutput(result) {
  const raw = String(result?.result ?? "");
  const structured = result?.structured_output;

  if (structured && typeof structured === "object") {
    const summary = cleanString(/** @type {any} */ (structured).summary);
    return {
      // Falling back to `raw` when the summary is empty would hand the user the
      // JSON string, which is the exact failure this function exists to prevent.
      text: summary,
      decisions: normalizeDecisions(/** @type {any} */ (structured).decisions),
      structured: true,
    };
  }

  // No structured output: the prose path, unchanged. Decisions stay inside the
  // text for the voice layer to read, exactly as before.
  return { text: raw, decisions: [], structured: false };
}
