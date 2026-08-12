// The second-brain capability (personal-knowledge-notes,
// second-brain-galaxy-view): the LLM-Wiki notes vault's readiness checks,
// the read-only galaxy graph watcher, and this capability's slice of Gemini
// prose / IPC / teardown — gathered here per design.md D10 rather than
// spread across the layered core modules. Electron-free.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVaultGraph } from "../vault-graph.mjs";
import { matchNotesByName } from "../note-name-match.mjs";
import { appendRunRecord, inboxBacklog } from "../run-inbox.mjs";
import {
  captureSpoolDir,
  runSpoolDir,
  sessionsSpoolDir,
  linkNotes,
  unlinkNotes,
  setNoteTags,
  writeVaultNote,
} from "../vault-write.mjs";
import { INITIAL_FOCUS, FOCUS_PROMPT_BOUND, toggle as toggleFocusId, clear as clearFocusState, resolve as resolveFocus } from "../focus.mjs";
import { createAmbientCapture } from "./ambient-capture.mjs";
// The three tool declarations live in second-brain-declarations.mjs — data,
// not behavior, and long enough to crowd this module.
import {
  CAPTURE_NOTE_DECLARATION,
  MUTATE_VAULT_NOTES_DECLARATION,
  FIND_NOTE_DECLARATION,
} from "./second-brain-declarations.mjs";
// Vault setup — the directory, the seeded config/schema and welcome note, and
// the skills check. All idempotent; see the module for why.
import { createVaultSetup } from "./second-brain-vault-setup.mjs";
import { createNotePathResolver, isNoteId } from "./second-brain-note-path.mjs";
import {
  focusLine,
  openNoteLine,
  noteOpenedMessage,
  noteEditedMessage,
  focusUpdateMessage,
} from "./second-brain-announcements.mjs";

// Personal-knowledge-notes capability (see openspec/changes/llm-wiki/): the
// LLM-Wiki vault is pinned to this fixed, user-level path, independent of any
// workstream's project cwd. Only the `capture_learning` verb is granted it.
const NOTES_VAULT_DIR = path.join(os.homedir(), "iris-second-brain");

// Where every finished run's record is appended (design.md D5). Inside the
// vault, so `capture_learning` reaches it through the same granted directory it
// already has, with nothing extra to wire.
const NOTES_INBOX_DIR = runSpoolDir(NOTES_VAULT_DIR);

// Where a voice capture lands, awaiting curation (vault-write-path design D3).
// A one-line spoken thought has no title, tags, or links, so it goes to the
// spool rather than becoming a page — promotion to a linked page is the
// curator's job.
const NOTES_CAPTURES_DIR = captureSpoolDir(NOTES_VAULT_DIR);

// Where ambient session capture flushes retained conversation text, when the
// user has opted in (ambient-memory). Inside the vault, so it rides the same
// granted directory and the same `inbox/` galaxy exclusion the other two
// spools already have — no new exclusion needed.
const NOTES_SESSIONS_DIR = sessionsSpoolDir(NOTES_VAULT_DIR);

// How often a live capture flushes progressively (design D5) — modest enough
// that a crash loses only a few seconds of conversation, without writing to
// disk on every utterance.
const AMBIENT_FLUSH_INTERVAL_MS = 30000;

// Ceiling on a single hand-authored note write (add-manual-note-editing). Not a
// security boundary — the writer is the vault's owner typing into their own note
// — but a bound on what one IPC message may carry, on the same terms every other
// renderer-supplied value in this module is length-checked. Counted in string
// length (UTF-16 code units), not bytes, because that is what is actually being
// bounded here; generous enough that no real note reaches it either way.
const MAX_NOTE_WRITE_CHARS = 2_000_000;

// The revision token read-note serves and write-note requires: a hash of the
// exact content, so a save can be refused when the file no longer holds the
// bytes the editor was opened on (add-manual-note-editing design.md D2).
function revisionOf(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

// How many un-synthesized records make it worth OFFERING to weave them in.
// Offering too eagerly trains the user to say no; the number is a threshold for
// an offer, never for an action — synthesis is never started unprompted.
const INBOX_OFFER_THRESHOLD = 8;

// The 6 vendored skill names this capability needs installed in
// ~/.claude/skills before Claude actually has LLM-Wiki instructions to follow
// (they are deliberately NOT in REQUIRED_SKILLS — that list gates the
// build pipeline, not Talk-mode notes; see pipeline-probes.mjs's
// checkSkillsStatus()). Vault creation (ensureNotesVaultReady, below) and
// skill installation (installPipelinePrereqs, via the SetupPanel's "Install
// missing" button) are two independent actions on two different schedules —
// the vault can exist before the skills are ever installed. Without this
// check, the append-system-prompt directive would tell Claude to "use the
// wiki skills" that aren't actually there, and Claude would either invent an
// ungoverned note format or hallucinate the skill's behavior instead of
// doing the real LLM-Wiki workflow.
const NOTES_SKILLS = ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"];


// Loose heuristic for the vault-write backstop below — matches common
// English/Vietnamese phrasing for "save/capture a note" (mirrors the example
// utterances in specs/personal-knowledge-notes/spec.md). False negatives just
// mean the backstop caveat isn't appended (same as before this capability
// existed); false positives are harmless (the caveat only fires when nothing
// in the vault changed, so a request that never intended to write there
// stays silent).

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   notifyIris: (lines: string | string[], opts?: { bufferIfOffline?: boolean }) => void,
 *   irisPluginDir: () => string | null,
 *   userDisplayName: () => string,
 *   getPipelineAvailable: () => boolean,
 *   recentUtterances?: () => Array<{ text: string, at: number }>,
 *   isListenOnlyEngaged?: () => boolean,
 *   openPathExternally?: (filePath: string) => Promise<any>,
 * }} deps
 */
