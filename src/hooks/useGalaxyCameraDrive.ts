import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { GalaxyNode, GalaxyLink, TrackballControlsLike } from "../lib/galaxy-types";
import type { HandState } from "./useHandControl";
import {
  dwellStep,
  driveFor,
  inspectingHand,
  isHandLowered,
  orbitStep,
  zoomRadius,
  handDistance,
  nearestNodeAt,
  INITIAL_DWELL_STATE,
  type DwellState,
  type GalaxyDrive,
} from "../lib/galaxy-nav";
import {
  CENTROID_ANCHOR,
  easeAnchor,
  pickAnchorAtCenter,
  shouldReleaseAnchor,
  type GalaxyAnchor,
} from "../lib/galaxy-anchor";
import type { AnchorRings } from "../lib/galaxy-anchor-rings";
import type { GalaxyAnchorApi } from "./useGalaxyAnchor";
import { hudChromeAtPoint } from "../lib/hudChrome";

// The galaxy's gesture rAF loop, lifted out of `VaultGalaxy.tsx`
// (galaxy-note-reachable-by-hand design.md D12): the component was already
// 1087 lines against a 250-450 line convention and the anchor wiring lands
// mostly here, so the loop moved out before any of it was written rather than
// as cleanup afterwards. It is still a thin driver over the pure policy in
// `src/lib/galaxy-nav.ts` and `src/lib/galaxy-anchor.ts`, reading per-frame
// inputs from refs the component owns.

type Fg = ForceGraph3DInstance<GalaxyNode, GalaxyLink>;

export type GalaxyCameraDriveParams = {
  handControl: boolean;
  running: boolean;
  /** The graph container — its rect converts projected node positions to window pixels. */
  containerRef: { current: HTMLDivElement | null };
  fgRef: { current: Fg | null };
  positionsRef: { current: Map<string, GalaxyNode> };
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handRef: { current: HandState };
  readerOpenRef: { current: boolean };
  onOpenNoteRef: { current: (id: string, title: string) => void };
  onForceCloseRef: { current: () => void };
  /** The node the HAND is pointing at — owned by the component because `repaintHighlight` reads it. */
  handTargetRef: { current: string | null };
  repaintHighlight: () => void;
  anchor: GalaxyAnchorApi;
  /** The candidate/anchor marks (design.md D10) — null until the scene exists. */
  ringsRef: { current: AnchorRings | null };
  debugEnabled: boolean;
  debugRef: { current: HTMLPreElement | null };
  /** Tuning constants, owned by the component alongside the galaxy's other ones. */
  dwellThresholdPx: number;
  dwellHoldMs: number;
  anchorThresholdPx: number;
  candidateIntervalMs: number;
  orbitSensitivity: number;
  zoomMinRadius: number;
  zoomMaxRadius: number;
};

