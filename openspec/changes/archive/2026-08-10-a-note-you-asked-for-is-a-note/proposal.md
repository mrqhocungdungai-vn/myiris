## Why

The user says "ghi vào second brain". Gemini hears it, calls `capture_note`,
and Iris says **"Saved to your notes."**

Nothing by that name existed. `capture_note` appended a line to
`inbox/captures` — a spool awaiting a later `capture_learning` run to weave it
into the vault. The user could not open the note, could not find it in the
galaxy, and had no way to tell that what they heard was a promise rather than a
fact. The one thing they most often ask the second brain to do was the one thing
it did not do.

The inbox exists for material the user did **not** ask to keep: ambient session
capture and finished-run records, which are raw and need curating before they
are worth anything. Batching them is right, because curation is expensive.

But "write this down" **is** the curation decision. The user already made it,
and deferring it solves a problem they did not have.

The code already knew how to do this. The welcome note is written directly as a
real markdown file, and its comment cites "the same 'a direct write needs no
worker' reasoning as capture_note" — while `capture_note` itself wrote a spool
line. The principle was stated in the right place and applied in the wrong one.

## What Changes

**`capture_note` writes a real note**: a plain markdown file with frontmatter in
the vault, exactly the shape every other note has, visible in the galaxy and
openable immediately.

**It stays worker-free.** No Claude run, no credential, no execution slot —
which matters most here, since the cheapest thing the second brain can do must
not be the thing that requires the pipeline.

**A capture with no title gets one from its first line.** A spoken thought is a
sentence, not a heading, and a note with no title is unfindable in a vault whose
filenames are its titles.

**A title never overwrites.** Two captures that open the same way are two things
the user said; the second is filed alongside the first, not over it.

**Titles keep their diacritics.** The vault is read in Obsidian, where the
filename IS the title — only characters a path cannot carry are replaced, so a
Vietnamese title survives intact.

**The declaration stops lying.** It said the tool "only appends the raw
thought"; it now says it creates a note the user can open and search, and tells
the voice layer to say the title back.

Nothing new writes to `inbox/captures`. The curation verb keeps reading it, so
whatever is already spooled there is still drained.

## Impact

- Specs: `personal-knowledge-notes` (MODIFIED)
- `electron/vault-write.mjs` (`writeVaultNote`, `noteFileName`, `titleFromText`), `electron/capabilities/second-brain.mjs`
