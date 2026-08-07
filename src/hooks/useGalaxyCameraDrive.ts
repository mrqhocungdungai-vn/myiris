import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { GalaxyNode, GalaxyLink, TrackballControlsLike } from "../lib/galaxy-types";
import type { HandState } from "./useHandControl";
import {
  dwellStep,
  driveFor,
  easeRadius,
  inspectingHand,
  isHandLowered,
  sightPoint,
  zoomRadius,
  handDistance,
  nearestNodeAt,
  MIN_ZOOM_HAND_DISTANCE_PX,
  INITIAL_DWELL_STATE,
  type DwellState,
  type GalaxyDrive,
} from "../lib/galaxy-nav";
import {
  CENTROID_ANCHOR,
  easeAnchor,
  pickZoomTarget,
  rectCentre,
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
  /** The sight, positioned and class-toggled directly rather than through React state — it moves every frame, which no re-render could afford. */
  reticleRef: { current: HTMLDivElement | null };
  debugEnabled: boolean;
  debugRef: { current: HTMLPreElement | null };
  /** Tuning constants, owned by the component alongside the galaxy's other ones. */
  dwellThresholdPx: number;
  dwellHoldMs: number;
  anchorThresholdPx: number;
  pivotRetargetDeadBandPx: number;
  candidateIntervalMs: number;
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
  reticleRef,
  debugEnabled,
  debugRef,
  dwellThresholdPx,
  dwellHoldMs,
  anchorThresholdPx,
  pivotRetargetDeadBandPx,
  candidateIntervalMs,
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
  const cameraEngagedRef = useRef<"zoom" | null>(null);
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
  // The same rate-limited pick above, kept whole rather than reduced to an id
  // — this is what the live zoom re-aim reads (manual-pass finding after
  // 8.7/9.8: moving the sight during a zoom felt laggy because the re-aim was
  // recomputing its own pick every frame, up to 6x the ring's own cadence, so
  // the dolly's reference reset far more often than what was even visible on
  // screen). One evaluation, one cadence, read by both.
  const pivotPickRef = useRef<GalaxyAnchor | null>(null);
  // The sight position the last COMMITTED live-zoom retarget was computed
  // from. Gates whether a throttled pick reaches `pivotPickRef` (the camera)
  // at all — it does NOT gate the ring's own `candidateIdRef`, which stays
  // immediate/honest feedback regardless (design.md D19). A node graze is
  // not exempt: `nearestNodeAt`'s own dead-band only breaks a tie between
  // near-equal candidates, it says nothing about whether the SIGHT has
  // actually travelled far enough to justify retargeting an already-live
  // zoom, and neither does a point's lack of an id — both need this gate.
  const lastPivotSightRef = useRef<{ x: number; y: number } | null>(null);

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
      // The un-eased target `zoomRadius` would ask for right now, alongside
      // the actual (eased) radius above — the gap between the two is exactly
      // what `easeRadius` is closing, and a tuning pass needs to see it
      // (design.md D19).
      const target =
        curDist !== null && ref
          ? zoomRadius({ refRadius: ref.radius, refDist: ref.dist, curDist, min: zoomMinRadius, max: zoomMaxRadius })
          : null;
      const live = anchor.anchorRef.current;
      const lines = [
        `hands: ${hand.hands.length}`,
        ...hand.hands.map((item) => `  ${item.id}: ${item.gesture}`),
        `curDist: ${curDist !== null ? curDist.toFixed(1) : "—"}`,
        `refDist: ${refDist !== null ? refDist.toFixed(1) : "—"}`,
        `ratio: ${ratio !== null ? ratio.toFixed(3) : "—"}`,
        `radius: ${radius !== null ? radius.toFixed(1) : "—"}`,
        `target: ${target !== null ? target.toFixed(1) : "—"}`,
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

    // The candidate/anchor marks (design.md D10). Two suppressions, each
    // answering the same question — "does this mark tell the user something
    // they can act on right now?":
    //
    // - the candidate is dropped when it IS the anchor, since two rings on one
    //   node say nothing about what would change;
    // - and dropped again while a drive is ENGAGED (tasks.md 6.5, resolved from
    //   the manual pass), because the candidate cannot change while the drive
    //   holds the camera, so a ring for it would mark a choice that is no
    //   longer available. The heavier engaged ring takes its place, which is
    //   what makes a grab visibly catch.
    function applyRings(engaged: boolean) {
      const rings = ringsRef.current;
      if (!rings) return;
      const live = anchor.anchorRef.current;
      const anchoredId = live.kind === "node" ? live.id : null;
      const candidateId = engaged || candidateIdRef.current === anchoredId ? null : candidateIdRef.current;
      rings.apply(positionOf(candidateId), positionOf(anchoredId), engaged);
    }

    function clearRings() {
      ringsRef.current?.apply(null, null, false);
      setReticleEngaged(false);
    }

    // Direct class write, never React state — the same reason the debug readout
    // writes `textContent` (design.md D7/M-A1): a drive engaging must not turn
    // this loop into a re-render.
    function setReticleEngaged(engaged: boolean) {
      reticleRef.current?.classList.toggle("engaged", engaged);
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
        const hand = handRef.current;

        // Where the camera is AIMED, in window pixels: the midpoint of two open
        // palms, else the primary hand's point, else the centre of the view
        // (design.md D14). It follows the hands rather than sitting at screen
        // centre, because a centre-pinned sight can only be aimed by first
        // flying the camera until the target is in the middle — the hardest part
        // of the task, demanded before the easy part is allowed to start.
        const sight = rect ? sightPoint(hand, rectCentre(rect)) : null;
        if (sight && reticleRef.current) {
          reticleRef.current.style.transform = `translate3d(${sight.x}px, ${sight.y}px, 0) translate(-50%, -50%)`;
        }

        // Re-select what a grab would take hold of, rate-limited (design.md
        // D10) — this is the same O(nodes) projection the titles pay for, and
        // a candidate that changed at frame rate would both cost more than it
        // is worth and read as flicker. `candidateIdRef` (the ring) always
        // takes this fresh, throttled pick — it is pure visual feedback and
        // camera-inert, so there is no reason to gate it further.
        //
        // `pickZoomTarget` — ALWAYS a note, never a point in space (design.md
        // D20). The point pivot this used to derive from the sight ray is gone
        // with it, and so is the whole self-chasing feedback loop D14/D18 kept
        // fighting: a note is a fixed thing in the world, so re-targeting
        // between notes is stable in a way a re-derived point never was.
        if (rect && sight && now - lastCandidateSelect >= candidateIntervalMs) {
          lastCandidateSelect = now;
          const picked = pickZoomTarget(
            positionsRef.current.values(),
            fg.camera(),
            rect,
            sight,
            anchor.anchorRef.current,
            anchorThresholdPx,
          );
          candidateIdRef.current = picked.kind === "node" ? picked.id : null;
          // `pivotPickRef` — what the LIVE ZOOM actually reads — commits only
          // once the sight has moved past the dead-band since the last commit
          // (design.md D19). Applies to a node result too, not only a point:
          // `nearestNodeAt`'s incumbent dead-band answers "which of two nearby
          // candidates" and a node has no analogue of "did the sight travel
          // far enough to retarget a live drive" at all — so a sight merely
          // grazing ANY node's 130px capture radius for one tick, without the
          // hand meaningfully moving, used to commit unconditionally and
          // reseed the zoom reference on the strength of that graze alone
          // (the regression this fixes). A point pivot additionally has no id
          // for "did this change" to even ask about — the gate is what makes
          // that question answerable for either kind.
          const last = lastPivotSightRef.current;
          const movedEnough = !last || Math.hypot(sight.x - last.x, sight.y - last.y) >= pivotRetargetDeadBandPx;
          if (movedEnough) {
            pivotPickRef.current = picked;
            lastPivotSightRef.current = sight;
          }
        }

        const drive = driveFor(hand);
        // A lowered hand drives nothing (design.md D6). Collapsing the drive to
        // null here routes it through the existing "drive went null" path, so
        // the reference release, the control restore and the highlight clearing
        // all follow with no new code. Window pixels, because that is the space
        // `HandPoint` is already in.
        const lowered = isHandLowered(hand.point, window.innerHeight);
        const activeCameraDrive = !lowered && drive === "zoom" ? drive : null;
        applyRings(activeCameraDrive !== null);
        setReticleEngaged(activeCameraDrive !== null);

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
            // Each grab regrips on the NOTE nearest the sight (design.md
            // D20) — the target is always a note, because "get me to that
            // note" is the only thing this drive exists to do. Nothing in
            // range keeps the current anchor, so a grab over empty space
            // neither throws the view back to the middle of the vault nor
            // sends it chasing some distant note the user never aimed at.
            engageMovedAnchorRef.current =
              rect && sight
                ? anchor.setAnchor(
                  pickZoomTarget(
                    positionsRef.current.values(),
                    fg.camera(),
                    rect,
                    sight,
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
            const engageDist = twoPalmDistance(hand);
            zoomReferenceRef.current =
              engageDist !== null ? { dist: engageDist, radius: sphericalRef.current.radius } : null;
          } else {
            zoomReferenceRef.current = null;
          }
          cameraEngagedRef.current = activeCameraDrive;
        } else if (activeCameraDrive) {
          const origin = anchor.resolveCurrent();
          anchor.displayedAnchorRef.current = easeAnchor(anchor.displayedAnchorRef.current, origin, dt);

          if (sphericalRef.current && zoomReferenceRef.current) {
            // A dropout (one palm briefly not open_palm) has already released
            // the reference above on the frame `activeCameraDrive` goes null —
            // here `zoomReferenceRef.current` staying set means both palms are
            // still live, so `twoPalmDistance` cannot return null.
            const curDist = twoPalmDistance(hand)!;
            // Re-aim FIRST, so this frame's radius is measured against the
            // anchor the sight is on right now — and re-read the origin after
            // it. `origin` above was resolved before the re-aim, and writing the
            // camera with it while the spherical has been re-seeded against the
            // new anchor would displace the camera by exactly the anchor delta:
            // the same trap D3 records for sharing one value between the orbit
            // origin and the look-at.
            // Backed out to the overview? Then stop retargeting for the rest
            // of the drive (design.md D21). `releaseAnchorIfBackedOut` hands
            // the anchor back to the centroid so pinching the hands shut is
            // the way out to the whole graph — but with the target now ALWAYS
            // a note, the very next throttled pick would immediately re-anchor
            // on one and cancel that. The release has to win, or "close your
            // hands to see everything again" silently stops working.
            const backedOut = shouldReleaseAnchor(
              sphericalRef.current.radius,
              anchor.boundingRadiusRef.current,
              zoomMaxRadius,
            );
            if (!backedOut && pivotPickRef.current) reaimZoomFromSight(fg, pivotPickRef.current, curDist);
            const zoomOrigin = anchor.resolveCurrent();
            const target = zoomRadius({
              refRadius: zoomReferenceRef.current.radius,
              refDist: zoomReferenceRef.current.dist,
              curDist,
              min: zoomMinRadius,
              max: zoomMaxRadius,
            });
            // `zoomRadius` is a memoryless ratio law: it maps THIS frame's raw
            // two-palm distance straight to an absolute radius, so any
            // tracking noise in that distance reaches the output with full
            // gain, every single frame — unlike the fist orbit that used to
            // live here, which only nudged an accumulated angle by a small
            // bounded increment regardless of how noisy the instantaneous
            // delta was (that drive is gone as of D20, but the asymmetry is
            // why this one needed damping). `easeRadius` gives the
            // DISPLAYED radius the same kind of memory `easeAnchor` already
            // gives the look-at point: it glides toward the target rather than
            // snapping to it, so one noisy frame moves the camera only a
            // little instead of replacing its distance outright (design.md
            // D19).
            const next = easeRadius(sphericalRef.current.radius, target, dt);
            sphericalRef.current.set(next, sphericalRef.current.phi, sphericalRef.current.theta);
            writeCameraFromSpherical(fg, zoomOrigin);
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

    // Moving the anchor MID-DRIVE has to hold the camera still, exactly as
    // engaging does — the spherical is measured against the old anchor, so
    // leaving it would shift the camera by the anchor delta on the next frame.
    // The zoom's reference moves with it, from the SAME frame's hand distance,
    // so the multiplicative law is continuous across the change: the hands have
    // not moved, so the radius must not either.
    function reseedAroundAnchor(fg: Fg, curDist: number | null) {
      engageMovedAnchorRef.current = true;
      const origin = anchor.resolveCurrent();
      sphericalRef.current = new THREE.Spherical().setFromVector3(
        fg.camera().position.clone().sub(new THREE.Vector3(origin.x, origin.y, origin.z)),
      );
      if (curDist === null) return;
      const previous = zoomReferenceRef.current;
      const radiusNow = sphericalRef.current.radius;
      if (!previous) {
        zoomReferenceRef.current = { dist: curDist, radius: radiusNow };
        return;
      }
      // Keep `dist` FIXED and rescale `radius` instead (design.md D21). Both
      // forms hold the camera still across the reseed, but re-pinning `dist`
      // to whatever the hands happen to be at right now silently rewrites the
      // gesture's own mapping mid-stroke: the spread already spent stops
      // counting, so the remaining travel collapses and the hands have to be
      // re-spread from scratch to go any further. That is the "I keep
      // spreading and nothing happens" report, and it got worse the more
      // often retargeting reseeded. Solving for the radius that reproduces
      // `radiusNow` under the UNCHANGED `dist` keeps hand-spread -> distance
      // fixed for the whole drive.
      const flooredPrev = Math.max(MIN_ZOOM_HAND_DISTANCE_PX, previous.dist);
      const flooredCur = Math.max(MIN_ZOOM_HAND_DISTANCE_PX, curDist);
      zoomReferenceRef.current = { dist: previous.dist, radius: (radiusNow * flooredCur) / flooredPrev };
    }

    // The sight keeps aiming for the whole of a zoom (design.md D14). This is
    // the substance of "wherever the sight is, spreading the hands goes there":
    // resolving only at engage would mean the user had to have the region under
    // their hands before the pose registered, which is the same
    // aim-before-you-may-act demand a centre-pinned sight made.
    //
    // Safe to do continuously HERE and not on the orbit, because the zoom's
    // input is the distance between the hands — their midpoint stays put while
    // they spread. An orbit's input IS the hand's travel, so a sight read from
    // it would re-aim on every frame of the motion that is meant to be turning
    // the camera.
    //
    // Reads `pivotPickRef` — the SAME throttled pick the candidate ring shows
    // — rather than picking again here. It used to pick fresh every frame via
    // `pickAnchorAt` (nodes only), which reset the dolly's reference up to 6x
    // more often than the ring's own 100ms cadence, so moving the sight while
    // zooming stalled the dolly far more than the visible candidate ever
    // suggested it would (design.md D17).
    //
    // Points, not just nodes, since D18: restricting the live re-aim to nodes
    // meant that over empty space the engage-time pivot stood for the WHOLE
    // drive (D15) — correct for a one-shot engage, but it meant moving the
    // sight to a different empty-space target mid-zoom never followed there at
    // all, only a node re-anchor did. A point pivot is derived by crossing the
    // sight ray with the plane at the current working depth, and doing that
    // every FRAME while the camera eases its aim onto the previous pivot is
    // what D14 correctly ruled out — the ray and the pivot it produces would
    // chase each other. Doing it on the ring's throttled cadence instead keeps
    // the same protection without giving up empty-space targets entirely.
    //
    // The movement gate on `pivotPickRef` (design.md D19) is what stops a
    // brief graze near ANY node, or ordinary jitter over empty space, from
    // committing a retarget on the strength of proximity alone — it applies
    // uniformly to both kinds now, not just points, since a node's own
    // dead-band never asked "has the sight travelled far enough to justify
    // retargeting an already-LIVE drive" in the first place.
    function reaimZoomFromSight(fg: Fg, picked: GalaxyAnchor, curDist: number) {
      if (!anchor.setAnchor(picked, { ease: false })) return;
      reseedAroundAnchor(fg, curDist);
    }

    // Dollying far enough out frames the whole graph again, so the anchor goes
    // back to the centroid and closing the hands is the way back to the
    // overview (design.md D5).
    function releaseAnchorIfBackedOut(fg: Fg, radius: number, curDist: number) {
      if (anchor.anchorRef.current.kind === "centroid") return;
      if (!shouldReleaseAnchor(radius, anchor.boundingRadiusRef.current, zoomMaxRadius)) return;
      if (!anchor.setAnchor(CENTROID_ANCHOR, { ease: false })) return;
      anchor.displayedAnchorRef.current = anchor.resolveCurrent();
      reseedAroundAnchor(fg, curDist);
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
