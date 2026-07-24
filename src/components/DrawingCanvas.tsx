import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";

// Excalidraw resolves its fonts from a public path that defaults to a CDN;
// Iris is offline-first and runs from file://, so point it at the vendored
// copy in public/excalidraw-assets (mirrors the mic-worklet file:// asset
// precedent — useAudioPipeline.ts:105-113). document.baseURI (not
// location.origin) is used so this stays correct relative to dist/index.html
// under file://, where a bare origin would resolve to the filesystem root
// instead of the app's own directory.
if (typeof window !== "undefined" && !window.EXCALIDRAW_ASSET_PATH) {
  window.EXCALIDRAW_ASSET_PATH = new URL("excalidraw-assets/", document.baseURI).href;
}

// Set once the dynamic import below resolves — read by the callbacks passed
// to <Excalidraw>, which Excalidraw itself only invokes after mount, i.e.
// strictly after this module has loaded (React.lazy suspends until then).
let excalidrawModule: typeof import("@excalidraw/excalidraw") | null = null;

// Loaded only on first activation (design.md D1 of hud-drawing-canvas) — this
// is a 500KB+ bundle plus its CSS, both irrelevant until the user opens the
// drawing panel.
const ExcalidrawLazy = lazy(async () => {
  await import("@excalidraw/excalidraw/index.css");
  const mod = await import("@excalidraw/excalidraw");
  excalidrawModule = mod;
  return { default: mod.Excalidraw };
});

