// The second-brain capability (personal-knowledge-notes,
// second-brain-galaxy-view): the LLM-Wiki notes vault's readiness checks,
// the read-only galaxy graph watcher, and this capability's slice of Gemini
// prose / IPC / teardown — gathered here per design.md D10 rather than
// spread across the layered core modules. Electron-free.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { createVaultGraph } from "../vault-graph.mjs";
import { appendRunRecord, inboxBacklog } from "../run-inbox.mjs";
import {
  appendSpoolRecord,
  captureSpoolDir,
  runSpoolDir,
  sessionsSpoolDir,
  linkNotes,
  unlinkNotes,
  setNoteTags,
} from "../vault-write.mjs";
import { INITIAL_FOCUS, FOCUS_PROMPT_BOUND, toggle as toggleFocusId, clear as clearFocusState, resolve as resolveFocus } from "../focus.mjs";
import { fenceUntrustedText } from "../untrusted-text.mjs";
import { createSessionCapture } from "../session-capture.mjs";
import { ambientCaptureForcedOff } from "../worker-env.mjs";

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

// How many un-synthesized records make it worth OFFERING to weave them in.
// Offering too eagerly trains the user to say no; the number is a threshold for
// an offer, never for an action — synthesis is never started unprompted.
const INBOX_OFFER_THRESHOLD = 8;

// The 6 vendored skill names this capability needs installed in
// ~/.claude/skills before Claude actually has LLM-Wiki instructions to follow
// (they are deliberately NOT in REQUIRED_SKILLS — that list gates the
// PO/DEV pipeline, not Talk-mode notes; see pipeline-probes.mjs's
// checkSkillsStatus()). Vault creation (ensureNotesVaultReady, below) and
// skill installation (installPipelinePrereqs, via the SetupPanel's "Install
// missing" button) are two independent actions on two different schedules —
// the vault can exist before the skills are ever installed. Without this
// check, the append-system-prompt directive would tell Claude to "use the
// wiki skills" that aren't actually there, and Claude would either invent an
// ungoverned note format or hallucinate the skill's behavior instead of
// doing the real LLM-Wiki workflow.
const NOTES_SKILLS = ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"];

