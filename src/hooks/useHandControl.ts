import { useEffect, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { semanticEquals } from "../lib/hand";

export type HandPoint = { x: number; y: number };
export type HandLandmark = { x: number; y: number };

export type TrackedHand = {
  id: string;
  point: HandPoint;
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
  gesture: string;
  gestureScore: number;
  pointing: boolean;
  openPalm: boolean;
  fist: boolean;
  pinchDistance: number;
  hands: TrackedHand[];
};

// Keep this version in sync with the @mediapipe/tasks-vision version in
// package.json to avoid runtime/ABI mismatches between the JS API and the WASM.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

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

    let smooth: HandPoint | null = null;
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

        if (landmarks.length > 0) {
          const detected = landmarks.slice(0, 2).map((hand, index) => {
            const topGesture = gestures[index]?.[0];
            const score = topGesture?.score ?? 0;
            const rawGesture = score >= 0.55 ? topGesture?.categoryName ?? "None" : "None";
            const indexTip = hand[8];
            const thumbTip = hand[4];
            const mirroredX = 1 - indexTip.x;
            const point = {
              x: remapToScreen(mirroredX, INPUT_RANGE.xMin, INPUT_RANGE.xMax, window.innerWidth),
              y: remapToScreen(indexTip.y, INPUT_RANGE.yMin, INPUT_RANGE.yMax, window.innerHeight),
            };
            const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
            return {
              rawGesture,
              score,
              point,
              landmarks: hand.map((landmark) => ({ x: 1 - landmark.x, y: landmark.y })),
              pinchDistance,
            };
          });

          const byX = [...detected].sort((a, b) => a.point.x - b.point.x);
          const hands: TrackedHand[] = detected.map((hand) => {
            const id = detected.length === 1 ? "single" : hand === byX[0] ? "left" : "right";
            const gesture = stabilizeGesture(id, hand.rawGesture);
            return {
              id,
              point: hand.point,
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
          smooth = smooth
            ? {
                x: smooth.x + (primary.point.x - smooth.x) * 0.5,
                y: smooth.y + (primary.point.y - smooth.y) * 0.5,
              }
            : primary.point;
          primaryPoint = smooth;
          hadHand = true;

          publish({
            active: true,
            present: true,
            point: smooth,
            gesture: primary.gesture,
            gestureScore: primary.gestureScore,
            pointing: primary.pointing,
            openPalm: primary.openPalm,
            fist: primary.fist,
            pinchDistance: primary.pinchDistance,
            hands: hands.map((item) => (item === primary ? { ...item, point: smooth! } : item)),
          });
        } else if (hadHand) {
          // Only re-publish the empty state on the transition into "no
          // hand" — an empty frame after another empty frame does zero work.
          smooth = null;
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