const PUSH_DEBOUNCE_MS = 500;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Identity of a scene state for echo suppression (canvas-claude-mcp
// design.md D4): (id, version, versionNonce) changes on every excalidraw
// mutation, so two elements arrays with an identical signature are the same
// state, not just visually equal. Deliberately NOT a one-shot "skip the next
// onChange" flag — updateScene may fire onChange zero times (leaving a flag
// armed to swallow the next real user edit) or more than once; comparing
// against the last-applied signature on every onChange handles both without
// ever needing to "disarm" it.
export function sceneSignature(elements: readonly { id: string; version?: number; versionNonce?: number; isDeleted?: boolean }[]): string {
  return elements
    .filter((element) => !element.isDeleted)
    .map((element) => `${element.id}:${element.version}:${element.versionNonce}`)
    .sort()
    .join("|");
}

export default function DrawingCanvas() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const pushTimerRef = useRef<number | null>(null);
  const pendingSceneRef = useRef<CanvasScene | null>(null);
  // Feature-detected once: when the File System Access API isn't available
  // under file://, excalidraw's own built-in Open/Save/Export menu falls
  // back to its bundled browser-fs-access shim automatically — this extra
  // strip only exists as the native-dialog escape hatch design.md D5a asks
  // for, in case that shim is ever blocked in a packaged build.
  const [hasFsAccess] = useState(() => typeof window !== "undefined" && "showOpenFilePicker" in window);
  // Signature of the elements this component itself last applied via
  // canvas:apply — read by handleChange's echo guard below.
  const lastAppliedSignatureRef = useRef<string | null>(null);

  // The panel only exists while active (App.tsx unmounts it when
  // drawingActive is false), so mount == activate: tell main to bring the
  // HUD window to keyboard focus (design.md D4) so the text tool, Delete,
  // and shortcuts reach excalidraw.
  useEffect(() => {
    window.iris.activateDrawingCanvas();
  }, []);

  // canvas-claude-mcp design.md D4/4.2: apply an externally-originated
  // (Claude) write into the live scene. Registered inside this effect so its
  // lifetime is exactly "panel mounted" — while unmounted, get_canvas's
  // includeImage request degrades to JSON-only for the same reason (no
  // listener to answer canvas:request-image, see the effect below).
  useEffect(() => {
    return window.iris.onCanvasApply((payload) => {
      if (!excalidrawModule || !apiRef.current) return; // mid-mount race — rare, main's cache stays the source of truth
      const elements = payload.elements as never[];
      lastAppliedSignatureRef.current = sceneSignature(elements as never);
      apiRef.current.updateScene({
        elements,
        // Remote update, not a local edit — must not pollute the user's undo
        // stack (design.md D4).
        captureUpdate: excalidrawModule.CaptureUpdateAction.NEVER,
      });
    });
  }, []);

  // canvas-claude-mcp design.md D3/4.3: reply to main's image-export request
  // (get_canvas({ includeImage: true })) with a rendered PNG of the current
  // scene. Same mount-scoped lifetime as the apply handler above — while
  // unmounted, main's own timeout degrades the tool result to JSON-only.
  useEffect(() => {
    return window.iris.onCanvasImageRequest((payload) => {
      if (!excalidrawModule || !apiRef.current) {
        window.iris.replyCanvasImage(payload.id, null);
        return;
      }
      const api = apiRef.current;
      const mod = excalidrawModule;
      mod
        .exportToBlob({ elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() })
        .then(async (blob: Blob) => {
          window.iris.replyCanvasImage(payload.id, { mimeType: "image/png", data: await blobToBase64(blob) });
        })
        .catch(() => {
          window.iris.replyCanvasImage(payload.id, null);
        });
    });
  }, []);

  const flushPending = useCallback(() => {
    if (pushTimerRef.current) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    if (pendingSceneRef.current) {
      window.iris.saveCanvasScene(pendingSceneRef.current);
      pendingSceneRef.current = null;
    }
  }, []);

  // Flush on unmount (panel toggled off, or the HUD is exited) so a quit or
  // toggle-off right after drawing doesn't lose the last debounce window.
  useEffect(() => flushPending, [flushPending]);

  const loadInitialData = useCallback(async () => {
    const stored = await window.iris.getCanvasScene();
    if (!stored || !excalidrawModule) return null;
    const restored = excalidrawModule.restore(stored as never, null, null);
    return { elements: restored.elements, appState: restored.appState, files: restored.files };
  }, []);

  const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>((elements, appState, files) => {
    if (!excalidrawModule) return;
    // Echo of our own canvas:apply — do not push it back up as a
    // whole-scene write, or it could clobber main's cache with a
    // slightly-stale copy captured mid-apply (design.md D4). A genuine user
    // edit changes every touched element's version/versionNonce, so it never
    // matches this signature and always still propagates below.
    if (lastAppliedSignatureRef.current !== null && sceneSignature(elements) === lastAppliedSignatureRef.current) {
      return;
    }
    const scene = JSON.parse(
      excalidrawModule.serializeAsJSON(elements, appState, files, "local"),
    ) as CanvasScene;
    pendingSceneRef.current = scene;
    if (pushTimerRef.current) return;
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      if (pendingSceneRef.current) {
        window.iris.saveCanvasScene(pendingSceneRef.current);
        pendingSceneRef.current = null;
      }
    }, PUSH_DEBOUNCE_MS);
  }, []);

  async function handleNativeOpen() {
    if (!excalidrawModule || !apiRef.current) return;
    const result = await window.iris.nativeOpenCanvasFile();
    if (result.canceled) return;
    const restored = excalidrawModule.restore(JSON.parse(result.content), null, null);
    apiRef.current.updateScene({ elements: restored.elements, appState: restored.appState });
    apiRef.current.addFiles(Object.values(restored.files));
  }

  async function handleNativeSave() {
    if (!excalidrawModule || !apiRef.current) return;
    const api = apiRef.current;
    const json = excalidrawModule.serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    await window.iris.nativeSaveCanvasFile(json, "drawing.excalidraw");
  }

  async function handleNativeExport(format: "png" | "svg") {
    if (!excalidrawModule || !apiRef.current) return;
    const api = apiRef.current;
    const opts = { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() };
    if (format === "svg") {
      const svg = await excalidrawModule.exportToSvg(opts);
      await window.iris.nativeExportCanvasImage(svg.outerHTML, "svg", "drawing.svg");
    } else {
      const blob = await excalidrawModule.exportToBlob(opts);
      await window.iris.nativeExportCanvasImage(await blobToBase64(blob), "png", "drawing.png");
    }
  }

  return (
    <div className="hud-drawing-panel hud-hit">
      <Suspense fallback={<div className="hud-drawing-loading">Loading canvas…</div>}>
        <ExcalidrawLazy
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          initialData={loadInitialData}
          onChange={handleChange}
          theme="dark"
        />
      </Suspense>
      {!hasFsAccess ? (
        <div className="hud-drawing-native-fallback hud-hit">
          <button type="button" onClick={handleNativeOpen} title="Open a local .excalidraw file">
            Open
          </button>
          <button type="button" onClick={handleNativeSave} title="Save to a local .excalidraw file">
            Save
          </button>
          <button type="button" onClick={() => handleNativeExport("png")} title="Export as PNG">
            PNG
          </button>
          <button type="button" onClick={() => handleNativeExport("svg")} title="Export as SVG">
            SVG
          </button>
        </div>
      ) : null}
    </div>
  );
}
