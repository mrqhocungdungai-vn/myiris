// The prepared-answers capability (iris-answers-from-the-open-folder): what
// Iris may read out from the folder the user has open, and on whose cue.
//
// The situation this serves is narrow and specific. The user is presenting,
// someone asks them a question, listen-only mode ends, and the answer is
// already written down — in the folder they are working out of, in the words
// they chose to say it. Every route to that text used to run through the
// `capture_learning` verb, which is wrong on all four counts that matter in
// front of an audience: it costs a run, it costs money, it takes seconds
// everyone is watching, and it comes back in Claude's words rather than the
// user's.
//
// So this is not a verb. It is the fourth member of the worker-free class
// (`capture_note`, `find_note_by_name`, `mutate_vault_notes`): local file reads
// and nothing else, deliberately outside `PIPELINE_ONLY_TOOLS` so it survives
// chat-only mode. The cheapest question the app can answer must not be the one
// that needs the most machinery.
//
// It does not decide which passage answers the question (design D2) — it returns
// the folder's prepared text and the model that HEARD the question does the
// matching. Electron-free: the open folder arrives as an injected getter, so
// this module never reaches into the session store.
import { gatherPreparedMaterial } from "../prepared-material.mjs";
import { fenceUntrustedText } from "../untrusted-text.mjs";

/** How much of a spoken question is used; the rest is padding, not signal. */
const QUESTION_MAX_CHARS = 500;

// The routing hazard here is the same shape as `find_note_by_name`'s and needs
// the same three mechanisms. The parameter is `question`, not `name` or `query`,
// because a schema is a contract where prose is only advice — and this takes the
// question that was asked, in the asker's words. The description then carries
// both boundaries explicitly: not the title lookup (which never reads contents),
// and not the retrieval verb (which reads the vault, and costs a run).
const FIND_PREPARED_ANSWER_DECLARATION = {
  name: "find_prepared_answer",
  description:
    "Look in the folder the user currently has open for material THEY prepared that answers a question — an instant " +
    "local read: no Claude run, no tokens, no execution slot, and it works with no Claude credential configured. Use it " +
    "the moment listen-only mode ends and you were asked something, and whenever the user asks whether there is " +
    "anything prepared about a question. It returns the prepared text itself, so you decide which part answers the " +
    "question; when something does, say in ONE short line that you have an answer ready and WAIT — do not start reading " +
    "until the user tells you to go ahead, then read their wording as written, never a summary of it. When nothing in it " +
    "answers the question, say there is nothing prepared and offer the two routes that do cost something (search the " +
    "folder properly with a Claude verb, or retrieve from the notes vault) without starting either. " +
    "This is NOT find_note_by_name, which matches note TITLES and never reads what a note says. It is NOT the " +
    "capture_learning verb either: that reads the notes vault and spends a run. This reads the open project folder, " +
    "for free.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question that was asked, as closely as you can to how it was asked — not a note title and not a " +
          "keyword. Include the words the asker used; they are what the prepared material is matched against if the " +
          "folder is too large to return whole.",
      },
    },
    required: ["question"],
  },
};

/**
 * @param {{
 *   openFolder: () => string | null,
 *   gatherMaterial?: typeof gatherPreparedMaterial,
 *   fenceText?: typeof fenceUntrustedText,
 * }} deps
 */
