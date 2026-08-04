// Turns a persona markdown file into the Agent SDK's `AgentDefinition` shape.
//
// The personas used to be *installed* into ~/.claude/agents so the `claude` CLI
// could find them by name via `--agent iris-dev`. The SDK takes agent
// definitions directly through its `agents` option, so the personas can be read
// straight out of the app bundle and handed to `query()` — no files written
// outside the app, and no run that can fail because an install step was skipped.
//
// There are two personas, named for the property that actually differs at
// runtime: `stateful` (a live session that may pause and ask by voice) and
// `stateless` (one shot, never asks). They were `iris-po.md` and `iris-dev.md`;
// naming them after job titles bundled *who the worker is* with *how the run
// behaves*, and only the second one is real. Which verb uses which persona, and
// the one-line clause that names each verb's job, live in electron/verbs.mjs.
//
// The project-local override survives: a persona at <cwd>/.claude/agents/
// iris-<base>.md still wins over the bundled one, which is the one place users
// were actually expected to customize. The override keeps the `iris-` prefix
// because it sits in a directory shared with the user's own agents, where an
// unprefixed `stateless.md` would be a collision waiting to happen.
//
// Electron-free; `fs` is injected so this is testable without touching disk.
import fs from "node:fs";
import path from "node:path";

// Deliberately not gray-matter: the persona front-matter is a fixed, tiny
// key: value block we author ourselves, and this keeps the module dependency-
// free (and matches the existing lightweight reader in pipeline-install.mjs).
// Values are taken literally except for surrounding quotes.
export function parsePersona(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return { frontMatter: {}, body: source.trim() };

  const frontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const eq = line.indexOf(":");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith("#")) continue;
    frontMatter[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return { frontMatter, body: match[2].trim() };
}

/**
 * Builds the SDK agent definition for one base persona.
 * @param {string} base - "stateful" | "stateless", from a verb's `basePersona`
 * @param {{
 *   personasDir: string | null,
 *   projectFile?: string | null,
 *   readFileSync?: (path: string, encoding: "utf8") => string,
 * }} deps
 * @returns {{ description: string, prompt: string, model?: string }}
 */
export function buildAgentDefinition(base, { personasDir, projectFile = null, readFileSync = fs.readFileSync }) {
  const source = projectFile || (personasDir ? path.join(personasDir, `${base}.md`) : null);
  if (!source) {
    throw new Error(`The ${base} persona is missing from the app bundle.`);
  }

  let contents;
  try {
    contents = readFileSync(source, "utf8");
  } catch (error) {
    throw new Error(`Could not read the ${base} persona at ${source}: ${error.message}`);
  }

  const { frontMatter, body } = parsePersona(String(contents));
  if (!body) {
    throw new Error(`The ${base} persona at ${source} has no prompt body.`);
  }

  const definition = {
    description: frontMatter.description || `The ${base} Iris worker.`,
    prompt: body,
  };
  // "inherit" is the SDK's own default meaning — omitting it lets the per-run
  // model choice (run-exec's resolveAgentModel) apply, which is what the
  // per-role model selector expects. Any other value is an explicit pin.
  if (frontMatter.model && frontMatter.model !== "inherit") definition.model = frontMatter.model;
  return definition;
}
