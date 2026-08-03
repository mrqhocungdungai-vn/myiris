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
// Electron-free, no I/O.

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
