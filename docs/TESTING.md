# Testing & Checks

[← Back to README](../README.md)

Iris has **two independent automated checks** and no linter. The authoritative
conventions are a living spec — `openspec/specs/test-harness/spec.md`. Read it
before adding tests; this page is the practical summary.

## The two gates

| Command | What it is | Notes |
| --- | --- | --- |
| `npm run build` | Typecheck gate — `tsc --noEmit` + Vite build to `dist/` | Must **never** depend on the test runner, so a typecheck is always runnable on its own |
| `npm test` | Behavioral gate — `vitest run` | vitest pinned at `4.1.10` |

Run both to verify a change.

There is **no linter** configured (no eslint/prettier/biome dependency or
config), despite a few stray `eslint-disable` comments in the source.

## What vitest picks up

`vitest.config.mjs` runs in the `node` environment and matches
`src/**/*.test.ts` plus `electron/**/*.test.mjs`, so renderer helpers and
main-process modules are both covered. Today that is:

- `src/lib/{downsample,hand,tasks}.test.ts`
- `electron/{run-queue,po-session,atomic-file,coalesce,platform,task-review}.test.mjs`

## Conventions (summary of the living spec)

- **Where logic lives.** Pure logic belongs in `src/lib/*.ts` or an
  `electron/*.mjs` module with a colocated `*.test.*`. `downsample.ts` was
  extracted out of the mic path precisely to make it testable — do the same
  rather than testing through the UI or the Electron shell.
- **How a module becomes testable.** By **accepting its dependencies as injected
  parameters with production defaults** — never by restructuring it around the
  test or reaching into its internals.
- **Hard boundaries.** No test may boot Electron, spawn `claude`, require
  `GEMINI_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`, or touch the network.

## Troubleshooting

- `vitest: command not found` — the checkout's `node_modules` predates the test
  runner being added. `npm ci` fixes it.
