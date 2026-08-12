import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

// ---------------------------------------------------------------------------
// The pure half of this module: element reconciliation and viewport maths.
// Exported for their tests (DrawingCanvas.merge.test.ts) — mounting this
// component in a test is not possible (it lazy-loads a 500KB excalidraw bundle
// and talks to window.iris), so the logic that must be right lives in
// functions that can be called directly.
// ---------------------------------------------------------------------------

/** The little of an excalidraw element this file reasons about. */
/**
 * The echo guard, as a decision: given the signature of the elements this
 * component last applied and the signature onChange is now reporting, should
 * the change be swallowed, and what should be remembered afterwards?
 *
 * The release half matters as much as the suppression: once a NON-matching
 * change is seen the echo is demonstrably behind us, so the signature is
 * dropped. Holding it forever left a live trap — a later undo/redo landing on
 * exactly that state would be mistaken for an echo and never pushed, silently
 * losing the user's change.
 */
export function echoGuard(
  lastAppliedSignature: string | null,
  signature: string,
): { suppress: boolean; nextSignature: string | null } {
  if (lastAppliedSignature === null) return { suppress: false, nextSignature: null };
  if (signature === lastAppliedSignature) return { suppress: true, nextSignature: lastAppliedSignature };
  return { suppress: false, nextSignature: null };
}

export type MergeableElement = {
  id: string;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

/**
 * A snapshot waiting to be pushed, and — the part that matters — the cache
 * revision it was taken against.
 *
 * The bug this exists to kill: the renderer used to send `revisionRef.current`
 * as the push's base, i.e. the NEWEST revision it had heard of, while the
 * snapshot itself could predate it. The sequence that lost Iris's work every
 * time is only three steps long:
 *
 *   1. the user draws — a snapshot is queued, to be pushed 500 ms later
 *   2. Iris writes through MCP — main advances to revision N, broadcasts the
 *      apply; the renderer merges it and adopts N. The `onChange` this causes
 *      is (correctly) swallowed as an echo, so the queued snapshot — which has
 *      no idea Iris exists — is still sitting there
 *   3. the timer fires and pushes that pre-Iris snapshot, declaring base N
 *
 * Main sees base N against its own N, concludes the push is current, and
 * replaces the scene with one Iris is missing from. Every reconciliation
 * safeguard behind it was working perfectly and never got to run, because the
 * push lied about what it was derived from — not on purpose, but by reading a
 * ref that had moved on. The user's own strokes survived (they were in the
 * snapshot), which is exactly the "only what I drew with the mouse is still
 * there" report.
 *
 * So the base travels WITH the snapshot. Where two snapshots coalesce into one
 * push, the older base wins: it is the one that describes what main might have
 * accepted in between.
 */
export type PendingPush<T> = { snapshot: T; baseRevision: number | null } | null;

export function stagePush<T>(pending: PendingPush<T>, snapshot: T, currentRevision: number | null): PendingPush<T> {
  return { snapshot, baseRevision: pending ? pending.baseRevision : currentRevision };
}

/**
 * After an apply has been merged into the live canvas, the queued snapshot is
 * stale by definition — it was taken before Iris's write. Replacing it with
 * the merged state, based at the apply's own revision, keeps the queue honest
 * and avoids leaning on reconciliation for something we can simply state
 * correctly: this snapshot contains Iris's elements, and it is current as of
 * her revision.
 */
export function rebasePush<T>(pending: PendingPush<T>, merged: T, revision: number | null): PendingPush<T> {
  if (!pending) return null;
  return { snapshot: merged, baseRevision: revision };
}

/**
 * Merge an externally-originated (Claude) write into the live scene BY ELEMENT
 * ID, which is the whole point (canvas-claude-mcp: "last-writer-wins per
 * element"). Replacing the scene wholesale is what erased a stroke the user
 * drew after Claude read the scene — Claude's `elements` is main's cache as of
 * its read, so anything newer than that read is simply absent from it.
 *
 * `changedIds` names what the writer actually touched:
 *   - id in changedIds, present in `incoming`  → the writer's version wins
 *   - id in changedIds, absent from `incoming` → the writer deleted it
 *   - id not in changedIds                     → the LIVE element wins, always
 *
 * Without `changedIds` (an older main) there is no way to tell "the writer
 * deleted this" from "the writer never saw this", so the conservative reading
 * is taken: incoming elements update their live counterparts and nothing is
 * deleted. Losing a deletion is recoverable; losing a drawing is not.
 *
 * Live order is preserved (excalidraw's array order is z-order) and genuinely
 * new elements are appended.
 */
export function mergeElementsById<T extends MergeableElement>(
  current: readonly T[],
  incoming: readonly T[],
  changedIds?: readonly string[],
): T[] {
  const incomingById = new Map(incoming.map((element) => [element.id, element]));
  const changed = changedIds ? new Set(changedIds) : null;
  const merged: T[] = [];

  for (const element of current) {
    const replacement = incomingById.get(element.id);
    incomingById.delete(element.id);
    if (changed && !changed.has(element.id)) {
      merged.push(element); // untouched by the writer — the live copy is the truth
      continue;
    }
    if (replacement) {
      merged.push(replacement);
    } else if (!changed) {
      merged.push(element); // no changedIds: never infer a delete
    }
    // changed && no replacement → the writer deleted it: drop it.
  }

  for (const element of incoming) {
    // Only the leftovers (ids the live scene did not have). With changedIds,
    // an untouched leftover is one the USER deleted locally — do not resurrect.
    if (!incomingById.has(element.id)) continue;
    if (changed && !changed.has(element.id)) continue;
    merged.push(element);
  }
  return merged;
}

export type SceneRect = { minX: number; minY: number; maxX: number; maxY: number };

/** Bounding box of `elements` in scene coordinates, or null when there is
 *  nothing to bound. */
export function elementsBounds(elements: readonly MergeableElement[]): SceneRect | null {
  let bounds: SceneRect | null = null;
  for (const element of elements) {
    if (element.isDeleted) continue;
    if (typeof element.x !== "number" || typeof element.y !== "number") continue;
    const maxX = element.x + (element.width ?? 0);
    const maxY = element.y + (element.height ?? 0);
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, element.x),
          minY: Math.min(bounds.minY, element.y),
          maxX: Math.max(bounds.maxX, maxX),
          maxY: Math.max(bounds.maxY, maxY),
        }
      : { minX: element.x, minY: element.y, maxX, maxY };
  }
  return bounds;
}

