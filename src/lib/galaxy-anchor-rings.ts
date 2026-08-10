import * as THREE from "three";

// Canvas mechanics for the galaxy's anchor marks (galaxy-note-reachable-by-hand
// design.md D10) — the faint ring on the node a grab WOULD anchor to, and the
// stronger ring on the node the camera is actually turning around.
//
// Same shape and the same untested-for-a-stated-reason as
// `galaxy-label-sprites.ts`: it needs a 2D canvas context, and `src/**/*.test.ts`
// runs in vitest's `node` environment (vitest.config.mjs) where `document` does
// not exist. Its correctness is covered by the manual pass.
//
// Sprites rather than `RingGeometry` meshes, deliberately: a ring drawn as
// geometry has to be re-oriented toward the camera every frame, which would put
// the camera into `apply()`'s signature and add a `lookAt` per mark. A sprite
// faces the camera by construction, so `apply` stays a position write.
//
// `apply` mutates in place and allocates nothing: the gesture loop already
// allocates per frame (a `Vector3` per camera write, plus a
// `getBoundingClientRect()`), and marks that ran every frame must not add to
// that.

const CANVAS_SIZE = 128;

// Both marks are ACHROMATIC on purpose (design.md 4.2 / the spec's "not
// confusable with the highlight or the focus"). Every other galaxy treatment is
// a hue — the six TAG_COLORS, the ghost grey-blue, DWELL_HIGHLIGHT_COLOR's
// yellow, FOCUS_HIGHLIGHT_COLOR's green — so picking a seventh hue would put
// these marks into the same visual channel as "which tag is this" and "is this
// focused". A neutral outline at two weights sits in a different channel
// entirely: the marks differ from every node treatment in SHAPE (a ring around
// the dot, not the dot's colour) and from each other in WEIGHT.
const CANDIDATE_COLOR = "rgba(214, 228, 255, 0.42)";
const CANDIDATE_LINE_PX = 5;
const ANCHOR_COLOR = "rgba(255, 255, 255, 0.80)";
const ANCHOR_LINE_PX = 6;
// The same ring again, drawn heavier, shown ONLY while a camera drive is
// actually engaged (galaxy-note-reachable-by-hand tasks.md 6.5, from the manual
// pass): closing a fist has to pass MediaPipe's three-consecutive-frame pose
// gate before anything can happen, and with no mark for "the grab caught" that
// unavoidable delay reads as the anchor being slow to move. A distinct engaged
// state turns the wait into visible confirmation.
const ENGAGED_COLOR = "rgba(255, 255, 255, 0.92)";
const ENGAGED_LINE_PX = 9;

// World-space diameters. A node's own sphere is ~4 units (three-forcegraph's
// default `nodeRelSize`), so every ring stands clear of the dot it marks, and
// the engaged one is the widest.
//
// Kept as tight to the dot as that clearance allows (D22). The title sits
// ~3.5-8.5 units above the node, so a ring wide enough to clear the dot at all
// necessarily crosses the text band — the label's own render order is what
// keeps the words legible over it, but a fat, bright ring still costs contrast
// behind them. These were 16/24/34 with 5/9/14px strokes, which at the new
// arrival distance read as a white disc around the note rather than a ring on
// it. Narrower and dimmer marks say the same thing and cover less of it.
// The ACQUIRING mark (design.md D23): a new note is under the sight and
// charging toward a lock. It is the same ring, drawn at a size that shrinks
// from `ACQUIRE_START_WORLD_SIZE` down onto `ANCHOR_WORLD_SIZE` as the charge
// completes — a closing reticle. Scaling a sprite is a `scale.set()`, so
// animating it per frame costs nothing and repaints no canvas.
//
// Shrinking rather than filling, because it has to answer two questions at
// once: "is there a note here at all" (a ring appears, where empty space shows
// nothing) and "how much longer" (it closes). A colour or opacity ramp answers
// only the second.
// The LOCK mark, and the one deliberate exception to the achromatic rule
// above. The lock stopped being "the anchor the camera happens to use" and
// became the BASIS of every hand gesture: what a fist turns around, what a
// zoom flies toward, what the whole language is addressed to. A user who
// cannot see whether they have one cannot tell why the same gesture does
// something or nothing, and that ambiguity is what made the drives feel
// arbitrary. Red because it must not be mistaken for the dwell's yellow or the
// focus's green, and because none of the six tag hues is a red — it stays out
// of the "which tag is this" channel it would otherwise join.
const LOCK_COLOR = "rgba(255, 45, 45, 0.95)";
const LOCK_LINE_PX = 7;
const LOCK_WORLD_SIZE = 20;

