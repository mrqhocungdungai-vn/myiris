import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// renderer-content-security (harden-security-boundaries, D7): delivered as a
// <meta http-equiv> in the document rather than a response header, because
// production loads over file:// — Electron's webRequest.onHeadersReceived
// does not reliably apply to file:// loads, so a header-based policy would
// protect dev and silently vanish in the packaged app. index.html is shared
// by both builds, so the strict/relaxed split happens here in
// transformIndexHtml instead: `build` gets the strict policy, `serve` gets
// the relaxed one Vite's dev server needs.
//
// connect-src is 'self' only in both variants: the Gemini Live SDK
// (@google/genai) runs in the Electron MAIN process (electron/main.mjs), not
// in the renderer, so the renderer itself never opens a network connection
// to generativelanguage.googleapis.com — nothing here needs to permit it.
// worker-src omits blob: — neither the vendored onnxruntime-web build
// (numThreads: 1, see useWakeWord.ts) nor the vendored MediaPipe build
// (`vision_wasm_internal`, confirmed by inspecting the resolved file — no
// `new Worker(` call) spawns a Web Worker in this configuration.
// img-src/media-src allow data:/blob: (not script/connect execution) because
// the bundled Excalidraw canvas (DrawingCanvas.tsx) renders pasted/embedded
// images as data: URIs — this permits that without widening anything that
// could execute code or exfiltrate data.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const DEV_CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required in dev: @vitejs/plugin-react injects the
  // React-refresh preamble as an inline <script> block, which 'self' alone
  // (no nonce/hash) does not permit. Dev-only — the production build's own
  // index.html contains no inline scripts (verified: only external
  // type="module" <script src> tags), so this never ships.
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
  // Vite's dev server injects component styles inline while serving.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  // 'self' at http://127.0.0.1:5173 does not implicitly cover the ws:
  // upgrade Vite's HMR client uses for the same host/port.
  "connect-src 'self' ws://127.0.0.1:5173",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export default defineConfig(({ command }) => ({
  // Relative base so the built index.html resolves assets when Electron loads it
  // from the filesystem (file://) in production / packaged builds.
  base: "./",
  plugins: [
    react(),
    {
      name: "iris-content-security-policy",
      transformIndexHtml(html) {
        const policy = command === "build" ? PRODUCTION_CSP : DEV_CSP;
        return html.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  ],
  resolve: {
    // 3d-force-graph bundles its own `three` dependency; without this the
    // bundler could resolve two live copies (r3f's + 3d-force-graph's),
    // breaking `instanceof THREE.Object3D` checks across the boundary. The
    // npm `overrides.three` pin in package.json collapses the copy on disk;
    // this collapses it at the bundler graph level too. See galaxy-view's
    // single-`three` constraint.
    dedupe: ["three"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
}));
