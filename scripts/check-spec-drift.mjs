// Fifth quality gate: checks the living spec (openspec/specs/) for drift —
// retired vocabulary, placeholder text, a requirement contradicted by its own
// scenario, or an empty capability/requirement.
//
// Every other gate in this repo checks code. Measured on 2026-08-04, the spec
// tree held 72 lowercase `role`/`persona` occurrences the previous vocabulary
// sweep's uppercase-only criterion missed, seven Purposes reading `TBD`, one
// requirement duplicated verbatim across two capabilities, and a requirement
// whose own scenarios mandated the thing it forbade — which shipped as a real
// user-facing defect (pipeline-availability's "Copy install command" button).
// `openspec validate --specs --strict` reported 43/43 throughout: it checks
// structure, not truth. This gate does not check truth either — no lexical
// scan can — but it catches the mechanical symptoms that structure alone
// misses. See openspec/specs/workflow-quality-gates/spec.md, "A fifth gate
// checks the living spec for drift".
//
// Scope: openspec/specs/ only. openspec/changes/ (including
// openspec/changes/archive/) is a sibling directory, never walked — the
// archive is history and must keep its retired vocabulary; it is the only
// record of where a rule used to live.
import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const SPECS_ROOT = path.join(REPO_ROOT, "openspec", "specs");

const TAG = "[spec-drift]";

// ---------------------------------------------------------------------------
// Retired vocabulary (design.md D3/D4) — each term carries its own matching
// rule, because a single global rule cannot be right for all of them.
// ---------------------------------------------------------------------------

const RETIRED_TERMS = [
  // Case-sensitive with word boundaries: IRIS_PO_QUESTION_TIMEOUT_MS and
  // SYSTEM_EVENT_PO_QUESTION are real identifiers the code reads, and `_` is a
  // word character, so \bPO\b never matches inside them.
  { term: "PO", pattern: /\bPO\b/g },
  { term: "DEV", pattern: /\bDEV\b/g },
  // Case-insensitive: the last sweep's uppercase-only criterion is exactly
  // what let 72 lowercase occurrences survive a check that reported zero.
  // Matches the plural too — "roles" does not satisfy a trailing \b after
  // "role" (the following "s" is a word character), so the earlier sweep's
  // own `\brole\b` regex silently missed every plural occurrence as well.
  { term: "role", pattern: /\brole(?:s)?\b/gi },
  { term: "Hermes", pattern: /\bHermes\b/gi },
];

