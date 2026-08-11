import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  renderNotesVaultConfig,
  WELCOME_NOTE_TITLE,
  WELCOME_NOTE_TAGS,
  WELCOME_NOTE_BODY,
} from "./second-brain-vault-template.mjs";

// Getting the notes vault into a usable state, and reporting whether the wiki
// skills are actually present.
//
// Split out of second-brain.mjs: no shared state with the rest of the
// capability, so it was self-contained already. The vault directory and the
// skill list are passed in rather than imported, which keeps this module free
// of any dependency on the capability that uses it.
//
// **Everything here is idempotent.** Each seeded file is written only when
// absent, so a user edit or deletion is respected on every later boot rather
// than undone by the next start.

/**
 * @param {{
 *   vaultDir: string,
 *   skills: string[],
 *   irisPluginDir: () => string | null,
 *   emitEvent: (event: any) => void,
 * }} deps
 */
export function createVaultSetup({ vaultDir, skills, irisPluginDir, emitEvent }) {
// The wiki skills ship in the Iris plugin, so this checks the app bundle —
// never ~/.claude, which Iris no longer reads or writes. It still gates the
// append-system-prompt directive (startDevRun) and the SetupPanel row, but
// "missing" now means a damaged bundle rather than a skipped install step.
function checkNotesSkillsStatus() {
  const pluginDir = irisPluginDir();
  if (!pluginDir) return { ok: false, missing: skills, skillsDir: null };
  const skillsDir = path.join(pluginDir, "skills");
  const missing = skills.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
  return { ok: missing.length === 0, missing, skillsDir };
}



// Idempotent: never overwrites once present, so an edit or a deletion is
// the user's own choice, respected on every later boot.
function seedWelcomeNote() {
  const target = path.join(vaultDir, `${WELCOME_NOTE_TITLE}.md`);
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
    fs.mkdirSync(vaultDir, { recursive: true });
  } catch (error) {
    emitEvent({ type: "log", level: "warn", message: `Could not create notes vault at ${vaultDir}: ${error.message}` });
    return;
  }

  seedWelcomeNote();

  const configTarget = path.join(vaultDir, "wiki-config.md");
  const schemaTarget = path.join(vaultDir, "wiki-schema.md");
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

  return { checkNotesSkillsStatus, ensureNotesVaultReady };
}
