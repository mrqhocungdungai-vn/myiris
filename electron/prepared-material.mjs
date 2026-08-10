// Reading the folder the user has open for prepared answers
// (iris-answers-from-the-open-folder, design D5/D2).
//
// The user is presenting, someone asks a question, and the answer is usually
// already written down — in the folder they are working out of, in the words
// they chose. This module is the reading half of getting it: walk that folder
// for prepared text, and bound how much of it can reach the voice model at once.
//
// It does NOT decide which passage answers the question. That is design D2, and
// it is the whole architectural point: Gemini heard the question in the form it
// handles best, and a keyword scorer put in front of it would be the most
// fragile step in the chain for no gain — a talk's prep folder fits in context
// several times over. Local scoring appears here only as the OVERFLOW strategy,
// when the folder holds more than the bound, and when it fires the caller is
// told it fired. Silent truncation is what turns "nothing was prepared for that"
// into a lie.
//
// Electron-free, pure over an injected `fs`, and it never throws: a folder that
// vanished between the user picking it and Iris reading it is an empty result,
// not an error in front of an audience.
import nodeFs from "node:fs";
import path from "node:path";
import { foldNoteName } from "./note-name-match.mjs";

/**
 * What counts as prepared material. Two extensions, deliberately.
 *
 * This narrow list is the main guard against the realistic mistake (design D5):
 * the session's folder is pointed at a code repository rather than a prep
 * folder. That case then yields a README and little else, which produces an
 * unhelpful "nothing prepared for that" — never an error, and never a wall of
 * source code read out loud.
 */
export const PREPARED_EXTENSIONS = new Set([".md", ".txt"]);

/**
 * Directories never descended into. Every dotted directory is skipped as well
 * (see `skipsDirectory`); these are the undotted ones that are never prepared
 * material either.
 */
export const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build"]);

/** How many prepared files the walk will read at most. */
export const PREPARED_FILE_LIMIT = 200;

/**
 * How much text the walk will read at most — a defensive bound on the FILE
 * SYSTEM, generous because it exists to stop a mistargeted folder costing real
 * time, not to decide what Iris sees.
 */
export const PREPARED_WALK_MAX_CHARS = 400_000;

/**
 * How much prepared text may reach the voice model in one call — the bound the
 * spec requires ("The amount of prepared material returned in one call SHALL be
 * bounded"). Roughly ten thousand tokens against a 131,072-token window, which
 * is several times what one talk's worth of prepared questions and answers
 * comes to.
 */
export const PREPARED_MATERIAL_MAX_CHARS = 40_000;

/** Words shorter than this are ignored when the overflow path scores files. */
const MIN_SCORED_WORD_LENGTH = 3;

/** Occurrences counted per word before frequency stops mattering. */
const MAX_COUNTED_HITS = 5;

function skipsDirectory(name) {
  return name.startsWith(".") || SKIPPED_DIRECTORIES.has(name);
}

function isPreparedFile(name) {
  return PREPARED_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * The directory's entries, sorted by name, or an empty list if it cannot be
 * read.
 *
 * Sorted so the caps below cut at a predictable place: which files a truncated
 * walk returns must not depend on the order the filesystem happened to hand
 * them over, or two runs over the same folder would answer differently.
 */
function readEntries(fs, dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/**
 * Every prepared file under `folder`, breadth-first and depth-last, under both
 * caps.
 *
 * `truncated` is set only when a prepared file was actually left unread — a
 * folder that fits reports `false`, so the flag means what the spec needs it to
 * mean when it is passed on to the user.
 *
 * @param {{ folder?: string | null, fs?: any, fileLimit?: number, maxChars?: number }} [params]
 * @returns {{ files: Array<{ path: string, text: string }>, truncated: boolean }}
 */
export function readPreparedMaterial({
  folder,
  fs = nodeFs,
  fileLimit = PREPARED_FILE_LIMIT,
  maxChars = PREPARED_WALK_MAX_CHARS,
} = {}) {
  /** @type {Array<{ path: string, text: string }>} */
  const files = [];
  if (typeof folder !== "string" || folder.length === 0) return { files, truncated: false };

  const queue = [folder];
  let totalChars = 0;

  while (queue.length > 0) {
    const dir = /** @type {string} */ (queue.shift());
    for (const entry of readEntries(fs, dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipsDirectory(entry.name)) queue.push(full);
        continue;
      }
      if (!isPreparedFile(entry.name)) continue;

      // A cap reached WITH a file in hand is a real drop, so the flag is honest.
      if (files.length >= fileLimit) return { files, truncated: true };

      let text;
      try {
        text = String(fs.readFileSync(full, "utf8"));
      } catch {
        // An unreadable file is not a truncation: nothing was dropped for want
        // of room, and reporting it as one would tell the user their folder
        // overflowed when it did not.
        continue;
      }

      if (totalChars + text.length > maxChars) {
        // Stop at the first file that does not fit rather than hunting for a
        // smaller one further on: which files come back then depends on sizes
        // as well as order, and a grab-bag is harder to explain than a cut.
        // The first file is kept even when it alone overflows, because a folder
        // holding one long prepared document must not read as an empty one.
        if (files.length === 0) files.push({ path: path.relative(folder, full), text: text.slice(0, maxChars) });
        return { files, truncated: true };
      }

      files.push({ path: path.relative(folder, full), text });
      totalChars += text.length;
    }
  }

  return { files, truncated: false };
}

/** The question's distinct words, folded, long enough to be worth matching. */
function questionWords(question) {
  const folded = foldNoteName(question);
  return [...new Set(folded.split(/[^a-z0-9]+/).filter((word) => word.length >= MIN_SCORED_WORD_LENGTH))];
}

function countHits(haystack, needle) {
  let hits = 0;
  let from = 0;
  while (hits < MAX_COUNTED_HITS) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    hits += 1;
    from = at + needle.length;
  }
  return hits;
}

