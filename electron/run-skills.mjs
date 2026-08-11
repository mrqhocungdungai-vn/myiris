// Which skills each kind of run can reach.
//
// Both run shapes used to pass `skills: "all"`, so a build run could invoke
// `iris:grilling` and a shaping run could invoke the `wiki-*` suite. A run's
// capability surface should be a property of what it was asked to do; a constant surface means a run can reach
// for a capability that has nothing to do with its job.
//
// **This is a behaviour change, not a refactor.** A skill omitted from a list is
// unavailable to that run. So the lists below are derived from what the personas
// and the plugin's own cross-references actually invoke — established by
// inspection, not from intent — and every entry has its reason recorded beside
// it.
//
// Two measured facts (agent-sdk-conformance design.md D7):
//   - `skills` really does scope the session. Measured 2026-08-04 against the
//     bundle as it shipped then (17 skills): identical one-word prompt, total
//     input tokens `"all"` 18 007, a two-skill list 16 056, `[]` 15 934 — about
//     ~120 tokens of listing per skill. The figures are dated rather than
//     restated as a current count: the bundle's size changes with every skill
//     added, and nothing keeps a number in a comment true.
//   - Plugin-qualified (`iris:grilling`) and bare (`grilling`) names behave
//     identically — both scoped to exactly 16 056. Qualified names are used here
//     because that is how the personas reference them, so the list and the
//     persona can be diffed against each other by eye.
//
// What this is NOT, per the SDK's own wording: a sandbox. Unlisted skills are
// hidden from the model's listing and rejected by the Skill tool, but their
// files stay on disk and remain readable via Read/Bash.
//
// **These lists bound the plugin's COMMANDS too**, and that is measured rather
// than assumed (every-verb-earns-its-skills D5, four live runs 2026-08-11
// against SDK 2.1.210). A model-invoked `/iris:opsx:*` command is not a
// separate channel: it is a `Skill` tool call — `Skill {"skill":
// "iris:opsx:explore"}` — and the SDK maps `skills: [...]` onto
// `allowedTools: ["Skill(<entry>)"]`, so commands and skills are scoped by one
// mechanism. With `["iris:wiki-lint"]` listed the runtime refused the command
// by name; with `["iris:opsx:explore"]` listed it ran. Nothing here lists a
// command entry, which is deliberate and is what run-skills.test.mjs pins: a
// workflow is reached through its skill, and there is no second surface that
// could grant one a verb's list withholds.
//
// The lists are now named for the **work**, not for a role, and the verb
// registry (electron/verbs.mjs) is what binds a list to a verb. This module owns
// the lists and their evidence; the registry owns which verb gets which. Keeping
// them apart is what stops the registry becoming the place everything
// accumulates (design.md "Risks").
//
// Electron-free, no I/O.

const PLUGIN = "iris";
const q = (name) => `${PLUGIN}:${name}`;

// Settling what to build: grill the request, then propose/update/archive an
// OpenSpec change. Both shaping verbs (by voice and on the canvas) share this —
// they are the same work in two media.
export const SHAPING_SKILLS = [
  q("grilling"), //                 stateful.md: "stress-test the request before committing to anything"
  q("openspec-propose"), //         stateful.md, three call sites, plus /iris:opsx:propose
  q("openspec-update-change"), //   stateful.md, plus /iris:opsx:update
  q("openspec-archive-change"), //  stateful.md, two call sites, plus /iris:opsx:archive
  q("openspec-sync-specs"), //      transitive: openspec-archive-change and the /opsx commands both invoke it
  q("openspec-explore"), //         /iris:opsx:explore ships as a command and shaping is when exploring happens
  // Drawing belongs to `shape_on_canvas`, but it cannot be scoped to it. Both
  // shaping verbs share ONE resident session, and a session's skills are fixed
  // when it is created (`skills: verb.skills`, run-exec.mjs's
  // statefulSessionOptions) — there is no `setStatefulSessionSkills` to repair it on a
  // later turn the way `setStatefulSessionMcpServers` repairs the tool surface. A
  // canvas-only list would therefore load this skill only when the user opens
  // the board BEFORE speaking, and silently omit it on the commoner path where
  // they talk first and move to the canvas when talking stops being enough
  // (the-canvas-verb-learns-to-draw design.md D1). ~120 input tokens on voice
  // turns is the price of the conversation genuinely being able to draw.
  q("excalidraw-drawing"),
];