// Per-occurrence allowances (design D5): each states which occurrence it is
// and why. Matched by (file, term, anchor) — anchor is a short substring
// unique to that occurrence's line, not the full line, so the allowance
// survives incidental rewrapping elsewhere on the line. If a line's wording
// changes enough to drop the anchor, the allowance stops matching and the
// gate re-flags it — a deliberate re-review trigger, not a bug.
const ALLOWANCES = [
  {
    file: "per-verb-model-selection/spec.md",
    term: "PO",
    anchor: "The previously documented `PO`/`DEV`-named variables",
    reason: "Names the real IRIS_PO_MODEL/IRIS_DEV_MODEL env-var aliases directly, in place of the retired generic noun \"role-named\".",
  },
  {
    file: "per-verb-model-selection/spec.md",
    term: "DEV",
    anchor: "The previously documented `PO`/`DEV`-named variables",
    reason: "Names the real IRIS_PO_MODEL/IRIS_DEV_MODEL env-var aliases directly, in place of the retired generic noun \"role-named\".",
  },
  {
    file: "per-verb-model-selection/spec.md",
    term: "PO",
    anchor: 'one of the `PO`/`DEV`-named model variables',
    reason: "Names the real IRIS_PO_MODEL/IRIS_DEV_MODEL env-var aliases directly, in place of the retired generic noun \"role-named\".",
  },
  {
    file: "per-verb-model-selection/spec.md",
    term: "DEV",
    anchor: 'one of the `PO`/`DEV`-named model variables',
    reason: "Names the real IRIS_PO_MODEL/IRIS_DEV_MODEL env-var aliases directly, in place of the retired generic noun \"role-named\".",
  },
  {
    file: "context-supplement-composer/spec.md",
    term: "role",
    anchor: "rely on a currently-selected role to route the work",
    reason: "Prohibition names the retired routing concept it forbids; no such role selection exists.",
  },
  {
    file: "global-agent-runtime/spec.md",
    term: "role",
    anchor: "those named for the retired roles",
    reason: "Names the retired PO/DEV roles to describe real, current cleanup behavior (removeLegacyClaudeArtifacts).",
  },
  {
    file: "talk-and-build-modes/spec.md",
    term: "role",
    anchor: "SHALL NOT be presented to users as a distinct role",
    reason: "Prohibition names the retired user-facing role concept it forbids reintroducing.",
  },
  {
    file: "talk-and-build-modes/spec.md",
    term: "role",
    anchor: "no separate ungated worker is named as a user-facing role",
    reason: "Prohibition names the retired user-facing role concept it forbids reintroducing.",
  },
  {
    file: "wake-sleep-voice/spec.md",
    term: "role",
    anchor: "the application menu ships without a View role",
    reason: "Electron's Menu API `role` property (e.g. 'about'/'quit'/'view') — an unrelated technical namespace.",
  },
  {
    file: "session-announcements/spec.md",
    term: "role",
    anchor: 'such as "the same role"',
    reason: "Quotes the literal banned phrase to state what the instruction must not say.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "name a role, or operate a control",
    reason: "Prohibition names the retired concept it forbids requiring of the user.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "naming no role and no mode",
    reason: "Scenario for the same prohibition above.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "The parameters' role SHALL differ by statefulness",
    reason: "Ordinary English sense (\"the role a parameter plays\"), unrelated to the retired concept.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "SHALL NOT assert that a current role",
    reason: "Prohibition names the retired concept it forbids claiming exists.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "survived the migration that removed roles",
    reason: "Historical reference explaining why the check exists.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "role in the pipeline",
    reason: "The explicit counter-example: ordinary English \"a verb's role in the pipeline\" is not a claim of an active worker.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "to set, or to avoid setting, an agent or role parameter",
    reason: "Prohibition names the retired parameter concept it forbids.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "tells the model that a role or worker is already active",
    reason: "Prohibition names the retired concept it forbids claiming.",
  },
  {
    file: "verb-tool-surface/spec.md",
    term: "role",
    anchor: "reintroduces a current-role or agent-parameter instruction",
    reason: "Describes the test that guards the prohibition above; must name what it catches.",
  },
  {
    file: "voice-decision-relay/spec.md",
    term: "role",
    anchor: "rather than for a role that no longer exists",
    reason: "Names the retired concept to explain why the tool is named for what it does instead.",
  },
  {
    file: "two-hand-gestures/spec.md",
    term: "role",
    anchor: '[role="button"]',
    reason: "HTML ARIA attribute selector — an unrelated technical namespace.",
  },
  {
    file: "workstream-switcher/spec.md",
    term: "Hermes",
    anchor: "without introducing any Hermes session IPC",
    reason: "Prohibition names the upstream feature Iris deliberately does not port.",
  },
  {
    file: "workstream-switcher/spec.md",
    term: "Hermes",
    anchor: "No Hermes session IPC",
    reason: "Prohibition names the upstream feature Iris deliberately does not port.",
  },
  {
    file: "task-step-timeline/spec.md",
    term: "Hermes",
    anchor: "Upstream's Hermes SSE ingestion",
    reason: "Prohibition names the upstream feature Iris deliberately does not port.",
  },
  {
    file: "renderer-structure/spec.md",
    term: "Hermes",
    anchor: "introduce any Hermes-derived IPC",
    reason: "Prohibition names the upstream feature Iris deliberately does not port.",
  },
  {
    file: "setup-panel/spec.md",
    term: "Hermes",
    anchor: "No Hermes endpoint configuration SHALL exist",
    reason: "Prohibition names the upstream feature Iris deliberately does not port.",
  },
  {
    file: "voice-ui-control/spec.md",
    term: "Hermes",
    anchor: "no `hermes`-named action SHALL exist",
    reason: "Prohibition names the upstream feature Iris deliberately does not port.",
  },
  {
    file: "deepspace-skin/spec.md",
    term: "Hermes",
    anchor: "Rules for the Hermes worker survived two renames",
    reason: "Historical rationale for why the dead-CSS check (this repo's other allowance-bearing gate) exists.",
  },
];

// ---------------------------------------------------------------------------
// Placeholder text
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [
  { name: "TBD", pattern: /\bTBD\b/g },
  { name: "TODO", pattern: /\bTODO\b/g },
  { name: "FIXME", pattern: /\bFIXME\b/g },
  { name: "a note to a future reader", pattern: /\bafter archive\b/gi },
];

// ---------------------------------------------------------------------------
// File collection and parsing
// ---------------------------------------------------------------------------

function collectSpecFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSpecFiles(full));
    else if (entry.name === "spec.md") files.push(full);
  }
  return files;
}

// Parses one spec.md into { requirements: [{ name, bodyLines, scenarios: [{ name, lines }] }] }.
// Deliberately simple: this repo's specs use a flat `### Requirement:` /
// `#### Scenario:` structure with no nesting, so a single-pass line scan is
// exact — no brace/heading-depth tracking needed (matches the same reasoning
// scripts/dead-claude-css.mjs uses for its own flat CSS scan).
function parseSpec(content) {
  const lines = content.split("\n");
  const requirements = [];
  let current = null;
  let currentScenario = null;

  for (const line of lines) {
    const reqMatch = line.match(/^###\s+Requirement:\s*(.+)$/);
    const scenMatch = line.match(/^####\s+Scenario:\s*(.+)$/);

    if (reqMatch) {
      current = { name: reqMatch[1].trim(), bodyLines: [], scenarios: [] };
      requirements.push(current);
      currentScenario = null;
      continue;
    }
    if (scenMatch) {
      if (!current) continue; // malformed; structural validation catches this separately
      currentScenario = { name: scenMatch[1].trim(), lines: [] };
      current.scenarios.push(currentScenario);
      continue;
    }
    if (currentScenario) currentScenario.lines.push(line);
    else if (current) current.bodyLines.push(line);
  }
  return { requirements };
}

function relativePath(filePath) {
  return path.relative(SPECS_ROOT, filePath);
}

// ---------------------------------------------------------------------------
// Check 1: retired vocabulary
// ---------------------------------------------------------------------------

function isAllowed(relFile, term, lineText) {
  return ALLOWANCES.some(
    (a) => a.file === relFile && a.term.toLowerCase() === term.toLowerCase() && lineText.includes(a.anchor),
  );
}

function checkRetiredVocabulary(files) {
  const findings = [];
  for (const file of files) {
    const rel = relativePath(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const { term, pattern } of RETIRED_TERMS) {
      lines.forEach((lineText, index) => {
        pattern.lastIndex = 0;
        if (!pattern.test(lineText)) return;
        if (isAllowed(rel, term, lineText)) return;
        findings.push({ file: rel, line: index + 1, term, text: lineText.trim() });
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 2: placeholder text
// ---------------------------------------------------------------------------

function checkPlaceholders(files) {
  const findings = [];
  for (const file of files) {
    const rel = relativePath(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((lineText, index) => {
      for (const { name, pattern } of PLACEHOLDER_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(lineText)) findings.push({ file: rel, line: index + 1, name, text: lineText.trim() });
      }
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 3: self-contradiction (narrow form, design D2)
//
// A requirement's body prohibits something ("SHALL NOT offering/providing/
// presenting <phrase>"); one of its own scenarios' THEN lines then asserts
// that same phrase as expected behavior. Lexical only: significant-word
// overlap between the prohibited phrase and a THEN line, never an attempt to
// understand either sentence.
//
// Deliberately narrow, per design D2/D5: a bare "SHALL NOT <phrase>" is too
// common a shape to key on (nearly every prohibition's neighboring prose
// shares vocabulary with its own compliant scenario — measured directly:
// keying on it against this tree's actual specs produced dozens of findings,
// none of them a real contradiction). This checks only the specific shape
// that shipped the real defect (pipeline-availability's "Copy install
// command" button): a requirement that forbids *offering* something, whose
// own scenario's THEN line then asserts that same something's presence
// without denying it. A THEN line that itself negates the overlap ("offers
// no install action") is compliant, not contradictory, and is excluded.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "shall", "that", "this", "with", "from", "will", "would", "could", "into",
  "being", "since", "there", "their", "which", "where", "while", "when",
  "than", "rather", "offering", "providing", "presenting", "about", "which",
  "these", "those", "instead", "should", "cannot", "never", "always",
]);

const NEGATION = /\b(no|not|never|none|without|neither|nor|cannot|isn't|doesn't|don't|won't|wouldn't)\b/i;

function significantWords(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)),
  );
}

// Per-occurrence allowances for this check specifically (design D5 applies to
// any check, not only vocabulary): a prohibition this lexical enough to catch
// but whose apparent conflict is resolved by a condition the check cannot see
// (e.g. "when X is not installed, SHALL NOT offer Y" vs. a scenario for the
// case where X *is* installed).
const CONTRADICTION_ALLOWANCES = [
  {
    file: "talk-and-build-modes/spec.md",
    requirement: "Iris offers to save valuable exchanges to the second brain",
    reason:
      'The prohibition is conditional ("when the notes skills are not yet installed, Iris SHALL NOT offer to save a note"); the flagged scenario describes the installed case, which is a different condition, not a contradiction.',
  },
];

function isContradictionAllowed(relFile, requirementName) {
  return CONTRADICTION_ALLOWANCES.some((a) => a.file === relFile && a.requirement === requirementName);
}

// Only the specific shape that shipped a real defect: a prohibition on
// *offering/providing/presenting* something, not a bare "SHALL NOT".
function extractProhibitions(bodyText) {
  const phrases = [];
  const re = /\bSHALL NOT\s+(?:offer|provide|present)\w*\s+([^.;]+)[.;]/gi;
  let match;
  while ((match = re.exec(bodyText))) phrases.push(match[1]);
  return phrases;
}

function checkContradictions(files) {
  const findings = [];
  for (const file of files) {
    const rel = relativePath(file);
    const { requirements } = parseSpec(fs.readFileSync(file, "utf8"));
    for (const req of requirements) {
      const bodyText = req.bodyLines.join(" ");
      const prohibitions = extractProhibitions(bodyText);
      if (prohibitions.length === 0) continue;
      if (isContradictionAllowed(rel, req.name)) continue;

      for (const phrase of prohibitions) {
        const prohibitedWords = significantWords(phrase);
        if (prohibitedWords.size === 0) continue;

        for (const scenario of req.scenarios) {
          const thenLines = scenario.lines.filter((l) => /\*\*THEN\*\*/.test(l));
          for (const thenLine of thenLines) {
            if (NEGATION.test(thenLine)) continue; // scenario denies it — compliant, not a contradiction

            const thenWords = significantWords(thenLine);
            const overlap = [...prohibitedWords].filter((w) => thenWords.has(w));
            const ratio = overlap.length / prohibitedWords.size;
            if (overlap.length >= 2 && ratio >= 0.5) {
              findings.push({
                file: rel,
                requirement: req.name,
                scenario: scenario.name,
                prohibited: phrase.trim(),
                asserted: thenLine.trim(),
              });
            }
          }
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 4: emptiness
// ---------------------------------------------------------------------------

function checkEmptiness(files) {
  const findings = [];
  for (const file of files) {
    const rel = relativePath(file);
    const { requirements } = parseSpec(fs.readFileSync(file, "utf8"));
    if (requirements.length === 0) {
      findings.push({ file: rel, kind: "empty-capability" });
      continue;
    }
    for (const req of requirements) {
      if (req.scenarios.length === 0) findings.push({ file: rel, kind: "empty-requirement", requirement: req.name });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Combined gate
// ---------------------------------------------------------------------------

export function checkSpecDrift({ specsRoot = SPECS_ROOT } = {}) {
  let files;
  try {
    files = collectSpecFiles(specsRoot);
  } catch (error) {
    return { ok: false, output: `${TAG} could not read ${specsRoot}: ${error.message}` };
  }

  const vocabulary = checkRetiredVocabulary(files);
  const placeholders = checkPlaceholders(files);
  const contradictions = checkContradictions(files);
  const emptiness = checkEmptiness(files);

  const total = vocabulary.length + placeholders.length + contradictions.length + emptiness.length;
  if (total === 0) return { ok: true, output: "" };

  const lines = [];
  for (const f of vocabulary) {
    lines.push(`${TAG} retired term "${f.term}" in ${f.file}:${f.line} — ${f.text}`);
  }
  for (const f of placeholders) {
    lines.push(`${TAG} placeholder (${f.name}) in ${f.file}:${f.line} — ${f.text}`);
  }
  for (const f of contradictions) {
    lines.push(
      `${TAG} contradiction in ${f.file}, requirement "${f.requirement}": forbids "${f.prohibited}", ` +
        `scenario "${f.scenario}" asserts "${f.asserted}"`,
    );
  }
  for (const f of emptiness) {
    lines.push(
      f.kind === "empty-capability"
        ? `${TAG} ${f.file} has no requirements`
        : `${TAG} ${f.file} requirement "${f.requirement}" has no scenarios`,
    );
  }
  lines.push(`${TAG} ${total} finding${total === 1 ? "" : "s"}. If genuinely legitimate, add an allowance in scripts/check-spec-drift.mjs's ALLOWANCES with a stated reason.`);

  return { ok: false, output: lines.join("\n") };
}