/** The visible region in SCENE coordinates. excalidraw maps a scene point to
 *  the viewport as `(scene + scroll) * zoom`, so the visible scene span is
 *  `[-scroll, -scroll + size / zoom]`. */
export function viewportSceneRect(appState: {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
  width: number;
  height: number;
}): SceneRect {
  const zoom = appState.zoom?.value || 1;
  // `+ 0` normalizes the -0 that negating a 0 scroll produces — irrelevant to
  // every comparison below, and confusing everywhere it is read.
  const minX = -appState.scrollX + 0;
  const minY = -appState.scrollY + 0;
  return { minX, minY, maxX: minX + appState.width / zoom, maxY: minY + appState.height / zoom };
}

/** Whether `bounds` is at all visible in `viewport` (any overlap counts —
 *  a write half on screen does not need the view yanked). */
export function boundsVisible(bounds: SceneRect | null, viewport: SceneRect): boolean {
  if (!bounds) return true; // nothing to look at is not "off screen"
  return (
    bounds.minX < viewport.maxX &&
    bounds.maxX > viewport.minX &&
    bounds.minY < viewport.maxY &&
    bounds.maxY > viewport.minY
  );
}

// How long the "Iris drew" chip stays up. Long enough to be read while the
// user is looking somewhere else on the canvas, short enough that it is not a
// permanent piece of chrome.
const IRIS_DREW_CHIP_MS = 4000;

