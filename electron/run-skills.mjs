// Which skills each kind of run can reach.
//
// Both roles used to pass `skills: "all"`, so DEV could invoke `iris:grilling`
// and PO could invoke the `wiki-*` suite. A run's capability surface should be a
// property of what it was asked to do; a constant surface means a run can reach
// for a capability that has nothing to do with its job.
//
// **This is a behaviour change, not a refactor.** A skill omitted from a list is
// unavailable to that run. So the lists below are derived from what the personas
// and the plugin's own cross-references actually invoke — established by
// inspection, not from intent — and every entry has its reason recorded beside
// it.
//
// Two measured facts (agent-sdk-conformance design.md D7):
//   - `skills` really does scope the session. Identical one-word prompt, total
//     input tokens: `"all"` (17 skills) 18 007, a two-skill list 16 056, `[]`
//     15 934. Each skill costs ~120 tokens of listing.
//   - Plugin-qualified (`iris:grilling`) and bare (`grilling`) names behave
//     identically — both scoped to exactly 16 056. Qualified names are used here
//     because that is how the personas reference them, so the list and the
//     persona can be diffed against each other by eye.
//
// What this is NOT, per the SDK's own wording: a sandbox. Unlisted skills are
// hidden from the model's listing and rejected by the Skill tool, but their
// files stay on disk and remain readable via Read/Bash.
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
  // statefulSessionOptions) — there is no `setPoSessionSkills` to repair it on a
  // later turn the way `setPoSessionMcpServers` repairs the tool surface. A
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

// `investigate`: read the project and answer. Exploring is what this is for, and
// it is the only skill here because investigating must not modify (the verb also
// carries Write/Edit in its `disallowedTools`).
export const INVESTIGATION_SKILLS = [
  q("openspec-explore"), //         /iris:opsx:explore — thinking-partner mode over an existing change
];

// `review`: judge work that already exists.
export const REVIEW_SKILLS = [
  q("code-review"), //              the review pass itself
  q("diagnosing-bugs"), //          a review that finds a defect needs the diagnosis loop to characterize it
];

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
