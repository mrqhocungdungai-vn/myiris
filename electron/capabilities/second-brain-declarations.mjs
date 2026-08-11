// The three tool declarations the second-brain capability contributes to
// Gemini's tool surface.
//
// Data, not behavior: each is a name, a description and a parameter schema, and
// nothing here reads the vault or holds any state. They are split out of
// second-brain.mjs because their descriptions are long — the descriptions ARE
// the routing logic for the model, so they are written at length deliberately —
// and they were pushing the capability module past three times the file-size
// convention while having nothing to do with its behavior.
//
// `capture_note` and `find_note_by_name` are NOT verbs: they start no Claude
// run, so they do not belong in the registry `capture_learning` is defined in
// (vault-write-path design D4). They are declared unconditionally, because
// gemini-tools.mjs concatenates every capability's toolDeclarations outside the
// pipelineAvailable gate — so they survive chat-only mode.

// Capture's own declaration (vault-write-path design D4): it is NOT a verb —
// it starts no Claude run, so it does not belong in the registry that
// `capture_learning` (curation) is defined in. Declared unconditionally
// (gemini-tools.mjs concatenates every capability's toolDeclarations outside
// the pipelineAvailable gate), so it survives chat-only mode.
export const CAPTURE_NOTE_DECLARATION = {
  name: "capture_note",
  description:
    "Save a thought directly to the user's personal notes vault, right now — a plain file write: no Claude run, no tokens, " +
    "no execution slot, and it works even with no Claude credential configured. Use for 'note this down', 'save that', " +
    "'ghi chú lại: …'. This creates a REAL note the user can open, search and see in the galaxy immediately — it is not a " +
    "queue. Confirm only after this reports status 'ok', and say the title it reports back; if it reports an error, tell " +
    "the user it was not saved. For weaving many existing notes into a linked wiki page, retrieving from notes, or an " +
    "explicit 'write this up as a page' request, use the capture_learning verb instead.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The thought to capture, in the user's own words, as close to verbatim as you can manage.",
      },
      title: {
        type: "string",
        description:
          "A short title. This becomes the note's filename and is how the user finds it again, so give one whenever the " +
          "thought has an obvious subject. Omit it only when it genuinely has none — the first line is used instead.",
      },
      tags: { type: "string", description: "Comma-separated tags, only if obvious from context. Optional." },
    },
    required: ["text"],
  },
};

// Structural vault edits (personal-knowledge-notes: "direct writes on the
// same terms as capture" — no run, no tokens, no execution slot). NOT a verb,
// for the identical reason capture_note is not one: a text transform over
// markdown has no judgement in it, so routing it through a worker would give
// an instant, deterministic edit a run's latency and cost. Defaults to
// whatever is currently focused in the galaxy — the shared-focus thesis
// ("voice supplies the verb, the hand supplies the noun") — but also accepts
// note titles by name for a request with nothing pointed at.
export const MUTATE_VAULT_NOTES_DECLARATION = {
  name: "mutate_vault_notes",
  description:
    "Link two existing vault notes to each other, unlink them, or set a note's tags — a direct file write: no Claude run, " +
    "no tokens. When note_titles is omitted, defaults to the note currently open in the reader if one is open, otherwise " +
    "to whatever is focused/selected in the second-brain galaxy (pointed at with their hand, or clicked) — use this for " +
    "'tag this', 'connect these two', 'unlink these'. " +
    "Pass note_titles only when the user named specific notes by title instead of pointing at them. link/unlink need " +
    "exactly two notes (focused or named); set_tags needs exactly one. If this reports an error, tell the user the edit " +
    "did not happen rather than confirming it.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["link", "unlink", "set_tags"],
        description: "link: connect two notes both ways. unlink: remove that connection. set_tags: replace a note's tags.",
      },
      note_titles: {
        type: "string",
        description:
          "Comma-separated note titles, ONLY if the user named specific notes rather than pointing at them. Omit to use " +
          "whatever is currently focused in the galaxy.",
      },
      tags: { type: "string", description: "Comma-separated tags, for the set_tags operation. Replaces the note's existing tags." },
    },
    required: ["operation"],
  },
};

// Finding a note by NAME (personal-knowledge-notes: "A note is findable by
// name, spoken, without spending a run"). NOT a verb, for the same reason
// capture_note is not one read the other way: comparing what the user said
// against a list of titles needs no model, so routing it through a worker would
// make the cheapest question this capability can answer the slowest, the only
// one that could fail for reasons unrelated to the vault, and the only one a
// user without a Claude credential could not ask.
//
// The description carries the boundary against `capture_learning` (design.md
// D3, mechanism 2), on the pattern capture_note's already uses against the same
// verb. This is the change's central hazard: "find my note about the deployment"
// and "what do my notes say about the deployment" are one word apart and route
// to completely different machinery, and choosing wrong is not symmetrical —
// answering a contents question from a filename is a confident wrong answer,
// which is worse than the slower correct one.
//
// The parameter is `name`, not `query`/`subject`/`question` (mechanism 1): a
// schema is a contract the calling interface enforces, where prose is only
// advice, so the strongest statement of "this takes a name" is the name of the
// thing it takes.
export const FIND_NOTE_DECLARATION = {
  name: "find_note_by_name",
  description:
    "Find the user's notes whose TITLE matches a name they said — an instant local lookup: no Claude run, no tokens, " +
    "no execution slot, and it works even with no Claude credential configured. Use for 'find my note called X', " +
    "'which note is X', 'open my X note', 'tìm ghi chú tên là X'. Matching ignores case and accents. Returns the " +
    "matching titles: when several match, name them and let the user choose rather than picking one; when none match, " +
    "say so rather than offering an unrelated note. " +
    "Do NOT use this to answer what the user's notes SAY about a subject, to summarise or synthesise across notes, or " +
    "for 'what do my notes say about X' / 'what do I know about X' — that is retrieval, it reads the notes' contents, " +
    "and it is the capture_learning verb, not this lookup. This only ever sees titles, so answering a question about " +
    "contents from it would be guessing from a filename.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The note's name, as the user said it — a title or part of one, NOT a subject, question, or description of " +
          "what the note is about.",
      },
      open: {
        type: "boolean",
        description:
          "True only when the user asked to OPEN the note as well as find it ('open my X note'). Opens it when exactly " +
          "one note matches. Omit for a plain lookup.",
      },
    },
    required: ["name"],
  },
};
