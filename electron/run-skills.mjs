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
// inspection (task 3.1), not from intent — and every entry has its reason
// recorded beside it.
//
// Two measured facts (design.md D7):
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
// Electron-free, no I/O.

const PLUGIN = "iris";
const q = (name) => `${PLUGIN}:${name}`;

// PO grills the request, then proposes/updates/archives an OpenSpec change.
export const PO_SKILLS = [
  q("grilling"), //                 iris-po.md: "stress-test the request before committing to anything"
  q("openspec-propose"), //         iris-po.md, three call sites, plus /iris:opsx:propose
  q("openspec-update-change"), //   iris-po.md, plus /iris:opsx:update
  q("openspec-archive-change"), //  iris-po.md, two call sites, plus /iris:opsx:archive
  q("openspec-sync-specs"), //      transitive: openspec-archive-change and the /opsx commands both invoke it
  q("openspec-explore"), //         /iris:opsx:explore ships as a command and PO is the role that explores before proposing
];

// DEV implements the open change's tasks and reviews its own work.
export const DEV_SKILLS = [
  q("openspec-apply-change"), //    iris-dev.md, plus /iris:opsx:apply
  q("openspec-archive-change"), //  iris-dev.md, plus /iris:opsx:archive
  q("openspec-sync-specs"), //      transitive, as above
  q("tdd"), //                      iris-dev.md: "write a failing test that expresses each acceptance criterion"
  q("code-review"), //              iris-dev.md's review pass; also invoked by the tdd skill itself
  q("diagnosing-bugs"), //          iris-dev.md
];

// Plain Claude is the personal-knowledge-notes path. The six wiki skills each
// cross-reference every other one, so they only work as a set — listing a subset
// would leave a skill telling the model to invoke one it cannot see.
export const PLAIN_SKILLS = [
  q("wiki-config"),
  q("wiki-crystallize"),
  q("wiki-ingest"),
  q("wiki-integrate"),
  q("wiki-lint"),
  q("wiki-query"),
];

/**
 * @param {"po" | "dev" | "plain"} role
 * @returns {string[]}
 */
export function skillsForRole(role) {
  if (role === "po") return [...PO_SKILLS];
  if (role === "dev") return [...DEV_SKILLS];
  return [...PLAIN_SKILLS];
}