export function useGalaxyCameraDrive({
  handControl,
  running,
  containerRef,
  fgRef,
  positionsRef,
  handRef,
  readerOpenRef,
  onOpenNoteRef,
  onForceCloseRef,
  handTargetRef,
  repaintHighlight,
  anchor,
  ringsRef,
  debugEnabled,
  debugRef,
  dwellThresholdPx,
  dwellHoldMs,
  anchorThresholdPx,
  candidateIntervalMs,
  orbitSensitivity,
  zoomMinRadius,
  zoomMaxRadius,
}: GalaxyCameraDriveParams) {
  // Gesture state — all pure-module state objects threaded through
  // src/lib/galaxy-nav.ts, plus the imperative camera-drive bookkeeping this
  // thin driver owns. Created once per hook instance so they survive the
  // effect re-running on a [handControl, running] change, which is exactly the
  // lifetime they had as component refs.
  const dwellStateRef = useRef<DwellState>(INITIAL_DWELL_STATE);
  const sphericalRef = useRef<THREE.Spherical | null>(null);
  const cameraEngagedRef = useRef<"orbit" | "zoom" | null>(null);
  const prevOrbitPointRef = useRef<{ x: number; y: number } | null>(null);
  const zoomReferenceRef = useRef<{ dist: number; radius: number } | null>(null);
  // Whether THIS engagement moved the anchor. The release path copies the
  // anchor into `controls.target` only when it did — otherwise a grab over
  // empty space would write a stale anchor over the user's mouse pan, which is
  // the exact framing-destroying behaviour this change removes (design.md D4b).
  const engageMovedAnchorRef = useRef(false);
  // The node a grab would take hold of right now, re-selected on the same
  // rate-limited cadence the titles use rather than every frame (design.md
  // D10) — the search is proportional to the node count and a candidate that
  // changed at frame rate would read as flicker.
  const candidateIdRef = useRef<string | null>(null);

  // Gesture drive (design.md D4b/D5): a thin driver over the pure policy in
  // src/lib/galaxy-nav.ts. Schedules NOTHING while gestures are off or the
  // HUD is asleep (H-1/M-1) — `backgroundThrottling:false` means nothing
  // else would throttle a spinning loop, and driving the camera while
  // `pauseAnimation()` holds the render would let it silently drift and
  // snap on wake. The marks stop with it, which is the whole of the spec's
  // "marks stop while Iris sleeps".
  useEffect(() => {
    if (!handControl || !running) return;
    let raf = 0;
    let lastFrameTime = performance.now();
    let lastCandidateSelect = 0;

    function restoreControlsIfNeeded(fg: Fg | null) {
      if (!fg) return;
      const controls = fg.controls() as unknown as TrackballControlsLike;
      if (!controls || controls.enabled) return;
      // Re-sync target before re-enabling (R1/M5): `setLookAt` only writes
      // `.target` while `.enabled` is true and REPLACES the Vector3 outright
      // on every enabled `cameraPosition()` call, so it must be re-read
      // (never cached) and copied into, not assumed still valid, here.
      //
      // The ANCHOR, not the centroid. Copying unconditionally is what used to
      // throw away whatever the user had framed with the mouse — so the one
      // case that is skipped is the one that would: a `point` anchor is a
      // position the USER put there with a pan, and an engagement that did not
      // move the anchor has nothing to say about it. Every other case is
      // re-synced, because a node anchor can drift under a still-settling
      // layout and a target left behind would orbit a position the node has
      // since left (design.md D4b).
      if (engageMovedAnchorRef.current || anchor.anchorRef.current.kind !== "point") {
        anchor.writeControlsTarget();
      }
      engageMovedAnchorRef.current = false;
      // Clear TrackballControls' own rotation momentum before handing
      // control back (see TrackballControlsLike) — otherwise a mouse-drag
      // rotate from earlier in the session, frozen mid-decay for however
      // long the gesture drive held `.enabled = false`, applies as one
      // sudden undamped jump the moment the mouse regains control: the exact
      // "camera swings past the note I was looking at" symptom a fist
      // release produced.
      if (controls._lastAngle !== undefined) controls._lastAngle = 0;
      controls.enabled = true;
    }

    // The two roles the anchor plays in a camera write are DIFFERENT VALUES,
    // and that separation is what lets both spec scenarios hold at once
    // (design.md D3):
    //
    // - the orbit ORIGIN is the resolved target anchor, which the spherical was
    //   seeded against at engage — so frame one reproduces the camera's exact
    //   position and re-anchoring never moves the camera;
    // - the LOOK-AT is the displayed anchor, lerping onto the target — so a
    //   change of aim is eased rather than snapped.
    //
    // Sharing one value between them writes the camera to
    // `oldAnchor + (camPos - targetAnchor)` on the first frame: a lurch of
    // exactly the anchor delta, which then decays.
    function writeCameraFromSpherical(fg: Fg, origin: { x: number; y: number; z: number }) {
      const spherical = sphericalRef.current;
      if (!spherical) return;
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      const displayed = anchor.displayedAnchorRef.current;
      fg.cameraPosition(
        { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z },
        { x: displayed.x, y: displayed.y, z: displayed.z },
        0,
      );
    }

    // two-hand-gestures: the zoom reads the distance between the two open
    // palms — null when fewer than two are present, which driveFor's own
    // partition already guarantees never happens while "zoom" is live.
    function twoPalmDistance(hand: HandState): number | null {
      const palms = hand.hands.filter((item) => item.openPalm);
      if (palms.length < 2) return null;
      return handDistance(palms[0].point, palms[1].point);
    }

    // design.md D7: every defect this change fixed traced to a runtime
    // number nobody could see — this makes them observable while tuning.
    // Direct DOM write, not React state (design.md D7/M-A1): an enabled
    // readout must not turn a 60fps loop into 60 re-renders.
    function updateDebugReadout(hand: HandState, drive: GalaxyDrive, dt: number) {
      const el = debugRef.current;
      if (!el) return;
      const fps = dt > 0 ? 1000 / dt : 0;
      const curDist = twoPalmDistance(hand);
      const ref = zoomReferenceRef.current;
      const refDist = ref?.dist ?? null;
      const ratio = curDist !== null && refDist !== null ? curDist / Math.max(80, refDist) : null;
      const radius = sphericalRef.current?.radius ?? null;
      const live = anchor.anchorRef.current;
      const lines = [
        `hands: ${hand.hands.length}`,
        ...hand.hands.map((item) => `  ${item.id}: ${item.gesture}`),
        `curDist: ${curDist !== null ? curDist.toFixed(1) : "—"}`,
        `refDist: ${refDist !== null ? refDist.toFixed(1) : "—"}`,
        `ratio: ${ratio !== null ? ratio.toFixed(3) : "—"}`,
        `radius: ${radius !== null ? radius.toFixed(1) : "—"}`,
        `extent: ${anchor.boundingRadiusRef.current.toFixed(1)}`,
        `anchor: ${live.kind === "node" ? `node ${live.id}` : live.kind}`,
        `candidate: ${candidateIdRef.current ?? "—"}`,
        `drive: ${drive ?? "none"}`,
        `fps: ${fps.toFixed(0)}`,
      ];
      el.textContent = lines.join("\n");
    }

    // The hand's highlight must not outlive the hand driving it: a reader
    // opening, hand control switching off, or Iris sleeping mid-point would
    // otherwise leave a node lit with nothing pointing at it. A live mouse
    // hover is untouched — repaintHighlight falls back to it.
    function clearHandTarget() {
      if (handTargetRef.current === null) return;
      handTargetRef.current = null;
      repaintHighlight();
    }

    function positionOf(id: string | null) {
      if (!id) return null;
      const node = positionsRef.current.get(id);
      if (!node || node.x === undefined) return null;
      return { x: node.x, y: node.y ?? 0, z: node.z ?? 0 };
    }

    // The candidate/anchor marks (design.md D10). The candidate is suppressed
    // when it IS the anchor: the pair answers "what would change if I grabbed
    // now", and two rings on one node answers nothing.
    function applyRings() {
      const rings = ringsRef.current;
      if (!rings) return;
      const live = anchor.anchorRef.current;
      const anchoredId = live.kind === "node" ? live.id : null;
      const candidateId = candidateIdRef.current === anchoredId ? null : candidateIdRef.current;
      rings.apply(positionOf(candidateId), positionOf(anchoredId));
    }

    function clearRings() {
      ringsRef.current?.apply(null, null);
    }

    function loop() {
      try {
        const now = performance.now();
        // One frame delta, read once: both the aim ease and the debug readout
        // need it, and a suspended frame (reader open) must not hand the ease a
        // multi-second step the moment the reader closes.
        const dt = now - lastFrameTime;
        lastFrameTime = now;
        const fg = fgRef.current;
        if (!fg || readerOpenRef.current) {
          restoreControlsIfNeeded(fg);
          cameraEngagedRef.current = null;
          clearHandTarget();
          // A reader holds the gesture surface, so nothing here can be acted
          // on — the marks go with it.
          clearRings();
          raf = requestAnimationFrame(loop);
          return;
        }

        const rect = containerRef.current?.getBoundingClientRect() ?? null;

        // Re-select what a grab would take hold of, rate-limited (design.md
        // D10) — this is the same O(nodes) projection the titles pay for, and
        // a candidate that changed at frame rate would both cost more than it
        // is worth and read as flicker.
        if (rect && now - lastCandidateSelect >= candidateIntervalMs) {
          lastCandidateSelect = now;
          const picked = pickAnchorAtCenter(
            positionsRef.current.values(),
            fg.camera(),
            rect,
            anchor.anchorRef.current,
            anchorThresholdPx,
          );
          candidateIdRef.current = picked.kind === "node" ? picked.id : null;
        }
        applyRings();

        const hand = handRef.current;
        const drive = driveFor(hand);
        // A lowered hand drives nothing (design.md D6). Collapsing the drive to
        // null here routes it through the existing "drive went null" path, so
        // the reference release, the control restore and the highlight clearing
        // all follow with no new code. Window pixels, because that is the space
        // `HandPoint` is already in.
        const lowered = isHandLowered(hand.point, window.innerHeight);
        const activeCameraDrive = !lowered && (drive === "orbit" || drive === "zoom") ? drive : null;

        // Which hand's point targets a node. The inspect drive uses the point of
        // the hand actually making the pose, not the primary hand's: the
        // primary is chosen with a preference for POINTING hands, so a Victory
        // hand can lose primacy while still being the hand the user is
        // inspecting with (design.md D4).
        const pointingAt =
          drive === "inspect" ? inspectingHand(hand)?.point ?? null : drive === "dwell" ? hand.point : null;

        // The galaxy owns the hand only where the galaxy is the top layer
        // (hud-panels-stay-hand-reachable-under-galaxy design.md D3). The HUD
        // chrome is painted above it and keeps its own dwell, so a finger aimed
        // at a task card must not also charge a node dwell on whatever node
        // projects behind that card, nor light its cluster.
        //
        // Only the POINTING drives yield. Orbit and zoom are read above and are
        // untouched: they act on the whole view rather than on a thing under
        // the finger, and a camera that stalled whenever the hand crossed a
        // panel would read as a worse fault than the one this fixes.
        const targetPoint =
          pointingAt && hudChromeAtPoint(pointingAt.x, pointingAt.y) ? null : pointingAt;

        // Only a pose that MEANS to point at something resolves a target
        // (design.md D3): the charging dwell, or the inspect pose. An earlier
        // pass resolved one under any non-camera pose, on the grounds that a
        // highlight is feedback rather than an action — in use that lit one
        // cluster after another as a hand drifted, which reads as the view
        // twitching at the hand rather than answering a question.
        //
        // The incumbent handed to nearestNodeAt is the currently-PAINTED target:
        // the dead-band exists to stop the highlight flickering between
        // neighbours in a dense cluster, so the thing it protects should be the
        // thing on screen.
        const candidate =
          targetPoint && rect
            ? nearestNodeAt(
                positionsRef.current.values(),
                fg.camera(),
                rect,
                targetPoint,
                dwellThresholdPx,
                handTargetRef.current,
              )
            : null;

        // Only the opening dwell has a machine: it is the one pose that commits
        // to something. Leaving the pose feeds it a null candidate, which
        // dwellStep resets on, so a charge is abandoned rather than carried into
        // a different pose.
        const openCandidate = drive === "dwell" ? candidate : null;
        const openResult = dwellStep(dwellStateRef.current, openCandidate, now, dwellHoldMs);
        dwellStateRef.current = openResult.state;

        const pointedAt = candidate?.id ?? null;
        if (pointedAt !== handTargetRef.current) {
          handTargetRef.current = pointedAt;
          repaintHighlight();
        }
        if (openResult.fire && openCandidate) {
          // Opening a note anchors on it, by dwell exactly as by click, so
          // closing the reader leaves the camera around that note's
          // neighbourhood rather than the middle of the vault (3.9). No drive
          // is engaged during a dwell, so the controls are enabled and the aim
          // eases onto it while the reader is open.
          anchor.setAnchor({ kind: "node", id: openCandidate.id });
          onOpenNoteRef.current(openCandidate.id, openCandidate.title);
        }

        // Camera drive: orbit and zoom share one spherical — re-derived from
        // the LIVE camera on every engage (fist<->zoom switch or mouse-drag
        // handoff, design.md M13), never carried over stale.
        if (activeCameraDrive !== cameraEngagedRef.current) {
          if (activeCameraDrive) {
            // Where the aim starts from, captured BEFORE the anchor moves, so
            // the displayed anchor has somewhere to ease from.
            anchor.displayedAnchorRef.current = anchor.resolveCurrent();
            // Each grab regrips on whatever the user is looking at. Nothing in
            // range keeps the current anchor — a grab over empty space must not
            // throw the view back to the middle of the vault.
            engageMovedAnchorRef.current = rect
              ? anchor.setAnchor(
                  pickAnchorAtCenter(
                    positionsRef.current.values(),
                    fg.camera(),
                    rect,
                    anchor.anchorRef.current,
                    anchorThresholdPx,
                  ),
                  // The drive's own per-frame write eases the aim; the mouse-path
                  // ease must not also run and fight it.
                  { ease: false },
                )
              : false;
            // Seeded from the LIVE camera against the TARGET anchor, and the
            // camera's position is never written — so "engaging never teleports"
            // is a property of the code's shape rather than a rule to remember
            // (design.md D4).
            const engageOrigin = anchor.resolveCurrent();
            sphericalRef.current = new THREE.Spherical().setFromVector3(
              fg
                .camera()
                .position.clone()
                .sub(new THREE.Vector3(engageOrigin.x, engageOrigin.y, engageOrigin.z)),
            );
            const engageDist = activeCameraDrive === "zoom" ? twoPalmDistance(hand) : null;
            zoomReferenceRef.current =
              engageDist !== null ? { dist: engageDist, radius: sphericalRef.current.radius } : null;
            // The wrist, not the fingertip (design note on
            // TrackedHand.wristPoint): the fingertip moves a long way purely
            // from curling/uncurling into a fist, which orbit's delta would
            // otherwise read as hand movement — exactly at the Closed_Fist
            // engage/release boundary, where that curl is happening.
            prevOrbitPointRef.current = activeCameraDrive === "orbit" ? hand.wristPoint : null;
          } else {
            zoomReferenceRef.current = null;
            prevOrbitPointRef.current = null;
          }
          cameraEngagedRef.current = activeCameraDrive;
        } else if (activeCameraDrive) {
          const origin = anchor.resolveCurrent();
          anchor.displayedAnchorRef.current = easeAnchor(anchor.displayedAnchorRef.current, origin, dt);

          if (activeCameraDrive === "orbit" && sphericalRef.current && prevOrbitPointRef.current && hand.wristPoint) {
            const delta = {
              x: hand.wristPoint.x - prevOrbitPointRef.current.x,
              y: hand.wristPoint.y - prevOrbitPointRef.current.y,
            };
            const next = orbitStep(sphericalRef.current, delta, orbitSensitivity);
            sphericalRef.current.set(next.radius, next.phi, next.theta);
            prevOrbitPointRef.current = hand.wristPoint;
            writeCameraFromSpherical(fg, origin);
          } else if (activeCameraDrive === "zoom" && sphericalRef.current && zoomReferenceRef.current) {
            // A dropout (one palm briefly not open_palm) has already released
            // the reference above on the frame `activeCameraDrive` goes null —
            // here `zoomReferenceRef.current` staying set means both palms are
            // still live, so `twoPalmDistance` cannot return null.
            const curDist = twoPalmDistance(hand)!;
            const next = zoomRadius({
              refRadius: zoomReferenceRef.current.radius,
              refDist: zoomReferenceRef.current.dist,
              curDist,
              min: zoomMinRadius,
              max: zoomMaxRadius,
            });
            sphericalRef.current.set(next, sphericalRef.current.phi, sphericalRef.current.theta);
            writeCameraFromSpherical(fg, origin);
            releaseAnchorIfBackedOut(fg, next, curDist);
          }
        }

        if (activeCameraDrive) {
          const controls = fg.controls() as unknown as TrackballControlsLike;
          if (controls.enabled) controls.enabled = false;
        } else {
          restoreControlsIfNeeded(fg);
        }

        if (debugEnabled) updateDebugReadout(hand, drive, dt);
      } catch (err) {
        // The error boundary does NOT catch rAF throws (design.md R6) — a
        // per-frame throw must force-close instead of throwing into the void
        // every frame with the click-through-disabled overlay left trapped.
        console.error("[second-brain-gesture-nav] gesture loop crashed, force-closing:", err);
        onForceCloseRef.current();
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    // Dollying far enough out frames the whole graph again, so the anchor goes
    // back to the centroid and closing the hands is the way back to the
    // overview (design.md D5).
    //
    // Re-seeding is not optional here: the orbit origin is about to move from
    // the node to the centroid, and a spherical still measured against the node
    // would shift the camera by exactly that delta on the next frame. The
    // zoom's reference is re-seeded from the SAME frame's hand distance so the
    // multiplicative law is continuous across the release — the hands have not
    // moved, so the radius must not either.
    function releaseAnchorIfBackedOut(fg: Fg, radius: number, curDist: number) {
      if (anchor.anchorRef.current.kind === "centroid") return;
      if (!shouldReleaseAnchor(radius, anchor.boundingRadiusRef.current, zoomMaxRadius)) return;
      if (!anchor.setAnchor(CENTROID_ANCHOR, { ease: false })) return;
      engageMovedAnchorRef.current = true;
      const origin = anchor.resolveCurrent();
      anchor.displayedAnchorRef.current = origin;
      sphericalRef.current = new THREE.Spherical().setFromVector3(
        fg.camera().position.clone().sub(new THREE.Vector3(origin.x, origin.y, origin.z)),
      );
      zoomReferenceRef.current = { dist: curDist, radius: sphericalRef.current.radius };
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      restoreControlsIfNeeded(fgRef.current);
      clearHandTarget();
      clearRings();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handControl, running]);
}

// Re-exported so the component can name the type it stores without reaching
// past this hook for it.
export type { GalaxyAnchor };