// Capture's own declaration (vault-write-path design D4): it is NOT a verb —
// it starts no Claude run, so it does not belong in the registry that
// `capture_learning` (curation) is defined in. Declared unconditionally
// (gemini-tools.mjs concatenates every capability's toolDeclarations outside
// the pipelineAvailable gate), so it survives chat-only mode.
const CAPTURE_NOTE_DECLARATION = {
  name: "capture_note",
  description:
    "Save a thought directly to the user's personal notes vault, right now — a plain file write: no Claude run, no tokens, " +
    "no execution slot, and it works even with no Claude credential configured. Use for 'note this down', 'save that', " +
    "'ghi chú lại: …'. Confirm only after this reports status 'ok'; if it reports an error, tell the user the capture failed " +
    "rather than saying it was saved. This only appends the raw thought — for weaving accumulated captures into the wiki, " +
    "retrieving from notes, or an explicit 'write this up as a page' request, use the capture_learning verb instead.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The thought to capture, in the user's own words, as close to verbatim as you can manage.",
      },
      title: { type: "string", description: "A short title, only if the user gave one or it is obvious. Optional." },
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
const MUTATE_VAULT_NOTES_DECLARATION = {
  name: "mutate_vault_notes",
  description:
    "Link two existing vault notes to each other, unlink them, or set a note's tags — a direct file write: no Claude run, " +
    "no tokens. Defaults to whatever the user currently has focused/selected in the second-brain galaxy (pointed at with " +
    "their hand, or clicked) when note_titles is omitted — use this for 'connect these two', 'unlink these', 'tag these'. " +
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
}) {
  // The wiki skills ship in the Iris plugin, so this checks the app bundle —
  // never ~/.claude, which Iris no longer reads or writes. It still gates the
  // append-system-prompt directive (startDevRun) and the SetupPanel row, but
  // "missing" now means a damaged bundle rather than a skipped install step.
  function checkNotesSkillsStatus() {
    const pluginDir = irisPluginDir();
    if (!pluginDir) return { ok: false, missing: NOTES_SKILLS, skillsDir: null };
    const skillsDir = path.join(pluginDir, "skills");
    const missing = NOTES_SKILLS.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
    return { ok: missing.length === 0, missing, skillsDir };
  }

  // Adapts the vendored wiki-config template's frontmatter for this
  // single-purpose, macOS-only vault (design.md D5): the template ships
  // `blacklist` as placeholder prose ("Folder(s) where the wiki should not
  // write"), not real folder names — wiki-config's own Validate step flags
  // leftover placeholder text, and since nothing but wiki content ever lives
  // under ~/iris-second-brain, an empty list is the correct config, not a
  // stub. `index_excludes`/`templates_folder` ship with the template's
  // Windows-style trailing backslash; this app is macOS-only, so those
  // become forward slashes. Everything else (ingested_folder,
  // ingested_subdirs, log_format, and all prose below the frontmatter) is
  // left exactly as vendored.
  function renderNotesVaultConfig(templateText) {
    const match = templateText.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return templateText; // unexpected shape — copy verbatim rather than risk corrupting it
    const [, frontmatter, body] = match;
    const adapted = frontmatter
      .replace(/^blacklist:\n(?:  - .*\n)+/m, "blacklist: []\n")
      .replace(/^(\s*- (?:raw|archive|ingested))\\$/gm, "$1/")
      .replace(/^templates_folder: templates\\$/m, "templates_folder: templates/");
    return `---\n${adapted}\n---\n${body}`;
  }

  // A real, user-visible note — unlike wiki-config.md/wiki-schema.md, which
  // are system files excluded from the galaxy graph (NOTES_SYSTEM_FILES) —
  // pre-seeded once so a first-ever open of the galaxy isn't an empty graph
  // with no explanation of what this vault is or how to use it. Static and
  // Iris-authored rather than generated by a run: the same "a direct write
  // needs no worker" reasoning as capture_note, and it exists from the very
  // first boot rather than only after some later capture_learning call.
  const WELCOME_NOTE_TITLE = "Welcome to your Second Brain";
  const WELCOME_NOTE_TAGS = ["iris", "getting-started"];
  const WELCOME_NOTE_BODY = `This vault is your personal second brain — plain markdown files, readable in Obsidian or any editor, that Iris helps you build up over time.

## Adding to it

- **"Note this down" / "ghi chú lại: ..."** — saves a thought right now: no Claude run, no tokens.
- **"Write this up as a page"** — turns accumulated captures into a linked wiki page.
- **"What do my notes say about X"** — retrieves from what's already here.
- **"Weave in what we've learned"** — processes everything waiting in the inbox since last time.

## The galaxy view

Toggle the network icon in the HUD to fly through your notes as a 3D graph.

- Point and hold over a node to open it.
- A quick pinch-and-release on a node selects it (or click it with your mouse) — selected notes ring and are named in a chip, so you can say **"connect these two"** or **"tag these"** and Iris acts on exactly what you pointed at.
- A held pinch zooms the camera instead.
- Clear the selection any time from the control island.

This note is just a starting point — edit it, retag it, or delete it whenever you like.
`;

  // Idempotent: never overwrites once present, so an edit or a deletion is
  // the user's own choice, respected on every later boot.
  function seedWelcomeNote() {
    const target = path.join(NOTES_VAULT_DIR, `${WELCOME_NOTE_TITLE}.md`);
    if (fs.existsSync(target)) return;
    try {
      fs.writeFileSync(
        target,
        matter.stringify(WELCOME_NOTE_BODY, { title: WELCOME_NOTE_TITLE, tags: WELCOME_NOTE_TAGS, date: new Date().toISOString() }),
      );
    } catch (error) {
      emitEvent({ type: "log", level: "warn", message: `Could not pre-seed the welcome note: ${error.message}` });
    }
  }

  // Ensures the vault directory exists and, on first use, pre-seeds
  // wiki-config.md + wiki-schema.md from the vendored wiki-config skill's own
  // bundled templates, plus the welcome note above. Without the config/schema
  // seed, the operational wiki skills' "Config Discovery" step finds no
  // config on a genuinely first-ever run and ends the turn asking the user to
  // run an interactive /wiki-config setup — a question a one-shot `claude -p`
  // run has no way to answer (design.md D5 of the llm-wiki change). Every
  // seeded file is idempotent: never overwritten once present, so user edits
  // or a missing bundle (irisPluginDir() unresolved) are safe — the directory
  // alone still gets created either way.
  function ensureNotesVaultReady() {
    try {
      fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true });
    } catch (error) {
      emitEvent({ type: "log", level: "warn", message: `Could not create notes vault at ${NOTES_VAULT_DIR}: ${error.message}` });
      return;
    }

    seedWelcomeNote();

    const configTarget = path.join(NOTES_VAULT_DIR, "wiki-config.md");
    const schemaTarget = path.join(NOTES_VAULT_DIR, "wiki-schema.md");
    if (fs.existsSync(configTarget) && fs.existsSync(schemaTarget)) return;

    const pluginDir = irisPluginDir();
    if (!pluginDir) return; // bundle not present — the directory alone is still created above
    const assetsDir = path.join(pluginDir, "skills", "wiki-config", "assets");

    try {
      if (!fs.existsSync(schemaTarget)) {
        const schemaSource = path.join(assetsDir, "wiki-schema.md");
        if (fs.existsSync(schemaSource)) fs.copyFileSync(schemaSource, schemaTarget);
      }
      if (!fs.existsSync(configTarget)) {
        const configSource = path.join(assetsDir, "wiki-config-template.md");
        if (fs.existsSync(configSource)) {
          fs.writeFileSync(configTarget, renderNotesVaultConfig(fs.readFileSync(configSource, "utf8")));
        }
      }
    } catch (error) {
      emitEvent({ type: "log", level: "warn", message: `Could not pre-seed notes vault config: ${error.message}` });
    }
  }

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
  // Whether the galaxy layer is the currently-active view (design D6/D7 of
  // second-brain-focus): gates the focus line in promptFragment() (a focus
  // that outlived its view must not keep talking about itself) and is what
  // the deactivate route below clears the focus on — see design's "cleared on
  // exactly the terms that already clear an open note reader": the renderer
  // unmounts the galaxy (and so calls deactivate) on every one of those
  // routes today, independent of this change.
  let galaxyActive = false;

  // The resolved focus, rendered as a bounded bullet list — shared by the
  // static promptFragment() line and the live SYSTEM_EVENT push below, so the
  // two descriptions of "what is focused" can never say different things.
  // Titles/tags are untrusted (second-brain-focus: "vault content may
  // originate from the web"), fenced on the same terms as everything else
  // that reaches a model without Iris having authored it.
  function focusLine(notes) {
    const bullets = notes
      .map((n) => `- ${n.title}${n.tags.length ? ` (tags: ${n.tags.join(", ")})` : ""}`)
      .join("\n");
    return fenceUntrustedText(bullets, "titles/tags of the notes currently focused in the second-brain galaxy");
  }

  // Live push (mirrors announceWorkspaceUpdate, for the identical reason: the
  // Gemini Live system instruction is built once at connect and does not
  // itself update mid-session, so a fact that changes constantly — the focus
  // changes on every tap/click — needs its own SYSTEM_EVENT rather than
  // relying solely on promptFragment(), which only describes the focus as of
  // the last connect). Fires on every toggle/clear while the galaxy is
  // active; a clear is announced too, so Gemini drops a stale referent
  // rather than keep believing something is still focused (second-brain-
  // focus: "No focus, no focus talk").
  function announceFocusUpdate() {
    const notes = resolveFocus(focusState, latestGraph, FOCUS_PROMPT_BOUND);
    notifyIris([
      "SYSTEM_EVENT_FOCUS_UPDATE",
      notes.length
        ? focusLine(notes)
        : "Nothing is focused in the second-brain galaxy right now.",
      "instructions_to_iris:",
      "- Silently remember this as the currently focused vault notes. Do NOT speak or respond to this message.",
      "- If nothing is focused, forget any notes you previously heard about this way — a deictic request ('these', 'this one') now has nothing to resolve against, so ask what the user means rather than guessing.",
    ]);
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
  // module owns writing, this capability owns what a record looks like.
  function renderCaptureRecord({ text, title, tags, now = () => new Date() }) {
    const tagList = Array.isArray(tags)
      ? tags
      : typeof tags === "string" && tags
        ? tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
    const lines = [`## ${now().toISOString()}`];
    if (title) lines.push(`- title: ${title}`);
    if (tagList.length) lines.push(`- tags: ${tagList.join(", ")}`);
    lines.push("", text, "");
    return lines.join("\n");
  }

  // The capture tool's handler (personal-knowledge-notes, vault-write-path
  // design D4): a direct file write, not a run. Ensures the vault exists first
  // (design D7) so a first-ever capture on a machine with no vault yet still
  // lands, then appends to the capture spool and reports what the filesystem
  // actually did — never a claim of success before the write settles (spec: "A
  // capture whose write fails is reported as failed, not confirmed").
  /** @param {{ text?: string, title?: string, tags?: string | string[] }} [params] */
  async function captureNote({ text, title, tags } = {}) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return { status: "error", error: "Nothing to capture — text is required." };
    ensureNotesVaultReady();
    const result = await appendSpoolRecord({
      dir: NOTES_CAPTURES_DIR,
      content: renderCaptureRecord({ text: trimmed, title, tags }),
    });
    if (!result.ok) return { status: "error", error: `Could not save the note: ${result.error}` };
    return { status: "ok", message: "Saved to your notes.", file: result.file };
  }

  // Ambient session capture (ambient-memory): the opt-in retention of
  // conversation text into NOTES_SESSIONS_DIR. Two independent gates decide
  // whether it is actually LIVE right now — the user's persisted preference
  // (renderer -> ambient-capture:set-enabled) and whether Iris is awake and
  // listening (main's own onAwake/onAsleep hooks, wired from the live
  // session) — and either one being false means nothing is retained (design
  // D1/spec "Capture follows the microphone and stops with it"). `sessionCapture`
  // itself starts disabled (D1) and is the single thing that ever writes.
  const sessionCapture = createSessionCapture();
  let ambientPreferenceEnabled = false;
  let ambientAwake = false;
  let ambientFlushTimer = null;

  function ambientCaptureLive() {
    return ambientPreferenceEnabled && ambientAwake && !ambientCaptureForcedOff();
  }

  async function flushAmbientCapture() {
    return sessionCapture.flush({
      utterances: recentUtterances(),
      dir: NOTES_SESSIONS_DIR,
      onError: (error) => {
        emitEvent({ type: "log", level: "warn", message: `Could not flush the ambient session capture: ${error.message}` });
      },
    });
  }

  function startAmbientFlushTimer() {
    if (ambientFlushTimer) return;
    ambientFlushTimer = setInterval(() => {
      flushAmbientCapture();
    }, AMBIENT_FLUSH_INTERVAL_MS);
    ambientFlushTimer.unref?.();
  }

  function stopAmbientFlushTimer() {
    if (!ambientFlushTimer) return;
    clearInterval(ambientFlushTimer);
    ambientFlushTimer = null;
  }

  // The single mutation point for the live/not-live transition (mirrors
  // probeSecondBrainAvailability's shape above): acts only on a real flip, so
  // repeated calls with the same inputs — the renderer re-sending its
  // preference, a second onAwake while already awake — cost nothing and, more
  // importantly, never reset the watermark or re-flush needlessly. Turning
  // live OFF flushes what accumulated under the consent already given, before
  // disabling (spec "Sleep stops retention... what accumulated is flushed
  // rather than dropped" / "Disabling stops retention immediately").
  async function syncAmbientCaptureState() {
    const live = ambientCaptureLive();
    if (live === sessionCapture.isEnabled()) return;
    if (live) {
      sessionCapture.enable(Date.now());
      startAmbientFlushTimer();
    } else {
      stopAmbientFlushTimer();
      await flushAmbientCapture();
      sessionCapture.disable();
    }
    emitToRenderer("ambient-capture:state", { live });
  }

  /** Called on the renderer's persisted-preference message (ambient-capture:set-enabled). */
  function setAmbientCapturePreference(enabled) {
    ambientPreferenceEnabled = Boolean(enabled);
    return syncAmbientCaptureState();
  }

  /** Called from the live session's own wake/sleep hooks — never by the renderer directly. */
  function setAmbientCaptureAwake(awake) {
    ambientAwake = Boolean(awake);
    return syncAmbientCaptureState();
  }

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

    const base = !getPipelineAvailable() || !checkNotesSkillsStatus().ok
      ? captureGuidance
      : (() => {
          const backlog = notesInboxStatus();
          const nudge = backlog.worthProcessing
            ? ` Right now ${backlog.records} items are waiting to be woven in — you MAY mention that once, in one short line, and offer to do it. Never start it unprompted.`
            : "";
          return (
            `${captureGuidance} Retrieving from notes ("what do my notes say about X") or weaving accumulated captures into ` +
            `the wiki goes through the capture_learning verb; always honor an explicit request for either.${nudge}`
          );
        })();

    // second-brain-focus: present only while the galaxy is active and the
    // focus is non-empty — an empty focus invites the model to invent a
    // referent, so it is described only when there is one (independent of
    // the pipeline; the galaxy needs no Claude credential). This is a static
    // snapshot as of the last connect — announceFocusUpdate() above is what
    // keeps Gemini current with a focus that changes mid-session.
    if (!galaxyActive) return base;
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

  // Resolves a renderer- or model-supplied note **identity** to a real,
  // in-vault file path — never a supplied path itself (personal-knowledge-
  // notes: "SHALL NOT accept a filesystem path from the renderer or from a
  // model"). Type/bound-checks `id` exactly as the original read-note check
  // did (an XSS-in-renderer, or a model, could pass anything), resolves it
  // against the single graph cache (never a ghost, never an unknown id), then
  // re-asserts — after resolving symlinks — that the file is inside the vault
  // before the caller may read OR write it. Shared by read-note and the
  // structural-edit surface below so the guard exists in exactly one place.
  function resolveVaultNotePath(id) {
    if (typeof id !== "string" || id.length === 0 || id.length > 512) return null;
    const notePath = notesVaultGraph.resolveNotePath(id);
    if (!notePath) return null; // ghost node, unknown id, or since-removed file
    let realNotePath;
    let realVaultDir;
    try {
      realNotePath = fs.realpathSync(notePath);
      realVaultDir = fs.realpathSync(NOTES_VAULT_DIR);
    } catch {
      return null;
    }
    const withinVault = realNotePath === realVaultDir || realNotePath.startsWith(realVaultDir + path.sep);
    return withinVault ? realNotePath : null;
  }

  // Resolves the target note ids for a structural edit: explicit titles when
  // the model named them (comma-separated, matched case-insensitively
  // against the live graph), otherwise whatever is currently focused — the
  // shared-focus thesis: the hand supplies the noun, the voice the verb.
  function resolveMutationTargets(noteTitles) {
    const raw = String(noteTitles ?? "").trim();
    if (!raw) return { ok: true, ids: focusState.ids };
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
    // Start/stop the watcher exactly on galaxy toggle-on/off (design.md D3
    // M-2) — an always-on recursive watcher would rebuild constantly during
    // normal note-capture use for a view that's off by default. start() is
    // idempotent; stop() is safe to call even if never started.
    {
      channel: "secondbrain:activate",
      kind: "on",
      fn: () => {
        galaxyActive = true;
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
        galaxyActive = false;
        focusState = clearFocusState();
        // Tell Gemini the referent it may have last heard about is gone —
        // otherwise a deictic request after the galaxy closes would resolve
        // against notes the user can no longer see (second-brain-focus:
        // "No focus, no focus talk").
        if (hadFocus) announceFocusUpdate();
        notesVaultGraph.stop();
      },
    },
    // Read-by-node-id only, resolved against the single graph cache — never a
    // renderer-supplied filesystem path (design.md D8/L-1).
    {
      channel: "secondbrain:read-note",
      kind: "handle",
      fn: (_event, id) => {
        const realNotePath = resolveVaultNotePath(id);
        if (!realNotePath) return { ok: false };
        try {
          return { ok: true, content: fs.readFileSync(realNotePath, "utf8") };
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
        if (typeof id !== "string" || id.length === 0 || id.length > 512) return { ok: false };
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
    // Ambient session capture (ambient-memory): the renderer's persisted
    // preference (localStorage, same as its sibling toggles) is the only way
    // this ever turns on — main defaults to off and stays off until this
    // arrives (design D1). Fire-and-forget from the renderer's point of view;
    // the live/not-live result reaches it over "ambient-capture:state".
    {
      channel: "ambient-capture:set-enabled",
      kind: "on",
      fn: (_event, payload) => {
        setAmbientCapturePreference(Boolean(payload?.enabled));
      },
    },
    // Boot-time/HUD-open pull, mirroring listen-only:query — the renderer's
    // indicator needs the current state on mount, before any transition has
    // fired the push above.
    {
      channel: "ambient-capture:query",
      kind: "handle",
      fn: () => ({ enabled: ambientPreferenceEnabled, live: ambientCaptureLive(), forcedOff: ambientCaptureForcedOff() }),
    },
  ];

  async function teardown() {
    // Tear down the vault-graph watcher, if it was running (second-brain-galaxy-view design.md D3).
    notesVaultGraph.stop();
    // Quit-time flush (design D5): whatever accumulated since the last
    // periodic flush must not be lost to a clean shutdown any more than to a
    // crash. A no-op when capture was never live (sessionCapture.flush is
    // itself a no-op while disabled).
    stopAmbientFlushTimer();
    await flushAmbientCapture();
  }

  return {
    // capture_learning (curation/retrieval) is a verb in the registry, and the
    // registry is the single place a verb is defined — no parallel declaration
    // for it here. capture_note is different: it is NOT a verb (design D4), so
    // its declaration belongs to the capability that owns it, the same way
    // canvas's MCP tools are declared by a run's `mcpServers`, not a capability
    // toolDeclaration — this is the one place a non-verb tool is declared.
    toolDeclarations: [CAPTURE_NOTE_DECLARATION, MUTATE_VAULT_NOTES_DECLARATION],
    notesVaultDir: NOTES_VAULT_DIR,
    notesInboxDir: NOTES_INBOX_DIR,
    notesCapturesDir: NOTES_CAPTURES_DIR,
    notesSessionsDir: NOTES_SESSIONS_DIR,
    captureRunOutcome,
    captureNote,
    notesInboxStatus,
    checkNotesSkillsStatus,
    ensureNotesVaultReady,
    probeSecondBrainAvailability,
    stopVaultGraphWatch: () => notesVaultGraph.stop(),
    promptFragment,
    resolveFocusForRun,
    mutateVaultNotes,
    // Ambient session capture (ambient-memory): setAmbientCaptureAwake is
    // called from the live session's own wake/sleep hooks (wiring-live.mjs),
    // never by the renderer — the preference arrives only through the IPC
    // channel above.
    setAmbientCaptureAwake,
    isAmbientCaptureLive: ambientCaptureLive,
    ipcHandlers,
    teardown,
  };
}
