## Context

```js
// persistSessionStore (main.mjs:378-383)
fs.writeFileSync(SESSION_STORE, JSON.stringify(sessionStore, null, 2));   // O_TRUNC

// loadSessionStore (main.mjs:315-376) ends:
} catch { /* first run or unreadable store */ }                          // 375 — swallows everything

// writeUserConfig (main.mjs:955) — the .env with GEMINI_API_KEY + CLAUDE_CODE_OAUTH_TOKEN
fs.writeFileSync(file, `${out.join("\n")...}\n`, "utf8");                 // O_TRUNC
```

The load path's swallowed error is what turns a corrupt file into permanent loss: `sessionStore` stays at its `{ active: null, sessions: [] }` default, `activeWorkstream()` creates a workstream, `createWorkstream` calls `persistSessionStore()`, and the corrupt file — which may still be hand-recoverable — is overwritten with a blank store. `persistSessionStore` has 8 callers, one (`rememberClaudeSessionId`) on the NDJSON hot path, so the truncating write is exercised constantly, and `before-quit` (`main.mjs:2709`) does not await anything, so a quit landing mid-write is a real event.

## Goals / Non-Goals

**Goals:**

- A crash mid-write never corrupts the previous good file (atomic replace).
- A corrupt store yields a preserved `.corrupt-*` file the user can send us, not silent amnesia.
- First-run and corruption are distinguished at load.
- The store is versioned from this commit forward, with reads that tolerate old and refuse-to-downgrade new.
- The core helpers are unit-tested (they are pure and Electron-free).

**Non-Goals:**

- Shutdown ordering / awaiting teardown (BUG I.4/I.5, later).
- fsync-on-rename durability against OS-level write reordering — rename gives atomicity of *replacement*, which is the property that prevents the observed loss; a full fsync-parent-dir dance is out of scope unless a real report needs it.
- Migrating existing data — unversioned files load as-is.

## Decisions

### D1 — One `writeFileAtomicSync` helper, extracted to a testable module

**Chosen:** a small pure module (e.g. `electron/atomic-file.mjs`) exporting `writeFileAtomicSync(file, data, opts)`:

```js
export function writeFileAtomicSync(file, data, opts) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, opts);
    fs.renameSync(tmp, file);            // atomic replace on the same filesystem
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}   // no .tmp litter on failure
    throw err;
  }
}
```

`main.mjs` remains out of automated test scope (Wave 0.0 D5); putting the helper in its own module is what lets Vitest cover the atomicity and no-litter guarantees against a temp dir. `persistSessionStore` keeps its own `try/catch` (persist is best-effort, must not throw into callers); `writeUserConfig` lets errors propagate as today.

*Why pid-suffixed tmp is enough:* the Node main process is single-threaded and these writes are synchronous, so there is never a second concurrent writer to collide with. The suffix only needs to avoid clashing with the real file and with a stale tmp from a previous crashed run (which `rmSync` on the next failure, or the successful `renameSync`, clears).

### D2 — Distinguish first-run from corruption; quarantine before any overwrite

**Chosen:** change `loadSessionStore`'s catch to `catch (err)` and branch:

- `err.code === "ENOENT"` → first run; return silently (today's common case).
- anything else (read error, `SyntaxError` from `JSON.parse`, or the future-version case from D3) → `quarantineFile(SESSION_STORE)` renaming it to `${SESSION_STORE}.corrupt-${Date.now()}`, log a warning, then return with the default empty store.

Because the corrupt file is *renamed away*, the subsequent `persistSessionStore()` (from `createWorkstream`) writes a fresh store at the original path without touching the quarantined bytes — closing the exact overwrite chain in Context. `quarantineFile` is extracted alongside `writeFileAtomicSync` so its rename is unit-testable.

### D3 — Schema version now, tolerant read, refuse-to-downgrade

**Chosen:** define `SESSION_STORE_SCHEMA_VERSION = 1`; write `{ schemaVersion: 1, active, sessions }`. On read:

- No `schemaVersion` (legacy / current unversioned file) → parse exactly as today (the `Array.isArray(data.sessions)` path and the legacy flat-map migration are unchanged).
- `schemaVersion <= 1` → parse as version 1.
- `schemaVersion > 1` → throw into the catch so D2 quarantines it, rather than parsing a format this build does not understand and overwriting it on the next save.

The field is additive on read and costs nothing for existing installs. The refuse-to-downgrade branch is three lines and directly serves durability (a user who ran a newer Iris, then an older one, does not lose the newer data).

*Deferring the field (as the original plan's drift-vs-gap table assumed) rejected:* every store written between now and a later wave would be unversioned, so the migration that field exists to enable would face exactly the ambiguous data it was meant to prevent. It is a write-side field; adding it costs one line now and pays off precisely on the data produced from now on.

### D4 — `.env` uses the same helper

`writeUserConfig` (`main.mjs:955`) swaps its `fs.writeFileSync(file, ..., "utf8")` for `writeFileAtomicSync(file, ..., "utf8")`. This is the higher-stakes file (credentials), and the fix is a one-line substitution because the helper takes the same `opts`.

## Risks / Trade-offs

**Cross-filesystem rename** → `renameSync` is only atomic within one filesystem; `~/.iris/` and its temp are always the same directory, so this holds. If a future store path could straddle filesystems the helper would need a copy-fallback, noted but not needed now.

**A quarantine rename that itself fails** (permissions, disk full) → wrapped in try/catch and logged; the app still starts with the default store. Worst case degrades to today's behavior (loss) for that one pathological case, but the common corruption case is preserved.

**`.corrupt-*` files accumulating** → each corruption leaves one file. Corruption is rare; unbounded growth is not a realistic concern, and the files are the whole point (recoverable evidence). No auto-cleanup.

**Test coverage** → `writeFileAtomicSync` and `quarantineFile` are covered directly (temp-dir round-trip, no-litter-on-failure, quarantine renames and preserves bytes). The `loadSessionStore` wiring and the `schemaVersion` read branches live in `main.mjs` (out of scope) and are covered by the manual corrupt-the-file ritual in tasks.
