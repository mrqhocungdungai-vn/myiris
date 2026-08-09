// the-canvas-stops-fighting-back tasks 2.4 / 2.6 / 3.1 / 3.2 / 3.5 — the pure
// half of DrawingCanvas: how a write from Claude is reconciled into the live
// scene, and how the panel decides the user cannot see it. The component
// itself cannot be mounted here (it lazy-loads the excalidraw bundle and talks
// to window.iris over IPC), which is exactly why this logic is factored out
// into functions rather than left inline in an effect.
import { describe, it, expect } from "vitest";
import {
  boundsVisible,
  echoGuard,
  elementsBounds,
  mergeElementsById,
  rebasePush,
  stagePush,
  viewportSceneRect,
  type MergeableElement,
  type PendingPush,
} from "./DrawingCanvas";

const el = (id: string, over: Partial<MergeableElement> = {}): MergeableElement => ({
  id,
  version: 1,
  versionNonce: 1,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...over,
});

describe("mergeElementsById", () => {
  it("keeps a stroke the user drew after Claude read the scene", () => {
    // Claude read [a], the user then drew [b], Claude's write arrives holding
    // only [a, claude-rect]. The whole-scene replace this used to do erased b.
    const live = [el("a"), el("user-stroke")];
    const incoming = [el("a"), el("claude-rect", { x: 500 })];
    const merged = mergeElementsById(live, incoming, ["claude-rect"]);
    expect(merged.map((e) => e.id)).toEqual(["a", "user-stroke", "claude-rect"]);
  });

  it("lets the writer's version win for the ids it actually changed", () => {
    const live = [el("a", { version: 1 })];
    const incoming = [el("a", { version: 9, versionNonce: 77 })];
    const merged = mergeElementsById(live, incoming, ["a"]);
    expect(merged).toEqual([el("a", { version: 9, versionNonce: 77 })]);
  });

  it("does NOT let a stale copy win for an id the writer did not touch", () => {
    // `incoming` is main's cache as of Claude's read, so its copy of an
    // untouched element may be older than what is on screen right now.
    const live = [el("a", { version: 12 })];
    const incoming = [el("a", { version: 3 }), el("new", { x: 40 })];
    const merged = mergeElementsById(live, incoming, ["new"]);
    expect(merged.find((e) => e.id === "a")?.version).toBe(12);
  });

  it("applies a deletion: an id the writer changed but did not send back", () => {
    const live = [el("a"), el("doomed")];
    const merged = mergeElementsById(live, [el("a")], ["doomed"]);
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });

  it("does not resurrect an element the user deleted locally", () => {
    const live = [el("a")];
    const incoming = [el("a"), el("user-deleted-this")];
    const merged = mergeElementsById(live, incoming, ["a"]);
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });

  it("preserves live z-order and appends genuinely new elements last", () => {
    const live = [el("back"), el("front")];
    const merged = mergeElementsById(live, [el("added")], ["added"]);
    expect(merged.map((e) => e.id)).toEqual(["back", "front", "added"]);
  });

  it("without changedIds, updates by id and never infers a deletion", () => {
    const live = [el("a", { version: 1 }), el("only-live")];
    const incoming = [el("a", { version: 5 }), el("only-incoming")];
    const merged = mergeElementsById(live, incoming);
    expect(merged.map((e) => e.id)).toEqual(["a", "only-live", "only-incoming"]);
    expect(merged[0].version).toBe(5);
  });

  it("treats an empty changedIds as 'nothing was touched', not 'delete everything'", () => {
    const live = [el("a"), el("b")];
    expect(mergeElementsById(live, [], []).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("elementsBounds", () => {
  it("bounds the union of the elements", () => {
    expect(elementsBounds([el("a", { x: 10, y: 20 }), el("b", { x: -5, y: 0, width: 30, height: 4 })])).toEqual({
      minX: -5,
      minY: 0,
      maxX: 25,
      maxY: 30,
    });
  });

  it("ignores tombstones and returns null when there is nothing to bound", () => {
    expect(elementsBounds([el("gone", { isDeleted: true })])).toBeNull();
    expect(elementsBounds([])).toBeNull();
  });
});

describe("viewportSceneRect / boundsVisible", () => {
  const appState = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 800, height: 600 };

  it("maps scroll and zoom to the visible scene span", () => {
    expect(viewportSceneRect(appState)).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
    expect(viewportSceneRect({ ...appState, scrollX: -100, zoom: { value: 2 } })).toEqual({
      minX: 100,
      minY: 0,
      maxX: 500,
      maxY: 300,
    });
  });

  it("sees a write inside the viewport, and does not see one beyond it", () => {
    const viewport = viewportSceneRect(appState);
    expect(boundsVisible(elementsBounds([el("near", { x: 100, y: 100 })]), viewport)).toBe(true);
    expect(boundsVisible(elementsBounds([el("far", { x: 4000, y: 4000 })]), viewport)).toBe(false);
  });

  it("counts a partially visible write as visible — the view is not yanked for it", () => {
    const viewport = viewportSceneRect(appState);
    expect(boundsVisible(elementsBounds([el("straddling", { x: 795, y: 10 })]), viewport)).toBe(true);
  });

  it("an empty write is not 'off screen'", () => {
    expect(boundsVisible(null, viewportSceneRect(appState))).toBe(true);
  });
});


// Task 2.5: the guard must also RELEASE. Suppressing forever is a live trap.
describe("echoGuard", () => {
  it("suppresses the echo of the apply itself", () => {
    expect(echoGuard("sig-a", "sig-a")).toEqual({ suppress: true, nextSignature: "sig-a" });
  });

  it("passes a genuine edit through and forgets the signature", () => {
    expect(echoGuard("sig-a", "sig-b")).toEqual({ suppress: false, nextSignature: null });
  });

  it("having released, no longer suppresses a later return to the applied state", () => {
    // An undo can land the scene back on exactly the applied signature; with
    // the guard still armed that push would be swallowed and the change lost.
    const released = echoGuard("sig-a", "sig-b");
    expect(echoGuard(released.nextSignature, "sig-a").suppress).toBe(false);
  });

  it("does nothing when no apply has happened", () => {
    expect(echoGuard(null, "sig-a")).toEqual({ suppress: false, nextSignature: null });
  });
});

// The reported failure, reproduced at the level it actually happens: not in
// the merge (which was right), but in what the push CLAIMS to be derived from.
// "Iris draws, I close the panel, her work is gone — only what I drew with the
// mouse is still there."
describe("stagePush / rebasePush: a push declares the revision its snapshot was taken at", () => {
  type Snap = string;

  it("stamps a fresh snapshot with the revision current at the time", () => {
    const pending = stagePush<Snap>(null, "user-stroke", 7);
    expect(pending).toEqual({ snapshot: "user-stroke", baseRevision: 7 });
  });

  it("keeps the OLDER base when two snapshots coalesce into one push", () => {
    // Both were taken before anything was sent, so the push covers the span
    // from the first one — that is the window main may have accepted a write in.
    const first = stagePush<Snap>(null, "stroke-1", 7);
    const second = stagePush<Snap>(first, "stroke-2", 9);
    expect(second).toEqual({ snapshot: "stroke-2", baseRevision: 7 });
  });

  it("does not let a later revision rewrite the base of a snapshot already queued", () => {
    // THE BUG. The renderer adopted the apply's revision (8) and then sent the
    // pre-apply snapshot declaring base 8, so main saw a current push and
    // replaced the scene — deleting everything Iris had just added. The
    // snapshot's base must be 7, which makes the push stale and reconcilable.
    const queued = stagePush<Snap>(null, "pre-iris-snapshot", 7);
    const revisionAfterIrisWrote = 8;
    const stillQueued = stagePush<Snap>(queued, "pre-iris-snapshot", revisionAfterIrisWrote);
    expect(stillQueued?.baseRevision).toBe(7);
    expect(stillQueued?.baseRevision).not.toBe(revisionAfterIrisWrote);
  });

  it("rebases a queued snapshot onto the merged scene once Iris's write is applied", () => {
    const queued = stagePush<Snap>(null, "pre-iris-snapshot", 7);
    const rebased = rebasePush<Snap>(queued, "merged-with-iris", 8);
    expect(rebased).toEqual({ snapshot: "merged-with-iris", baseRevision: 8 });
  });

  it("does not invent a push where none was queued", () => {
    // An apply with nothing pending must not manufacture a push: main already
    // holds that state, and pushing it back is how echo loops start.
    const rebased: PendingPush<Snap> = rebasePush<Snap>(null, "merged-with-iris", 8);
    expect(rebased).toBeNull();
  });

  it("carries a null base when the renderer has never heard a revision", () => {
    // A reload mid-session. Main treats an unattributed push as stale, which
    // is the safe reading.
    expect(stagePush<Snap>(null, "snapshot", null)?.baseRevision).toBeNull();
  });
});
