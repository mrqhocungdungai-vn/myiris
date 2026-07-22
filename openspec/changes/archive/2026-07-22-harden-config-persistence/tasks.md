## 1. Atomic-write helpers (new testable module)

- [x] 1.1 Create `electron/atomic-file.mjs` exporting `writeFileAtomicSync(file, data, opts)`: write to `${file}.<pid>.tmp`, `renameSync` onto the target, and on any error `rmSync` the tmp (force) before rethrowing, so a failed write leaves no `.tmp` behind (design D1)
- [x] 1.2 Export `quarantineFile(file)` in the same module: rename `file` to `${file}.corrupt-${Date.now()}` and return the new path (design D2)

## 2. Session store (`main.mjs`)

- [x] 2.1 `persistSessionStore` (`main.mjs:378-383`) writes via `writeFileAtomicSync`, keeping its own `try/catch` so persist stays best-effort and never throws into callers
- [x] 2.2 Add `const SESSION_STORE_SCHEMA_VERSION = 1;` and include `schemaVersion: SESSION_STORE_SCHEMA_VERSION` in the serialized object (design D3)
- [x] 2.3 In `loadSessionStore`, before parsing branch on version: unversioned or `schemaVersion <= 1` → parse as today (the `Array.isArray(data.sessions)` path and the legacy flat-map migration are unchanged); `schemaVersion > 1` → throw so the catch quarantines it (design D3)
- [x] 2.4 Change the catch (`main.mjs:375`) to `catch (err)`: `err.code === "ENOENT"` → return silently (first run); otherwise `quarantineFile(SESSION_STORE)`, log a warning naming the quarantine path, then fall through to the default empty store (design D2)
- [x] 2.5 Confirm the overwrite chain is closed: after quarantine the corrupt file is renamed away, so the automatic `persistSessionStore()` from `createWorkstream` writes a fresh store beside the preserved original, not over it

## 3. User config `.env` (`main.mjs`)

- [x] 3.1 `writeUserConfig` (`main.mjs:955`) writes via `writeFileAtomicSync(file, ..., "utf8")` — one-line substitution (design D4). Let errors propagate as today
- [x] 3.2 Confirm the agent/persona write at `main.mjs:1209` is left alone (idempotent install artifact, not durable user state)

## 4. Tests (`electron/atomic-file.test.mjs`, new)

- [x] 4.1 `writeFileAtomicSync` writes the given contents to the target (temp-dir round-trip)
- [x] 4.2 After a successful write, no `*.tmp` file remains in the directory
- [x] 4.3 A write that fails (e.g. data that makes the write throw, or an unwritable target) leaves no `.tmp` behind and rethrows
- [x] 4.4 `quarantineFile` renames the target to a `.corrupt-*` path, the new file holds the original bytes, and the original path no longer exists

## 5. Verification

- [x] 5.1 `npm test` passes with no `.env`, no `claude` on `PATH`, no network
- [x] 5.2 `npm run build` passes with no new type errors
- [x] 5.3 Manual (the plan's BUG C ritual): create a few workstreams, set cwds, pick models; hand-corrupt `~/.iris/claude-sessions.json` (truncate to half); relaunch → the app logs the corruption, a `claude-sessions.json.corrupt-*` appears, and the original data is NOT overwritten (the corrupt file is preserved)
- [x] 5.4 Manual: after a normal run, confirm `~/.iris/` has no leftover `*.tmp` files
- [x] 5.5 Manual: save a setting (e.g. a PO token) and confirm `.env` still round-trips correctly through the atomic write (existing keys preserved)

## 6. Spec and record

- [x] 6.1 `openspec validate harden-config-persistence` passes
- [x] 6.2 Re-read the `config-persistence` delta: all three requirements' scenarios are true against the landed code
- [x] 6.3 One commit on `develop` (single bug), Co-Authored-By trailer
- [x] 6.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG C done, note atomic write + corrupt quarantine + `schemaVersion` (v1) landed together, and that a new `config-persistence` capability spec was added (deviation from the drift-vs-gap table, justified by quarantine/version being observable behavior)