// `execute` against a project that HAS an open change with unchecked tasks: the
// OpenSpec apply workflow, test-first, verified.
export const IMPLEMENTATION_SKILLS = [
  q("openspec-apply-change"), //    stateless.md, plus /iris:opsx:apply
  q("openspec-sync-specs"), //      transitive, as above
  q("tdd"), //                      stateless.md: "write a failing test that expresses each acceptance criterion"
  q("code-review"), //              stateless.md's review pass; also invoked by the tdd skill itself
  q("diagnosing-bugs"), //          stateless.md
];

// `execute` against a project with NO open change (design.md D4). Deliberately
// empty: the fork exists so a note-sized request is simply done, and loading the
// OpenSpec workflow skills here is exactly the software-development ceremony the
// fork removes. The openspec-native-pipeline spec requires the workflow skills
// to be absent on this path; the rest are omitted for the same reason rather
// than by oversight.
export const ORDINARY_SKILLS = [];

// `finish`: close the open change out — check off what is genuinely done and
// archive it so the living spec absorbs the deltas.
export const CLOSEOUT_SKILLS = [
  q("openspec-apply-change"), //    finishing stragglers before the change can be archived
  q("openspec-archive-change"), //  stateless.md, plus /iris:opsx:archive
  q("openspec-sync-specs"), //      transitive: archive invokes it
];

// `investigate`: read the project and answer. Deliberately empty, and this is a
// correction rather than an omission. It used to carry `openspec-explore`, whose
// own primary modes are asking clarifying questions and creating OpenSpec
// artifacts — both structurally denied by this verb's `disallowedTools`
// (`AskUserQuestion`, `Write`, `Edit`, `NotebookEdit`, verbs.mjs). A skill whose
// central instructions run into denials produces churn, not capability. The
// skill stays in SHAPING_SKILLS, where those modes are legal.
//
// Nothing replaces it: no shipped skill fits a read-and-answer one-shot, and the
// verb's clause plus ordinary reads plus the `openspec` CLI (Bash is allowed
// here) already cover status questions. An empty list is this module's
// established way of saying "the prompt carries it" — see ORDINARY_SKILLS.
export const INVESTIGATION_SKILLS = [];

// `investigate` at `depth: judge`: judge work that already exists. There is no
// `review` verb — it was folded into this depth because two overlapping
// descriptions are a routing contest with no error path, and the cheap verb won
// every time. The list is what makes the depth mean something.
export const REVIEW_SKILLS = [
  q("code-review"), //              the review pass itself
  q("diagnosing-bugs"), //          a review that finds a defect needs the diagnosis loop to characterize it
];

// `work_on_note`: the ONE note open on screen. Empty, and for the same reason
// ORDINARY_SKILLS is: what this verb does is carried by prompt text and a
// structural guard, not by a skill. The confirm-before-remove discipline lives
// in the verb's clause and the `note` persona, and is backstopped by the
// `guardOpenNoteWrites` seam (stateful-session.mjs's confirmWrite) — a discipline the
// model may *optionally invoke* is not a discipline.
//
// It used to carry NOTE_SKILLS, the wiki suite. That suite is corpus curation —
// ingest `raw/`, lint the graph, add backlinks, across everything that has
// accumulated — and this verb edits one open note. Zero overlap, ~720 tokens of
// listing. The suite stays whole and stays with `capture_learning`.
export const OPEN_NOTE_SKILLS = [];

// `capture_learning`: the personal-knowledge-notes path. The six wiki skills each
// cross-reference every other one, so they only work as a set — listing a subset
// would leave a skill telling the model to invoke one it cannot see.
export const NOTE_SKILLS = [
  q("wiki-config"),
  q("wiki-crystallize"),
  q("wiki-ingest"),
  q("wiki-integrate"),
  q("wiki-lint"),
  q("wiki-query"),
];
