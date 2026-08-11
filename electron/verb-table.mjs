// The verb table — one record per kind of work Iris can hand to Claude.
//
// **Data, not behavior.** Every field is either a value or a function of the
// resolved project state; nothing here reads a file, an env var or the clock.
// Resolution — turning a record plus a project state into the effective verb —
// is `verbs.mjs`, which re-exports everything this module declares so callers
// import from one place and never need to know about the split.
//
// The split is by size only: the descriptions and persona clauses ARE the
// routing logic the model reads, so they are written at length deliberately,
// and together they pushed the registry past the file-size convention while
// having nothing to do with resolution. Nothing about "a verb is defined in
// exactly one place" changes — the one place is this table.
//
// Electron-free, no I/O, no `process.env`.
import {
  SHAPING_SKILLS,
  IMPLEMENTATION_SKILLS,
  ORDINARY_SKILLS,
  CLOSEOUT_SKILLS,
  INVESTIGATION_SKILLS,
  REVIEW_SKILLS,
  OPEN_NOTE_SKILLS,
  NOTE_SKILLS,
} from "./run-skills.mjs";
import { PARK, STATEFUL_SESSION_KEY, STRONGEST, FAST, CHEAPEST } from "./verb-constants.mjs";

// `stateful` and `stateless` are named for the run shape. `note` is not a third
// run shape: it is the live-session base with every OpenSpec and shaping section
// removed. `work_on_note` runs a live session like the shaping verbs, but the
// stateful body's spine — "You decide WHAT gets built… you do not write
// production code… OpenSpec is the only spec surface" — is actively false for a
// verb whose whole job is writing to one open note.
const STATEFUL = "stateful";
const STATELESS = "stateless";
const NOTE = "note";

// The two recurring `disallowedTools` values, named so a record states which
// policy it takes rather than repeating a literal (ask-when-unspecified D1).
//
// A verb that withholds NOTHING is a verb whose whole purpose is the mid-turn
// question — every stateful verb, and no other.
const ASKS_FREELY = Object.freeze([]);
// A one-shot run whose work arrived already settled. The answers were collected
// upstream, so pausing to re-ask them is redundant — and the inability is
// enforced by the configuration rather than promised in a prompt, because "DEV
// never asks" was a prompt promise with nothing behind it.
const SETTLED_WORK_ASKS_NOTHING = Object.freeze(["AskUserQuestion"]);

// open-note-session D2: `work_on_note`'s session key is derived PER NOTE, not
// shared with STATEFUL_SESSION_KEY — editing a note is not the shaping
// conversation, and sharing would bind both to one model and one context
// window. Falls back to this bare key on the (should-not-happen) call with no
// note open, since a session key must always resolve to something.
const NOTE_SESSION_KEY_FALLBACK = "work_on_note";
function noteSessionKey(state) {
  return state.openNoteId ? `note:${state.openNoteId}` : NOTE_SESSION_KEY_FALLBACK;
}

// The thin schema both stateful verbs take (design.md D7). The model on the
// other end is the strongest available, holds the session context, and can pause
// to ask by voice — so a thin brief is a starting point it repairs, not a loss.
// Forcing Gemini to enumerate details here would be *worse*: enumeration is
// summarization, and summarization drops things. The verbatim transcript reaches
// the run alongside these two fields.
const THIN_PARAMS = Object.freeze({
  type: "object",
  properties: {
    said: {
      type: "string",
      description:
        "What was said, as you heard it, verbatim as far as you can manage — whoever said it. Not only the user: if they are asking about something someone else said near them, put those words here. Do not summarize it, do not tidy it, and do not turn it into a specification — that is this verb's job, not yours. This is the instruction the run acts on, so anything you leave out is lost.",
    },
    spoken_by: {
      type: "string",
      enum: ["user", "someone_else"],
      description:
        "Whose words `said` carries — the user's own, or another person's that the user was listening to. Provenance, so a turn after a listening window is unambiguous about whose request it is.",
    },
    reading: {
      type: "string",
      description: "One line: what you take them to be asking for. A reading, not a brief.",
    },
  },
  required: ["said", "reading"],
});

/**
 * One record per verb. Every field is either a value or a function of the
 * resolved project state — see `resolveVerb` in verbs.mjs, which owns the
 * `ProjectState` typedefs.
 */
