---
description: "Run all five quality gates and report which are red"
argument-hint: "[build|test|lint|secrets|spec] (optional — omit to run all five)"
allowed-tools: Bash(npm run build), Bash(npm test), Bash(npm run lint), Bash(npm run scan:secrets), Bash(npm run spec:check)
---

Run this repo's five independent quality gates and report the result of each.

This is deliberately **not** the same thing the Stop hook already does. The hook
runs lint, the spec-drift check, the typecheck projects whose files changed, and the
behavioral suite — scoped to what the turn touched. This command runs the full
picture, which nothing else produces:

- `npm run build` includes the **Vite build** and the build-attached checks
  (`check-three-dedupe`, `check-types-node`, `plugin-sync`), none of which the hook
  runs.
- `npm run scan:secrets` scans **staged** content, which only makes sense before a
  commit.

So: use this before committing, or when you want the whole board green rather than
the part of it your last turn could affect.

## What to run

If `$1` is given, run only that gate:

| `$1` | Command |
| --- | --- |
| `build` | `npm run build` |
| `test` | `npm test` |
| `lint` | `npm run lint` |
| `secrets` | `npm run scan:secrets` |
| `spec` | `npm run spec:check` |

Otherwise run all five, in this order — cheapest first, so a fast failure is
reported before an expensive one starts:

```bash
npm run lint
npm run spec:check
npm run scan:secrets
npm test
npm run build
```

## How to report

Run every gate even if an earlier one fails — the point is to see the whole board,
not to stop at the first red. Then report exactly one line per gate:

```
✓ lint          0.4s
✓ spec:check    0.1s
✓ scan:secrets  0.1s
✗ test          8.3s   3 failing in electron/run-queue.test.mjs
✓ build        12.1s
```

For each failure, quote the specific failing assertion, rule, or file — not the
whole output. If a gate fails because its tool is missing, say which tool and print
the install command it reported; these gates fail closed on purpose and a missing
tool is a failure, never a skip.

Do not attempt to fix anything unless asked. Report, then stop.
