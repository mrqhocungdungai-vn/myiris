// Every path under the app's own state root, resolved in one place.
//
// The root used to be spelled out with `path.join(os.homedir(), ".iris", …)` in
// six independent modules with no shared constant — the same shape as the defect
// CLAUDE.md records under "a verb is defined in exactly one place". Renaming it
// meant finding all six and being right about which ones were actually the state
// root, which is exactly the kind of question a constant answers once.
//
// Each accessor takes `homedir` as an injectable FUNCTION, matching the
// convention worker-env.mjs's irisClaudeHome() established, so tests inject a
// fake home rather than mutating os.homedir globally.
//
// Electron-free and dependency-free (main-process-structure).
import os from "node:os";
import path from "node:path";
import { STATE_ROOT_DIR } from "./app-identity.mjs";

/**
 * The state root itself.
 *
 * @param {() => string} homedir
 * @returns {string}
 */
export function stateRoot(homedir = os.homedir) {
  return path.join(homedir(), STATE_ROOT_DIR);
}

/**
 * The `.env` a PACKAGED build reads and writes.
 *
 * A packaged .app has no repository beside it, so this is the only editable
 * configuration location a packaged user has — which is why the SetupPanel writes
 * here and why every "put your key in…" instruction names it. In dev the repo's
 * own .env wins; that fork lives in user-config.mjs, not here.
 *
 * @param {() => string} homedir
 * @returns {string}
 */
export function userConfigFile(homedir = os.homedir) {
  return path.join(stateRoot(homedir), ".env");
}

/**
 * The CLAUDE_CONFIG_DIR every run is pinned to — the app's own Claude Code state
 * directory, kept away from the user's ~/.claude.
 *
 * `settingSources` is NOT the whole story: a handful of inputs are read and
 * written regardless of it, and they all live under CLAUDE_CONFIG_DIR (default
 * ~/.claude) — the session transcript for every run, the always-read
 * .claude.json global config, and auto-memory. Measured before this existed: one
 * DEV run against the default workspace left a 57 KB transcript in
 * ~/.claude/projects/-Users-...--iris-workspace/. That is the user's own Claude
 * Code history directory, and the app was writing the contents of their projects
 * into it.
 *
 * Pointing the whole directory at the app's own storage is the documented fix and
 * covers all of those inputs at once (the CLI creates the directory, and its own
 * .claude.json inside it, on first use — nothing here has to mkdir).
 *
 * Deliberately NOT overridable by an environment variable: the only interesting
 * value to override it *to* is the user's ~/.claude, which is exactly what this
 * prevents. Tests inject via the `claudeHome` option on the consumers instead.
 *
 * It also has to be STABLE across runs, not a temp directory — a resumed session
 * has to find the transcript an earlier run wrote.
 *
 * @param {() => string} homedir
 * @returns {string}
 */
export function claudeHome(homedir = os.homedir) {
  return path.join(stateRoot(homedir), "claude-home");
}

/**
 * Where the workstream/session store is persisted, so sessions survive a restart.
 *
 * @param {() => string} homedir
 * @returns {string}
 */
export function sessionStoreFile(homedir = os.homedir) {
  return path.join(stateRoot(homedir), "claude-sessions.json");
}

/**
 * Where the drawing canvas's serialized scene is cached.
 *
 * @param {() => string} homedir
 * @returns {string}
 */
export function canvasStoreFile(homedir = os.homedir) {
  return path.join(stateRoot(homedir), "canvas.json");
}

/**
 * The working directory runs fall back to when no project folder is selected.
 *
 * Overridable per-run by IRIS_CLAUDE_CWD at the call site — that precedence lives
 * with the caller, since this module answers "where is the default" and not
 * "which directory is this run using".
 *
 * NOTE for anyone renaming the state root: the transcript directory Claude Code
 * creates is named after a slug of this path, so changing it orphans the
 * transcripts of past runs — a resumed session then silently finds no history
 * rather than failing. Also leave pipeline-install.mjs's legacyTranscriptDir()
 * alone: it deliberately names the PRE-RENAME path, because the files it looks
 * for in the user's own ~/.claude were written against it.
 *
 * @param {() => string} homedir
 * @returns {string}
 */
export function defaultWorkspace(homedir = os.homedir) {
  return path.join(stateRoot(homedir), "workspace");
}
