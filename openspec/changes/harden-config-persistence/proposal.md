## Why

Both on-disk stores are written with plain `fs.writeFileSync`, which opens the target `O_TRUNC` — there is a window where the file is empty or half-written, and a crash, power loss, or the un-awaited `before-quit` handler (`main.mjs:2709`) landing mid-write leaves it corrupt. There is no temp+rename, no backup, no fsync.

The session store (`persistSessionStore`, `main.mjs:378-383`) is written from **8 call sites**, one of them (`rememberClaudeSessionId`) firing repeatedly from the NDJSON hot path — so the window is hit often. On the read side, `loadSessionStore` ends in a bare `} catch { /* first run or unreadable store */ }` (`main.mjs:375`) that cannot tell "first run" from "corrupt file." The consequence is worse than an empty reset: the swallowed error leaves `sessionStore` at its `{ active: null, sessions: [] }` default, `activeWorkstream()` then creates a fresh workstream, `createWorkstream` calls `persistSessionStore()`, and the corrupt-but-possibly-salvageable file is **overwritten with a blank store** — every workstream, every `agent_sessions` id (i.e. all PO and DEV conversation history), and every `agent_models` choice is lost silently.

The same defect sits on the more important file: `writeUserConfig` (`main.mjs:955`) rewrites the whole `.env` — which holds `GEMINI_API_KEY` **and** `CLAUDE_CODE_OAUTH_TOKEN` — the same non-atomic way. A crash mid-write loses credentials and the app will not start.

This is `docs/BUGFIX_PLAN.md` BUG C.

## What Changes

One bug, **one commit**.

- Add a `writeFileAtomicSync(file, data, opts)` helper (write to `${file}.<pid>.tmp`, then `renameSync` onto the target — atomic on the same filesystem — cleaning up the temp file on failure). Use it for both the session store (`main.mjs:381`) and the user config `.env` (`main.mjs:955`).
- In `loadSessionStore`'s catch, distinguish `ENOENT` (a legitimate first run — stay silent) from any other error (a read or parse failure): **quarantine** the file by renaming it to `${SESSION_STORE}.corrupt-<timestamp>` and log it, so the later automatic `persistSessionStore()` writes a fresh store beside the preserved original instead of destroying it.
- Add a `schemaVersion` field to the session store **in this commit** — written now, tolerated-if-absent on read (an existing unversioned file still loads), and a file whose version is newer than this build understands is quarantined rather than parsed-and-overwritten. Deferring the field to a later wave would mean every store written between now and then carries no version — exactly the data a future migration would have to guess at.

Not in scope:
- The un-awaited `before-quit` teardown (BUG I.4/I.5, a later wave) — this change makes each individual write survivable; it does not change shutdown ordering.
- The agent/persona file write at `main.mjs:1209` — that is an idempotent install artifact, not durable user state; regenerated on demand.

## Capabilities

### New Capabilities

- `config-persistence`: durability guarantees for Iris's on-disk state — the session store and the user config (`.env`) are written atomically (never left half-written), a corrupt store is quarantined rather than silently overwritten, and the session store carries a schema version that read tolerates across upgrades. No existing spec states these invariants; without them a future refactor can silently reintroduce the truncating write.

### Modified Capabilities

None. This adds durability guarantees around *how* state is persisted; it does not change *what* `per-role-model-selection`, `agent-subscription-auth`, or `setup-panel` persist.

## Impact

- `electron/main.mjs` — `persistSessionStore` and `writeUserConfig` route through the new helper; `loadSessionStore`'s catch gains the ENOENT-vs-corrupt split and quarantine; the store gains `schemaVersion`.
- New `electron/atomic-file.mjs` (or similar) — the pure `writeFileAtomicSync` + `quarantineFile` helpers, so the core new behavior is unit-testable with Vitest against a temp dir, no Electron.
- `config-persistence` — a new living-spec capability.
- No new dependency. No data migration: unversioned stores load unchanged and are rewritten with `schemaVersion` on the next save.