export function createSecondBrainCapability({
  emitEvent,
  emitToRenderer,
  notifyIris,
  irisPluginDir,
  userDisplayName,
  getPipelineAvailable,
  recentUtterances = () => [],
  /**
   * Whether listen-only mode is engaged right now, read from the live session
   * (its sole owner) at the moment ambient capture asks. Ambient capture stands
   * aside for that whole span — see ambientCaptureLive below — and it reads the
   * mode directly rather than being handed a copy, so there is no second piece
   * of state here to fall out of step with the one that decides.
   */
  isListenOnlyEngaged = () => false,
  /**
   * Hands a resolved, in-vault file path to the OS's default application for
   * it. Injected rather than imported (design.md D3 of add-manual-note-editing)
   * because it is Electron's `shell.openPath` and this module is Electron-free
   * — `main-process-structure` confines Electron API access to four modules, and
   * keeping this one out of that set is what makes it importable in a plain
   * vitest file. The wiring layer supplies the real one; a test supplies a fake
   * that records the path it was handed.
   */
  openPathExternally = async () => {},
}) {
  // Vault setup (directory, seeded config/schema, the welcome note) and the
  // skills check — see second-brain-vault-setup.mjs.
  const vaultSetup = createVaultSetup({
    vaultDir: NOTES_VAULT_DIR,
    skills: NOTES_SKILLS,
    irisPluginDir,
    emitEvent,
  });
  const { checkNotesSkillsStatus, ensureNotesVaultReady } = vaultSetup;

  // Second-brain galaxy view (second-brain-galaxy-view): reads the same
  // NOTES_VAULT_DIR the notes capability writes, purely for viewing — never
  // creates or writes to the vault. Module-level singleton, like canvasStore,
  // so its watcher/cache lifecycle survives window recreation.
  const notesVaultGraph = createVaultGraph({ dir: NOTES_VAULT_DIR });
  // Dedicated channel for the (potentially large) full graph payload, kept out
  // of the sidecar:event log stream (design.md D3/L2). Only fires while the
  // watcher is actually running (start()'d), so this subscription is safe to
  // hold for the module's whole lifetime rather than churning per toggle.
  notesVaultGraph.onUpdate((graph) => {
    latestGraph = graph;
    emitToRenderer("secondbrain:graph-updated", graph);
  });

  // second-brain-focus (design D1/D2): the shared selection of vault notes,
  // owned here as the one instance — the renderer produces it (hand/mouse),
  // the voice layer and Claude's runs both read it. Ids only; resolved late
  // against `latestGraph`, a plain mirror of whatever the watcher/getGraph
  // last saw (no separate fetch — the galaxy view already keeps this fresh
  // for its own rendering, so the focus rides the same freshness for free).
  let focusState = INITIAL_FOCUS;
  let latestGraph = { nodes: [], links: [] };
  // open-note-session: which note is open in the reader, owned here on the
  // same terms as the focus above — identity only, never a metadata snapshot
  // (spec: "stored as a note identity only... resolved... against the live
  // vault graph"). Reported by the renderer's openNote lifecycle; read by
  // promptFragment()/announceNoteOpened() below, by mutateVaultNotes's target
  // precedence, and by run-exec.mjs's per-note session key and write guard.
  let openNoteId = null;
  // Whether the galaxy layer is the currently-active view (design D6/D7 of
  // second-brain-focus): gates the focus line in promptFragment() (a focus
  // that outlived its view must not keep talking about itself) and is what
  // the deactivate route below clears the focus on — see design's "cleared on
  // exactly the terms that already clear an open note reader": the renderer
  // unmounts the galaxy (and so calls deactivate) on every one of those
  // routes today, independent of this change.
  let secondBrainActive = false;

  // The three SYSTEM_EVENT pushes and the two fenced content lines are pure
  // builders in second-brain-announcements.mjs, where the fencing of untrusted
  // titles/tags and the "announce the gone case too" rule are both asserted.
  function announceNoteOpened() {
    notifyIris(noteOpenedMessage(resolveOpenNote()));
  }

  function announceNoteEdited() {
    const note = resolveOpenNote();
    if (!note) return;
    notifyIris(noteEditedMessage(note));
  }

  function announceFocusUpdate() {
    notifyIris(focusUpdateMessage(resolveFocus(focusState, latestGraph, FOCUS_PROMPT_BOUND)));
  }

  // Gated purely on the vault existing, independent of pipelineAvailable
  // (design.md D7) — viewing only reads local markdown. Modeled exactly on
  // probePipelineAvailability's single-mutation-choke-point shape: tracks the
  // last-emitted value and only emits on a real false<->true transition, never
  // on every ensureNotesVaultReady() call (which runs on every plain-Claude
  // turn and would otherwise fire constantly).
  let secondBrainAvailable = false;
  function probeSecondBrainAvailability() {
    const next = fs.existsSync(NOTES_VAULT_DIR);
    if (next !== secondBrainAvailable) {
      secondBrainAvailable = next;
      emitEvent({ type: "secondbrain_availability", available: secondBrainAvailable });
      // The vault disappeared out from under an active watch (e.g. deleted
      // while the galaxy was open) — stop rather than let fs.watch spin on a
      // now-missing directory.
      if (!secondBrainAvailable) notesVaultGraph.stop();
    }
    return secondBrainAvailable;
  }

  // Records one finished run. Called from the run queue's finalize path for
  // EVERY terminal status, successes and failures alike — a failed attempt is at
  // least as worth keeping as a successful one. It is a plain file append: no
  // run is started, no tokens are spent, and the single execution slot is not
  // held, so bookkeeping can never delay the user's next request.
  //
  // Deliberately not conditional on the voice layer choosing to record
  // something: accumulated knowledge that requires a model to remember to save
  // it is knowledge that will be lost.
  function captureRunOutcome(run) {
    return appendRunRecord({
      dir: NOTES_INBOX_DIR,
      run,
      onError: (error) => {
        emitEvent({ type: "log", level: "warn", message: `Could not record the run in the second brain: ${error.message}` });
      },
    });
  }

  // The capture record's own shape (design D3): a raw voice capture has no
  // title, tags, or links by default — those are honoured when Gemini supplies
  // them, but the common case is a bare thought. Owned here, not by
  // vault-write.mjs, on the same D1 split run-inbox.mjs already uses: that

  // The capture tool's handler (personal-knowledge-notes, vault-write-path
  // design D4): a direct file write, not a run. Ensures the vault exists first
  // (design D7) so a first-ever capture on a machine with no vault yet still
  // lands, then appends to the capture spool and reports what the filesystem
  // actually did — never a claim of success before the write settles (spec: "A
  // capture whose write fails is reported as failed, not confirmed").
  /** @param {{ text?: string, title?: string, tags?: string | string[] }} [params] */
  // A NOTE THE USER ASKED FOR IS A NOTE, NOT A QUEUE ENTRY.
  //
  // This used to append a line to `inbox/captures` — a spool awaiting a later
  // `capture_learning` run to weave it into the vault — and then report "Saved
  // to your notes." Nothing by that name existed. The user could not open it,
  // could not find it in the galaxy, and had no way to tell that what they
  // heard was a promise rather than a fact.
  //
  // The inbox is for material the user did NOT ask to keep: ambient session
  // capture and finished-run records, which are raw and need curating before
  // they are worth anything. Batching exists because curation is expensive. But
  // "write this into my second brain" IS the curation decision — the user has
  // already made it, and deferring it solves a problem they did not have.
  //
  // Written directly, with no worker, exactly as the welcome note is: a plain
  // markdown file with frontmatter, which is what every other note in this
  // vault is. That keeps it working with no Claude credential at all, which
  // matters most here — the cheapest thing the second brain can do must not be
  // the thing that requires the pipeline.
  async function captureNote({ text, title, tags } = {}) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return { status: "error", error: "Nothing to capture — text is required." };
    ensureNotesVaultReady();
    const result = await writeVaultNote({
      dir: NOTES_VAULT_DIR,
      title,
      text: trimmed,
      tags,
      io: fs,
      now: () => new Date(),
    });
    if (result.ok !== true) return { status: "error", error: `Could not save the note: ${result.error}` };
    return {
      status: "ok",
      message: `Saved as the note "${result.title}".`,
      file: result.file,
      title: result.title,
    };
  }


  // Ambient session capture lives in ambient-capture.mjs — a self-contained
  // machine whose state is used nowhere else here.
  const ambient = createAmbientCapture({
    sessionsDir: NOTES_SESSIONS_DIR,
    flushIntervalMs: AMBIENT_FLUSH_INTERVAL_MS,
    recentUtterances,
    isListenOnlyEngaged,
    emitEvent,
    emitToRenderer,
  });

  // What is waiting to be synthesized. Read by the voice layer's prose below so
  // Iris can offer — never so it can act. Counts both spools (design D3): a
  // capture waiting for curation is material too, not just finished-run
  // records.
  function notesInboxStatus() {
    // The session spool counts too (design D8/ambient-session-capture: "The
    // offer accounts for retained conversation") — a backlog of accumulated
    // talk is material worth offering to weave in, on the same terms as a
    // deliberate capture or a run record.
    const backlog = inboxBacklog({ dir: [NOTES_INBOX_DIR, NOTES_CAPTURES_DIR, NOTES_SESSIONS_DIR] });
    return { ...backlog, worthProcessing: backlog.records >= INBOX_OFFER_THRESHOLD };
  }

  function promptFragment() {
    // Capture needs no worker, so this half is NEVER gated on
    // getPipelineAvailable()/notes-skills (pipeline-availability spec: "A
    // worker-free local tool still works" in chat-only mode). Curation and
    // retrieval genuinely run on the worker, through the capture_learning
    // verb, so that half stays gated exactly as before.
    //
    // What this no longer does is describe how to route note work through a
    // general-purpose task tool. The second brain has its own callable
    // surfaces (capture_note, capture_learning), so this fragment says only
    // what a schema cannot: when to offer.
    const captureGuidance =
      `SECOND BRAIN — ${userDisplayName()} has a personal notes vault. capture_note saves a thought directly, right now, ` +
      "with no Claude run and no credential required. After a conversational exchange has produced durable value (a research " +
      'result, a worked-out decision), you MAY offer ONCE, in a single short line, to save it (e.g. "Want me to save that to ' +
      'your notes?"). Never auto-save and never repeat the offer for the same exchange; if declined or ignored, drop it ' +
      "silently. Always honor an explicit save request whether or not you offered.";

    // The third and weakest of design.md D3's three mechanisms against the
    // change's central hazard — the schema (a parameter called `name`) and the
    // declaration's own explicit negative case are the two that carry it. Said
    // here as well because the failure is a routing choice made before either
    // declaration is read closely, and it is not symmetrical: a contents
    // question answered from a title list is a confident wrong answer, where a
    // name lookup sent to the verb merely costs time and money.
    //
    // Ungated, like capture: the lookup needs no worker and no credential.
    const findGuidance =
      " find_note_by_name answers WHICH NOTE IS CALLED something — a title lookup, instantly and locally. " +
      'Use it for "find my note called X" or "open my X note". It never reads what a note says, so do NOT use it for ' +
      '"what do my notes say about X"; that question is about contents and belongs to retrieval.';

    const base = !getPipelineAvailable() || !checkNotesSkillsStatus().ok
      ? captureGuidance + findGuidance
      : (() => {
          const backlog = notesInboxStatus();
          const nudge = backlog.worthProcessing
            ? ` Right now ${backlog.records} items are waiting to be woven in — you MAY mention that once, in one short line, and offer to do it. Never start it unprompted.`
            : "";
          return (
            `${captureGuidance}${findGuidance} Retrieving from notes ("what do my notes say about X") or weaving accumulated ` +
            `captures into the wiki goes through the capture_learning verb — that verb reads the notes themselves, which is ` +
            `what separates it from the title lookup above; always honor an explicit request for either.${nudge}`
          );
        })();

    // second-brain-focus: present only while the galaxy is active and the
    // focus is non-empty — an empty focus invites the model to invent a
    // referent, so it is described only when there is one (independent of
    // the pipeline; the galaxy needs no Claude credential). This is a static
    // snapshot as of the last connect — announceFocusUpdate() above is what
    // keeps Gemini current with a focus that changes mid-session.
    if (!secondBrainActive) return base;

    // open-note-session: the open note outranks the focus as the described
    // referent — exactly one is ever described, never both (D1). A note can
    // only be open while the galaxy is active, so this sits ahead of the
    // focus check below rather than beside it.
    const openNote = resolveOpenNote();
    if (openNote) {
      return (
        `${base} Right now the user has a note open in the reader — ${openNoteLine(openNote)} A deictic request like ` +
        '"this" or "this note" refers to it; act on it without asking which note is meant.'
      );
    }

    const focused = resolveFocus(focusState, latestGraph, FOCUS_PROMPT_BOUND);
    if (!focused.length) return base;
    return (
      `${base} Right now the second-brain galaxy is open and the user has ${focused.length} note${focused.length === 1 ? "" : "s"} ` +
      `focused (pointed at with their hand, or clicked) — ${focusLine(focused)} A deictic request like "these", "this one", or ` +
      '"these two" refers to them; act on them without asking which notes are meant.'
    );
  }

  // What a run's prompt receives (second-brain-focus D5/run-context.mjs):
  // ids/titles/tags only, resolved fresh, or null when nothing is focused so
  // the composition point can emit no block at all rather than an empty one.
  function resolveFocusForRun() {
    const notes = resolveFocus(focusState, latestGraph, FOCUS_PROMPT_BOUND);
    return notes.length ? notes : null;
  }

  // What a run's prompt receives for the open note (design D4): identity,
  // title, tags, and the vault-relative path — never the body, and never the
  // absolute filesystem path (that stays internal to this module; see
  // openNoteWritePath below). Null when nothing is open, so the composition
  // point emits no block at all.
  function resolveOpenNoteForRun() {
    const note = resolveOpenNote();
    return note ? { id: note.id, title: note.title, tags: note.tags, relativePath: note.relativePath } : null;
  }

  // The open note's real, vault-checked absolute path — for run-exec.mjs's
  // write-confirmation guard only (design D6/8.3). Never sent to the model or
  // the renderer; resolved through the same resolveVaultNotePath every other
  // write already goes through, never a path the caller supplies.
  function openNoteWritePath() {
    return resolveOpenNote()?.absolutePath ?? null;
  }

  // Resolving a note identity to a real, in-vault path — a security boundary,
  // now in second-brain-note-path.mjs where it is tested.
  const resolveVaultNotePath = createNotePathResolver({
    vaultDir: NOTES_VAULT_DIR,
    resolveNotePath: (id) => notesVaultGraph.resolveNotePath(id),
  });

  // Late-resolves the open note against the live graph, mirroring resolveFocus
  // (open-note-session spec: "resolved to a title, tags, and a file at the
  // moment of use... never as a snapshot"). A renamed note resolves to its
  // current title; a deleted one resolves to nothing rather than a phantom.
  // `absolutePath` is for this module's own internal use (the write guard) —
  // never handed to the model or the renderer; the run-facing shape below
  // carries only `relativePath` (design D4).
  function resolveOpenNote() {
    if (!openNoteId) return null;
    const node = (latestGraph.nodes ?? []).find((n) => n.id === openNoteId && !n.ghost);
    if (!node) return null;
    const absolutePath = resolveVaultNotePath(openNoteId);
    if (!absolutePath) return null;
    // resolveVaultNotePath's absolutePath is realpath'd (symlinks resolved);
    // NOTES_VAULT_DIR is not, so it must be realpath'd here too before the
    // two are compared — otherwise a symlinked tmp/vault root (macOS's
    // /var -> /private/var, for one) turns this into a long ../../.. chain
    // instead of a clean vault-relative path.
    let realVaultDir;
    try {
      realVaultDir = fs.realpathSync(NOTES_VAULT_DIR);
    } catch {
      realVaultDir = NOTES_VAULT_DIR;
    }
    return {
      id: node.id,
      title: node.title,
      tags: node.tags ?? [],
      relativePath: path.relative(realVaultDir, absolutePath),
      absolutePath,
    };
  }

  // Resolves the target note ids for a structural edit: explicit titles when
  // the model named them (comma-separated, matched case-insensitively
  // against the live graph), otherwise whatever is currently focused — the
  // shared-focus thesis: the hand supplies the noun, the voice the verb.
  function resolveMutationTargets(noteTitles) {
    const raw = String(noteTitles ?? "").trim();
    if (!raw) {
      // open-note-session: "Structural edits target the open note when there
      // is one" — explicit titles > open note > focus. The open note is
      // resolved fresh (drops out if deleted/renamed away), never assumed
      // live from the stored id alone.
      const openNote = resolveOpenNote();
      if (openNote) return { ok: true, ids: [openNote.id] };
      return { ok: true, ids: focusState.ids };
    }
    const wanted = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const ids = [];
    for (const title of wanted) {
      const matches = (latestGraph.nodes ?? []).filter((n) => !n.ghost && n.title.toLowerCase() === title.toLowerCase());
      if (matches.length === 0) return { ok: false, error: `No note titled "${title}" was found.` };
      if (matches.length > 1) return { ok: false, error: `More than one note is titled "${title}" — be more specific.` };
      ids.push(matches[0].id);
    }
    return { ok: true, ids };
  }

  // The structural-edit tool's handler (personal-knowledge-notes: "direct
  // writes on the same terms as capture"). Ids are never accepted from the
  // caller directly — only a title to look up, or the focus's own ids — and
  // every target is re-resolved through resolveVaultNotePath before any
  // write, refusing an unknown identity or a ghost node rather than guessing.
  /** @param {{ operation?: string, note_titles?: string, tags?: string }} [params] */
  async function mutateVaultNotes({ operation, note_titles, tags } = {}) {
    const resolved = resolveMutationTargets(note_titles);
    if (!resolved.ok) return { status: "error", error: resolved.error };
    const ids = resolved.ids;

    if (operation === "link" || operation === "unlink") {
      if (ids.length !== 2) {
        return {
          status: "error",
          error: note_titles
            ? `${operation} needs exactly two notes named — got ${ids.length}.`
            : `${operation} needs exactly two notes focused in the galaxy right now — ${ids.length} ${ids.length === 1 ? "is" : "are"} focused.`,
        };
      }
      const [idA, idB] = ids;
      const pathA = resolveVaultNotePath(idA);
      const pathB = resolveVaultNotePath(idB);
      if (!pathA) return { status: "error", error: `Note not found: ${idA}` };
      if (!pathB) return { status: "error", error: `Note not found: ${idB}` };
      const result = await (operation === "link" ? linkNotes : unlinkNotes)({ pathA, idA, pathB, idB });
      if (!result.ok) return { status: "error", error: result.error };
      return { status: "ok", message: operation === "link" ? "Linked." : "Unlinked." };
    }

    if (operation === "set_tags") {
      if (ids.length !== 1) {
        return {
          status: "error",
          error: note_titles
            ? `set_tags needs exactly one note named — got ${ids.length}.`
            : `set_tags needs exactly one note focused in the galaxy right now — ${ids.length} are focused.`,
        };
      }
      const notePath = resolveVaultNotePath(ids[0]);
      if (!notePath) return { status: "error", error: `Note not found: ${ids[0]}` };
      const tagList = String(tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const result = await setNoteTags({ path: notePath, tags: tagList });
      if (!result.ok) return { status: "error", error: result.error };
      return { status: "ok", message: "Tags updated." };
    }

    return { status: "error", error: `Unknown operation: ${operation}` };
  }

  // How long a spoken or typed name may be. Not a security bound — the matcher
  // touches no filesystem — but a query longer than any title can be is a bug
  // or a paste, and folding a megabyte of it per keystroke is work for nothing.
  const FIND_QUERY_MAX_CHARS = 200;

  /**
   * The notes whose title matches `query` (personal-knowledge-notes: "A note is
   * findable by name, spoken, without spending a run").
   *
   * **The single point both routes reach.** The typed find field calls it over
   * `secondbrain:find-notes`; the spoken lookup calls it through the tool
   * dispatch. The spec requires the two to return the same notes in the same
   * order, and they do so by being one call into one matcher rather than two
   * that agree today.
   *
   * Always a fresh scan (design.md D6), never `latestGraph`. With the galaxy
   * closed the watcher is off and nothing is keeping a copy current — and on a
   * cold session that copy is the empty initial graph, so a cached read would
   * answer "no matches" for an entire vault. The scan is also what primes
   * `vault-graph`'s own cache, which is what lets a note found this way then be
   * opened (`resolveVaultNotePath` reads that cache).
   *
   * Costs no run, no tokens and no execution slot, and works with no Claude
   * credential — it is a string comparison over titles, on exactly the terms
   * capture is a direct write.
   */
  async function findNotesByName(query) {
    const text = typeof query === "string" ? query.slice(0, FIND_QUERY_MAX_CHARS) : "";
    if (!probeSecondBrainAvailability()) return { matches: [], available: false };
    const graph = await notesVaultGraph.getGraph();
    latestGraph = graph;
    return { matches: matchNotesByName({ query: text, nodes: graph.nodes, links: graph.links }), available: true };
  }

  /**
   * The spoken lookup (`find_note_by_name`) — a direct read, dispatched outside
   * `PIPELINE_ONLY_TOOLS` so it survives chat-only mode.
   *
   * Calls the same `findNotesByName` the typed field does, which is what makes
   * "spoken and typed searches agree" structural rather than aspirational.
   *
   * Two things happen with the result, and they are separate on purpose
   * (design.md D4): the matches are EMITTED so the rail can offer them, and
   * they are RETURNED so Iris can speak them. Emitting is how the rail learns;
   * returning is how the question gets answered — and the question has to have
   * an answer when there is no galaxy to emit into.
   *
   * Nothing here selects: no focus is set, no note is opened unless the user
   * asked for one, and what the voice layer reads is unchanged. Navigating is
   * not selecting — the rule stepping already holds to.
   */
  /** @param {{ name?: string, open?: boolean }} [params] */
  async function findNoteByName({ name, open = false } = {}) {
    const { matches, available } = await findNotesByName(name);
    if (!available) return { status: "error", error: "The notes vault is not available." };

    // The rail learns even when nothing matched, so a search that found nothing
    // clears the previous search's matches rather than leaving them standing as
    // though they answered this question.
    emitToRenderer("secondbrain:name-matches", { query: String(name ?? ""), matches });

    const found = matches.map((m) => ({ title: m.title, openable: m.openable }));
    if (!open) return { status: "ok", matches: found, count: found.length };

    if (matches.length === 0) return { status: "ok", matches: found, count: 0, opened: false };
    // Several matched: name them and let the user choose. Opening one silently
    // would be picking on their behalf between notes they can distinguish and
    // this lookup cannot.
    if (matches.length > 1) {
      return { status: "ok", matches: found, count: found.length, opened: false, reason: "several_matched" };
    }

    const [only] = matches;
    // A ghost is an unresolved `[[wikilink]]` target: named by another note,
    // but there is no file behind it. Refused with that reason rather than with
    // a read error — and the galaxy is NOT brought up, because there would be
    // nothing to show in it (design.md D5).
    if (!only.openable) {
      return {
        status: "ok",
        matches: found,
        count: 1,
        opened: false,
        reason: "no_file",
        message: `"${only.title}" is a link to a note that does not exist yet, so there is nothing to open.`,
      };
    }

    // Opening goes through the renderer's existing note-open path, so the
    // camera anchoring applies without being reimplemented — and brings the
    // galaxy up with it when it is shut, since the reader lives in that layer
    // and does not exist outside it (design.md D5).
    emitToRenderer("secondbrain:open-note", { id: only.id, title: only.title });
    return { status: "ok", matches: found, count: 1, opened: true, title: only.title };
  }

  /** @type {Array<{ channel: string, kind: "handle"|"on", fn: Function }>} */
  const ipcHandlers = [
    // Second-brain galaxy view (second-brain-galaxy-view design.md D3/D7/D8):
    // renderer's boot-time/HUD-open availability pull — the live push half of
    // this rides the existing sidecar:event stream (secondbrain_availability),
    // not a new dedicated channel (design.md D7, L2).
    { channel: "secondbrain:availability", kind: "handle", fn: () => ({ available: probeSecondBrainAvailability() }) },
    // Always a fresh scan (design.md D3) — re-checks availability inline so a
    // vault that vanished between the toggle showing and being clicked is
    // caught here too, not just on the next HUD-open re-check. Also mirrors
    // the scan into latestGraph (second-brain-focus D2) so a toggle/get-focus
    // call right after open — before the watcher's first rebuild — still
    // resolves against real data instead of the empty initial graph.
    {
      channel: "secondbrain:get-graph",
      kind: "handle",
      fn: async () => {
        const available = probeSecondBrainAvailability();
        if (!available) return { graph: { nodes: [], links: [] }, available };
        const graph = await notesVaultGraph.getGraph();
        latestGraph = graph;
        return { graph, available };
      },
    },
    // The typed find field's route into the one matcher (voice-finds-a-note
    // D2). It reads the same `findNotesByName` the spoken lookup does, which is
    // what makes "spoken and typed searches agree" true by construction rather
    // than by two implementations happening to match.
    //
    // The cost of this over the array filter the renderer used to do is one
    // local IPC round trip per debounced keystroke, accepted deliberately: the
    // guarantee bought is that what the user hears and what the user sees
    // cannot disagree.
    { channel: "secondbrain:find-notes", kind: "handle", fn: (_event, query) => findNotesByName(query) },
    // Start/stop the watcher exactly on galaxy toggle-on/off (design.md D3
    // M-2) — an always-on recursive watcher would rebuild constantly during
    // normal note-capture use for a view that's off by default. start() is
    // idempotent; stop() is safe to call even if never started.
    {
      channel: "secondbrain:activate",
      kind: "on",
      fn: () => {
        secondBrainActive = true;
        notesVaultGraph.start();
      },
    },
    // second-brain-focus: "The focus SHALL be cleared whenever the galaxy
    // layer is not active." The renderer already calls this on every route
    // that takes the galaxy off screen — the toggle, another exclusive HUD
    // layer opening, leaving the HUD (button/hotkey/tray), and the error-
    // boundary force-close all unmount VaultGalaxy, whose own cleanup effect
    // sends this — so clearing here reuses that single existing choke point
    // rather than teaching the renderer a second one.
    {
      channel: "secondbrain:deactivate",
      kind: "on",
      fn: () => {
        const hadFocus = focusState.ids.length > 0;
        const hadOpenNote = openNoteId !== null;
        secondBrainActive = false;
        focusState = clearFocusState();
        // open-note-session: "the reader cannot outlive the galaxy" — cleared
        // on exactly the terms the focus already is above.
        openNoteId = null;
        // Tell Gemini the referent it may have last heard about is gone —
        // otherwise a deictic request after the galaxy closes would resolve
        // against notes the user can no longer see (second-brain-focus:
        // "No focus, no focus talk").
        if (hadFocus) announceFocusUpdate();
        if (hadOpenNote) announceNoteOpened();
        notesVaultGraph.stop();
      },
    },
    // Read-by-node-id only, resolved against the single graph cache — never a
    // renderer-supplied filesystem path (design.md D8/L-1).
    //
    // `revision` is the token the editor hands back on save
    // (add-manual-note-editing design.md D2): a hash of the exact bytes served,
    // so a save can be refused when the file no longer holds them. A content
    // hash rather than an mtime — mtime answers "when was it touched", can
    // collide inside a millisecond, and can change without the content
    // changing, which would refuse a save the user should have been allowed to
    // make.
    {
      channel: "secondbrain:read-note",
      kind: "handle",
      fn: (_event, id) => {
        const realNotePath = resolveVaultNotePath(id);
        if (!realNotePath) return { ok: false };
        try {
          const content = fs.readFileSync(realNotePath, "utf8");
          return { ok: true, content, revision: revisionOf(content) };
        } catch {
          return { ok: false };
        }
      },
    },
    // personal-knowledge-notes "A user-authored content write SHALL be
    // permitted": the ONLY arbitrary-content write in the app, and deliberately
    // reachable from nowhere but the note reader's editor — it is not a verb,
    // not an MCP tool, and not in any skills surface, which is what keeps the
    // model-facing side of that requirement ("only enumerated operations")
    // still true. Guarded by the same resolveVaultNotePath as the read above,
    // so a ghost node, an unknown id, a since-deleted file and a symlink
    // escaping the vault are all already refused without restating any of it.
    {
      channel: "secondbrain:write-note",
      kind: "handle",
      fn: (_event, payload) => {
        const { id, content, revision, force } = payload ?? {};
        if (typeof content !== "string" || content.length > MAX_NOTE_WRITE_CHARS) return { ok: false, reason: "refused" };
        const realNotePath = resolveVaultNotePath(id);
        if (!realNotePath) return { ok: false, reason: "refused" };
        try {
          // Concurrent-write refusal (design.md D2): Claude's note session, a
          // voice capture, or another app may have written the file since the
          // reader read it. Iris refuses rather than picking a winner; the
          // renderer keeps the user's draft and can re-issue with `force` once
          // the user has explicitly said to overwrite.
          if (force !== true) {
            const onDisk = fs.readFileSync(realNotePath, "utf8");
            if (revisionOf(onDisk) !== revision) return { ok: false, reason: "stale" };
          }
          fs.writeFileSync(realNotePath, content, "utf8");
        } catch {
          return { ok: false, reason: "refused" };
        }
        // Only when the saved note is the one the reader has open — a save to
        // anything else is not a stale-reading hazard for the resident session.
        if (openNoteId && resolveVaultNotePath(openNoteId) === realNotePath) announceNoteEdited();
        return { ok: true, revision: revisionOf(content) };
      },
    },
    // The route out to a real editor. Resolved by identity like every other
    // vault path, then handed to the injected opener — this module never
    // imports Electron (design.md D3).
    {
      channel: "secondbrain:open-note-externally",
      kind: "handle",
      fn: async (_event, id) => {
        const realNotePath = resolveVaultNotePath(id);
        if (!realNotePath) return { ok: false };
        try {
          await openPathExternally(realNotePath);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },
    },
    // second-brain-focus: toggles `id`'s membership in the one shared focus —
    // the hand's tap and a mouse click both call this. Type/bound-checked
    // exactly like read-note's id; a ghost node or an id the graph does not
    // know is refused by focus.mjs's own toggle() (given latestGraph), not
    // silently added.
    {
      channel: "secondbrain:set-focus",
      kind: "handle",
      fn: (_event, id) => {
        if (!isNoteId(id)) return { ok: false };
        focusState = toggleFocusId(focusState, id, latestGraph);
        announceFocusUpdate();
        return { ok: true, ids: focusState.ids, notes: resolveFocus(focusState, latestGraph) };
      },
    },
    // Resolved fresh against latestGraph on every call (design D2) — never a
    // cached title/tag snapshot. Used both by the galaxy on (re)mount, to
    // rehydrate a focus that survived a remount, and after every toggle.
    {
      channel: "secondbrain:get-focus",
      kind: "handle",
      fn: () => ({ ids: focusState.ids, notes: resolveFocus(focusState, latestGraph) }),
    },
    // The HUD control island's explicit clear action (design D4/D8 of
    // second-brain-focus) — distinct from the toggle above so an accidental
    // pinch over empty space can never discard a selection.
    {
      channel: "secondbrain:clear-focus",
      kind: "handle",
      fn: () => {
        const hadFocus = focusState.ids.length > 0;
        focusState = clearFocusState();
        if (hadFocus) announceFocusUpdate();
        return { ok: true, ids: focusState.ids, notes: [] };
      },
    },
    // open-note-session: the renderer reports open/close from the note
    // reader's existing lifecycle; main is the single authority every
    // consumer (promptFragment, mutateVaultNotes, run-context, the write
    // guard) reads. Type/bound-checked like set-focus's id — a renderer XSS
    // or a stray call could pass anything.
    {
      channel: "secondbrain:note-opened",
      kind: "on",
      fn: (_event, id) => {
        if (!isNoteId(id)) return;
        openNoteId = id;
        announceNoteOpened();
      },
    },
    {
      channel: "secondbrain:note-closed",
      kind: "on",
      fn: () => {
        if (openNoteId === null) return;
        openNoteId = null;
        announceNoteOpened();
      },
    },
    // The ambient-capture channels are declared by that module, beside the
    // state they touch.
    ...ambient.ipcHandlers,
  ];

  async function teardown() {
    // Tear down the vault-graph watcher, if it was running (second-brain-galaxy-view design.md D3).
    notesVaultGraph.stop();
    // Quit-time flush (design D5): whatever accumulated since the last
    // periodic flush must not be lost to a clean shutdown any more than to a
    // crash. A no-op when capture was never live (sessionCapture.flush is
    // itself a no-op while disabled).
    ambient.stopTimer();
    await ambient.flush();
  }

  return {
    // capture_learning (curation/retrieval) is a verb in the registry, and the
    // registry is the single place a verb is defined — no parallel declaration
    // for it here. capture_note is different: it is NOT a verb (design D4), so
    // its declaration belongs to the capability that owns it, the same way
    // canvas's MCP tools are declared by a run's `mcpServers`, not a capability
    // toolDeclaration — this is the one place a non-verb tool is declared.
    toolDeclarations: [CAPTURE_NOTE_DECLARATION, FIND_NOTE_DECLARATION, MUTATE_VAULT_NOTES_DECLARATION],
    notesVaultDir: NOTES_VAULT_DIR,
    notesInboxDir: NOTES_INBOX_DIR,
    notesCapturesDir: NOTES_CAPTURES_DIR,
    notesSessionsDir: NOTES_SESSIONS_DIR,
    captureRunOutcome,
    captureNote,
    findNoteByName,
    notesInboxStatus,
    checkNotesSkillsStatus,
    ensureNotesVaultReady,
    probeSecondBrainAvailability,
    stopVaultGraphWatch: () => notesVaultGraph.stop(),
    promptFragment,
    resolveFocusForRun,
    resolveOpenNoteForRun,
    openNoteWritePath,
    mutateVaultNotes,
    // Ambient session capture (ambient-memory): setAmbientCaptureAwake is
    // called from the live session's own wake/sleep hooks (wiring-live.mjs),
    // never by the renderer — the preference arrives only through the IPC
    // channel above.
    setAmbientCaptureAwake: ambient.setAwake,
    isAmbientCaptureLive: ambient.isLive,
    // Re-evaluates whether capture is live, for a caller that changed something
    // ambientCaptureLive() reads but this module does not own — today that is
    // the live session's listen-only transitions (wiring-live.mjs). It hands
    // nothing over; it only makes the yield happen at the mode's own edge,
    // flushing as it engages and resuming with a fresh watermark as it ends,
    // rather than at whatever unrelated flip happens to come next.
    syncAmbientCaptureState: ambient.sync,
    ipcHandlers,
    teardown,
  };
}
