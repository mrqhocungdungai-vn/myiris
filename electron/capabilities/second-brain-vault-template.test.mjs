import { describe, it, expect } from "vitest";
import {
  renderNotesVaultConfig,
  WELCOME_NOTE_TITLE,
  WELCOME_NOTE_TAGS,
  WELCOME_NOTE_BODY,
} from "./second-brain-vault-template.mjs";

// renderNotesVaultConfig adapts the VENDORED wiki-config template for this
// single-purpose, macOS-only vault (design.md D5). It is regex surgery on YAML
// frontmatter, and both failure directions are silent: leaving the placeholder
// blacklist in ships prose wiki-config's own Validate step rejects, and
// rewriting too much corrupts a config nothing else validates.

const template = [
  "---",
  "ingested_folder: ingested",
  "blacklist:",
  "  - Folder(s) where the wiki should not write",
  "  - Another placeholder line",
  "index_excludes:",
  "  - raw\\",
  "  - archive\\",
  "  - ingested\\",
  "templates_folder: templates\\",
  "log_format: markdown",
  "---",
  "",
  "# Wiki config",
  "Prose below the frontmatter.",
  "",
].join("\n");

describe("renderNotesVaultConfig", () => {
  const rendered = renderNotesVaultConfig(template);

  // Nothing but wiki content ever lives under ~/iris-second-brain, so an empty
  // list is the CORRECT config here — not a stub left to fill in.
  it("replaces the placeholder blacklist with an empty list", () => {
    expect(rendered).toContain("blacklist: []");
    expect(rendered).not.toContain("Folder(s) where the wiki should not write");
    expect(rendered).not.toContain("Another placeholder line");
  });

  // The template ships Windows-style trailing backslashes; this app is macOS
  // only.
  it("turns the Windows trailing backslashes into forward slashes", () => {
    expect(rendered).toContain("  - raw/");
    expect(rendered).toContain("  - archive/");
    expect(rendered).toContain("  - ingested/");
    expect(rendered).toContain("templates_folder: templates/");
    expect(rendered).not.toMatch(/\\$/m);
  });

  // Everything the adaptation does not name must survive byte-for-byte, or a
  // future template change silently loses a field.
  it("leaves every other field and all prose exactly as vendored", () => {
    expect(rendered).toContain("ingested_folder: ingested");
    expect(rendered).toContain("log_format: markdown");
    expect(rendered).toContain("# Wiki config");
    expect(rendered).toContain("Prose below the frontmatter.");
  });

  it("keeps the frontmatter delimiters intact", () => {
    expect(rendered.startsWith("---\n")).toBe(true);
    expect(rendered.split("---").length).toBeGreaterThanOrEqual(3);
  });

  // Copying verbatim is the deliberate choice for an unexpected shape:
  // corrupting a config is worse than failing to adapt one.
  it("copies an unrecognized shape verbatim rather than risking corruption", () => {
    const odd = "no frontmatter here at all";
    expect(renderNotesVaultConfig(odd)).toBe(odd);
  });

  it("is idempotent — re-rendering an adapted config changes nothing", () => {
    expect(renderNotesVaultConfig(rendered)).toBe(rendered);
  });
});

describe("the seeded welcome note", () => {
  it("is a real, taggable, user-editable note", () => {
    expect(WELCOME_NOTE_TITLE).toBeTruthy();
    expect(WELCOME_NOTE_TAGS.length).toBeGreaterThan(0);
    expect(WELCOME_NOTE_BODY.length).toBeGreaterThan(200);
  });

  // It is the first thing a user ever reads in the vault, so it must actually
  // teach the two entry points rather than just exist.
  it("names how to add to the vault and how to open the galaxy", () => {
    expect(WELCOME_NOTE_BODY).toMatch(/note this down/i);
    expect(WELCOME_NOTE_BODY).toMatch(/galaxy/i);
  });

  it("tells the user the note is theirs to change", () => {
    expect(WELCOME_NOTE_BODY).toMatch(/edit it|delete it/i);
  });
});
