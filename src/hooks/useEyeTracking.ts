import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { irisCenter, irisRadius, presenceEquals } from "../lib/eye";
import { smoothPoint } from "../lib/hand";
import { resolveVendoredAssetUrl } from "../lib/asset-url";

export type EyePoint = { x: number; y: number };

export type TrackedEye = {
  /**
   * MediaPipe's own **anatomical** label for the iris this came from — the
   * subject's left or right eye, not a side of the screen. The preview is
   * mirrored (`.camera-frame video { transform: scaleX(-1) }`) and these
   * coordinates are mirrored to match, so the two vocabularies read opposite:
   * the anatomically-`left` eye is the one that appears on the **left** of the
   * displayed frame, and `right` appears on the right. See EYE_RING /
   * EYE_READOUT below for the assignment that depends on this.
   */
  id: "left" | "right";
  /** Mirrored, frame-normalized iris center — (0,0) is the frame's top-left as displayed. */
  center: EyePoint;
  /** Iris radius in units of the frame's WIDTH (lib/eye.ts's irisRadius). */
  radius: number;
};

export type EyeState = {
  active: boolean;
  present: boolean;
  /**
   * `performance.now()` of the frame this face was acquired on — the clock the
   * acquire animation eases against (design D8). Only rewritten on the
   * absent → present transition, so it survives the whole time a face is held.
   */
  acquiredAt: number;
  eyes: TrackedEye[];
};

// Same vendoring rule as useHandControl's model/WASM URLs
// (renderer-content-security): downloaded once by
// scripts/vendor-runtime-assets.mjs, never fetched by the renderer at runtime,
// and pre-resolved against document.baseURI so the path can't depend on which
// chunk happens to load it.
const WASM_URL = resolveVendoredAssetUrl("runtime/mediapipe", import.meta.env.BASE_URL, document.baseURI);
const MODEL_URL = resolveVendoredAssetUrl(
  "runtime/mediapipe/face_landmarker.task",
  import.meta.env.BASE_URL,
  document.baseURI,
);

// Iris boundary rings in the 478-point refined face mesh, read off the
// installed package's own FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS /
// _RIGHT_IRIS connection lists rather than from memory (task 2.3). The center
// landmarks (473 / 468) exist too but go unused — lib/eye.ts takes the ring's
// centroid instead, which is steadier.
const LEFT_IRIS_RING = [474, 475, 476, 477];
const RIGHT_IRIS_RING = [469, 470, 471, 472];

/**
 * The fixed eye-to-element assignment, as indices into `EyeState.eyes`
 * (spec: "Which eye drives which element SHALL be fixed and consistent").
 * The array is built in one hardcoded order below and never sorted, so this
 * cannot drift frame-to-frame.
 *
 * In on-screen terms — which is how anyone verifying this reads it, and the
 * vocabulary the spec requires alongside the landmark one: **the ring sits on
 * the RIGHT of the displayed frame and the readout panel on its LEFT.** The
 * preview is mirrored, so the frame's right is the subject's own right eye.
 */
export const EYE_READOUT = 0;
export const EYE_RING = 1;

// Matches useHandControl's own smoothing — the same EMA, reusing lib/hand.ts's
// smoothPoint rather than a second copy of it. Iris centers are noisier than a
// fingertip relative to their own size, so this leans a little heavier.
const SMOOTHING_ALPHA = 0.4;

const EMPTY_STATE: EyeState = { active: false, present: false, acquiredAt: 0, eyes: [] };

/**
 * Decorative iris tracking (eye-tracking-hud), powered by MediaPipe
 * FaceLandmarker — a sibling task to the GestureRecognizer useHandControl
 * already runs, sharing its FilesetResolver and WASM fileset.
 *
 * Takes the `MediaStream` useHandControl already opened and drives its own
 * detached `<video>` from it (design D3), so there is exactly one camera
 * session and one permission prompt, and the hook is surface-agnostic: it
 * lives at App level and survives a deck↔HUD switch without re-initializing
 * the model, which attaching to either preview's video ref would force.
 *
 * Returns the same dual `{ state, stateRef }` shape as useHandControl: `state`
 * is published only when presence changes, `stateRef` every frame.
 */
export function useEyeTracking(stream: MediaStream | null, enabled: boolean) {
  const [state, setState] = useState<EyeState>(EMPTY_STATE);
  const stateRef = useRef<EyeState>(EMPTY_STATE);

  useEffect(() => {
    if (!enabled || !stream) {
      stateRef.current = EMPTY_STATE;
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let landmarker: FaceLandmarker | null = null;
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;

    const smoothById = new Map<string, EyePoint>();
    let published = EMPTY_STATE;
    let hadFace = false;
    let acquiredAt = 0;

    function publish(next: EyeState) {
      stateRef.current = next;
      if (!presenceEquals(next, published)) {
        published = next;
        setState(next);
      }
    }

    async function setup() {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          // Both left off (design D1): this HUD needs iris position and size
          // only, and the plain face_landmarker.task variant is what's
          // vendored. Stated rather than defaulted so the choice is visible.
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        video.srcObject = stream;
        await video.play();

        if (cancelled) return;
        publish({ ...EMPTY_STATE, active: true });
        loop();
      } catch {
        // Spec: "A failed model load degrades quietly" — an unsupported
        // environment or a missing model asset leaves the overlays unmounted
        // and surfaces nothing. Purely decorative; there is nothing the user
        // could do about it, and the camera dock itself is unaffected.
      }
    }

    function trackEye(id: TrackedEye["id"], landmarks: EyePoint[], ring: number[]): TrackedEye | null {
      const points: EyePoint[] = [];
      for (const index of ring) {
        const landmark = landmarks[index];
        if (!landmark) return null;
        // Mirrored for the same reason useHandControl mirrors its landmarks:
        // the preview video is CSS-mirrored, so overlay coordinates are
        // mirrored to match rather than the CSS compensating afterwards.
        points.push({ x: 1 - landmark.x, y: landmark.y });
      }
      const raw = irisCenter(points);
      const center = smoothPoint(smoothById.get(id) ?? null, raw, SMOOTHING_ALPHA);
      smoothById.set(id, center);
      return { id, center, radius: irisRadius(raw, points) };
    }

    function loop() {
      if (cancelled || !landmarker) return;
      if (video.readyState >= 2) {
        const now = performance.now();
        const result = landmarker.detectForVideo(video, now);
        const landmarks = result.faceLandmarks?.[0];

        // Fixed order, never sorted (task 8.3): index EYE_READOUT is always the
        // anatomically-left iris and index EYE_RING always the right one, so
        // the assignment cannot flip between frames or sessions.
        const eyes = landmarks
          ? [trackEye("left", landmarks, LEFT_IRIS_RING), trackEye("right", landmarks, RIGHT_IRIS_RING)].filter(
              (eye): eye is TrackedEye => eye !== null,
            )
          : [];

        if (eyes.length === 2) {
          if (!hadFace) {
            hadFace = true;
            acquiredAt = now;
          }
          publish({ active: true, present: true, acquiredAt, eyes });
        } else if (hadFace) {
          // Only on the transition out — an empty frame after another empty
          // frame does no work, matching useHandControl's own gate.
          smoothById.clear();
          hadFace = false;
          publish({ ...EMPTY_STATE, active: true });
        }
      }
      raf = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      // The stream belongs to useHandControl, which stops its tracks — this
      // hook only detaches its own video element from it.
      video.srcObject = null;
    };
  }, [enabled, stream]);

  return { state, stateRef };
}
