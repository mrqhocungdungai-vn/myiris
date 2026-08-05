// Dead-class check for src/styles/claude.css (remove-dead-role-era-styles
// design.md D1-D4): a class with no occurrence anywhere in src/**/*.{ts,tsx}
// is unreachable. `.agent-install` survived a whole migration this way — an
// unmatched CSS rule is valid CSS, so nothing but a human reading the file
// ever surfaced it.
//
// Reports candidates and fails; never deletes. A class built as
// `` className={`thing-${x}`} `` would look dead to this static scan, and the
// cost of a false positive is a broken UI no test would catch — so a human
// confirms every removal (design D2).
//
// Scoped to claude.css only: the adopted upstream sheets (deck.css et al.)
// must stay byte-comparable to upstream so future ports diff cleanly, and a
// dead-rule sweep over them would violate that (design D2/Non-Goals).
import fs from "node:fs";
import path from "node:path";

const CSS_RELATIVE_PATH = "src/styles/claude.css";
const SEARCH_ROOT = "src";
const SEARCH_EXTENSIONS = new Set([".ts", ".tsx"]);

// Classes confirmed built dynamically rather than written as a literal
// className, each with a reason — the explicit allowance design D2/task 2.4
// requires. Empty today: every dynamic className in the renderer (`deck`,
// `deck-body`, `boot-line`, `project-bar`, `hud-mode`, and the
// `classList.toggle` call in App.tsx) was enumerated for this change and none
// constructs a claude.css class. Add an entry here, with why, if that changes.
const DYNAMIC_ALLOWLIST = new Map();

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// No at-rules (@media/@keyframes) exist in claude.css (verified for this
// change), so a flat, non-nested `selector { declarations }` scan is exact —
// no brace-depth tracking needed.
function extractClasses(css) {
  const classes = new Set();
  const ruleRe = /([^{}]*)\{[^{}]*\}/g;
  let ruleMatch;
  while ((ruleMatch = ruleRe.exec(css))) {
    const classRe = /\.([a-zA-Z_][\w-]*)/g;
    let classMatch;
    while ((classMatch = classRe.exec(ruleMatch[1]))) classes.add(classMatch[1]);
  }
  return classes;
}

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(full));
    else if (SEARCH_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function escapeForRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {{ repoRoot: string }} params
 * @returns {{ dead: string[], allowed: string[] }}
 */
export function findDeadClaudeCssClasses({ repoRoot }) {
  const css = stripComments(fs.readFileSync(path.join(repoRoot, CSS_RELATIVE_PATH), "utf8"));
  const classes = extractClasses(css);

  const source = collectSourceFiles(path.join(repoRoot, SEARCH_ROOT))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  const dead = [];
  const allowed = [];
  for (const className of [...classes].sort()) {
    const referenced = new RegExp(`\\b${escapeForRegExp(className)}\\b`).test(source);
    if (referenced) continue;
    if (DYNAMIC_ALLOWLIST.has(className)) allowed.push(className);
    else dead.push(className);
  }
  return { dead, allowed };
}

const TAG = "[dead-claude-css]";

/** @param {{ repoRoot: string }} params */
export function checkDeadClaudeCss({ repoRoot }) {
  const { dead } = findDeadClaudeCssClasses({ repoRoot });
  if (dead.length === 0) return { ok: true, output: "" };
  return {
    ok: false,
    output: [
      `${TAG} ${dead.length} class${dead.length === 1 ? "" : "es"} in ${CSS_RELATIVE_PATH} with no reference anywhere in src/**/*.{ts,tsx}: ${dead.join(", ")}`,
      `${TAG} If genuinely dead, delete the rule. If it's built dynamically (e.g. a template literal), add it to DYNAMIC_ALLOWLIST in scripts/dead-claude-css.mjs with a comment saying why.`,
    ].join("\n"),
  };
}
