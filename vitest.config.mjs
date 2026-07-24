import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["electron/**/*.test.mjs", "src/**/*.test.ts"],
    // @excalidraw/excalidraw's own build ships an extensionless deep import
    // (roughjs/bin/rough) that Node's native ESM resolver rejects; inlining
    // it here routes the import through Vite's resolver (used by the golden
    // element-builder test, canvas-mcp.golden.test.mjs) instead of Node's.
    server: {
      deps: {
        inline: ["@excalidraw/excalidraw", "roughjs"],
      },
    },
  },
});
