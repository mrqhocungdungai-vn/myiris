import { defineConfig } from "vitest/config";

// Two explicit projects (design.md D3): Vitest 4 does not inherit root-level
// `test` options into projects, so each is fully self-contained rather than
// layered on shared defaults.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["electron/**/*.test.mjs", "src/**/*.test.ts"],
          // @excalidraw/excalidraw's own build ships an extensionless deep
          // import (roughjs/bin/rough) that Node's native ESM resolver
          // rejects; inlining it here routes the import through Vite's
          // resolver (used by the golden element-builder test,
          // canvas-mcp.golden.test.mjs) instead of Node's.
          server: {
            deps: {
              inline: ["@excalidraw/excalidraw", "roughjs"],
            },
          },
        },
      },
      {
        test: {
          // Import-graph test (design.md D3, add-electron-test-signal): the
          // opposite of "unit"'s inline setting above. Externalizing
          // electron/**/*.mjs makes those modules load through Node's
          // native ESM loader instead of Vite's SSR transform. This is
          // load-bearing, not cosmetic: the SSR transform rewrites named
          // imports into namespace property accesses, so a module importing
          // a name its sibling does not export resolves to `undefined`
          // instead of throwing — silently passing the exact defect class
          // this project exists to catch (see design.md M5). Undoing this
          // externalization restores that masking with no test failing to
          // signal it. Scoped to this project only, not the global config,
          // so "unit"'s 21 other test files are unaffected.
          name: "graph",
          environment: "node",
          include: ["electron-graph.*.test.mjs"],
          server: {
            deps: {
              external: [/\/electron\/.*\.mjs$/],
            },
          },
        },
      },
    ],
  },
});