const VERBS = Object.freeze({
  // ---- stateful: a resident session that may pause and ask by voice --------
  shape_requirements: {
    label: "Shape",
    description:
      "Settle what to build, by talking it through. Use for a NEW project or feature, for a request that is not yet pinned down, and for steering a shaping conversation that is already under way ('propose it now', 'what's the state of it'). This verb grills the user through you: it pauses mid-run to ask questions by voice, which arrive as SYSTEM_EVENT_CLAUDE_QUESTION and are answered with answer_claude_question. Do NOT write a specification yourself — pass on what was said and let it do the analysis.",
    stateful: true,
    park: PARK.ON_OPEN,
    sessionKey: STATEFUL_SESSION_KEY,
    model: STRONGEST,
    budget: "stateful",
    skills: SHAPING_SKILLS,
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    disallowedTools: ASKS_FREELY,
    params: THIN_PARAMS,
    basePersona: STATEFUL,
    clause: "Settle what to build by talking it through, then turn it into an OpenSpec change with tasks.",
  },

  shape_on_canvas: {
    label: "Canvas",
    description:
      "Shape something on the drawing canvas — read what is on it, add to it, rearrange it, or answer a question about it. Use when the user says anything about the canvas/diagram/whiteboard ('draw it out', 'connect these two boxes', 'what should I add to my diagram'). You cannot see the canvas; this verb can. It continues the SAME conversation as shape_requirements, so it knows what THIS pipeline has already been told — it has no access to your voice conversation with the user, and cannot hear anything you do not pass it. Say what was said.",
    stateful: true,
    park: PARK.ON_OPEN,
    // Shares the resident session, so it also shares its model while that
    // session is alive — declared here rather than pretending each verb owns
    // one (design.md D3).
    sessionKey: STATEFUL_SESSION_KEY,
    model: STRONGEST,
    budget: "stateful",
    skills: SHAPING_SKILLS,
    // Wired from the registry, not from a per-run special case — which is what
    // lets capabilities/canvas.mjs drop the workaround that steered Gemini away
    // from a worker for reasons unrelated to drawing.
    mcpServers: ["iris-canvas"],
    vault: false,
    // Read out in full, never summarized (the-canvas-becomes-a-conversation
    // D3). This is a conversation the user is IN: they watched the drawing
    // happen and asked a question about it, so a précis of the answer is a
    // worse answer. It also matters for Iris herself — what she speaks is what
    // she reasons from next turn, and summarizing here would compound into
    // answering against a paraphrase of a paraphrase.
    spokenResult: "verbatim",
    // The user is looking at the board while this runs. Silence until the turn
    // ends makes a drawing appear out of nowhere and a pause look like a
    // failure; saying what is being added, as it is added, is what makes it a
    // conversation rather than a request and a wait.
    speakWhileWorking: true,
    structuredOutput: true,
    // Not ASKS_FREELY, unlike its sibling shaping verb. It still asks freely —
    // AskUserQuestion is absent from this list — but it does not mutate the
    // project, and that had to become explicit rather than remain incidental.
    //
    // While every run went through one execution slot, a canvas turn could
    // never overlap with anything, so what it was permitted to do never had to
    // be examined. The resident lane removed that accident: a drawing
    // conversation now runs beside an unrelated job, and two writers touching
    // one working tree is the hazard the slot existed to prevent. A
    // conversation about a whiteboard has no business editing files or running
    // commands, so it is confined to reading, asking, and the canvas tools it
    // declares — enforced by configuration, never promised in a prompt.
    disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash"],
    params: THIN_PARAMS,
    basePersona: STATEFUL,
    clause:
      "Work on the drawing canvas with the user. Read the canvas before answering about it, and draw on it rather than describing what you would draw. You cannot edit files or run commands from here — if something needs building or written down, say so and let them start that work.",
  },

  work_on_note: {
    label: "Note",
    description:
      "Work on the ONE note currently open on screen in the note reader — read it back aloud, then remove, add, or " +
      "rewrite parts of it as the user asks, across turns of one continuing conversation about that note. Use when a " +
      "note is open and the user asks to hear it, change it, fix it, or clean it up. Do NOT use this for weaving " +
      "accumulated captures into pages, writing something up as a new page, or answering 'what do my notes say about " +
      "X' — that is capture_learning's job, over everything that has accumulated, not this one open note.",
    stateful: true,
    park: PARK.ON_OPEN,
    // NOT STATEFUL_SESSION_KEY: this is not the shaping conversation, and per
    // note rather than per verb (design D2) — resolved per run against
    // whichever note is open, so returning to a note resumes its own
    // conversation instead of accumulating several notes in one window.
    sessionKey: noteSessionKey,
    model: STRONGEST,
    budget: "stateful",
    // Empty by decision, not by omission — see OPEN_NOTE_SKILLS. The wiki suite
    // this used to carry is corpus curation; this verb edits one open note.
    skills: OPEN_NOTE_SKILLS,
    mcpServers: [],
    // The vault lives outside the project, so it has to be GRANTED as a
    // working directory rather than described in prose (same as
    // capture_learning).
    vault: true,
    // A spoken reading, not a build report — forcing it through the
    // decisions schema's "keep it to a few sentences" summary would be
    // exactly the condensing the verbatim read-back requirement forbids (see
    // announcements.mjs's note-reading path).
    structuredOutput: false,
    // open-note-session 5.1: read back AS WRITTEN. This used to be a verb-name
    // check in the announcement path; it is declared here now, with the rest
    // of what this verb is.
    spokenResult: "verbatim",
    disallowedTools: ASKS_FREELY,
    // open-note-session D6: the main-process write guard (stateful-session.mjs's
    // canUseTool seam, wired in run-exec.mjs) applies only to this verb.
    guardOpenNoteWrites: true,
    params: THIN_PARAMS,
    basePersona: NOTE,
    clause:
      "Work on the ONE note currently open on screen (its identity, title, tags, and vault-relative path are in your " +
      "context below). When asked to hear it, read it back AS WRITTEN — do not summarize or condense it — and identify " +
      "its parts (e.g. by paragraph) so a follow-up can name one. An edit that only ADDS text: apply it, then report " +
      "what you added in one line — do not ask first. An edit that REMOVES or REWRITES existing text: before writing " +
      "anything, name the exact text about to go (the text itself, not just its position — 'the part about the " +
      "project deadline', not 'the second paragraph') and wait for the user's answer via AskUserQuestion; only write " +
      "once they agree. This confirmation discipline is required for every removal or rewrite, with no exception for " +
      "review mode or any other setting.",
  },

  // ---- stateless: one-shot, autonomous, never asks -------------------------
  execute: {
    label: "Build",
    description:
      "Do the work. Implementing, fixing, writing, automating, looking something up and acting on it — anything the user asks to have DONE. In a project with an open change this implements its remaining tasks; with no open change it simply does the work, so a small request is not refused for lacking a specification. It runs on its own and never comes back to YOU for more: its parameters are the whole instruction, so a detail you leave out is lost. Where nothing was specified up front it may pause once to ask the USER directly, which reaches you as SYSTEM_EVENT_CLAUDE_QUESTION like any other live question — read it out and collect the answer, never decide it yourself.",
    stateful: false,
    park: PARK.ALWAYS,
    sessionKey: "execute",
    model: FAST,
    budget: "worker",
    // The fork (design.md D4): an open change with unchecked tasks means the
    // OpenSpec apply workflow; no open change means ordinary work with no
    // process skills loaded.
    skills: (state) => (state.hasOpenChange ? IMPLEMENTATION_SKILLS : ORDINARY_SKILLS),
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    // The same fork, applied to the one property of this verb that used to
    // ignore the state everything else reads (ask-when-unspecified D1/D4).
    //
    // WITH an open change: withheld, exactly as before. The task list is
    // settled, the grilling that resolved its ambiguity happened in the shaping
    // verb before a tasks.md existed, and this is the long unattended path whose
    // whole value is that the user can walk away — granting the ask here would
    // let a build stop for minutes at a time waiting for someone who left.
    //
    // With NO open change: granted. There is no upstream on that path to have
    // settled anything, so refusing the question tool does not make the run stop
    // needing the answer — it makes it invent one and write the result. The
    // request was spoken moments ago, so the user is almost certainly still
    // there. Note this is only the FIRST of two conditions: run-exec.mjs
    // narrows it again when nothing can relay an answer (design D2), so the
    // model is never offered a tool whose use would abort its run.
    disallowedTools: (state) => (state.hasOpenChange ? SETTLED_WORK_ASKS_NOTHING : []),
    params: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the user wants done, in one or two sentences." },
        details: {
          type: "string",
          description:
            "Every concrete detail the user gave — names, numbers, URLs, paths, dates, budgets, constraints — plus any default you are assuming. This run cannot hear the conversation and cannot ask you anything, so a detail you leave out is lost.",
        },
        expected_output: { type: "string", description: "What finishing looks like: the file, the change, the answer." },
        change: {
          type: "string",
          description: "The name of the OpenSpec change to implement, ONLY if the user named one. Omit otherwise — the run finds the open change itself.",
        },
      },
      required: ["goal", "details"],
    },
    basePersona: STATELESS,
    clause: (state) =>
      state.hasOpenChange
        ? // Unchanged, and deliberately silent about asking: this fork genuinely
          // cannot (its `disallowedTools` above withholds the tool), and the
          // base clause role-prompt.mjs picks says so once, for every run that
          // cannot. Saying it twice is how the two drift.
          "Implement the remaining tasks of the open OpenSpec change, test-first, and verify your own work against the specs' scenarios."
        : // ask-when-unspecified D5: this fork MAY ask, so the judgement of when
          // to is stated here. Nothing in a configuration can decide whether a
          // given ambiguity is worth a question — that is the one part of this
          // guarantee that lives in the prompt, and it is named as such.
          "Do the work you were asked to do, directly. There is no open change and none is wanted: do not " +
          "propose one, do not create process artifacts, and do not ask for a specification first. Where a " +
          "detail is genuinely unspecified and getting it wrong would mean undoing work, ask the user before " +
          "you write anything — one question, with options. Where a wrong guess would cost nothing to change " +
          "later, pick the sensible default, get on with it, and say which default you applied when you report.",
  },

  finish: {
    label: "Finish",
    description:
      "Close out the open change: confirm its tasks are genuinely done, then archive it so the living spec absorbs what it changed. Use for 'archive it', 'wrap this up', 'we're done with that change'. Not for asking what is left — that is investigate.",
    stateful: false,
    park: PARK.ALWAYS,
    sessionKey: "finish",
    model: FAST,
    budget: "worker",
    skills: CLOSEOUT_SKILLS,
    mcpServers: [],
    vault: false,
    structuredOutput: true,
    // Its input is the open change, which is settled by definition; if it is
    // not, that is what `investigate` is for (design D4).
    disallowedTools: SETTLED_WORK_ASKS_NOTHING,
    params: {
      type: "object",
      properties: {
        change: { type: "string", description: "The change to close out, ONLY if the user named one." },
        note: {
          type: "string",
          description: "Anything the user said that bears on closing it out — work to skip, something to check first.",
        },
      },
      required: [],
    },
    basePersona: STATELESS,
    clause:
      "Close out the open OpenSpec change: verify its tasks are genuinely complete, then archive it so its delta specs are synced into the living spec.",
  },

  investigate: {
    label: "Look",
    description:
      "Read the project and answer a question about it, changing nothing. Two depths, and you MUST pick one: " +
      "'explain' for 'what's left', 'how does X work', 'is that done', 'why is this here'; 'judge' for 'review that', " +
      "'is this any good', 'check what it just did' — an assessment of work that already exists. Judge is slower and " +
      "costs more, so do not reach for it to answer a plain question, and do not settle for explain when the user is " +
      "asking whether something is GOOD. This verb cannot write or edit — if the user wants something changed, that " +
      "is execute.",
    stateful: false,
    park: PARK.NEVER,
    sessionKey: "investigate",
    // MODEL AND SKILLS FOLLOW THE DEPTH, and this is why the two were merged.
    // `review` was its own verb — the STRONGEST model with review skills — and
    // across every run ever logged it was called ZERO times, while
    // `investigate` (FAST) took the traffic. The two descriptions overlapped
    // ("is that done" against "is this any good"), and a routing contest
    // between two sentences has no error path: the model always picks
    // something, so the user asking for a judgement silently got the cheap
    // verb with the wrong skills, and the configuration they were paying for
    // never once applied.
    //
    // One verb with a declared enum makes the choice STRUCTURAL. The API
    // constrains the value, so it cannot be fudged, and there is no second
    // description to lose to.
    model: (state) => (state.depth === "judge" ? STRONGEST : FAST),
    budget: "light",
    skills: (state) => (state.depth === "judge" ? REVIEW_SKILLS : INVESTIGATION_SKILLS),
    mcpServers: [],
    vault: false,
    // A judgement has findings to rank; an explanation is spoken prose that a
    // summary/decisions schema would only distort.
    structuredOutput: (state) => state.depth === "judge",
    // Neither depth modifies, and that has to be structural too: a verb that
    // reads and reports has no business holding an edit tool. Nor does it ask —
    // it cannot write, so a wrong assumption costs a re-ask rather than a file,
    // and an ambiguous question is better answered by reporting both readings
    // than by pausing to pick one (design D4).
    disallowedTools: ["AskUserQuestion", "Write", "Edit", "NotebookEdit"],
    params: {
      type: "object",
      properties: {
        depth: {
          type: "string",
          enum: ["explain", "judge"],
          description:
            "'explain' to answer a question about how something works or what is left. 'judge' to assess the quality " +
            "of work that already exists — a diff, a change, a file, the last thing that ran.",
        },
        question: {
          type: "string",
          description:
            "What to answer, as concretely as the user put it — or, when judging, what to review: a change name, a " +
            "path, 'the work that just finished', 'the uncommitted changes'.",
        },
        scope: {
          type: "string",
          description:
            "Where to look, if the user narrowed it — a change name, a folder, a feature. When judging, anything the " +
            "user said they were worried about.",
        },
      },
      required: ["depth", "question"],
    },
    basePersona: STATELESS,
    clause: (state) =>
      state.depth === "judge"
        ? "Review the work you were pointed at and report findings, most serious first. Do not fix what you find."
        : "Answer the question by reading the project. You have no ability to write or edit and must not try — report what you found, not what you would change.",
  },


  capture_learning: {
    label: "Notes",
    description:
      "Curate the user's second brain: weave accumulated captures and run records into linked wiki pages, write something up as a proper page, or answer a question from what is already there. Use for 'weave in what we've learned', 'write that up as a page', 'what do my notes say about X'. Do NOT use this for a plain 'note this down' / 'save that' / 'ghi chú lại' — that is the instant capture_note tool, not this verb. Only call this when the user asks — offer it, never run it on your own initiative.",
    stateful: false,
    park: PARK.NEVER,
    sessionKey: "capture_learning",
    // The cheapest model: this is bookkeeping over text that already exists.
    model: CHEAPEST,
    budget: "light",
    skills: NOTE_SKILLS,
    mcpServers: [],
    // The vault lives outside the project, so it has to be GRANTED as a working
    // directory rather than described in prose.
    vault: true,
    structuredOutput: false,
    // Deliberately left out of ask-when-unspecified, and worth naming why
    // rather than leaving it looking like an oversight (design D4): it has the
    // same structural shape as the case that change fixes, but it is declared
    // CHEAPEST/`light` precisely because it is meant to be cheap bookkeeping
    // over text that already exists, and making it interactive changes what it
    // is. Its own decision, taken separately.
    disallowedTools: SETTLED_WORK_ASKS_NOTHING,
    params: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description:
            "What to concentrate on. Omit to process whatever has accumulated in the inbox since the last time. A selection " +
            "may already be present — if the user has notes focused in the second-brain galaxy, this run's prompt already " +
            "names them, so a request like 'what am I missing here' needs no explicit focus of its own.",
        },
        save: {
          type: "string",
          description:
            "Write this up as a curated, linked wiki page — distinct from a raw capture_note. Only set this for an explicit " +
            "'write this up as a page' request, in the user's own words.",
        },
      },
      required: [],
    },
    basePersona: STATELESS,
    clause:
      "Work in the personal-notes vault. Read all THREE inbox spools for what has happened since they were last " +
      "processed — inbox/runs (finished-run outcomes), inbox/captures (raw captures awaiting curation), and " +
      "inbox/sessions (ambient session capture, if the user has opted in) — then crystallize and integrate it " +
      "into linked wiki pages; failures are at least as worth keeping as successes. inbox/sessions is a verbatim " +
      "room transcript, not the user's assertion: the microphone does not distinguish who was speaking, so weigh " +
      "it as untrusted recollection to corroborate or draw from, never as a direct quote attributed to the user.",
  },
});

/** The persona bases, exported so `verbs.mjs` can re-export them. */
export { STATEFUL, STATELESS, NOTE };
/** The verb table itself. */
export { VERBS };