function DrawingCanvasSurface({ onClose }: { onClose?: () => void }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const pushTimerRef = useRef<number | null>(null);
  // The live excalidraw state awaiting a push — held by reference, not
  // serialized, until the debounce window closes. See `serializeAndPush`.
  const pendingSnapshotRef = useRef<
    PendingPush<{
      elements: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];
      appState: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[1];
      files: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[2];
    }>
  >(null);
  // Feature-detected once: when the File System Access API isn't available
  // under file://, excalidraw's own built-in Open/Save/Export menu falls
  // back to its bundled browser-fs-access shim automatically — this extra
  // strip only exists as the native-dialog escape hatch design.md D5a asks
  // for, in case that shim is ever blocked in a packaged build.
  const [hasFsAccess] = useState(() => typeof window !== "undefined" && "showOpenFilePicker" in window);
  // Signature of the elements this component itself last applied via
  // canvas:apply — read by handleChange's echo guard below.
  const lastAppliedSignatureRef = useRef<string | null>(null);
  // The newest cache revision this renderer has SEEN — from the restore, from
  // an apply, or from a push's own acknowledgement. Every push declares it, so
  // main can tell a push that raced a write it already accepted from one that
  // did not (the-canvas-stops-fighting-back).
  const revisionRef = useRef<number | null>(null);
  // Applies that arrived before the canvas could take them (the panel is
  // mounting, the 500KB bundle is still loading). Dropping them was a silent
  // lost write; they are replayed the moment the API appears.
  const queuedAppliesRef = useRef<CanvasApplyPayload[]>([]);
  const initialLoadedRef = useRef(false);
  const restoredElementsRef = useRef<MergeableElement[]>([]);
  const viewportRestoredRef = useRef(false);
  const [irisDrew, setIrisDrew] = useState(false);
  const chipTimerRef = useRef<number | null>(null);

  // The panel only exists while active (App.tsx unmounts it when
  // drawingActive is false), so mount == activate: tell main to bring the
  // HUD window to keyboard focus (design.md D4) so the text tool, Delete,
  // and shortcuts reach excalidraw.
  useEffect(() => {
    window.iris.activateDrawingCanvas();
  }, []);

  const announceIrisDrew = useCallback(() => {
    setIrisDrew(true);
    if (chipTimerRef.current) window.clearTimeout(chipTimerRef.current);
    chipTimerRef.current = window.setTimeout(() => {
      chipTimerRef.current = null;
      setIrisDrew(false);
    }, IRIS_DREW_CHIP_MS);
  }, []);

  useEffect(
    () => () => {
      if (chipTimerRef.current) window.clearTimeout(chipTimerRef.current);
    },
    [],
  );

  // canvas-claude-mcp design.md D4/4.2: apply an externally-originated
  // (Claude) write into the live scene — by element id, never by replacing the
  // scene, so a stroke the user drew after Claude's read survives it.
  const applyIncoming = useCallback(
    (payload: CanvasApplyPayload) => {
      const api = apiRef.current;
      const mod = excalidrawModule;
      if (!mod || !api || !initialLoadedRef.current) {
        queuedAppliesRef.current.push(payload);
        return;
      }
      if (typeof payload.revision === "number") revisionRef.current = payload.revision;

      const incoming = payload.elements as MergeableElement[];
      const live = api.getSceneElements() as unknown as MergeableElement[];
      const merged = mergeElementsById(live, incoming, payload.changedIds);
      lastAppliedSignatureRef.current = sceneSignature(merged);
      api.updateScene({
        elements: merged as never,
        // A remote write is its OWN undo step (canvas-claude-mcp): "undo what
        // Iris just drew" has to be one keystroke and must not require undoing
        // the user's own work first. It used to be CaptureUpdateAction.NEVER,
        // which made an apply that clobbered a stroke unrecoverable.
        captureUpdate: mod.CaptureUpdateAction.IMMEDIATELY,
      });

      // A snapshot queued before this apply describes a canvas Iris had not
      // written to yet. Pushing it later would ask main to accept a scene she
      // is missing from; rebasing it onto the merged state says the true thing
      // instead. (The `onChange` this apply triggers is swallowed as an echo,
      // so nothing else is going to refresh the queue.)
      pendingSnapshotRef.current = rebasePush(
        pendingSnapshotRef.current,
        { elements: merged as never, appState: api.getAppState(), files: api.getFiles() },
        revisionRef.current,
      );

      // A write the user cannot see is indistinguishable from nothing having
      // happened: bring it into view, and say who did it.
      const touchedIds = payload.changedIds ? new Set(payload.changedIds) : null;
      const touched = touchedIds ? merged.filter((element) => touchedIds.has(element.id)) : incoming;
      const bounds = elementsBounds(touched);
      if (bounds && !boundsVisible(bounds, viewportSceneRect(api.getAppState()))) {
        api.scrollToContent(touched as never, { fitToContent: true, animate: true });
      }
      announceIrisDrew();
    },
    [announceIrisDrew],
  );

  // Registered inside this effect so its lifetime is exactly "panel mounted" —
  // while unmounted, get_canvas's includeImage request degrades to JSON-only
  // for the same reason (no listener to answer canvas:request-image).
  useEffect(() => window.iris.onCanvasApply(applyIncoming), [applyIncoming]);


  // Both halves of "the canvas is usable now": the API handed over by
  // excalidraw, and the stored scene loaded. Whichever lands last runs the
  // queued applies and the viewport restore.
  const canvasReady = useCallback(() => {
    if (!apiRef.current || !initialLoadedRef.current) return;
    if (!viewportRestoredRef.current) {
      viewportRestoredRef.current = true;
      // Reopening must never present a blank canvas that is in fact holding a
      // full drawing: excalidraw's serializer does not persist scroll/zoom, so
      // a scene drawn away from the origin restores with the viewport at the
      // origin, looking empty. Scroll to what is actually there.
      if (restoredElementsRef.current.length > 0) {
        apiRef.current.scrollToContent(restoredElementsRef.current as never, { fitToContent: true });
      }
    }
    if (queuedAppliesRef.current.length === 0) return;
    const queued = queuedAppliesRef.current;
    queuedAppliesRef.current = [];
    for (const payload of queued) applyIncoming(payload);
  }, [applyIncoming]);

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

  // Every push declares the revision it was derived from, and adopts whatever
  // revision main reports back. The acknowledgement is optional by design:
  // `canvas:scene` is a fire-and-forget `send` today, so this is `undefined`
  // and the revision simply stays where the last apply/restore left it.
  const pushScene = useCallback((scene: CanvasScene, baseRevision: number | null) => {
    const ack = window.iris.saveCanvasScene({ scene, baseRevision });
    if (!ack || typeof ack.then !== "function") return;
    ack
      .then((result) => {
        if (result && typeof result.revision === "number") revisionRef.current = result.revision;
      })
      .catch(() => {});
  }, []);

  // `flushPending` is registered on `pagehide` and on unmount, both of which
  // are set up before `serializeAndPush` is defined below; going through a ref
  // keeps the listener stable (it is never re-registered) while always calling
  // the current implementation.
  const serializeAndPushRef = useRef<() => void>(() => {});

  const flushPending = useCallback(() => {
    if (pushTimerRef.current) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    serializeAndPushRef.current();
  }, []);