/**
 * How plausibly one file answers the question — the OVERFLOW heuristic, and
 * nothing else.
 *
 * Presence of a word counts for far more than how often it appears, so a file
 * touching several of the question's words beats one repeating a single word:
 * the failure this guards against is a long unrelated document winning on
 * sheer length. Folded case- and accent-insensitively through the same
 * `foldNoteName` the note-title lookup uses, so a question asked with accents
 * matches material written without them (and the reverse).
 */
function scoreAgainstQuestion(file, words) {
  if (words.length === 0) return 0;
  const haystack = foldNoteName(`${file.path}\n${file.text}`);
  let score = 0;
  for (const word of words) {
    const hits = countHits(haystack, word);
    if (hits > 0) score += MAX_COUNTED_HITS + hits;
  }
  return score;
}

/**
 * The material, narrowed to the bound only if it exceeds it.
 *
 * Under the bound this is the identity and `narrowed` is false — the primary
 * path returns the folder's prepared text and lets the model that heard the
 * question do the matching (design D2). Over the bound it keeps the
 * highest-scoring files that fit, in folder order, and says so.
 *
 * @param {{ files?: Array<{ path: string, text: string }>, question?: string, maxChars?: number }} [params]
 * @returns {{ files: Array<{ path: string, text: string }>, narrowed: boolean }}
 */
export function selectPreparedMaterial({ files = [], question = "", maxChars = PREPARED_MATERIAL_MAX_CHARS } = {}) {
  const total = files.reduce((sum, file) => sum + file.text.length, 0);
  if (total <= maxChars) return { files, narrowed: false };

  const words = questionWords(question);
  const ranked = files
    .map((file, index) => ({ file, index, score: scoreAgainstQuestion(file, words) }))
    // Folder order breaks ties, so an unscored question (or one whose words
    // appear nowhere) narrows to the first files rather than to an arbitrary set.
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));

  const kept = new Set();
  let used = 0;
  for (const { file } of ranked) {
    if (used + file.text.length > maxChars) continue;
    kept.add(file);
    used += file.text.length;
  }

  // Nothing fit whole: return the best candidate's opening, cut. `narrowed` is
  // already true, so the cut is stated rather than passed off as coverage.
  if (kept.size === 0) {
    const [best] = ranked;
    return { files: [{ path: best.file.path, text: best.file.text.slice(0, maxChars) }], narrowed: true };
  }

  return { files: files.filter((file) => kept.has(file)), narrowed: true };
}

/**
 * Read the open folder and bound the result: the one call the capability makes.
 *
 * @param {{
 *   folder?: string | null,
 *   question?: string,
 *   fs?: any,
 *   fileLimit?: number,
 *   walkMaxChars?: number,
 *   maxChars?: number,
 * }} [params]
 * @returns {{ files: Array<{ path: string, text: string }>, truncated: boolean, narrowed: boolean }}
 */
export function gatherPreparedMaterial({
  folder,
  question = "",
  fs = nodeFs,
  fileLimit = PREPARED_FILE_LIMIT,
  walkMaxChars = PREPARED_WALK_MAX_CHARS,
  maxChars = PREPARED_MATERIAL_MAX_CHARS,
} = {}) {
  const walked = readPreparedMaterial({ folder, fs, fileLimit, maxChars: walkMaxChars });
  const selected = selectPreparedMaterial({ files: walked.files, question, maxChars });
  return { files: selected.files, truncated: walked.truncated, narrowed: selected.narrowed };
}