const ACQUIRE_COLOR = "rgba(255, 255, 255, 0.85)";
const ACQUIRE_LINE_PX = 6;
const ACQUIRE_START_WORLD_SIZE = 44;

const CANDIDATE_WORLD_SIZE = 13;
const ANCHOR_WORLD_SIZE = 17;
const ENGAGED_WORLD_SIZE = 23;

export type Vec3Like = { x: number; y: number; z: number };

function createRingSprite(color: string, lineWidthPx: number, worldSize: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.beginPath();
  ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - lineWidthPx, 0, Math.PI * 2);
  ctx.lineWidth = lineWidthPx;
  ctx.strokeStyle = color;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  // Same non-power-of-two caution the label pool documents: default mipmapping
  // on a canvas texture either warns or samples wrong.
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    // A mark must read even when the node it marks is behind other geometry —
    // it answers "what would I grab", which is useless if the dense core hides
    // it. `depthTest: false` is why, and `depthWrite: false` keeps it from
    // punching a hole in anything drawn after.
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldSize, worldSize, 1);
  sprite.visible = false;
  // Drawn after the graph's own objects, so the ring is not swallowed by the
  // node sphere it surrounds.
  sprite.renderOrder = 2;
  return sprite;
}

export type AnchorRings = {
  group: THREE.Group;
  /**
   * Positions and shows each ring, hiding any whose position is null. Mutates
   * in place — allocates nothing.
   *
   * `engaged` says a camera drive is live, which adds the heavier outer ring.
   * The caller also stops passing a candidate then: the candidate cannot change
   * while a drive holds the camera, so leaving it drawn would mark a choice the
   * user can no longer make (6.5).
   */
  apply(
    candidatePos: Vec3Like | null,
    anchorPos: Vec3Like | null,
    engaged: boolean,
    acquiringPos: Vec3Like | null,
    acquireProgress: number,
    lockedPos: Vec3Like | null,
  ): void;
  /** Disposes every texture/material and removes `group` from its parent. */
  dispose(): void;
};

/**
 * The candidate/anchor ring pair, in one `THREE.Group` the caller adds to the
 * graph's scene (galaxy-note-reachable-by-hand design.md D10).
 */
export function createRingPair(): AnchorRings {
  const group = new THREE.Group();
  const candidate = createRingSprite(CANDIDATE_COLOR, CANDIDATE_LINE_PX, CANDIDATE_WORLD_SIZE);
  const anchor = createRingSprite(ANCHOR_COLOR, ANCHOR_LINE_PX, ANCHOR_WORLD_SIZE);
  const engagedRing = createRingSprite(ENGAGED_COLOR, ENGAGED_LINE_PX, ENGAGED_WORLD_SIZE);
  const acquiring = createRingSprite(ACQUIRE_COLOR, ACQUIRE_LINE_PX, ACQUIRE_START_WORLD_SIZE);
  const locked = createRingSprite(LOCK_COLOR, LOCK_LINE_PX, LOCK_WORLD_SIZE);
  group.add(locked);
  group.add(candidate);
  group.add(anchor);
  group.add(engagedRing);
  group.add(acquiring);

  function apply(
    candidatePos: Vec3Like | null,
    anchorPos: Vec3Like | null,
    engaged: boolean,
    acquiringPos: Vec3Like | null,
    acquireProgress: number,
    lockedPos: Vec3Like | null,
  ) {
    if (lockedPos) {
      locked.position.set(lockedPos.x, lockedPos.y, lockedPos.z);
      locked.visible = true;
    } else {
      locked.visible = false;
    }
    if (acquiringPos) {
      acquiring.position.set(acquiringPos.x, acquiringPos.y, acquiringPos.z);
      const t = Math.max(0, Math.min(1, acquireProgress));
      const size = ACQUIRE_START_WORLD_SIZE + (ANCHOR_WORLD_SIZE - ACQUIRE_START_WORLD_SIZE) * t;
      acquiring.scale.set(size, size, 1);
      acquiring.visible = true;
    } else {
      acquiring.visible = false;
    }
    if (candidatePos) {
      candidate.position.set(candidatePos.x, candidatePos.y, candidatePos.z);
      candidate.visible = true;
    } else {
      candidate.visible = false;
    }
    if (anchorPos) {
      anchor.position.set(anchorPos.x, anchorPos.y, anchorPos.z);
      anchor.visible = true;
      engagedRing.position.set(anchorPos.x, anchorPos.y, anchorPos.z);
      engagedRing.visible = engaged;
    } else {
      anchor.visible = false;
      engagedRing.visible = false;
    }
  }

  function dispose() {
    for (const sprite of [candidate, anchor, engagedRing, acquiring, locked]) {
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    group.parent?.remove(group);
  }

  return { group, apply, dispose };
}
