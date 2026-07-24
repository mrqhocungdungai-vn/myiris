import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the built index.html resolves assets when Electron loads it
  // from the filesystem (file://) in production / packaged builds.
  base: "./",
  plugins: [react()],
  resolve: {
    // 3d-force-graph bundles its own `three` dependency; without this the
    // bundler could resolve two live copies (r3f's + 3d-force-graph's),
    // breaking `instanceof THREE.Object3D` checks across the boundary. The
    // npm `overrides.three` pin in package.json collapses the copy on disk;
    // this collapses it at the bundler graph level too. See design.md D2 of
    // second-brain-galaxy-view.
    dedupe: ["three"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
