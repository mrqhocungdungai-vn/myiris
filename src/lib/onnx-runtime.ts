import * as ort from "onnxruntime-web";
import { resolveVendoredAssetUrl } from "./asset-url";

// Shared onnxruntime-web bootstrap for every ONNX model the renderer runs —
// the wake-word phrase chain and the speech-confirmation VAD. One place, so a
// second model cannot quietly acquire a different runtime configuration from
// the first.

let ortConfigured = false;
export function configureOrt() {
  if (ortConfigured) return;
  // Vendored under public/runtime/ort/ by scripts/vendor-runtime-assets.mjs
  // (renderer-content-security: no runtime-fetched script/WASM glue) — kept
  // in lockstep with the installed onnxruntime-web version by that script,
  // never a hand-copied CDN URL.
  //
  // onnxruntime-web loads its own wasm glue via a runtime `import(url)`, which
  // resolves a relative specifier against the *importing chunk's* URL
  // (Vite emits the app chunk under dist/assets/), not against the document —
  // so the path must be absolute before it is handed over, in every
  // environment, or it silently resolves under dist/assets/ instead of the
  // vendored dist/runtime/ort/ (design D1).
  //
  // Separately, observed in dev: BASE_URL is "/" there, so an un-resolved
  // string is only path-absolute, not fully qualified, and Vite's dev-server
  // transform refuses to serve public/ assets through a runtime dynamic
  // import ("this file is in /public ... should not be imported from source
  // code"). Pre-resolving against document.baseURI sidesteps that too, since
  // Vite treats an already-absolute URL as resolved and leaves it alone (same
  // as the CDN URL this replaced always did).
  ort.env.wasm.wasmPaths = resolveVendoredAssetUrl("runtime/ort/", import.meta.env.BASE_URL, document.baseURI);
  ort.env.wasm.numThreads = 1; // avoid SharedArrayBuffer / COOP-COEP requirements
  ortConfigured = true;
}

export async function createSession(url: string): Promise<ort.InferenceSession> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
}