export function createPreparedAnswers({
  openFolder,
  /**
   * Injected so the capability's own tests can supply material without a
   * filesystem — and so the reading rules stay in `prepared-material.mjs`, which
   * is pure and tested on its own terms.
   */
  gatherMaterial = gatherPreparedMaterial,
  fenceText = fenceUntrustedText,
}) {
  /**
   * The folder the lookup searches: the active session's project folder, and no
   * other (design D1).
   *
   * Deliberately NOT falling back to `~/.myiris/workspace` when none is picked.
   * That directory is where Claude's file work lands when the user chose
   * nowhere; nobody prepared anything in it, and searching it would answer a
   * question from whatever a previous run happened to leave behind.
   */
  function folder() {
    const open = openFolder?.();
    return typeof open === "string" && open.length > 0 ? open : null;
  }

  /**
   * `find_prepared_answer` — a direct read, dispatched outside
   * `PIPELINE_ONLY_TOOLS`.
   *
   * Returns the prepared material rather than a verdict on it. The narrowing and
   * truncation flags travel with it because a user told "nothing was prepared
   * for that", when in fact the material was cut, prepares against a system
   * that lies about its own coverage.
   *
   * @param {{ question?: string }} [params]
   */
  function findPreparedAnswer({ question } = {}) {
    const dir = folder();
    if (!dir) {
      return {
        status: "ok",
        found: false,
        reason: "no_folder_open",
        message:
          "No project folder is selected for this session, so there is no prepared material to look in. Say that, and " +
          "that the user can pick the folder from the UI. Do not search anywhere else.",
      };
    }

    const asked = typeof question === "string" ? question.slice(0, QUESTION_MAX_CHARS) : "";
    const { files, truncated, narrowed } = gatherMaterial({ folder: dir, question: asked });

    if (files.length === 0) {
      return {
        status: "ok",
        found: false,
        reason: "nothing_prepared",
        folder: dir,
        message:
          `Nothing prepared: ${dir} holds no notes or text files to answer from. Say so plainly, then offer to search ` +
          "the folder properly with a Claude verb or to retrieve from the notes vault — and start neither until the " +
          "user picks one.",
      };
    }

    return {
      status: "ok",
      found: true,
      folder: dir,
      sources: files.map((file) => file.path),
      // Reported, never implied: the spec makes stating a narrowing a
      // requirement rather than a courtesy.
      narrowed,
      truncated,
      // Fenced on the same terms as every other file-sourced text this app hands
      // a model (design D6). It is the user's own material, but it is file
      // content reaching a voice model and it can contain sentences shaped like
      // instructions — including material copied in from elsewhere. The fence is
      // a LABEL, not a transform: what Iris reads aloud is the wording inside it,
      // unchanged, which is the whole point of the feature.
      material: fenceText(
        files.map((file) => `--- ${file.path} ---\n${file.text}`).join("\n\n"),
        "the user's own prepared material from the folder they have open",
      ),
      instructions:
        "This is the user's own prepared wording. Decide which part of it answers the question. If something does, say " +
        "in ONE short line that you have an answer ready and stop — read it out only when the user tells you to, and " +
        "then read it exactly as written, not a summary. If nothing here answers it, say nothing is prepared for that " +
        "and offer the two costly routes without starting either." +
        (narrowed
          ? " This folder held more prepared material than fits in one look, so only the most likely part is here — say " +
            "that too if you find nothing, rather than implying the whole folder was considered."
          : "") +
        (truncated
          ? " The folder was also larger than the reader will walk, so some files were not read at all — say that if you " +
            "find nothing."
          : ""),
    };
  }

  function promptFragment() {
    const dir = folder();
    // Naming the folder is what makes a mistargeted session visible to the user
    // (design's Risks: the workstream pointed at a code repository). Iris can
    // say which folder she looked in, so "nothing prepared" is diagnosable
    // instead of mysterious.
    const where = dir
      ? `the folder this session has open (${dir})`
      : "the folder this session has open — right now NO folder is selected, so the lookup will say so rather than searching anywhere else";
    return (
      `PREPARED ANSWERS — ${dir ? "some of" : ""} what the user will be asked is already written down in ${where}. ` +
      "find_prepared_answer reads it directly: no Claude run, no tokens, no credential needed. " +
      "The moment listen-only mode ends and you were asked something, call it straight away — before you consider any " +
      "verb, and without asking the user whether you should look. " +
      "If it comes back with material that answers the question, say in ONE short line that you have an answer ready, " +
      "then WAIT. Do not begin reading unprompted: the user turned the mode off intending to answer some questions " +
      "themselves, and talking over their presentation is a far worse failure than one extra beat. When they tell you " +
      "to go ahead, read their prepared wording exactly as written — never a summary or a rephrasing; those words are " +
      "the reason they prepared it. If they answer the question themselves instead, stay quiet and drop it. " +
      "If nothing in the folder answers the question, say that plainly, then offer the two routes that do cost " +
      "something — searching the folder properly with a Claude verb, or retrieving from the notes vault — and start " +
      "NEITHER until the user chooses. A run you start on your own initiative during a live session spends their money " +
      "and their audience's attention on a guess. " +
      "The one exception is the automatic look the moment listen-only mode ends: if nothing is prepared THEN, say " +
      "nothing at all and wait for the user to speak — they turned the mode off in order to answer, and an absence is " +
      "not worth a sentence at that moment. Report it, with the two routes, once they ask."
    );
  }

  return {
    toolDeclarations: [FIND_PREPARED_ANSWER_DECLARATION],
    promptFragment,
    // Stated empty rather than omitted, on the same terms as hud-telemetry's
    // empty `toolDeclarations`: this capability reaches the renderer through no
    // channel of its own and has nothing to tear down, and saying so is clearer
    // than leaving a reader to conclude it from an absence.
    ipcHandlers: [],
    // The contract's availability probe. Nothing core reads it today — it is
    // here because "is there a folder to look in" is exactly the question the
    // field is for, and the capability's tests assert against it.
    probe: () => ({ ok: folder() !== null, folder: folder() }),
    findPreparedAnswer,
  };
}
