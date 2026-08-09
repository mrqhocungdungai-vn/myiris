import { useEffect, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { handIdentity, semanticEquals, smoothPoint } from "../lib/hand";
import { resolveVendoredAssetUrl } from "../lib/asset-url";

export type HandPoint = { x: number; y: number };
export type HandLandmark = { x: number; y: number };

export type TrackedHand = {
  id: string;
  point: HandPoint;
  /**
   * The wrist landmark (0), screen-remapped and smoothed the same way as
   * `point` (the index fingertip, landmark 8) but tracked separately
   * (add-galaxy-node-labels manual pass / gesture-nav follow-up): the
   * fingertip moves a large distance purely from curling/uncurling a finger
   * — exactly what happens crossing the Closed_Fist <-> Open_Palm boundary —
   * even when the hand hasn't translated at all. A drive that measures
   * frame-to-frame MOVEMENT (the galaxy's fist-orbit) needs a landmark whose
   * position doesn't depend on which pose the hand is making; the wrist is
   * that landmark, `point` is not.
   */
  wristPoint: HandPoint;
  landmarks: HandLandmark[];
  gesture: string;
  gestureScore: number;
  pointing: boolean;
  openPalm: boolean;
  fist: boolean;
  /** Normalized thumb-tip-to-index-tip distance (landmarks 4/8); smaller = tighter pinch. */
  pinchDistance: number;
};

export type HandState = {
  active: boolean;
  present: boolean;
  point: HandPoint | null;
  /** The primary hand's `wristPoint` — see `TrackedHand.wristPoint`. */
  wristPoint: HandPoint | null;
  gesture: string;
  gestureScore: number;
  pointing: boolean;
  openPalm: boolean;
  fist: boolean;
  pinchDistance: number;
  hands: TrackedHand[];
};

// Vendored under public/runtime/mediapipe/ by scripts/vendor-runtime-assets.mjs
// (renderer-content-security: no runtime-fetched script/WASM glue) — the JS
// glue is copied straight from the installed @mediapipe/tasks-vision version,
// so it can't drift from package.json the way a hand-copied CDN URL could.
//
// Pre-resolved against document.baseURI (design D4/D7), matching
// useWakeWord's onnxruntime-web path: MediaPipe loads its glue via a
// `<script src>`, which already resolves against the document, so this isn't
// fixing a break here — it's making every vendored runtime obey one rule
// rather than relying on a loading-mechanism detail that isn't visible at
// this call site. Output-identical to the previous relative strings in both
// environments (verified by task 3.2).
const WASM_URL = resolveVendoredAssetUrl("runtime/mediapipe", import.meta.env.BASE_URL, document.baseURI);
const MODEL_URL = resolveVendoredAssetUrl(
  "runtime/mediapipe/gesture_recognizer.task",
  import.meta.env.BASE_URL,
  document.baseURI,
);

// Camera coordinates rarely use the full 0..1 range in practice. Expand the
// useful center region to the full screen so reaching UI edges doesn't require
// moving your hand to the physical edge of the camera frame.
const INPUT_RANGE = {
  xMin: 0.18,
  xMax: 0.82,
  yMin: 0.12,
  yMax: 0.82,
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function remapToScreen(value: number, min: number, max: number, size: number) {
  return clamp01((value - min) / (max - min)) * size;
}

const EMPTY_STATE: HandState = {
  active: false,
  present: false,
  point: null,
  wristPoint: null,
  gesture: "None",
  gestureScore: 0,
  pointing: false,
  openPalm: false,
  fist: false,
  pinchDistance: 0,
  hands: [],
};

/**
 * Camera hand tracking powered by MediaPipe GestureRecognizer.
 *
 * We rely on the edge ML model's canned classes instead of hand-written angle
 * heuristics. Supported classes include Closed_Fist, Open_Palm, Pointing_Up,
 * Thumb_Up, Thumb_Down, Victory, ILoveYou, and None.
 */
export const SYSTEM_DEFAULT_CAMERA = "default";

// EMA smoothing factor (two-hand-gestures) — the value the primary hand's
// point already used before every tracked hand was smoothed alike.
const SMOOTHING_ALPHA = 0.5;

function videoConstraintsFor(deviceId: string): MediaTrackConstraints {
  if (!deviceId || deviceId === SYSTEM_DEFAULT_CAMERA) {
    return { width: 640, height: 480, facingMode: "user" };
  }
  return { width: 640, height: 480, deviceId: { exact: deviceId } };
}

export function useHandControl(enabled: boolean, deviceId: string = SYSTEM_DEFAULT_CAMERA) {
  const [state, setState] = useState<HandState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Every-frame hand data (point, landmarks, pinchDistance) lives here for
  // imperative readers (rAF loops, direct DOM writes); `state` above is
  // published only when a semantic field changes, so it never drives a
  // 60fps React re-render (BUG F).
  const stateRef = useRef<HandState>(EMPTY_STATE);

  useEffect(() => {
    if (!enabled) {
      stateRef.current = EMPTY_STATE;
      setState(EMPTY_STATE);
      setStream(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let recognizer: GestureRecognizer | null = null;
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;

    // Per-hand smoothing history, keyed by the same id stabilizeGesture uses
    // (two-hand-gestures) — a relation between two hands (e.g. the galaxy's
    // zoom distance) must not mix a filtered primary point with a raw
    // secondary one, so every hand is smoothed independently.
    const smoothById = new Map<string, HandPoint>();
    // Separate smoothing history for `wristPoint` — mixing it with `point`'s
    // would smooth two landmarks moving at different rates through one EMA.
    const smoothWristById = new Map<string, HandPoint>();
    let primaryId = "";
    let primaryPoint: HandPoint | null = null;
    const stableGestureById = new Map<string, string>();
    const candidateGestureById = new Map<string, string>();
    const candidateFramesById = new Map<string, number>();
    let published = EMPTY_STATE;
    let hadHand = false;

    function publish(next: HandState) {
      stateRef.current = next;
      if (!semanticEquals(next, published)) {
        published = next;
        setState(next);
      }
    }

    async function setup() {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        recognizer = await GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          cannedGesturesClassifierOptions: {
            scoreThreshold: 0.55,
          },
        });

        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraintsFor(deviceId),
        });
        video.srcObject = stream;
        await video.play();

        if (cancelled) return;
        setStream(stream);
        setError(null);
        publish({ ...EMPTY_STATE, active: true });
        loop();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    function stabilizeGesture(id: string, rawGesture: string) {
      const candidateGesture = candidateGestureById.get(id) ?? "None";
      const candidateFrames = candidateFramesById.get(id) ?? 0;
      if (rawGesture === candidateGesture) {
        candidateFramesById.set(id, Math.min(candidateFrames + 1, 8));
      } else {
        candidateGestureById.set(id, rawGesture);
        candidateFramesById.set(id, 1);
      }
      if ((candidateFramesById.get(id) ?? 0) >= 3) {
        stableGestureById.set(id, rawGesture);
      }
      return stableGestureById.get(id) ?? "None";
    }

    function nearestTo(point: HandPoint, hands: TrackedHand[]) {
      return hands.reduce((best, hand) => {
        const bestDistance = Math.hypot(best.point.x - point.x, best.point.y - point.y);
        const handDistance = Math.hypot(hand.point.x - point.x, hand.point.y - point.y);
        return handDistance < bestDistance ? hand : best;
      }, hands[0]);
    }

    function choosePrimary(hands: TrackedHand[]) {
      const pointingHands = hands.filter((hand) => hand.pointing);
      const previous = hands.find((hand) => hand.id === primaryId);

      // If only one hand is intentionally pointing, switch to it immediately.
      // This fixes the "wrong hand stays primary" issue when both hands are visible.
      if (pointingHands.length === 1) return pointingHands[0];

      // If both point, avoid flicker by keeping the existing primary if possible.
      if (pointingHands.length > 1) {
        const previousPointing = pointingHands.find((hand) => hand.id === primaryId);
        if (previousPointing) return previousPointing;
        if (primaryPoint) return nearestTo(primaryPoint, pointingHands);
        return pointingHands[0];
      }

      // No pointing hand: preserve continuity for scroll/resize/read states.
      if (previous) return previous;
      if (primaryPoint) return nearestTo(primaryPoint, hands);
      return hands[0];
    }

    function loop() {
      if (cancelled || !recognizer) return;
      if (video.readyState >= 2) {
        const now = performance.now();
        const result = recognizer.recognizeForVideo(video, now);
        const landmarks = result.landmarks ?? [];
        const gestures = result.gestures ?? [];
        // Which physical hand this is. Every per-hand memory — the point EMA,
        // the wrist EMA, the 3-frame gesture stabilizer — is keyed by it, so
        // an identity that changes for any reason other than the hand changing
        // makes one hand inherit another's past.
        const handedness = result.handedness ?? [];

        if (landmarks.length > 0) {
          const detected = landmarks.slice(0, 2).map((hand, index) => {
            const topGesture = gestures[index]?.[0];
            const score = topGesture?.score ?? 0;
            const rawGesture = score >= 0.55 ? topGesture?.categoryName ?? "None" : "None";
            const indexTip = hand[8];
            const thumbTip = hand[4];
            const wrist = hand[0];
            const mirroredX = 1 - indexTip.x;
            const point = {
              x: remapToScreen(mirroredX, INPUT_RANGE.xMin, INPUT_RANGE.xMax, window.innerWidth),
              y: remapToScreen(indexTip.y, INPUT_RANGE.yMin, INPUT_RANGE.yMax, window.innerHeight),
            };
            // Same remap as `point`, but from the wrist (landmark 0) instead
            // of the index fingertip — see TrackedHand.wristPoint.
            const wristMirroredX = 1 - wrist.x;
            const wristPoint = {
              x: remapToScreen(wristMirroredX, INPUT_RANGE.xMin, INPUT_RANGE.xMax, window.innerWidth),
              y: remapToScreen(wrist.y, INPUT_RANGE.yMin, INPUT_RANGE.yMax, window.innerHeight),
            };
            const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
            // MediaPipe's own per-hand label, which does not change when the
            // number of hands does. Prefixed so it can never collide with the
            // positional fallback used when the model gives no label.
            const label = handedness[index]?.[0]?.categoryName;
            return {
              handLabel: label ? `hand:${label}` : null,
              rawGesture,
              score,
              point,
              wristPoint,
              landmarks: hand.map((landmark) => ({ x: 1 - landmark.x, y: landmark.y })),
              pinchDistance,
            };
          });

          const byX = [...detected].sort((a, b) => a.point.x - b.point.x);
          // Drop the memory of hands that are not in frame. Stable identities
          // fix the renaming, but not a hand that leaves, moves, and returns
          // under the same true name — its stored point would be wherever it
          // was seconds ago, and the EMA would drag the camera there. A hand
          // that reappears is treated exactly like one that appears.
          const liveIds = new Set(
            detected.map((hand) => handIdentity(hand.handLabel, hand === byX[0])),
          );
          for (const memory of [smoothById, smoothWristById, stableGestureById, candidateGestureById, candidateFramesById]) {
            for (const key of [...memory.keys()]) if (!liveIds.has(key)) memory.delete(key);
          }
          const hands: TrackedHand[] = detected.map((hand) => {
            // Keyed on HANDEDNESS, not on how many hands are in frame.
            //
            // It used to be `"single"` for one hand and `"left"`/`"right"` for
            // two. So raising a second hand renamed the first one, and every
            // memory keyed to it was looked up under the new name — where a
            // PREVIOUS two-hand session's values were still sitting, since
            // nothing pruned them. The point jumped to wherever that hand had
            // been the last time two were up, and the gesture stabilizer
            // returned that session's pose until three frames corrected it.
            //
            // That transition is intrinsic to reeling in: you must aim with
            // ONE open palm to lock a note, then add the second hand. It is
            // only incidental to the two-palm zoom, which is usually raised
            // from nothing — which is why that one was reported as fine.
            const id = handIdentity(hand.handLabel, hand === byX[0]);
            const gesture = stabilizeGesture(id, hand.rawGesture);
            const smoothed = smoothPoint(smoothById.get(id) ?? null, hand.point, SMOOTHING_ALPHA);
            smoothById.set(id, smoothed);
            const smoothedWrist = smoothPoint(smoothWristById.get(id) ?? null, hand.wristPoint, SMOOTHING_ALPHA);
            smoothWristById.set(id, smoothedWrist);
            return {
              id,
              point: smoothed,
              wristPoint: smoothedWrist,
              landmarks: hand.landmarks,
              gesture,
              gestureScore: hand.score,
              pointing: gesture === "Pointing_Up",
              openPalm: gesture === "Open_Palm",
              fist: gesture === "Closed_Fist",
              pinchDistance: hand.pinchDistance,
            };
          });

          const primary = choosePrimary(hands);
          primaryId = primary.id;
          primaryPoint = primary.point;
          hadHand = true;

          publish({
            active: true,
            present: true,
            point: primary.point,
            wristPoint: primary.wristPoint,
            gesture: primary.gesture,
            gestureScore: primary.gestureScore,
            pointing: primary.pointing,
            openPalm: primary.openPalm,
            fist: primary.fist,
            pinchDistance: primary.pinchDistance,
            hands,
          });
        } else if (hadHand) {
          // Only re-publish the empty state on the transition into "no
          // hand" — an empty frame after another empty frame does zero work.
          smoothById.clear();
          smoothWristById.clear();
          primaryId = "";
          primaryPoint = null;
          stableGestureById.clear();
          candidateGestureById.clear();
          candidateFramesById.clear();
          hadHand = false;
          publish({ ...EMPTY_STATE, active: true });
        }
      }
      raf = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      recognizer?.close();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      setStream(null);
    };
  }, [enabled, deviceId]);

  return { state, stateRef, error, stream };
}