// A run is about to read the canvas: push whatever is still sitting in the
  // debounce window, so it reads the board on screen rather than the one from
  // half a second ago. The case this exists for is drawing while speaking —
  // "and this arrow here" — where the stroke being asked about is exactly the
  // one still pending.
  useEffect(() => window.iris.onCanvasFlushRequest(() => flushPending()), [flushPending]);

  // Flush on unmount (panel toggled off, or the HUD is exited) so a quit or
  // toggle-off right after drawing doesn't lose the last debounce window —
  // AND on `pagehide`, which is the only one of the two that fires when the
  // document is torn down under React (reload, window close, app quit).
  // Unmount alone silently cost the last half-second of drawing on every quit.
  useEffect(() => {
    const onPageHide = () => flushPending();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flushPending();
    };
  }, [flushPending]);

  const loadInitialData = useCallback(async () => {
    const stored = await window.iris.getCanvasScene();
    if (!stored || !excalidrawModule) {
      initialLoadedRef.current = true;
      canvasReady();
      return null;
    }
    // `irisRevision` rides inside the served scene so `canvas:get-scene` keeps
    // its shape; strip it before restore, which is entitled to see only
    // excalidraw's own scene keys.
    const { irisRevision, ...scene } = stored;
    revisionRef.current = typeof irisRevision === "number" ? irisRevision : null;
    const restored = excalidrawModule.restore(scene as never, null, null);
    restoredElementsRef.current = restored.elements as unknown as MergeableElement[];
    initialLoadedRef.current = true;
    canvasReady();
    return { elements: restored.elements, appState: restored.appState, files: restored.files };
  }, [canvasReady]);

  // Serialize the pending snapshot, if there is one, and hand it to main.
  // Serializing happens HERE — once per debounce window — and never in
  // `onChange`. Excalidraw calls `onChange` from `componentDidUpdate`, i.e.
  // on every pointermove while a stroke is being drawn (60-120/s), and
  // serializing the whole scene there cost 8.7 ms per call on a 1 MB scene,
  // 35 ms on 4 MB, 63 ms on 8 MB (measured, Apple M4; roughly 3x that on
  // Intel). Debouncing only the SEND left that cost on every frame, which is
  // what made drawing on a large board feel like the machine had seized up.
  // The snapshot taken at the end of the window is the one that was being
  // sent anyway.
  const serializeAndPush = useCallback(() => {
    const pending = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    if (!pending || !excalidrawModule) return;
    const { elements, appState, files } = pending.snapshot;
    const scene = JSON.parse(excalidrawModule.serializeAsJSON(elements, appState, files, "local")) as CanvasScene;
    // The base the SNAPSHOT was taken at, never the newest revision known —
    // see PendingPush.
    pushScene(scene, pending.baseRevision);
  }, [pushScene]);

  serializeAndPushRef.current = serializeAndPush;

  const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements, appState, files) => {
      if (!excalidrawModule) return;
      // Echo of our own canvas:apply — do not push it back up as a
      // whole-scene write, or it could clobber main's cache with a
      // slightly-stale copy captured mid-apply (design.md D4). A genuine user
      // edit changes every touched element's version/versionNonce, so it never
      // matches this signature and always still propagates below.
      //
      // The signature is O(n log n) over the scene, so it is computed only
      // when there is something to compare it against — with no apply
      // outstanding there is no echo to suppress.
      if (lastAppliedSignatureRef.current !== null) {
        const echo = echoGuard(lastAppliedSignatureRef.current, sceneSignature(elements));
        lastAppliedSignatureRef.current = echo.nextSignature;
        if (echo.suppress) return;
      }
      // Hold the references, not a serialization of them. Excalidraw hands us
      // its live arrays; the snapshot is read at the end of the debounce
      // window, which is exactly the state that would have been sent.
      pendingSnapshotRef.current = stagePush(
        pendingSnapshotRef.current,
        { elements, appState, files },
        revisionRef.current,
      );
      if (pushTimerRef.current) return;
      pushTimerRef.current = window.setTimeout(() => {
        pushTimerRef.current = null;
        serializeAndPush();
      }, PUSH_DEBOUNCE_MS);
    },
    [serializeAndPush],
  );

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
            canvasReady();
          }}
          initialData={loadInitialData}
          onChange={handleChange}
          theme="dark"
          // The way out, rendered by excalidraw into its own top-right UI row
          // rather than positioned over it. This surface covers the whole
          // display and the window sits above the menu bar at `screen-saver`
          // level, so while it is open the desktop underneath cannot be
          // clicked — which makes "close it" the single most important thing a
          // MOUSE can still do. Esc does it too, and so does the orb cluster's
          // toggle, but both of those depend on something else working: Esc on
          // this transparent window actually holding key focus, the toggle on
          // the user knowing hover reveals it. A visible button depends on
          // nothing.
          renderTopRightUI={() => (
            <button
              type="button"
              className="hud-drawing-close hud-hit"
              onClick={() => onClose?.()}
              title="Close the drawing surface (Esc)"
            >
              Close
            </button>
          )}
        />
      </Suspense>
      {irisDrew ? <div className="hud-drawing-iris-chip">Iris just drew</div> : null}
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

class DrawingErrorBoundary extends Component<{ onCrash?: () => void; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: unknown) {
    // Mirrors VaultGalaxy's boundary (second-brain-layer, "The second-brain
    // vault is shown as an exclusive HUD layer"): a crashed canvas must not
    // leave a panel-sized hole that owns
    // part of the screen and cannot be closed by anything inside it. Force the
    // panel closed, same as Esc, and log rather than swallow so the crash is
    // visible in devtools instead of "the drawing panel vanished".
    console.error("[hud-drawing-canvas] drawing panel crashed, force-closing:", error);
    this.props.onCrash?.();
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}

export default function DrawingCanvas({ onForceClose }: { onForceClose?: () => void } = {}) {
  return (
    <DrawingErrorBoundary onCrash={onForceClose}>
      <DrawingCanvasSurface onClose={onForceClose} />
    </DrawingErrorBoundary>
  );
}
